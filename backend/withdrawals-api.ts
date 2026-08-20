import { getNetworkConfig } from "../shared/network";
import { scriptPublicKeyForAddress } from "./kaspa-address";
import { AppError, requiredStr, toRouteResult } from "./errors";
import type { RouteResult } from "./errors";
import { KaspaClient } from "./kaspa-client";
import type { UtxoResponse } from "./kaspa-api-types";
import { logger } from "./logger";
import type { MembershipStore } from "./membership-store";
import {
  DEFAULT_CONFIRM_POLICY,
  feeRate,
  fetchAuthoritativeAmounts,
  parseSignedTransaction,
  requireAddress,
  requirePositiveSompi,
  toSubmitTxModel,
  verifyAffordability,
  waitForAcceptance,
} from "./payments-api";
import type {
  ConfirmPolicy,
  PaymentChain,
  SignedTransaction,
  SignedTransactionInput,
} from "./payments-api";
import { buildTransfer } from "./tx-builder";
import type { WalletStore } from "./wallet-store";

export const ONLY_MEMBER_RECIPIENT_COPY =
  "Only members can receive money from this fund.";
export const NOT_A_GROUP_COPY = "This isn't a registered group.";

export interface WithdrawalInput {
  fund_address?: unknown;
  recipient_address?: unknown;
  amount_sompi?: unknown;
}

export interface FinalizeWithdrawalInput extends WithdrawalInput {
  signed?: unknown;
}

async function resolveFundAndMember(
  fundAddress: string,
  recipientAddress: string,
  store: MembershipStore,
  wallets: WalletStore,
): Promise<void> {
  const fund = await wallets.get(fundAddress);
  if (fund === null || fund.kind !== "group") {
    logger.warn("withdrawal refused", {
      fundAddress,
      recipientAddress,
      reason: "not-a-registered-fund",
    });
    throw new AppError("invalid", NOT_A_GROUP_COPY);
  }
  if (fundAddress === recipientAddress) {
    logger.warn("withdrawal refused", { fundAddress, reason: "self-recipient" });
    throw new AppError("invalid", "A fund cannot send money to itself.");
  }
  if (!(await store.isMember(fundAddress, recipientAddress))) {
    logger.warn("withdrawal refused", {
      fundAddress,
      recipientAddress,
      reason: "recipient-not-a-member",
    });
    throw new AppError("policy", ONLY_MEMBER_RECIPIENT_COPY);
  }
}

function parseWithdrawalAmounts(
  requester: string,
  input: WithdrawalInput,
): {
  fundAddress: string;
  recipientAddress: string;
  amountSompi: string;
} {
  const fundAddress = requireAddress(input.fund_address, "fund_address");
  const recipientAddress = requireAddress(input.recipient_address, "recipient_address");
  const amountSompi = requirePositiveSompi(input.amount_sompi);
  if (fundAddress !== requester) {
    logger.warn("withdrawal refused", { fundAddress, requester, reason: "not-the-fund" });
    throw new AppError("unauthorized", "Only the fund can withdraw.");
  }
  return { fundAddress, recipientAddress, amountSompi };
}

// The signed transaction must pay exactly the requested amount to the
// recipient — a single output with the recipient's script and value.
function requireRecipientOutput(
  signed: SignedTransaction,
  recipientAddress: string,
  amountSompi: string,
): void {
  const script = scriptPublicKeyForAddress(
    recipientAddress,
    getNetworkConfig().addressPrefix.replace(/:$/, ""),
  );
  if (script === null) {
    throw new AppError("invalid", "recipient_address is not a valid address on this network");
  }
  const expected = `0000${script}`.toLowerCase();
  const matches = signed.outputs.filter(
    (output) => output.scriptPublicKey.toLowerCase() === expected,
  );
  if (matches.length !== 1 || matches[0].value !== amountSompi) {
    throw new AppError(
      "policy",
      "Signed transaction must pay exactly the requested amount to the recipient",
    );
  }
}

async function fetchAuthoritativeInputAddresses(
  chain: PaymentChain,
  inputs: SignedTransactionInput[],
): Promise<string[]> {
  const addresses: string[] = [];
  for (const input of inputs) {
    const tx = await chain.getTransaction(input.transactionId);
    const output = tx.outputs.find((candidate) => candidate.index === input.index);
    if (output === undefined) {
      throw new AppError(
        "invalid",
        `Input outpoint ${input.transactionId}:${input.index} does not exist on the chain`,
      );
    }
    const address =
      typeof output.script_public_key_address === "string" &&
      output.script_public_key_address !== ""
        ? output.script_public_key_address
        : null;
    if (address === null) {
      throw new AppError("policy", "A withdrawal input does not belong to the fund wallet");
    }
    addresses.push(address);
  }
  return addresses;
}

export async function handlePrepareWithdrawal(
  store: MembershipStore,
  wallets: WalletStore,
  requester: string,
  input: WithdrawalInput,
  chain: PaymentChain = new KaspaClient(),
): Promise<RouteResult> {
  try {
    const { fundAddress, recipientAddress, amountSompi } = parseWithdrawalAmounts(requester, input);
    await resolveFundAndMember(fundAddress, recipientAddress, store, wallets);
    const feerate = await feeRate(chain);
    const utxos: UtxoResponse[] = await chain.getUtxos(fundAddress);
    const built = buildTransfer({
      utxos,
      userAddress: fundAddress,
      groupAddress: recipientAddress,
      amountSompi,
      feerate,
    });
    logger.info("withdrawal prepared", {
      fundAddress,
      recipientAddress,
      amountSompi,
      feerate,
      utxos: utxos.length,
      inputs: built.sign_inputs.length,
      fee_sompi: built.fee_sompi,
      change_sompi: built.change_sompi,
    });
    return {
      status: 200,
      body: { signing_template: JSON.stringify(built.signing_template) },
    };
  } catch (err) {
    return toRouteResult(err);
  }
}

export async function handleFinalizeWithdrawal(
  store: MembershipStore,
  wallets: WalletStore,
  requester: string,
  input: FinalizeWithdrawalInput,
  chain: PaymentChain = new KaspaClient(),
  policy: ConfirmPolicy = DEFAULT_CONFIRM_POLICY,
): Promise<RouteResult> {
  try {
    const { fundAddress, recipientAddress, amountSompi } = parseWithdrawalAmounts(requester, input);
    await resolveFundAndMember(fundAddress, recipientAddress, store, wallets);
    const signed = parseSignedTransaction(requiredStr(input.signed, "signed"));
    const inputAmounts = await fetchAuthoritativeAmounts(chain, signed.inputs);
    const inputAddresses = await fetchAuthoritativeInputAddresses(chain, signed.inputs);
    if (inputAddresses.some((address) => address !== fundAddress)) {
      logger.warn("withdrawal refused", { fundAddress, reason: "input-not-from-fund" });
      throw new AppError("policy", "A withdrawal must spend from the fund wallet");
    }
    requireRecipientOutput(signed, recipientAddress, amountSompi);
    const feerate = await feeRate(chain);
    verifyAffordability(signed, inputAmounts, feerate);
    const response = await chain.broadcastTransaction(toSubmitTxModel(signed));
    if (response.transactionId !== undefined && response.transactionId !== "") {
      const txid = response.transactionId.toLowerCase();
      const accepted = await waitForAcceptance(chain, txid, policy);
      logger.info("withdrawal finalized", {
        txid,
        accepted,
        fundAddress,
        recipientAddress,
        amount_sompi: amountSompi,
      });
      if (accepted) {
        return { status: 200, body: { status: "recorded", txid } };
      }
      return {
        status: 202,
        body: {
          status: "pending",
          txid,
        },
      };
    }
    logger.warn("withdrawal rejected by node", { error: response.error });
    throw new AppError("conflict", response.error ?? "Transaction was rejected by the node");
  } catch (err) {
    return toRouteResult(err);
  }
}