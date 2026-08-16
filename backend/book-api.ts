import { getNetworkConfig, proofUrl } from "../shared/network";
import type { NetworkConfig } from "../shared/types";
import type { Book, BookDirection, BookRow } from "../shared/types";
import { AppError, requiredStr, toRouteResult, validInt, validUint } from "./errors";
import type { RouteResult } from "./errors";
import { KaspaClient } from "./kaspa-client";
import { isValidMembershipCode } from "./kaspa-address";
import type { BalanceResponse, TxInput, TxModel, TxOutput } from "./kaspa-api-types";
import { logger } from "./logger";

export interface BookChain {
  getBalance(address: string): Promise<BalanceResponse>;
  getFullTransactions(
    address: string,
    opts: { limit: number; offset: number },
  ): Promise<TxModel[]>;
}

export interface GetBookInput {
  limit?: unknown;
  offset?: unknown;
}

const DEFAULT_PAGE_SIZE = 50;

function requireCode(raw: unknown): string {
  const code = requiredStr(raw, "code");
  if (!isValidMembershipCode(code)) {
    throw new AppError("invalid", "code is not a well-formed address for this network");
  }
  return code;
}

function parsePagination(input: GetBookInput): { limit: number; offset: number } {
  const limit = validInt(input.limit ?? DEFAULT_PAGE_SIZE, "limit");
  if (limit < 1) {
    throw new AppError("invalid", "limit must be a positive integer");
  }
  const offset = validUint(input.offset ?? 0, "offset");
  return { limit, offset };
}

function toSompi(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function outputAddress(output: TxOutput): string | null {
  return typeof output.script_public_key_address === "string" &&
    output.script_public_key_address !== ""
    ? output.script_public_key_address
    : null;
}

function inputAddress(input: TxInput): string | null {
  if (
    typeof input.previous_outpoint_address === "string" &&
    input.previous_outpoint_address !== ""
  ) {
    return input.previous_outpoint_address;
  }
  if (input.previous_outpoint_resolved !== undefined) {
    return outputAddress(input.previous_outpoint_resolved);
  }
  return null;
}

function inputAmount(input: TxInput): bigint | null {
  if (
    typeof input.previous_outpoint_amount === "number" &&
    Number.isFinite(input.previous_outpoint_amount)
  ) {
    return toSompi(input.previous_outpoint_amount);
  }
  if (
    input.previous_outpoint_resolved !== undefined &&
    Number.isFinite(input.previous_outpoint_resolved.amount)
  ) {
    return toSompi(input.previous_outpoint_resolved.amount);
  }
  return null;
}

// in when the group address is among the outputs, out when among the inputs.
// A transaction that touches the group on both sides counts as in.
export function deriveDirection(
  groupAddress: string,
  tx: TxModel,
): BookDirection | null {
  const receives = tx.outputs.some((output) => outputAddress(output) === groupAddress);
  if (receives) return "in";
  const spends = tx.inputs.some((input) => inputAddress(input) === groupAddress);
  if (spends) return "out";
  return null;
}

// The counterparty: the sender for money coming in, the receiver for money
// going out. Deterministic — first distinct address that is not the group.
export function selectOtherParty(
  groupAddress: string,
  tx: TxModel,
  direction: BookDirection,
): string | null {
  const candidates =
    direction === "in" ? tx.inputs.map(inputAddress) : tx.outputs.map(outputAddress);
  for (const address of candidates) {
    if (address !== null && address !== groupAddress) {
      return address;
    }
  }
  return null;
}

// The group-facing amount: what the group received (outputs to the group) when
// the direction is in, what the group spent (inputs from the group) when out.
function groupAmount(
  groupAddress: string,
  tx: TxModel,
  direction: BookDirection,
): bigint | null {
  if (direction === "in") {
    const amounts = tx.outputs
      .filter((output) => outputAddress(output) === groupAddress)
      .map((output) => toSompi(output.amount));
    if (amounts.length === 0) return null;
    return amounts.reduce((acc, amount) => acc + amount, 0n);
  }
  const amounts: bigint[] = [];
  for (const input of tx.inputs) {
    if (inputAddress(input) !== groupAddress) continue;
    const amount = inputAmount(input);
    if (amount === null) return null;
    amounts.push(amount);
  }
  if (amounts.length === 0) return null;
  return amounts.reduce((acc, amount) => acc + amount, 0n);
}

export function deriveBookRow(
  groupAddress: string,
  tx: TxModel,
  network: NetworkConfig,
): BookRow | null {
  const direction = deriveDirection(groupAddress, tx);
  if (direction === null) return null;
  const amount = groupAmount(groupAddress, tx, direction);
  if (amount === null) return null;
  const otherAddress = selectOtherParty(groupAddress, tx, direction);
  if (otherAddress === null) return null;
  return {
    direction,
    amount_sompi: amount.toString(),
    other_address: otherAddress,
    date: tx.block_time,
    txid: tx.transaction_id,
    proof_url: proofUrl(network, tx.transaction_id),
    is_accepted: tx.is_accepted,
  };
}

// Every transaction the chain reports, newest first by block_time (ties broken
// by txid), and never a row the chain does not support. The chain's own
// acceptance verdict is carried on each row; the book does not hide rejected
// or not-yet-accepted payments.
export function bookRowsForPage(
  groupAddress: string,
  txs: readonly TxModel[],
  network: NetworkConfig,
): BookRow[] {
  return txs
    .map((tx) => deriveBookRow(groupAddress, tx, network))
    .filter((row): row is BookRow => row !== null)
    .sort(
      (a, b) =>
        b.date - a.date ||
        (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0),
    );
}

export async function handleGetBook(
  code: unknown,
  input: GetBookInput = {},
  chain: BookChain = new KaspaClient(),
): Promise<RouteResult> {
  try {
    const address = requireCode(code);
    const { limit, offset } = parsePagination(input);
    const network = getNetworkConfig();
    const [balance, txs] = await Promise.all([
      chain.getBalance(address),
      chain.getFullTransactions(address, { limit, offset }),
    ]);
    const book: Book = {
      balance_sompi: toSompi(balance.balance).toString(),
      rows: bookRowsForPage(address, txs, network),
    };
    logger.info("book fetched", {
      address,
      limit,
      offset,
      balance_sompi: book.balance_sompi,
      rows: book.rows.length,
      txs: txs.length,
    });
    return { status: 200, body: book };
  } catch (err) {
    return toRouteResult(err);
  }
}
