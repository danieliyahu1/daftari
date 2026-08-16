import { afterEach, describe, expect, it } from "vitest";
import { SqliteWalletStore } from "./wallet-store";
import type { WalletStore } from "./wallet-store";
import {
  NAME_ERROR_COPY,
  handleRegisterWallet,
  handleResolveWallets,
} from "./wallets-api";

const USER = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const VALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks";
const INVALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpk0";
const MAINNET_CODE =
  "kaspa:qp0l70zd5x85ttwd6jv7g3s3a8llzj96d8dncn4zmhv4tlzx5k2jyqh70xmfj";

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

function register(
  store: WalletStore,
  input: { address?: unknown; name?: unknown; kind?: unknown },
) {
  return handleRegisterWallet(store, input);
}

describe("handleRegisterWallet", () => {
  it("registers a person wallet with a 201 and the stored wallet", () => {
    const result = register(store(), {
      address: USER,
      name: "  Amina  ",
      kind: "user",
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      wallet: { address: USER, name: "Amina", kind: "user", created_at: 1_000 },
    });
  });

  it("registers a group wallet", () => {
    const result = register(store(), {
      address: VALID_CODE,
      name: "the plot chama",
      kind: "group",
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      wallet: {
        address: VALID_CODE,
        name: "the plot chama",
        kind: "group",
        created_at: 1_000,
      },
    });
  });

  it("returns 409 conflict when the wallet is already named", () => {
    const s = store();
    register(s, { address: USER, name: "Amina", kind: "user" });

    const result = register(s, { address: USER, name: "Bob", kind: "group" });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { kind: "conflict", message: "This wallet is already named" },
    });
  });

  it("does not overwrite the original name on a conflict", () => {
    const s = store();
    register(s, { address: USER, name: "Amina", kind: "user" });
    register(s, { address: USER, name: "Bob", kind: "group" });

    expect(s.get(USER)).toEqual({
      address: USER,
      name: "Amina",
      kind: "user",
      created_at: 1_000,
    });
  });

  it("returns 422 when the address is missing", () => {
    const result = register(store(), { name: "Amina", kind: "user" });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { kind: "invalid", message: expect.stringMatching(/address/) },
    });
  });

  it("returns 422 when the address is not well-formed for the network", () => {
    const result = register(store(), {
      address: INVALID_CODE,
      name: "Amina",
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 for a well-formed address on another network", () => {
    const result = register(store(), {
      address: MAINNET_CODE,
      name: "Amina",
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns the length copy for a name shorter than 2 characters", () => {
    const result = register(store(), { address: USER, name: "a", kind: "user" });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a name longer than 20 characters", () => {
    const result = register(store(), {
      address: USER,
      name: "a".repeat(21),
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a whitespace-only name", () => {
    const result = register(store(), { address: USER, name: "   ", kind: "user" });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a name with control characters", () => {
    const result = register(store(), {
      address: USER,
      name: "Am\nina",
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns 400 when the name is missing", () => {
    const result = register(store(), { address: USER, kind: "user" });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: { kind: "invalid", message: expect.stringMatching(/name/) },
    });
  });

  it("returns 422 for an unknown kind", () => {
    const result = register(store(), {
      address: USER,
      name: "Amina",
      kind: "robot",
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: "kind must be either user or group" },
    });
  });

  it("does not store a rejected registration", () => {
    const s = store();
    register(s, { address: USER, name: "a", kind: "user" });

    expect(s.get(USER)).toBeNull();
  });
});

describe("handleResolveWallets", () => {
  it("resolves a batch of addresses in one call", () => {
    const s = store();
    register(s, { address: USER, name: "Amina", kind: "user" });
    register(s, { address: VALID_CODE, name: "the plot chama", kind: "group" });

    const result = handleResolveWallets(s, `${USER},${VALID_CODE}`);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      wallets: [
        { address: USER, name: "Amina", kind: "user", created_at: 1_000 },
        { address: VALID_CODE, name: "the plot chama", kind: "group", created_at: 1_000 },
      ],
    });
  });

  it("omits addresses that are not registered", () => {
    const s = store();
    register(s, { address: USER, name: "Amina", kind: "user" });

    const result = handleResolveWallets(
      s,
      `${USER},${VALID_CODE},${MAINNET_CODE}`,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      wallets: [
        { address: USER, name: "Amina", kind: "user", created_at: 1_000 },
      ],
    });
  });

  it("returns an empty wallet list for an empty input", () => {
    const result = handleResolveWallets(store(), undefined);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ wallets: [] });
  });

  it("returns an empty wallet list for a blank input", () => {
    const result = handleResolveWallets(store(), "  ,  ");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ wallets: [] });
  });

  it("accepts a repeated query param as an array", () => {
    const s = store();
    register(s, { address: USER, name: "Amina", kind: "user" });

    const result = handleResolveWallets(s, [USER, VALID_CODE]);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      wallets: [
        { address: USER, name: "Amina", kind: "user", created_at: 1_000 },
      ],
    });
  });
});
