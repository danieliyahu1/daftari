import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { SqliteWalletStore } from "./wallet-store";
import type { WalletStore } from "./wallet-store";

const ALICE = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const BOB = "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks";
const CAROL = "kaspatest:qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhe837j2d";

const stores: WalletStore[] = [];

function store(): WalletStore {
  const s = new SqliteWalletStore({ now: () => 1_000 });
  stores.push(s);
  return s;
}

afterEach(() => {
  for (const s of stores) s.close();
  stores.length = 0;
});

describe("SqliteWalletStore", () => {
  it("starts empty", () => {
    const s = store();
    expect(s.get(ALICE)).toBeNull();
    expect(s.resolveMany([ALICE, BOB])).toEqual([]);
  });

  it("registers a wallet with its name, kind, and created_at", () => {
    const s = store();
    const wallet = s.register(ALICE, "Amina", "user");

    expect(wallet).toEqual({
      address: ALICE,
      name: "Amina",
      kind: "user",
      created_at: 1_000,
    });
    expect(s.get(ALICE)).toEqual(wallet);
  });

  it("registers a group wallet", () => {
    const s = store();
    expect(s.register(BOB, "the plot chama", "group").kind).toBe("group");
  });

  it("rejects a duplicate registration with a conflict", () => {
    const s = store();
    s.register(ALICE, "Amina", "user");

    expect(() => s.register(ALICE, "Someone Else", "user")).toThrow(AppError);
    try {
      s.register(ALICE, "Someone Else", "user");
    } catch (err) {
      expect((err as AppError).kind).toBe("conflict");
    }
    expect(s.get(ALICE)).toEqual({
      address: ALICE,
      name: "Amina",
      kind: "user",
      created_at: 1_000,
    });
  });

  it("resolveMany returns only the registered addresses in input order", () => {
    const s = store();
    s.register(BOB, "the plot chama", "group");
    s.register(ALICE, "Amina", "user");

    expect(s.resolveMany([ALICE, CAROL, BOB])).toEqual([
      { address: ALICE, name: "Amina", kind: "user", created_at: 1_000 },
      { address: BOB, name: "the plot chama", kind: "group", created_at: 1_000 },
    ]);
  });

  it("resolveMany returns nothing for an empty input", () => {
    const s = store();
    expect(s.resolveMany([])).toEqual([]);
  });

  it("resolveMany deduplicates repeated addresses", () => {
    const s = store();
    s.register(ALICE, "Amina", "user");

    expect(s.resolveMany([ALICE, ALICE])).toHaveLength(1);
  });

  it("applies the fresh-start wipe of old memberships on construction", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "daftari-wallet-store-"));
    const filename = path.join(dir, "daftari.db");

    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE memberships (
        user_address TEXT NOT NULL,
        chama_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_address, chama_address)
      )
    `);
    legacy
      .prepare("INSERT INTO memberships (user_address, chama_address, created_at) VALUES (?, ?, ?)")
      .run(ALICE, BOB, 1_000);
    legacy.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    legacy.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
    legacy.close();

    const s = new SqliteWalletStore({ filename });
    stores.push(s);

    expect(s.get(ALICE)).toBeNull();
    expect(s.register(ALICE, "Amina", "user").name).toBe("Amina");

    const after = new DatabaseSync(filename);
    const master = after
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const schemaVersion = after
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    after.close();

    expect(master.map((t) => t.name)).toEqual(["meta", "wallets"]);
    expect(schemaVersion.value).toBe("2");
  });

  it("does not wipe again on a second construction", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "daftari-wallet-store-"));
    const filename = path.join(dir, "daftari.db");

    const first = new SqliteWalletStore({ filename, now: () => 1_000 });
    first.register(ALICE, "Amina", "user");
    first.close();

    const second = new SqliteWalletStore({ filename, now: () => 2_000 });
    stores.push(second);
    expect(second.get(ALICE)).toEqual({
      address: ALICE,
      name: "Amina",
      kind: "user",
      created_at: 1_000,
    });
  });
});
