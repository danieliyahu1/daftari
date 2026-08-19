import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

export const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;

export interface ChallengeRecord {
  nonce: string;
  address: string;
  expiresAt: number;
}

export interface AuthStore {
  create(address: string): ChallengeRecord;
  consume(nonce: string, address: string): ChallengeRecord | null;
  close(): void;
}

interface AuthStoreOptions {
  filename?: string;
  now?: () => number;
  ttlMs?: number;
}

// One-time, short-lived sign-in nonces. A nonce is deleted the moment it is
// redeemed (so "not found" is the only failure path) and stale ones are swept
// on every create so the table never grows with abandoned challenges.
export class SqliteAuthStore implements AuthStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: AuthStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.db = new DatabaseSync(options.filename ?? ":memory:");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_challenges (
        nonce TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.prune();
  }

  create(address: string): ChallengeRecord {
    this.prune();
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = this.now() + this.ttlMs;
    this.db
      .prepare("INSERT INTO auth_challenges (nonce, address, expires_at) VALUES (?, ?, ?)")
      .run(nonce, address, expiresAt);
    logger.debug("auth challenge created", { address, nonce, expiresAt });
    return { nonce, address, expiresAt };
  }

  // Redeems a nonce exactly once. Returns the record and deletes it on success;
  // returns null if the nonce is unknown (never issued, already used) or stale.
  consume(nonce: string, address: string): ChallengeRecord | null {
    const row = this.db
      .prepare("SELECT nonce, address, expires_at FROM auth_challenges WHERE nonce = ? AND address = ?")
      .get(nonce, address) as
      | { nonce: string; address: string; expires_at: number }
      | undefined;
    if (row === undefined) {
      logger.debug("auth challenge not found", { nonce, address, reason: "unknown-or-used" });
      return null;
    }
    if (row.expires_at <= this.now()) {
      this.db.prepare("DELETE FROM auth_challenges WHERE nonce = ?").run(nonce);
      logger.debug("auth challenge expired", { nonce, address });
      return null;
    }
    this.db.prepare("DELETE FROM auth_challenges WHERE nonce = ?").run(nonce);
    return { nonce: row.nonce, address: row.address, expiresAt: row.expires_at };
  }

  private prune(): void {
    this.db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(this.now());
  }

  close(): void {
    this.db.close();
  }
}
