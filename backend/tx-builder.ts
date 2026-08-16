import { getNetworkConfig } from "../shared/network";
import type { NetworkConfig } from "../shared/types";
import { scriptPublicKeyForAddress } from "./kaspa-address";
import type { UtxoResponse } from "./kaspa-api-types";

export const SOMIPI_PER_KASPA = 100_000_000n;

// Mass model per kaspad (util/txmass/calculator.go + consensus defaults).
// Verified live: a 1-in/2-out P2PK v0 tx has mass 2036; required fee = mass × feerate.
const MASS_PER_TX_BYTE = 1;
const MASS_PER_SCRIPT_PUBKEY_BYTE = 10;
const MASS_PER_SIGOP = 1000;
// Signed P2PK signature script length: "41" + 64-byte Schnorr sig + "01" (SIGHASH_ALL).
// The node computes mass on the signed tx, so fee estimation assumes each input carries this.
const SIGNED_SIG_SCRIPT_LENGTH = 66;
const SUBNETWORK_ID_LENGTH = 20;
const PAYLOAD_HASH_LENGTH = 32;

const SUB_NETWORK_ID = "0".repeat(SUBNETWORK_ID_LENGTH * 2);
const TEMPLATE_ID_PLACEHOLDER = "0".repeat(64);

export type TxBuilderErrorKind =
  | "insufficient-funds"
  | "invalid-amount"
  | "invalid-address";

export class TxBuilderError extends Error {
  readonly kind: TxBuilderErrorKind;

  constructor(kind: TxBuilderErrorKind, message: string) {
    super(message);
    this.name = "TxBuilderError";
    this.kind = kind;
  }
}

export interface SignInput {
  transactionId: string;
  index: number;
}

export interface SigningTemplateInput {
  transactionId: string;
  index: number;
  sequence: string;
  sigOpCount: number;
  computeBudget: number;
  signatureScript: string;
  utxo: {
    amount: string;
    scriptPublicKey: string;
    blockDaaScore: string;
    isCoinbase: boolean;
  };
}

export interface SigningTemplateOutput {
  value: string;
  scriptPublicKey: string;
  covenant: null;
}

// Safe-JSON schema for a kaspa-wasm Transaction, per the spike's verified
// template format (hand-built in pure TS, signed by Kastle, submitted via REST).
export interface SigningTemplate {
  id: string;
  version: number;
  inputs: SigningTemplateInput[];
  outputs: SigningTemplateOutput[];
  subnetworkId: string;
  lockTime: string;
  gas: string;
  storageMass: string;
  payload: string;
}

export interface BuiltTransfer {
  signing_template: SigningTemplate;
  sign_inputs: SignInput[];
  fee_sompi: string;
  change_sompi: string;
}

export interface BuildTransferInput {
  utxos: UtxoResponse[];
  userAddress: string;
  groupAddress: string;
  amountSompi: string;
  feerate: number;
  config?: NetworkConfig;
}

export function kaspaToSompi(kaspa: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(kaspa.trim());
  if (match === null) {
    throw new TxBuilderError("invalid-amount", `Not a valid KAS amount: ${kaspa}`);
  }
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(8, "0");
  return whole * SOMIPI_PER_KASPA + BigInt(fraction === "" ? "0" : fraction);
}

export function sompiToKaspa(sompi: bigint): string {
  if (sompi < 0n) {
    throw new TxBuilderError("invalid-amount", "sompi cannot be negative");
  }
  const whole = sompi / SOMIPI_PER_KASPA;
  const fraction = (sompi % SOMIPI_PER_KASPA).toString().padStart(8, "0");
  if (fraction === "00000000") {
    return whole.toString();
  }
  return `${whole}.${fraction.replace(/0+$/, "")}`;
}

export function estimateMass(
  numInputs: number,
  outputScriptLengths: readonly number[],
): number {
  let size =
    2 + // version
    8 + // number of inputs (uint64)
    numInputs * (32 + 4 + 8 + SIGNED_SIG_SCRIPT_LENGTH + 8) + // outpoint + sig len + sig + sequence
    8 + // number of outputs (uint64)
    8 + // lock time (uint64)
    SUBNETWORK_ID_LENGTH +
    8 + // gas (uint64)
    PAYLOAD_HASH_LENGTH +
    8; // payload length (uint64)
  for (const len of outputScriptLengths) {
    size += 8 + 2 + 8 + len; // value + spk version + spk len + spk
  }
  const scriptPubKeySize = outputScriptLengths.reduce((acc, len) => acc + 2 + len, 0);
  const sigOps = numInputs;
  return (
    size * MASS_PER_TX_BYTE +
    scriptPubKeySize * MASS_PER_SCRIPT_PUBKEY_BYTE +
    sigOps * MASS_PER_SIGOP
  );
}

export function estimateFee(
  numInputs: number,
  outputScriptLengths: readonly number[],
  feerate: number,
): bigint {
  const mass = estimateMass(numInputs, outputScriptLengths);
  return BigInt(Math.ceil(mass * feerate));
}

function parseAmount(amountSompi: string): bigint {
  if (!/^\d+$/.test(amountSompi)) {
    throw new TxBuilderError(
      "invalid-amount",
      `amount_sompi must be a non-negative integer string, got: ${amountSompi}`,
    );
  }
  const amount = BigInt(amountSompi);
  if (amount <= 0n) {
    throw new TxBuilderError("invalid-amount", "amount_sompi must be positive");
  }
  return amount;
}

function sortUtxos(utxos: UtxoResponse[]): UtxoResponse[] {
  return [...utxos].sort((a, b) => {
    const amountDiff = BigInt(a.utxoEntry.amount) - BigInt(b.utxoEntry.amount);
    if (amountDiff !== 0n) {
      return amountDiff > 0n ? -1 : 1;
    }
    if (a.outpoint.transactionId !== b.outpoint.transactionId) {
      return a.outpoint.transactionId < b.outpoint.transactionId ? -1 : 1;
    }
    return a.outpoint.index - b.outpoint.index;
  });
}

// Selects inputs to cover amount + fee, deterministically largest-first.
// Returns the number of inputs used and the resulting fee/change for the
// final output set (1 output = no change, 2 outputs = payment + change).
function selectInputs(
  sorted: UtxoResponse[],
  amount: bigint,
  feerate: number,
  outputScriptLengths: [number, number],
): { numInputs: number; fee: bigint; change: bigint; numOutputs: 1 | 2 } {
  let numInputs = 0;
  let sum = 0n;
  while (numInputs < sorted.length) {
    const fee = estimateFee(numInputs, outputScriptLengths, feerate);
    if (sum >= amount + fee) {
      break;
    }
    sum += BigInt(sorted[numInputs].utxoEntry.amount);
    numInputs++;
  }
  if (numInputs === 0) {
    throw new TxBuilderError("insufficient-funds", "No inputs selected");
  }

  let fee = estimateFee(numInputs, outputScriptLengths, feerate);
  if (sum < amount + fee) {
    throw new TxBuilderError(
      "insufficient-funds",
      `Balance ${sum} cannot cover amount ${amount} + fee ${fee}`,
    );
  }

  const change = sum - amount - fee;
  if (change > 0n) {
    return { numInputs, fee, change, numOutputs: 2 };
  }
  // change === 0 → omit the change output entirely; the whole remainder
  // becomes the fee (slightly more than the 1-output minimum, which is safe).
  return { numInputs, fee: sum - amount, change: 0n, numOutputs: 1 };
}

function scriptHexFor(address: string, prefix: string): string {
  const script = scriptPublicKeyForAddress(address, prefix);
  if (script === null) {
    throw new TxBuilderError("invalid-address", `Cannot decode address: ${address}`);
  }
  return script;
}

export function buildTransfer(input: BuildTransferInput): BuiltTransfer {
  const config = input.config ?? getNetworkConfig();
  const prefix = config.addressPrefix.replace(/:$/, "");

  const amount = parseAmount(input.amountSompi);
  if (!Number.isFinite(input.feerate) || input.feerate <= 0) {
    throw new TxBuilderError(
      "invalid-amount",
      `feerate must be a positive number, got: ${input.feerate}`,
    );
  }

  const paymentScript = scriptHexFor(input.groupAddress, prefix);
  const changeScript = scriptHexFor(input.userAddress, prefix);
  const outputScriptLengths: [number, number] = [
    paymentScript.length / 2,
    changeScript.length / 2,
  ];

  const sorted = sortUtxos(input.utxos);
  const { numInputs, fee, change, numOutputs } = selectInputs(
    sorted,
    amount,
    input.feerate,
    outputScriptLengths,
  );

  const selected = sorted.slice(0, numInputs);

  const templateInputs: SigningTemplateInput[] = selected.map((utxo) => ({
    transactionId: utxo.outpoint.transactionId,
    index: utxo.outpoint.index,
    sequence: "0",
    sigOpCount: 1,
    computeBudget: 0,
    signatureScript: "",
    utxo: {
      amount: utxo.utxoEntry.amount,
      scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}`,
      blockDaaScore: utxo.utxoEntry.blockDaaScore,
      isCoinbase: utxo.utxoEntry.isCoinbase,
    },
  }));

  const outputs: SigningTemplateOutput[] = [
    {
      value: amount.toString(),
      scriptPublicKey: `0000${paymentScript}`,
      covenant: null,
    },
  ];
  if (numOutputs === 2) {
    outputs.push({
      value: change.toString(),
      scriptPublicKey: `0000${changeScript}`,
      covenant: null,
    });
  }

  const signing_template: SigningTemplate = {
    id: TEMPLATE_ID_PLACEHOLDER,
    version: 0,
    inputs: templateInputs,
    outputs,
    subnetworkId: SUB_NETWORK_ID,
    lockTime: "0",
    gas: "0",
    storageMass: "20000",
    payload: "",
  };

  return {
    signing_template,
    sign_inputs: selected.map((utxo) => ({
      transactionId: utxo.outpoint.transactionId,
      index: utxo.outpoint.index,
    })),
    fee_sompi: fee.toString(),
    change_sompi: change.toString(),
  };
}
