import { DatabaseSync } from "node:sqlite";
import type { Membership } from "../shared/types";
import { logger } from "./logger";

export interface MembershipStore {
  listForUser(userAddress: string): Membership[];
  listForChama(chamaAddress: string): Membership[];
  addMember(chamaAddress: string, userAddress: string): Membership;
  isMember(chamaAddress: string, userAddress: string): boolean;
  close(): void;
}

interface MembershipStoreOptions {
  filename?: string;
  now?: () => number;
}

function toMembership(row: Record<string, unknown>): Membership {
  return {
    user_address: String(row.user_address),
    chama_address: String(row.chama_address),
    created_at: Number(row.created_at),
  };
}

export class SqliteMembershipStore implements MembershipStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(options: MembershipStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.db = new DatabaseSync(options.filename ?? ":memory:");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memberships (
        user_address TEXT NOT NULL,
        chama_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_address, chama_address)
      )
    `);
  }

  listForUser(userAddress: string): Membership[] {
    const rows = this.db
      .prepare(
        "SELECT user_address, chama_address, created_at FROM memberships WHERE user_address = ? ORDER BY created_at ASC, chama_address ASC",
      )
      .all(userAddress);
    logger.debug("memberships listed for user", { userAddress, count: rows.length });
    return rows.map((row) => toMembership(row));
  }

  listForChama(chamaAddress: string): Membership[] {
    const rows = this.db
      .prepare(
        "SELECT user_address, chama_address, created_at FROM memberships WHERE chama_address = ? ORDER BY created_at ASC, user_address ASC",
      )
      .all(chamaAddress);
    logger.debug("memberships listed for chama", { chamaAddress, count: rows.length });
    return rows.map((row) => toMembership(row));
  }

  addMember(chamaAddress: string, userAddress: string): Membership {
    const created_at = this.now();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO memberships (user_address, chama_address, created_at) VALUES (?, ?, ?)",
      )
      .run(userAddress, chamaAddress, created_at);
    logger.info("member added to chama", { chamaAddress, userAddress });
    return { user_address: userAddress, chama_address: chamaAddress, created_at };
  }

  isMember(chamaAddress: string, userAddress: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM memberships WHERE user_address = ? AND chama_address = ?",
      )
      .get(userAddress, chamaAddress);
    return row !== undefined;
  }

  close(): void {
    this.db.close();
  }
}