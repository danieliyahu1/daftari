import { SignJWT, jwtVerify } from "jose";
import { getNetworkConfig } from "../shared/network";
import { AppError, toRouteResult, validAddress } from "./errors";
import type { RouteResult } from "./errors";
import type { AuthStore } from "./auth-store";
import { verifySignature } from "./kaspa-signature";
import { logger } from "./logger";

export const SESSION_TTL_MS = 15 * 60_000;

const MESSAGE_VERSION = "1";
const STATEMENT = "I'm signing into Daftari. This is free — no payment happens here.";

export interface AuthConfig {
  origin: string;
  secret: Uint8Array;
  sessionTtlMs?: number;
}

export interface ChallengeInput {
  address?: unknown;
}

export interface SessionInput {
  message?: unknown;
  signature?: unknown;
}

export function buildSignInMessage(input: {
  address: string;
  origin: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "Daftari wants you to sign in with your Kaspa account:",
    input.address,
    "",
    STATEMENT,
    "",
    `URI: ${input.origin}`,
    `Version: ${MESSAGE_VERSION}`,
    `Chain ID: ${getNetworkConfig().networkId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}

interface ParsedMessage {
  address: string;
  origin: string;
  nonce: string;
}

// Strictly parses a sign-in message back into its fields so the backend only
// trusts values it can reconstruct, never anything the client asserts alone.
export function parseSignInMessage(message: string): ParsedMessage | null {
  const lines = message.split("\n");
  if (lines.length !== 10) return null;
  if (!lines[0].startsWith("Daftari wants you to sign in with your Kaspa account:")) {
    return null;
  }
  const address = lines[1].trim();
  if (lines[2] !== "") return null;
  if (lines[3] !== STATEMENT) return null;
  if (lines[4] !== "") return null;
  const uri = lines[5];
  if (!uri.startsWith("URI: ")) return null;
  const origin = uri.slice("URI: ".length).trim();
  if (lines[6] !== `Version: ${MESSAGE_VERSION}`) return null;
  if (lines[7] !== `Chain ID: ${getNetworkConfig().networkId}`) return null;
  const nonceLine = lines[8];
  if (!nonceLine.startsWith("Nonce: ")) return null;
  const nonce = nonceLine.slice("Nonce: ".length).trim();
  if (lines[9].startsWith("Issued At: ") === false) return null;
  return { address, origin, nonce };
}

export async function handleCreateChallenge(
  store: AuthStore,
  input: ChallengeInput,
  config: AuthConfig,
): Promise<RouteResult> {
  try {
    const address = validAddress(input.address, "address");
    const record = await store.create(address);
    const message = buildSignInMessage({
      address,
      origin: config.origin,
      nonce: record.nonce,
      issuedAt: new Date().toISOString(),
    });
    logger.info("auth challenge issued", { address });
    return { status: 200, body: { nonce: record.nonce, message } };
  } catch (err) {
    return toRouteResult(err);
  }
}

export async function handleCreateSession(
  store: AuthStore,
  input: SessionInput,
  config: AuthConfig,
): Promise<RouteResult> {
  try {
    if (typeof input.message !== "string" || typeof input.signature !== "string") {
      throw new AppError("unauthorized", "A signed message and signature are required");
    }
    const parsed = parseSignInMessage(input.message);
    if (parsed === null) {
      logger.warn("auth session refused", { reason: "malformed-message" });
      throw new AppError("unauthorized", "The signed message is not valid");
    }
    if (parsed.origin !== config.origin) {
      logger.warn("auth session refused", {
        reason: "origin-mismatch",
        expected: config.origin,
        got: parsed.origin,
      });
      throw new AppError("unauthorized", "The signed message is not for this app");
    }
    const record = await store.consume(parsed.nonce, parsed.address);
    if (record === null) {
      logger.warn("auth session refused", { reason: "nonce-rejected" });
      throw new AppError("unauthorized", "This sign-in attempt is no longer valid. Try again.");
    }
    const valid = verifySignature({
      address: parsed.address,
      message: input.message,
      signature: input.signature,
    });
    if (!valid) {
      logger.warn("auth session refused", { reason: "signature-invalid" });
      throw new AppError("unauthorized", "The signature does not match this wallet");
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(parsed.address)
      .setIssuedAt()
      .setExpirationTime(`${Math.floor(config.sessionTtlMs ?? SESSION_TTL_MS / 1000)}s`)
      .sign(config.secret);
    logger.info("auth session created", { address: parsed.address });
    return { status: 200, body: { token, expires_in_seconds: (config.sessionTtlMs ?? SESSION_TTL_MS) / 1000 } };
  } catch (err) {
    return toRouteResult(err);
  }
}

export interface AuthUser {
  address: string;
}

// Verifies a bearer token and returns the authenticated address, or null.
export async function verifyToken(
  bearer: string | undefined,
  secret: Uint8Array,
): Promise<AuthUser | null> {
  if (typeof bearer !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(bearer.trim());
  if (match === null) return null;
  try {
    const { payload } = await jwtVerify(match[1], secret, { algorithms: ["HS256"] });
    const address = payload.sub;
    if (typeof address !== "string" || address === "") return null;
    return { address };
  } catch {
    return null;
  }
}
