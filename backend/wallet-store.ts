import { createClient, type Client } from "@libsql/client";
import type { Wallet, WalletKind } from "../shared/types";
import { AppError } from "./errors";
import { logger } from "./logger";

const SCHEMA_VERSION = 2;

export interface WalletStore {
  register(address: string, name: string, kind: WalletKind): Promise<Wallet>;
  get(address: string): Promise<Wallet | null>;
  resolveMany(addresses: string[]): Promise<Wallet[]>;
  close(): void;
}

interface WalletStoreOptions {
  url: string;
  authToken?: string;
  now?: () => number;
}

interface WalletRow {
  address: string;
  name: string;
  kind: string;
  created_at: number;
}

function toWallet(row: WalletRow): Wallet {
  return {
    address: row.address,
    name: row.name,
    kind: row.kind as WalletKind,
    created_at: row.created_at,
  };
}

const WALLET_COLUMNS = "address, name, kind, created_at";

export class TursoWalletStore implements WalletStore {
  private readonly client: Client;
  private readonly now: () => number;

  constructor(options: WalletStoreOptions) {
    this.now = options.now ?? (() => Date.now());
    this.client = createClient({ url: options.url, authToken: options.authToken });
  }

  async init(): Promise<void> {
    // The database is provisioned with the schema (see migration notes), so on
    // startup we only record the schema version. If the tables are somehow
    // missing (e.g. a fresh DB not yet migrated), create them non-destructively.
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS wallets (
        address TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('user', 'group')),
        created_at INTEGER NOT NULL
      )
    `);
    await this.client.execute({
      sql: "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [String(SCHEMA_VERSION)],
    });
    logger.debug("wallets store ready", { schemaVersion: SCHEMA_VERSION });
  }

  async register(address: string, name: string, kind: WalletKind): Promise<Wallet> {
    if ((await this.get(address)) !== null) {
      logger.warn("wallet registration rejected", { address, reason: "already-named" });
      throw new AppError("conflict", "This wallet is already named");
    }
    const created_at = this.now();
    await this.client.execute({
      sql: `INSERT INTO wallets (${WALLET_COLUMNS}) VALUES (?, ?, ?, ?)`,
      args: [address, name, kind, created_at],
    });
    logger.info("wallet registered", { address, kind, name });
    return { address, name, kind, created_at };
  }

  async get(address: string): Promise<Wallet | null> {
    const result = await this.client.execute({
      sql: `SELECT ${WALLET_COLUMNS} FROM wallets WHERE address = ?`,
      args: [address],
    });
    const row = result.rows[0] as unknown as WalletRow | undefined;
    return row ? toWallet(row) : null;
  }

  async resolveMany(addresses: string[]): Promise<Wallet[]> {
    if (addresses.length === 0) return [];
    const unique = [...new Set(addresses)];
    const placeholders = unique.map(() => "?").join(", ");
    const result = await this.client.execute({
      sql: `SELECT ${WALLET_COLUMNS} FROM wallets WHERE address IN (${placeholders})`,
      args: unique,
    });
    const rows = result.rows as unknown as WalletRow[];
    const byAddress = new Map(rows.map((row) => [row.address, toWallet(row)]));
    return unique.filter((address) => byAddress.has(address)).map((address) => byAddress.get(address)!);
  }

  close(): void {
    this.client.close();
  }
}
