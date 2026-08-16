import { DatabaseSync } from "node:sqlite";
import type { Membership } from "../shared/types";
import { logger } from "./logger";

export type JoinOutcome = "joined" | "already-member";

export interface JoinResult {
  outcome: JoinOutcome;
  membership: Membership;
}

export interface MembershipStore {
  listForUser(userAddress: string): Membership[];
  join(userAddress: string, chamaAddress: string): JoinResult;
  leave(userAddress: string, chamaAddress: string): boolean;
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
    logger.debug("memberships listed", { userAddress, count: rows.length });
    return rows.map((row) => toMembership(row));
  }

  join(userAddress: string, chamaAddress: string): JoinResult {
    const created_at = this.now();
    const info = this.db
      .prepare(
        "INSERT OR IGNORE INTO memberships (user_address, chama_address, created_at) VALUES (?, ?, ?)",
      )
      .run(userAddress, chamaAddress, created_at);

    if (Number(info.changes) === 0) {
      const row = this.db
        .prepare(
          "SELECT user_address, chama_address, created_at FROM memberships WHERE user_address = ? AND chama_address = ?",
        )
        .get(userAddress, chamaAddress) as Record<string, unknown>;
      return { outcome: "already-member", membership: toMembership(row) };
    }
    return {
      outcome: "joined",
      membership: { user_address: userAddress, chama_address: chamaAddress, created_at },
    };
  }

  leave(userAddress: string, chamaAddress: string): boolean {
    const info = this.db
      .prepare("DELETE FROM memberships WHERE user_address = ? AND chama_address = ?")
      .run(userAddress, chamaAddress);
    logger.debug("membership deleted", {
      userAddress,
      chamaAddress,
      removed: Number(info.changes) > 0,
    });
    return Number(info.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
