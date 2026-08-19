import { getNetworkConfig, proofUrl } from "../shared/network";
import { scriptPublicKeyForAddress } from "./kaspa-address";
import { AppError, requiredStr, toRouteResult } from "./errors";
import type { RouteResult } from "./errors";
import { KaspaClient } from "./kaspa-client";
import type {
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";
import { buildTransfer, estimateFee } from "./tx-builder";
import { logger } from "./logger";
import type { WalletStore } from "./wallet-store";

export const UNREGISTERED_PAYER_COPY =
  "Name your wallet in the app before you can pay.";

export interface PaymentChain {
  getUtxos(address: string): Promise<UtxoResponse[]>;
  getTransaction(txid: string): Promise<TxModel>;
  getFeeEstimate(): Promise<FeeEstimateResponse>;
  broadcastTransaction(transaction: SubmitTxModel): Promise<SubmitTransactionResponse>;
}

export interface PrepareInput {
  chama_address?: unknown;
  amount_sompi?: unknown;
}

export interface FinalizeInput {
  signed?: unknown;
}

export interface ConfirmPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleeper?: (ms: number) => Promise<void>;
}

// Six checks with doubling backoff (1s, 2s, 4s, 8s, 8s) ≈ 23s of wall time.
// Testnet blocks in ~1s, so acceptance normally lands on the first or second
// check; the budget only matters for a tx stuck near the DAG tip.
export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = {
  maxAttempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

function defaultSleeper(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls until the broadcast tx is accepted on chain. A tx near the tip can
// report is_accepted === false before flipping to true, so only acceptance is
// decisive; false and transient 404s keep the loop alive. Returns true when
// accepted, false when the budget is spent without a verdict.
export async function waitForAcceptance(
  chain: PaymentChain,
  txid: string,
  policy: ConfirmPolicy = DEFAULT_CONFIRM_POLICY,
): Promise<boolean> {
  const sleeper = policy.sleeper ?? defaultSleeper;
  let delay = policy.baseDelayMs;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      const tx = await chain.getTransaction(txid);
      if (tx.is_accepted) return true;
    } catch {
      // not yet visible — keep polling
    }
    if (attempt < policy.maxAttempts - 1) {
      await sleeper(delay);
      delay = Math.min(delay * 2, policy.maxDelayMs);
    }
  }
  return false;
}

export interface SignedTransactionInput {
  transactionId: string;
  index: number;
  sequence: string;
  sigOpCount: number;
  computeBudget: number;
  signatureScript: string;
}

export interface SignedTransactionOutput {
  value: string;
  scriptPublicKey: string;
}

export interface SignedTransaction {
  id: string;
  version: number;
  inputs: SignedTransactionInput[];
  outputs: SignedTransactionOutput[];
  subnetworkId: string;
  lockTime: string;
  gas: string;
  storageMass: string;
  payload: string;
}

function requireString(value: unknown, field: string): string {
  return requiredStr(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addressPrefix(): string {
  return getNetworkConfig().addressPrefix.replace(/:$/, "");
}

export function requireAddress(value: unknown, field: string): string {
  const raw = requireString(value, field);
  if (scriptPublicKeyForAddress(raw, addressPrefix()) === null) {
    throw new AppError("invalid", `${field} is not a valid address on this network`);
  }
  return raw;
}

export function requirePositiveSompi(value: unknown): string {
  const raw = requireString(value, "amount_sompi");
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new AppError(
      "invalid",
      "amount_sompi must be a positive integer amount of sompi",
    );
  }
  return raw;
}

function parseUintString(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value.toString();
  }
  throw new AppError("invalid", `${field} must be a non-negative integer`);
}

function parseSignedInput(value: unknown, index: number): SignedTransactionInput {
  if (!isRecord(value)) {
    throw new AppError("invalid", `signed.inputs[${index}] must be an object`);
  }
  const transactionId = value.transactionId;
  if (typeof transactionId !== "string" || !/^[0-9a-fA-F]{64}$/.test(transactionId)) {
    throw new AppError("invalid",
      `signed.inputs[${index}].transactionId must be a 64-character hex string`,
    );
  }
  const outputIndex = value.index;
  if (typeof outputIndex !== "number" || !Number.isInteger(outputIndex) || outputIndex < 0) {
    throw new AppError("invalid",
      `signed.inputs[${index}].index must be a non-negative integer`,
    );
  }
  const sigOpCount = value.sigOpCount;
  if (typeof sigOpCount !== "number" || !Number.isInteger(sigOpCount) || sigOpCount <= 0) {
    throw new AppError("invalid",
      `signed.inputs[${index}].sigOpCount must be a positive integer`,
    );
  }
  const signatureScript = value.signatureScript;
  if (
    typeof signatureScript !== "string" ||
    signatureScript.length === 0 ||
    signatureScript.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(signatureScript)
  ) {
    throw new AppError("invalid",
      `signed.inputs[${index}].signatureScript must be non-empty hex`,
    );
  }
  return {
    transactionId: transactionId.toLowerCase(),
    index: outputIndex,
    sequence: parseUintString(value.sequence, `signed.inputs[${index}].sequence`),
    sigOpCount,
    computeBudget:
      typeof value.computeBudget === "number" && Number.isInteger(value.computeBudget)
        ? value.computeBudget
        : 0,
    signatureScript: signatureScript.toLowerCase(),
  };
}

function parseSignedOutput(value: unknown, index: number): SignedTransactionOutput {
  if (!isRecord(value)) {
    throw new AppError("invalid", `signed.outputs[${index}] must be an object`);
  }
  const amount = value.value;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new AppError("invalid",
      `signed.outputs[${index}].value must be a numeric string of sompi`,
    );
  }
  const scriptPublicKey = value.scriptPublicKey;
  if (
    typeof scriptPublicKey !== "string" ||
    scriptPublicKey.length < 4 ||
    scriptPublicKey.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(scriptPublicKey)
  ) {
    throw new AppError("invalid",
      `signed.outputs[${index}].scriptPublicKey must be hex with a version prefix`,
    );
  }
  return { value: amount, scriptPublicKey: scriptPublicKey.toLowerCase() };
}

export function parseSignedTransaction(raw: string): SignedTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("invalid", "signed is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new AppError("invalid", "signed must be a JSON object");
  }
  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new AppError("invalid",
      "signed.version must be a non-negative integer",
    );
  }
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length === 0) {
    throw new AppError("invalid", "signed must have at least one input");
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.length === 0) {
    throw new AppError("invalid", "signed must have at least one output");
  }

  const inputs = parsed.inputs.map((input, index) => parseSignedInput(input, index));
  const outputs = parsed.outputs.map((output, index) => parseSignedOutput(output, index));
  const outpoints = new Set<string>();
  for (const input of inputs) {
    const key = `${input.transactionId}:${input.index}`;
    if (outpoints.has(key)) {
      throw new AppError("invalid", `Duplicate input outpoint ${key}`);
    }
    outpoints.add(key);
  }

  return {
    id: typeof parsed.id === "string" ? parsed.id : "",
    version,
    inputs,
    outputs,
    subnetworkId: typeof parsed.subnetworkId === "string" ? parsed.subnetworkId : "",
    lockTime: typeof parsed.lockTime === "string" ? parsed.lockTime : "0",
    gas: typeof parsed.gas === "string" ? parsed.gas : "0",
    storageMass: typeof parsed.storageMass === "string" ? parsed.storageMass : "0",
    payload: typeof parsed.payload === "string" ? parsed.payload : "",
  };
}

export async function feeRate(chain: PaymentChain): Promise<number> {
  const estimate = await chain.getFeeEstimate();
  const rate = estimate.normalBuckets[0]?.feerate ?? estimate.priorityBucket.feerate;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AppError("upstream", "Upstream returned no usable fee estimate", 502);
  }
  return rate;
}

export async function fetchAuthoritativeAmounts(
  chain: PaymentChain,
  inputs: SignedTransactionInput[],
): Promise<bigint[]> {
  const amounts: bigint[] = [];
  for (const input of inputs) {
    const tx = await chain.getTransaction(input.transactionId);
    const output = tx.outputs.find((candidate) => candidate.index === input.index);
    if (output === undefined) {
      throw new AppError(
        "invalid",
        `Input outpoint ${input.transactionId}:${input.index} does not exist on the chain`,
      );
    }
    amounts.push(BigInt(output.amount));
  }
  return amounts;
}

export function verifyAffordability(
  signed: SignedTransaction,
  inputAmounts: readonly bigint[],
  feerate: number,
): void {
  const inputsTotal = inputAmounts.reduce((acc, amount) => acc + amount, 0n);
  const outputsTotal = signed.outputs.reduce(
    (acc, output) => acc + BigInt(output.value),
    0n,
  );
  const scriptLengths = signed.outputs.map(
    (output) => (output.scriptPublicKey.length - 4) / 2,
  );
  const requiredFee = estimateFee(signed.inputs.length, scriptLengths, feerate);
  if (inputsTotal < outputsTotal + requiredFee) {
    throw new AppError(
      "policy",
      `Inputs ${inputsTotal} sompi cannot cover outputs ${outputsTotal} sompi plus required fee ${requiredFee} sompi`,
    );
  }
}

function splitScriptPublicKey(hex: string): {
  version: number;
  scriptPublicKey: string;
} {
  const version = parseInt(hex.slice(0, 4), 16);
  if (!Number.isInteger(version) || version < 0) {
    throw new AppError("invalid", "output scriptPublicKey has an invalid version prefix");
  }
  return { version, scriptPublicKey: hex.slice(4) };
}

export function toSubmitTxModel(signed: SignedTransaction): SubmitTxModel {
  const lockTime = Number(signed.lockTime);
  return {
    version: signed.version,
    inputs: signed.inputs.map((input) => ({
      previousOutpoint: { transactionId: input.transactionId, index: input.index },
      signatureScript: input.signatureScript,
      sequence: Number(input.sequence),
      sigOpCount: input.sigOpCount,
    })),
    outputs: signed.outputs.map((output) => ({
      amount: Number(output.value),
      scriptPublicKey: splitScriptPublicKey(output.scriptPublicKey),
    })),
    ...(Number.isFinite(lockTime) && lockTime >= 0 ? { lockTime } : {}),
    ...(signed.subnetworkId !== "" ? { subnetworkId: signed.subnetworkId } : {}),
  };
}

export async function handlePreparePayment(
  requester: string,
  input: PrepareInput,
  chain: PaymentChain = new KaspaClient(),
  wallets?: WalletStore,
): Promise<RouteResult> {
  try {
    const userAddress = requester;
    const chamaAddress = requireAddress(input.chama_address, "chama_address");
    const amountSompi = requirePositiveSompi(input.amount_sompi);
    if (wallets !== undefined) {
      const payer = await wallets.get(userAddress);
      if (payer === null || payer.kind !== "user") {
        logger.warn("payment prepare refused", {
          userAddress,
          chamaAddress,
          reason: "payer-unregistered",
        });
        throw new AppError("invalid", UNREGISTERED_PAYER_COPY);
      }
    }
    const feerate = await feeRate(chain);
    const utxos = await chain.getUtxos(userAddress);
    const built = buildTransfer({
      utxos,
      userAddress,
      groupAddress: chamaAddress,
      amountSompi,
      feerate,
    });
    logger.info("payment prepared", {
      userAddress,
      chamaAddress,
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

export async function handleFinalizePayment(
  input: FinalizeInput,
  chain: PaymentChain = new KaspaClient(),
  policy: ConfirmPolicy = DEFAULT_CONFIRM_POLICY,
): Promise<RouteResult> {
  try {
    const signed = parseSignedTransaction(requireString(input.signed, "signed"));
    const inputAmounts = await fetchAuthoritativeAmounts(chain, signed.inputs);
    const feerate = await feeRate(chain);
    verifyAffordability(signed, inputAmounts, feerate);
    const response = await chain.broadcastTransaction(toSubmitTxModel(signed));
    if (response.transactionId !== undefined && response.transactionId !== "") {
      const txid = response.transactionId.toLowerCase();
      const accepted = await waitForAcceptance(chain, txid, policy);
      logger.info("payment finalized", {
        txid,
        accepted,
        inputs: signed.inputs.length,
        outputs: signed.outputs.length,
      });
      if (accepted) {
        return { status: 200, body: { status: "recorded", txid } };
      }
      return {
        status: 202,
        body: {
          status: "pending",
          txid,
          explorer_url: proofUrl(getNetworkConfig(), txid),
        },
      };
    }
    logger.warn("payment rejected by node", { error: response.error });
    throw new AppError("conflict", response.error ?? "Transaction was rejected by the node");
  } catch (err) {
    return toRouteResult(err);
  }
}
