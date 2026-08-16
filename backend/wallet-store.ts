import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { Wallet, WalletKind } from "../shared/types";
import { AppError } from "./errors";
import { logger } from "./logger";

const SCHEMA_VERSION = 2;

export interface WalletStore {
  register(address: string, name: string, kind: WalletKind): Wallet;
  get(address: string): Wallet | null;
  resolveMany(addresses: string[]): Wallet[];
  close(): void;
}

interface WalletStoreOptions {
  filename?: string;
  now?: () => number;
}

function toWallet(row: Record<string, unknown>): Wallet {
  return {
    address: String(row.address),
    name: String(row.name),
    kind: String(row.kind) as WalletKind,
    created_at: Number(row.created_at),
  };
}

const WALLET_COLUMNS = "address, name, kind, created_at";

function selectWallet(db: DatabaseSync, where: string, ...params: SQLInputValue[]): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT ${WALLET_COLUMNS} FROM wallets WHERE ${where}`)
    .get(...params) as Record<string, unknown> | undefined;
}

export class SqliteWalletStore implements WalletStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(options: WalletStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.db = new DatabaseSync(options.filename ?? ":memory:");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    const versionRow = this.db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    const version = versionRow ? Number(versionRow.value) : 0;

    if (version < SCHEMA_VERSION) {
      this.db.exec("BEGIN");
      try {
        this.db.exec("DROP TABLE IF EXISTS memberships");
        this.db.exec(`
          CREATE TABLE wallets (
            address TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('user', 'group')),
            created_at INTEGER NOT NULL
          )
        `);
        this.db
          .prepare(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(String(SCHEMA_VERSION));
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
      logger.info("wallets store initialized from a fresh start", { schemaVersion: SCHEMA_VERSION });
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS wallets (
          address TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('user', 'group')),
          created_at INTEGER NOT NULL
        )
      `);
      logger.debug("wallets store ready", { schemaVersion: version });
    }
  }

  register(address: string, name: string, kind: WalletKind): Wallet {
    if (this.get(address) !== null) {
      logger.warn("wallet registration rejected", { address, reason: "already-named" });
      throw new AppError("conflict", "This wallet is already named");
    }
    const created_at = this.now();
    this.db
      .prepare(`INSERT INTO wallets (${WALLET_COLUMNS}) VALUES (?, ?, ?, ?)`)
      .run(address, name, kind, created_at);
    logger.info("wallet registered", { address, kind, name });
    return { address, name, kind, created_at };
  }

  get(address: string): Wallet | null {
    const row = selectWallet(this.db, "address = ?", address);
    return row ? toWallet(row) : null;
  }

  resolveMany(addresses: string[]): Wallet[] {
    if (addresses.length === 0) return [];
    const unique = [...new Set(addresses)];
    const placeholders = unique.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT ${WALLET_COLUMNS} FROM wallets WHERE address IN (${placeholders})`)
      .all(...unique) as Record<string, unknown>[];
    const byAddress = new Map(rows.map((row) => [String(row.address), toWallet(row)]));
    return unique.filter((address) => byAddress.has(address)).map((address) => byAddress.get(address)!);
  }

  close(): void {
    this.db.close();
  }
}
