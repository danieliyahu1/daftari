import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookChain } from "./book-api";
import { UNREGISTERED_GROUP_COPY } from "./book-api";
import type { TxModel } from "./kaspa-api-types";
import { SqliteMembershipStore } from "./membership-store";
import type { MembershipStore } from "./membership-store";
import { handleAddMember, handleGetHome } from "./memberships-api";
import { SqliteWalletStore } from "./wallet-store";
import type { WalletStore } from "./wallet-store";

const GROUP = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const MEMBER = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const OTHER = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const INVALID = "kaspatest:not-an-address";

const stores: MembershipStore[] = [];
const wallets: WalletStore[] = [];

function store(): MembershipStore {
  const s = new SqliteMembershipStore({ now: () => 1_000 });
  stores.push(s);
  return s;
}

function walletStore(registered: Array<{ address: string; name: string; kind: "user" | "group" }> = []): WalletStore {
  const w = new SqliteWalletStore();
  wallets.push(w);
  for (const entry of registered) w.register(entry.address, entry.name, entry.kind);
  return w;
}

afterEach(() => {
  for (const s of stores) s.close();
  for (const w of wallets) w.close();
  stores.length = 0;
  wallets.length = 0;
});

function makeTx(member: string): TxModel {
  const txid = "c".repeat(64);
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: txid,
    hash: txid,
    mass: "100",
    payload: "",
    block_hash: [],
    block_time: 300,
    version: 0,
    is_accepted: true,
    accepting_block_hash: "",
    accepting_block_blue_score: 0,
    accepting_block_time: 0,
    inputs: [
      {
        transaction_id: txid,
        index: 0,
        previous_outpoint_hash: "0".repeat(64),
        previous_outpoint_index: "0",
        signature_script: "",
        sig_op_count: "1",
        previous_outpoint_address: member,
        previous_outpoint_amount: 30,
      },
    ],
    outputs: [
      {
        transaction_id: txid,
        index: 0,
        amount: 30,
        script_public_key: "20..",
        script_public_key_address: GROUP,
      },
    ],
  };
}

function makeChain(party: string | null = null): BookChain {
  return {
    getBalance: async () => ({ address: GROUP, balance: 1_000 }),
    getFullTransactions: async () => (party === null ? [] : [makeTx(party)]),
  };
}

describe("handleGetHome", () => {
  it("returns 400 when the user param is missing", () => {
    const result = handleGetHome(store(), walletStore(), undefined);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: expect.stringMatching(/user/) },
    });
  });

  it("returns 400 when the user param is blank", () => {
    const result = handleGetHome(store(), walletStore(), "   ");
    expect(result.status).toBe(400);
  });

  it("returns an empty person home for an unregistered wallet", () => {
    const result = handleGetHome(store(), walletStore(), MEMBER);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ identity: null, members: [], chamas: [] });
  });

  it("shows only registered chamas for a person", () => {
    const s = store();
    const w = walletStore([
      { address: MEMBER, name: "Amina", kind: "user" },
      { address: GROUP, name: "Plot", kind: "group" },
    ]);
    s.addMember(GROUP, MEMBER);
    s.addMember(OTHER, MEMBER);

    const result = handleGetHome(s, w, MEMBER);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      identity: { address: MEMBER, name: "Amina", kind: "user", created_at: expect.any(Number) },
      members: [],
      chamas: [{ address: GROUP, name: "Plot", kind: "group" }],
    });
  });

  it("hides memberships in unregistered or person chamas from a person home", () => {
    const s = store();
    const w = walletStore([
      { address: MEMBER, name: "Amina", kind: "user" },
      { address: GROUP, name: "Plot", kind: "group" },
      { address: OTHER, name: "Bob", kind: "user" },
    ]);
    s.addMember(OTHER, MEMBER);

    const result = handleGetHome(s, w, MEMBER);

    expect(result.status).toBe(200);
    expect((result.body as { chamas: unknown[] }).chamas).toEqual([]);
  });

  it("shows the roster for a group wallet, unregistered members by address", () => {
    const s = store();
    const w = walletStore([
      { address: GROUP, name: "Plot", kind: "group" },
      { address: MEMBER, name: "Amina", kind: "user" },
    ]);
    s.addMember(GROUP, MEMBER);
    s.addMember(GROUP, OTHER);

    const result = handleGetHome(s, w, GROUP);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      identity: { address: GROUP, name: "Plot", kind: "group", created_at: expect.any(Number) },
      members: [
        { address: OTHER },
        { address: MEMBER, name: "Amina", kind: "user" },
      ],
      chamas: [],
    });
  });
});

describe("handleAddMember", () => {
  it("returns 400 when either address is missing", async () => {
    const s = store();
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    expect((await handleAddMember(s, w, {}, makeChain(MEMBER))).status).toBe(400);
    expect((await handleAddMember(s, w, { group_address: GROUP }, makeChain(MEMBER))).status).toBe(400);
    expect((await handleAddMember(s, w, { member_address: MEMBER }, makeChain(MEMBER))).status).toBe(400);
  });

  it("rejects a malformed address", async () => {
    const result = await handleAddMember(store(), walletStore(), {
      group_address: INVALID,
      member_address: MEMBER,
    }, makeChain(MEMBER));
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("refuses when the group is not a registered group", async () => {
    const result = await handleAddMember(store(), walletStore(), {
      group_address: GROUP,
      member_address: MEMBER,
    }, makeChain(MEMBER));
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_GROUP_COPY },
    });
  });

  it("refuses a member who has not transacted with the group", async () => {
    const s = store();
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    const result = await handleAddMember(s, w, {
      group_address: GROUP,
      member_address: MEMBER,
    }, makeChain(null));
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: "This wallet hasn't paid into the chama." },
    });
    expect(s.isMember(GROUP, MEMBER)).toBe(false);
  });

  it("adds a member who has transacted with the group", async () => {
    const s = store();
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    const result = await handleAddMember(s, w, {
      group_address: GROUP,
      member_address: MEMBER,
    }, makeChain(MEMBER));
    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      membership: { user_address: MEMBER, chama_address: GROUP, created_at: 1_000 },
    });
    expect(s.isMember(GROUP, MEMBER)).toBe(true);
  });

  it("is idempotent when the person is already a member", async () => {
    const s = store();
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    await handleAddMember(s, w, { group_address: GROUP, member_address: MEMBER }, makeChain(MEMBER));
    const result = await handleAddMember(s, w, { group_address: GROUP, member_address: MEMBER }, makeChain(MEMBER));
    expect(result.status).toBe(201);
    expect(s.listForChama(GROUP)).toHaveLength(1);
  });

  it("refuses a group adding itself as a member", async () => {
    const s = store();
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    const result = await handleAddMember(s, w, {
      group_address: GROUP,
      member_address: GROUP,
    }, makeChain(GROUP));
    expect(result.status).toBe(422);
    expect(s.isMember(GROUP, GROUP)).toBe(false);
  });

  it("refuses a registered group wallet as a member", async () => {
    const s = store();
    const w = walletStore([
      { address: GROUP, name: "Plot", kind: "group" },
      { address: OTHER, name: "Kamau Traders", kind: "group" },
    ]);
    const result = await handleAddMember(s, w, {
      group_address: GROUP,
      member_address: OTHER,
    }, makeChain(OTHER));
    expect(result.status).toBe(422);
    expect(s.isMember(GROUP, OTHER)).toBe(false);
  });

  it("surfaces an upstream error", async () => {
    const w = walletStore([{ address: GROUP, name: "Plot", kind: "group" }]);
    const chain: BookChain = {
      getBalance: async () => ({ address: GROUP, balance: 0 }),
      getFullTransactions: vi.fn(async () => {
        throw new Error("upstream down");
      }),
    };
    const result = await handleAddMember(store(), w, {
      group_address: GROUP,
      member_address: MEMBER,
    }, chain);
    expect(result.status).toBe(500);
  });
});