import { describe, expect, it } from "vitest";
import { SqliteAuthStore } from "./auth-store";

describe("SqliteAuthStore", () => {
  it("issues a fresh nonce with a future expiry", () => {
    let now = 1_000;
    const store = new SqliteAuthStore({ now: () => now });
    const record = store.create("kaspatest:aaa");
    expect(record.nonce.length).toBe(32);
    expect(record.address).toBe("kaspatest:aaa");
    expect(record.expiresAt).toBeGreaterThan(now);
    store.close();
  });

  it("consumes a valid nonce exactly once", () => {
    const store = new SqliteAuthStore();
    const record = store.create("kaspatest:aaa");
    expect(store.consume(record.nonce, "kaspatest:aaa")).not.toBeNull();
    expect(store.consume(record.nonce, "kaspatest:aaa")).toBeNull();
    store.close();
  });

  it("refuses a nonce for a different address", () => {
    const store = new SqliteAuthStore();
    const record = store.create("kaspatest:aaa");
    expect(store.consume(record.nonce, "kaspatest:bbb")).toBeNull();
    expect(store.consume(record.nonce, "kaspatest:aaa")).not.toBeNull();
    store.close();
  });

  it("refuses a nonce after it expires", () => {
    let now = 1_000;
    const store = new SqliteAuthStore({ now: () => now });
    const record = store.create("kaspatest:aaa");
    now += 5 * 60_000 + 1;
    expect(store.consume(record.nonce, "kaspatest:aaa")).toBeNull();
    store.close();
  });

  it("refuses an unknown nonce", () => {
    const store = new SqliteAuthStore();
    expect(store.consume("ffffffffffffffffffffffffffffffff", "kaspatest:aaa")).toBeNull();
    store.close();
  });

  it("sweeps stale nonces on create", () => {
    let now = 1_000;
    const store = new SqliteAuthStore({ now: () => now });
    const old = store.create("kaspatest:aaa");
    now += 5 * 60_000 + 1;
    store.create("kaspatest:bbb"); // this create() should prune the stale one
    expect(store.consume(old.nonce, "kaspatest:aaa")).toBeNull();
    store.close();
  });
});
