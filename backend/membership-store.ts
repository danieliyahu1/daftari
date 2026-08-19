import { createClient, type Client } from "@libsql/client";
import type { Membership } from "../shared/types";
import { logger } from "./logger";

export interface MembershipStore {
  listForUser(userAddress: string): Promise<Membership[]>;
  listForChama(chamaAddress: string): Promise<Membership[]>;
  addMember(chamaAddress: string, userAddress: string): Promise<Membership>;
  isMember(chamaAddress: string, userAddress: string): Promise<boolean>;
  close(): void;
}

interface MembershipStoreOptions {
  url: string;
  authToken?: string;
  now?: () => number;
}

interface MembershipRow {
  user_address: string;
  chama_address: string;
  created_at: number;
}

function toMembership(row: MembershipRow): Membership {
  return {
    user_address: row.user_address,
    chama_address: row.chama_address,
    created_at: row.created_at,
  };
}

const MEMBERSHIP_COLUMNS = "user_address, chama_address, created_at";

export class TursoMembershipStore implements MembershipStore {
  private readonly client: Client;
  private readonly now: () => number;

  constructor(options: MembershipStoreOptions) {
    this.now = options.now ?? (() => Date.now());
    this.client = createClient({ url: options.url, authToken: options.authToken });
  }

  async init(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS memberships (
        user_address TEXT NOT NULL,
        chama_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_address, chama_address)
      )
    `);
  }

  async listForUser(userAddress: string): Promise<Membership[]> {
    const result = await this.client.execute({
      sql: `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE user_address = ? ORDER BY created_at ASC, chama_address ASC`,
      args: [userAddress],
    });
    const rows = result.rows as unknown as MembershipRow[];
    logger.debug("memberships listed for user", { userAddress, count: rows.length });
    return rows.map(toMembership);
  }

  async listForChama(chamaAddress: string): Promise<Membership[]> {
    const result = await this.client.execute({
      sql: `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE chama_address = ? ORDER BY created_at ASC, user_address ASC`,
      args: [chamaAddress],
    });
    const rows = result.rows as unknown as MembershipRow[];
    logger.debug("memberships listed for chama", { chamaAddress, count: rows.length });
    return rows.map(toMembership);
  }

  async addMember(chamaAddress: string, userAddress: string): Promise<Membership> {
    const created_at = this.now();
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO memberships (${MEMBERSHIP_COLUMNS}) VALUES (?, ?, ?)`,
      args: [userAddress, chamaAddress, created_at],
    });
    logger.info("member added to chama", { chamaAddress, userAddress });
    return { user_address: userAddress, chama_address: chamaAddress, created_at };
  }

  async isMember(chamaAddress: string, userAddress: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: "SELECT 1 AS present FROM memberships WHERE user_address = ? AND chama_address = ?",
      args: [userAddress, chamaAddress],
    });
    return result.rows.length > 0;
  }

  close(): void {
    this.client.close();
  }
}
