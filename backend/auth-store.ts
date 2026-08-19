import { createClient, type Client } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

export const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;

export interface ChallengeRecord {
  nonce: string;
  address: string;
  expiresAt: number;
}

export interface AuthStore {
  create(address: string): Promise<ChallengeRecord>;
  consume(nonce: string, address: string): Promise<ChallengeRecord | null>;
  close(): void;
}

interface AuthStoreOptions {
  url: string;
  authToken?: string;
  now?: () => number;
  ttlMs?: number;
}

interface ChallengeRow {
  nonce: string;
  address: string;
  expires_at: number;
}

function toRecord(row: ChallengeRow): ChallengeRecord {
  return { nonce: row.nonce, address: row.address, expiresAt: row.expires_at };
}

// One-time, short-lived sign-in nonces. A nonce is deleted the moment it is
// redeemed (so "not found" is the only failure path) and stale ones are swept
// on every create so the table never grows with abandoned challenges.
export class TursoAuthStore implements AuthStore {
  private readonly client: Client;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: AuthStoreOptions) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.client = createClient({ url: options.url, authToken: options.authToken });
  }

  async init(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS auth_challenges (
        nonce TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async create(address: string): Promise<ChallengeRecord> {
    await this.prune();
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = this.now() + this.ttlMs;
    await this.client.execute({
      sql: "INSERT INTO auth_challenges (nonce, address, expires_at) VALUES (?, ?, ?)",
      args: [nonce, address, expiresAt],
    });
    logger.debug("auth challenge created", { address, nonce, expiresAt });
    return { nonce, address, expiresAt };
  }

  // Redeems a nonce exactly once. Returns the record and deletes it on success;
  // returns null if the nonce is unknown (never issued, already used) or stale.
  async consume(nonce: string, address: string): Promise<ChallengeRecord | null> {
    const result = await this.client.execute({
      sql: "SELECT nonce, address, expires_at FROM auth_challenges WHERE nonce = ? AND address = ?",
      args: [nonce, address],
    });
    const row = result.rows[0] as unknown as ChallengeRow | undefined;
    if (row === undefined) {
      logger.debug("auth challenge not found", { nonce, address, reason: "unknown-or-used" });
      return null;
    }
    if (row.expires_at <= this.now()) {
      await this.client.execute({ sql: "DELETE FROM auth_challenges WHERE nonce = ?", args: [nonce] });
      logger.debug("auth challenge expired", { nonce, address });
      return null;
    }
    await this.client.execute({ sql: "DELETE FROM auth_challenges WHERE nonce = ?", args: [nonce] });
    return toRecord(row);
  }

  private async prune(): Promise<void> {
    await this.client.execute({
      sql: "DELETE FROM auth_challenges WHERE expires_at <= ?",
      args: [this.now()],
    });
  }

  close(): void {
    this.client.close();
  }
}
