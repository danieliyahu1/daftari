import { getNetworkConfig } from "../shared/network";
import { scriptPublicKeyForAddress } from "./kaspa-address";
import { ChainError, KaspaClient, UpstreamError } from "./kaspa-client";
import type { UpstreamKind } from "./kaspa-client";
import type {
  FeeEstimateResponse,
  SubmitTransactionResponse,
  SubmitTxModel,
  TxModel,
  UtxoResponse,
} from "./kaspa-api-types";
import { buildTransfer, estimateFee, TxBuilderError } from "./tx-builder";

export interface RouteResult {
  status: number;
  body: unknown;
}

export type PaymentErrorKind = Exclude<UpstreamKind, "not_found" | "unknown">;

export class PaymentError extends Error {
  readonly status: number;
  readonly kind: PaymentErrorKind;

  constructor(status: number, kind: PaymentErrorKind, message: string) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
    this.kind = kind;
  }
}

export interface PaymentChain {
  getUtxos(address: string): Promise<UtxoResponse[]>;
  getTransaction(txid: string): Promise<TxModel>;
  getFeeEstimate(): Promise<FeeEstimateResponse>;
  broadcastTransaction(transaction: SubmitTxModel): Promise<SubmitTransactionResponse>;
}

export interface PrepareInput {
  user_address?: unknown;
  chama_address?: unknown;
  amount_sompi?: unknown;
}

export interface FinalizeInput {
  signed?: unknown;
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

function requireString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addressPrefix(): string {
  return getNetworkConfig().addressPrefix.replace(/:$/, "");
}

function requireAddress(value: unknown, field: string): string {
  const raw = requireString(value);
  if (raw === null) {
    throw new PaymentError(400, "bad_request", `${field} is required`);
  }
  if (scriptPublicKeyForAddress(raw, addressPrefix()) === null) {
    throw new PaymentError(
      422,
      "validation",
      `${field} is not a valid address on this network`,
    );
  }
  return raw;
}

function requirePositiveSompi(value: unknown): string {
  const raw = requireString(value);
  if (raw === null) {
    throw new PaymentError(400, "bad_request", "amount_sompi is required");
  }
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new PaymentError(
      422,
      "validation",
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
  throw new PaymentError(422, "validation", `${field} must be a non-negative integer`);
}

function parseSignedInput(value: unknown, index: number): SignedTransactionInput {
  if (!isRecord(value)) {
    throw new PaymentError(422, "validation", `signed.inputs[${index}] must be an object`);
  }
  const transactionId = value.transactionId;
  if (typeof transactionId !== "string" || !/^[0-9a-fA-F]{64}$/.test(transactionId)) {
    throw new PaymentError(
      422,
      "validation",
      `signed.inputs[${index}].transactionId must be a 64-character hex string`,
    );
  }
  const outputIndex = value.index;
  if (typeof outputIndex !== "number" || !Number.isInteger(outputIndex) || outputIndex < 0) {
    throw new PaymentError(
      422,
      "validation",
      `signed.inputs[${index}].index must be a non-negative integer`,
    );
  }
  const sigOpCount = value.sigOpCount;
  if (typeof sigOpCount !== "number" || !Number.isInteger(sigOpCount) || sigOpCount <= 0) {
    throw new PaymentError(
      422,
      "validation",
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
    throw new PaymentError(
      422,
      "validation",
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
    throw new PaymentError(422, "validation", `signed.outputs[${index}] must be an object`);
  }
  const amount = value.value;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new PaymentError(
      422,
      "validation",
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
    throw new PaymentError(
      422,
      "validation",
      `signed.outputs[${index}].scriptPublicKey must be hex with a version prefix`,
    );
  }
  return { value: amount, scriptPublicKey: scriptPublicKey.toLowerCase() };
}

function parseSignedTransaction(raw: string): SignedTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PaymentError(422, "validation", "signed is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new PaymentError(422, "validation", "signed must be a JSON object");
  }
  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new PaymentError(
      422,
      "validation",
      "signed.version must be a non-negative integer",
    );
  }
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length === 0) {
    throw new PaymentError(422, "validation", "signed must have at least one input");
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.length === 0) {
    throw new PaymentError(422, "validation", "signed must have at least one output");
  }

  const inputs = parsed.inputs.map((input, index) => parseSignedInput(input, index));
  const outputs = parsed.outputs.map((output, index) => parseSignedOutput(output, index));
  const outpoints = new Set<string>();
  for (const input of inputs) {
    const key = `${input.transactionId}:${input.index}`;
    if (outpoints.has(key)) {
      throw new PaymentError(422, "validation", `Duplicate input outpoint ${key}`);
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

async function feeRate(chain: PaymentChain): Promise<number> {
  const estimate = await chain.getFeeEstimate();
  const rate = estimate.normalBuckets[0]?.feerate ?? estimate.priorityBucket.feerate;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new PaymentError(502, "server", "Upstream returned no usable fee estimate");
  }
  return rate;
}

async function fetchAuthoritativeAmounts(
  chain: PaymentChain,
  inputs: SignedTransactionInput[],
): Promise<bigint[]> {
  const amounts: bigint[] = [];
  for (const input of inputs) {
    const tx = await chain.getTransaction(input.transactionId);
    const output = tx.outputs.find((candidate) => candidate.index === input.index);
    if (output === undefined) {
      throw new PaymentError(
        422,
        "validation",
        `Input outpoint ${input.transactionId}:${input.index} does not exist on the chain`,
      );
    }
    amounts.push(BigInt(output.amount));
  }
  return amounts;
}

function verifyAffordability(
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
    throw new PaymentError(
      422,
      "validation",
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
    throw new PaymentError(
      422,
      "validation",
      "output scriptPublicKey has an invalid version prefix",
    );
  }
  return { version, scriptPublicKey: hex.slice(4) };
}

function toSubmitTxModel(signed: SignedTransaction): SubmitTxModel {
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

function upstreamStatus(kind: UpstreamKind): number {
  switch (kind) {
    case "bad_request":
      return 400;
    case "validation":
      return 422;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "server":
      return 502;
    case "not_found":
      return 404;
    case "unknown":
      return 500;
  }
}

function upstreamMessage(err: UpstreamError): string {
  if (isRecord(err.body)) {
    if (typeof err.body.error === "string" && err.body.error !== "") {
      return err.body.error;
    }
    if (typeof err.body.detail === "string" && err.body.detail !== "") {
      return err.body.detail;
    }
  }
  return err.message;
}

function toErrorResult(err: unknown): RouteResult {
  if (err instanceof PaymentError) {
    return { status: err.status, body: { error: { kind: err.kind, message: err.message } } };
  }
  if (err instanceof TxBuilderError) {
    return { status: 422, body: { error: { kind: "validation", message: err.message } } };
  }
  if (err instanceof UpstreamError) {
    return {
      status: upstreamStatus(err.kind),
      body: { error: { kind: err.kind, message: upstreamMessage(err) } },
    };
  }
  if (err instanceof ChainError) {
    return { status: 503, body: { error: { kind: "unavailable", message: err.message } } };
  }
  const message = err instanceof Error ? err.message : "Unexpected payment error";
  return { status: 500, body: { error: { kind: "server", message } } };
}

export async function handlePreparePayment(
  input: PrepareInput,
  chain: PaymentChain = new KaspaClient(),
): Promise<RouteResult> {
  try {
    const userAddress = requireAddress(input.user_address, "user_address");
    const chamaAddress = requireAddress(input.chama_address, "chama_address");
    const amountSompi = requirePositiveSompi(input.amount_sompi);
    const feerate = await feeRate(chain);
    const utxos = await chain.getUtxos(userAddress);
    const built = buildTransfer({
      utxos,
      userAddress,
      groupAddress: chamaAddress,
      amountSompi,
      feerate,
    });
    return {
      status: 200,
      body: { signing_template: JSON.stringify(built.signing_template) },
    };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function handleFinalizePayment(
  input: FinalizeInput,
  chain: PaymentChain = new KaspaClient(),
): Promise<RouteResult> {
  try {
    const raw = requireString(input.signed);
    if (raw === null) {
      throw new PaymentError(400, "bad_request", "signed is required");
    }
    const signed = parseSignedTransaction(raw);
    const inputAmounts = await fetchAuthoritativeAmounts(chain, signed.inputs);
    const feerate = await feeRate(chain);
    verifyAffordability(signed, inputAmounts, feerate);
    const response = await chain.broadcastTransaction(toSubmitTxModel(signed));
    if (response.transactionId !== undefined && response.transactionId !== "") {
      return { status: 200, body: { txid: response.transactionId } };
    }
    throw new PaymentError(
      409,
      "conflict",
      response.error ?? "Transaction was rejected by the node",
    );
  } catch (err) {
    return toErrorResult(err);
  }
}
