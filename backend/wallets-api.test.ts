import { afterEach, describe, expect, it } from "vitest";
import { handleRegisterWallet, handleResolveWallets, NAME_ERROR_COPY } from "./wallets-api";
import { SqliteWalletStore } from "./wallet-store";
import type { WalletStore } from "./wallet-store";

const USER = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const VALID_CODE = "kaspatest:qpchy8753068rt2szvwxc0yr0kl38sjxqs0cg7xe97y6tzxh5h5wx09rle5a7";

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
  s: WalletStore,
  requester: string,
  input: { name?: unknown; kind?: unknown },
) {
  return handleRegisterWallet(s, requester, input);
}

describe("handleRegisterWallet", () => {
  it("registers a person wallet with a 201 and the stored wallet", () => {
    const result = register(store(), USER, {
      name: "  Amina  ",
      kind: "user",
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      wallet: { address: USER, name: "Amina", kind: "user", created_at: 1_000 },
    });
  });

  it("registers a group wallet", () => {
    const result = register(store(), VALID_CODE, {
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
    register(s, USER, { name: "Amina", kind: "user" });

    const result = register(s, USER, { name: "Bob", kind: "group" });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { kind: "conflict", message: "This wallet is already named" },
    });
  });

  it("does not overwrite the original name on a conflict", () => {
    const s = store();
    register(s, USER, { name: "Amina", kind: "user" });
    register(s, USER, { name: "Bob", kind: "group" });

    expect(s.get(USER)).toEqual({
      address: USER,
      name: "Amina",
      kind: "user",
      created_at: 1_000,
    });
  });

  it("returns the length copy for a name shorter than 2 characters", () => {
    const result = register(store(), USER, { name: "a", kind: "user" });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a name longer than 20 characters", () => {
    const result = register(store(), USER, {
      name: "a".repeat(21),
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a whitespace-only name", () => {
    const result = register(store(), USER, { name: "   ", kind: "user" });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns the length copy for a name with control characters", () => {
    const result = register(store(), USER, {
      name: "Am\nina",
      kind: "user",
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: NAME_ERROR_COPY },
    });
  });

  it("returns 400 when the name is missing", () => {
    const result = register(store(), USER, { kind: "user" });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: { kind: "invalid", message: expect.stringMatching(/name/) },
    });
  });

  it("returns 422 for an unknown kind", () => {
    const result = register(store(), USER, {
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
    register(s, USER, { name: "a", kind: "user" });

    expect(s.get(USER)).toBeNull();
  });
});

describe("handleResolveWallets", () => {
  it("resolves a batch of addresses in one call", () => {
    const s = store();
    register(s, USER, { name: "Amina", kind: "user" });
    register(s, VALID_CODE, { name: "the plot chama", kind: "group" });

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
    register(s, USER, { name: "Amina", kind: "user" });

    const result = handleResolveWallets(s, `${USER},${VALID_CODE}`);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      wallets: [{ address: USER, name: "Amina", kind: "user", created_at: 1_000 }],
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
    register(s, USER, { name: "Amina", kind: "user" });

    const result = handleResolveWallets(s, [USER, VALID_CODE]);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      wallets: [{ address: USER, name: "Amina", kind: "user", created_at: 1_000 }],
    });
  });
});
