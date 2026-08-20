import { describe, expect, it, vi } from "vitest";
import { getNetworkConfig } from "../shared/network";
import type { Book, BookRow, Wallet, WalletKind } from "../shared/types";
import type { TxModel } from "./kaspa-api-types";
import {
  bookRowsForPage,
  deriveBookRow,
  deriveDirection,
  handleGetBook,
  isCounterpartyOf,
  MEMBER_ONLY_COPY,
  selectOtherParty,
  UNREGISTERED_GROUP_COPY,
} from "./book-api";
import type { BookChain, BookMembershipResolver, BookWalletResolver } from "./book-api";
import { UpstreamError } from "./kaspa-client";

const GROUP = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const ALICE = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const BOB = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const INVALID_CODE = "kaspatest:not-an-address";

const NETWORK = getNetworkConfig();

interface TxOpts {
  txid?: string;
  block_time?: number;
  is_accepted?: boolean;
  inputs?: Array<{ address?: string; amount?: number; resolved?: boolean }>;
  outputs?: Array<{ address?: string; amount?: number }>;
}

function tx(opts: TxOpts = {}): TxModel {
  const txid = opts.txid ?? "a".repeat(64);
  return {
    subnetwork_id: "0".repeat(64),
    transaction_id: txid,
    hash: txid,
    mass: "100",
    payload: "",
    block_hash: [],
    block_time: opts.block_time ?? 0,
    version: 0,
    is_accepted: opts.is_accepted ?? true,
    accepting_block_hash: "",
    accepting_block_blue_score: 0,
    accepting_block_time: 0,
    inputs: (opts.inputs ?? []).map((input) => ({
      transaction_id: txid,
      index: 0,
      previous_outpoint_hash: "0".repeat(64),
      previous_outpoint_index: "0",
      signature_script: "",
      sig_op_count: "1",
      ...(input.resolved
        ? {
            previous_outpoint_resolved: {
              transaction_id: txid,
              index: 0,
              amount: input.amount ?? 0,
              script_public_key: "20..",
              script_public_key_address: input.address,
            },
          }
        : input.address !== undefined && input.address !== null
          ? {
              previous_outpoint_address: input.address,
              previous_outpoint_amount: input.amount,
            }
          : {}),
    })),
    outputs: (opts.outputs ?? []).map((output, index) => ({
      transaction_id: txid,
      index,
      amount: output.amount ?? 0,
      script_public_key: "20..",
      ...(output.address !== undefined && output.address !== null
        ? { script_public_key_address: output.address }
        : {}),
    })),
  };
}

function makeChain(overrides: Partial<BookChain> = {}): {
  chain: BookChain;
  getBalance: ReturnType<typeof vi.fn>;
  getFullTransactions: ReturnType<typeof vi.fn>;
} {
  const getBalance = vi.fn(async () => ({ address: GROUP, balance: 1_000_000_000 }));
  const getFullTransactions = vi.fn(async (): Promise<TxModel[]> => []);
  const chain: BookChain = { getBalance, getFullTransactions };
  return {
    chain: { ...chain, ...overrides },
    getBalance,
    getFullTransactions,
  };
}

function makeWallets(
  registered: Array<{ address: string; name: string; kind: WalletKind; created_at?: number }> = [],
): BookWalletResolver {
  const byAddress = new Map(
    registered.map((wallet) => [
      wallet.address,
      {
        address: wallet.address,
        name: wallet.name,
        kind: wallet.kind,
        created_at: wallet.created_at ?? 0,
      },
    ]),
  );
  return {
    get: async (address) => byAddress.get(address) ?? null,
    resolveMany: async (addresses) =>
      addresses
        .map((address) => byAddress.get(address))
        .filter((wallet): wallet is Wallet => wallet !== undefined),
  };
}

const GROUP_WALLET: Wallet = { address: GROUP, name: "Plot", kind: "group", created_at: 0 };
const ALICE_WALLET: Wallet = { address: ALICE, name: "Amina", kind: "user", created_at: 0 };
const BOB_WALLET: Wallet = { address: BOB, name: "Kamau Traders", kind: "group", created_at: 0 };

function makeMemberships(members: string[] = []): BookMembershipResolver {
  return { isMember: async (_chama, user) => members.includes(user) };
}

describe("deriveDirection", () => {
  it("is in when the group address is among the outputs", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBe("in");
  });

  it("is out when the group address is among the inputs", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [{ address: ALICE, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBe("out");
  });

  it("returns null for a self-send where group is on both sides equally", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBeNull();
  });

  it("is out when the group spends more than it receives", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 20 },
        { address: ALICE, amount: 80 },
      ],
    });
    expect(deriveDirection(GROUP, t)).toBe("out");
  });

  it("is in when the group receives more than it spends", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 90 },
        { address: ALICE, amount: 10 },
      ],
    });
    expect(deriveDirection(GROUP, t)).toBe("in");
  });

  it("is null when the group address does not appear", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: BOB, amount: 100 }],
    });
    expect(deriveDirection(GROUP, t)).toBeNull();
  });
});

describe("selectOtherParty", () => {
  it("picks the sender for money coming in", () => {
    const t = tx({
      inputs: [
        { address: ALICE, amount: 80 },
        { address: BOB, amount: 20 },
      ],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(ALICE);
  });

  it("picks the receiver for money going out", () => {
    const t = tx({
      inputs: [{ address: GROUP, amount: 100 }],
      outputs: [
        { address: ALICE, amount: 80 },
        { address: BOB, amount: 20 },
      ],
    });
    expect(selectOtherParty(GROUP, t, "out")).toBe(ALICE);
  });

  it("skips the group itself when choosing the counterparty", () => {
    const t = tx({
      inputs: [
        { address: GROUP, amount: 50 },
        { address: BOB, amount: 50 },
      ],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(BOB);
  });

  it("reads the counterparty from the resolved input output when the address is not inline", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100, resolved: true }],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBe(ALICE);
  });

  it("returns null when there is no other party", () => {
    const t = tx({
      inputs: [],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(selectOtherParty(GROUP, t, "in")).toBeNull();
  });
});

describe("deriveBookRow", () => {
  it("formats an incoming row with the group-facing amount", () => {
    const t = tx({
      txid: "c".repeat(64),
      block_time: 1_720_000_000,
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 90 },
        { address: ALICE, amount: 10 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row).toEqual<BookRow>({
      direction: "in",
      amount_sompi: "90",
      other_address: ALICE,
      date: 1_720_000_000,
      txid: "c".repeat(64),
      proof_url: `https://explorer.kaspa.org/tn10/txs/${"c".repeat(64)}`,
    });
  });

  it("sums every group output on an incoming row", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [
        { address: GROUP, amount: 60 },
        { address: GROUP, amount: 40 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row?.amount_sompi).toBe("100");
  });

  it("sums non-group outputs on an outgoing row", () => {
    const t = tx({
      inputs: [
        { address: GROUP, amount: 60 },
        { address: GROUP, amount: 40 },
      ],
      outputs: [
        { address: ALICE, amount: 80 },
        { address: GROUP, amount: 20 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row?.amount_sompi).toBe("80");
    expect(row?.direction).toBe("out");
  });

  it("returns null when the group does not appear", () => {
    const t = tx({
      inputs: [{ address: ALICE, amount: 100 }],
      outputs: [{ address: BOB, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });

  it("returns null when no counterparty can be identified", () => {
    const t = tx({
      inputs: [],
      outputs: [{ address: GROUP, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });

  it("treats a group-send-with-change as outgoing to the counterparty", () => {
    const t = tx({
      inputs: [
        { address: GROUP, amount: 100 },
        { address: GROUP, amount: 50 },
      ],
      outputs: [
        { address: ALICE, amount: 120 },
        { address: GROUP, amount: 30 },
      ],
    });
    const row = deriveBookRow(GROUP, t, NETWORK);
    expect(row).toEqual<BookRow>({
      direction: "out",
      amount_sompi: "120",
      other_address: ALICE,
      date: 0,
      txid: "a".repeat(64),
      proof_url: `https://explorer.kaspa.org/tn10/txs/${"a".repeat(64)}`,
    });
  });

  it("returns null when the group-facing amount is unknowable", () => {
    const t = tx({
      inputs: [{ address: GROUP }],
      outputs: [{ address: ALICE, amount: 100 }],
    });
    expect(deriveBookRow(GROUP, t, NETWORK)).toBeNull();
  });
});

describe("bookRowsForPage", () => {
  it("keeps only accepted rows and sorts newest first by block_time", () => {
    const older = tx({ txid: "a".repeat(64), block_time: 100, is_accepted: true, inputs: [{ address: ALICE, amount: 10 }], outputs: [{ address: GROUP, amount: 10 }] });
    const rejected = tx({ txid: "b".repeat(64), block_time: 200, is_accepted: false, inputs: [{ address: BOB, amount: 20 }], outputs: [{ address: GROUP, amount: 20 }] });
    const newest = tx({ txid: "c".repeat(64), block_time: 300, is_accepted: true, inputs: [{ address: BOB, amount: 30 }], outputs: [{ address: GROUP, amount: 30 }] });

    const rows = bookRowsForPage(GROUP, [older, rejected, newest], NETWORK);

    expect(rows.map((row) => row.txid)).toEqual(["c".repeat(64), "a".repeat(64)]);
  });

  it("breaks block_time ties by txid for determinism", () => {
    const t1 = tx({ txid: "b".repeat(64), block_time: 100, inputs: [{ address: ALICE, amount: 1 }], outputs: [{ address: GROUP, amount: 1 }] });
    const t2 = tx({ txid: "a".repeat(64), block_time: 100, inputs: [{ address: BOB, amount: 1 }], outputs: [{ address: GROUP, amount: 1 }] });

    const rows = bookRowsForPage(GROUP, [t1, t2], NETWORK);

    expect(rows.map((row) => row.txid)).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("never invents a row when the chain does not support it", () => {
    const unsupported = tx({ txid: "d".repeat(64), is_accepted: true, inputs: [], outputs: [{ address: GROUP, amount: 5 }] });
    const rows = bookRowsForPage(GROUP, [unsupported], NETWORK);
    expect(rows).toEqual([]);
  });
});

describe("handleGetBook", () => {
  it("returns balance, the group, and empty rows for an empty book", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(200);
    expect(result.body).toEqual<Book>({
      balance_sompi: "1000000000",
      rows: [],
      group: { address: GROUP, name: "Plot", kind: "group" },
    });
  });

  it("paginates with default limit and offset", async () => {
    const { chain, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(getFullTransactions).toHaveBeenCalledWith(GROUP, { limit: 50, offset: 0 });
  });

  it("honours custom limit and offset", async () => {
    const { chain, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, { limit: 20, offset: 40 }, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(getFullTransactions).toHaveBeenCalledWith(GROUP, { limit: 20, offset: 40 });
  });

  it("returns the formatted rows from the chain page", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "c".repeat(64),
          block_time: 300,
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      balance_sompi: "1000000000",
      rows: [
        {
          direction: "in",
          amount_sompi: "30",
          other_address: ALICE,
          other_is_member: false,
          date: 300,
          txid: "c".repeat(64),
          proof_url: `https://explorer.kaspa.org/tn10/txs/${"c".repeat(64)}`,
        },
      ],
      group: { address: GROUP, name: "Plot", kind: "group" },
    });
  });

  it("enriches rows with the registered counterparty's name and kind", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "a".repeat(64),
          block_time: 400,
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
        tx({
          txid: "b".repeat(64),
          block_time: 300,
          inputs: [{ address: BOB, amount: 70 }],
          outputs: [{ address: GROUP, amount: 70 }],
        }),
      ]),
    });
    const result = await handleGetBook(
      GROUP,
      {},
      chain,
      makeWallets([GROUP_WALLET, ALICE_WALLET, BOB_WALLET]),
      makeMemberships([ALICE]),
      GROUP,
    );
    expect(result.status).toBe(200);
    const rows = (result.body as Book).rows;
    expect(rows[0]).toMatchObject({
      other_address: ALICE,
      other_name: "Amina",
      other_kind: "user",
      other_is_member: true,
    });
    expect(rows[1]).toMatchObject({
      other_address: BOB,
      other_name: "Kamau Traders",
      other_kind: "group",
      other_is_member: false,
    });
  });

  it("leaves unregistered counterparties as their address", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          txid: "c".repeat(64),
          block_time: 300,
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(200);
    const [row] = (result.body as Book).rows;
    expect(row).not.toHaveProperty("other_name");
    expect(row).not.toHaveProperty("other_kind");
    expect(row?.other_address).toBe(ALICE);
    expect(row?.other_is_member).toBe(false);
  });

  it("fetches balance and transactions together", async () => {
    const { chain, getBalance, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(getBalance).toHaveBeenCalledWith(GROUP);
    expect(getFullTransactions).toHaveBeenCalled();
  });

  it("returns 400 when the code is missing", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(undefined, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 invalid for an invalid code", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(INVALID_CODE, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { kind: "invalid" } });
  });

  it("returns 422 validation for a non-positive limit or negative offset", async () => {
    const { chain } = makeChain();
    const wallets = makeWallets([GROUP_WALLET]);
    expect((await handleGetBook(GROUP, { limit: 0 }, chain, wallets, makeMemberships(), GROUP)).status).toBe(422);
    expect((await handleGetBook(GROUP, { limit: -1 }, chain, wallets, makeMemberships(), GROUP)).status).toBe(422);
    expect((await handleGetBook(GROUP, { offset: -1 }, chain, wallets, makeMemberships(), GROUP)).status).toBe(422);
  });

  it("refuses a code that is not a registered group with the exact copy", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([]), makeMemberships(), GROUP);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_GROUP_COPY },
    });
  });

  it("refuses a registered user wallet the same way", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(
      GROUP,
      {},
      chain,
      makeWallets([{ address: GROUP, name: "Amina", kind: "user" }]),
      makeMemberships(),
      GROUP,
    );
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "invalid", message: UNREGISTERED_GROUP_COPY },
    });
  });

  it("does not touch the chain when the code is not a registered group", async () => {
    const { chain, getBalance, getFullTransactions } = makeChain();
    await handleGetBook(GROUP, {}, chain, makeWallets([]), makeMemberships(), GROUP);
    expect(getBalance).not.toHaveBeenCalled();
    expect(getFullTransactions).not.toHaveBeenCalled();
  });

  it("allows the group wallet itself to read the book", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships([]), GROUP);
    expect(result.status).toBe(200);
  });

  it("allows a member to read the book", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships([ALICE]), ALICE);
    expect(result.status).toBe(200);
  });

  it("refuses a non-member with the member-only copy", async () => {
    const { chain, getBalance } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships([]), ALICE);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "policy", message: MEMBER_ONLY_COPY },
    });
    expect(getBalance).not.toHaveBeenCalled();
  });

  it("refuses an anonymous requester the same way", async () => {
    const { chain } = makeChain();
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), undefined);
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { kind: "policy", message: MEMBER_ONLY_COPY },
    });
  });

  it("maps an upstream rejection to a structured error", async () => {
    const { chain } = makeChain({
      getBalance: vi.fn(async () => {
        throw new UpstreamError("upstream down", 503, "unavailable", { error: "busy" });
      }),
    });
    const result = await handleGetBook(GROUP, {}, chain, makeWallets([GROUP_WALLET]), makeMemberships(), GROUP);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error: { kind: "upstream", source: "unavailable", message: "busy" },
    });
  });
});

describe("isCounterpartyOf", () => {
  it("is true when the address appears among the parties", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          inputs: [{ address: ALICE, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    expect(await isCounterpartyOf(chain, GROUP, ALICE)).toBe(true);
  });

  it("is true for a party on the receiving side", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          inputs: [{ address: GROUP, amount: 30 }],
          outputs: [{ address: ALICE, amount: 30 }],
        }),
      ]),
    });
    expect(await isCounterpartyOf(chain, GROUP, ALICE)).toBe(true);
  });

  it("is false when the address never appears", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async () => [
        tx({
          inputs: [{ address: BOB, amount: 30 }],
          outputs: [{ address: GROUP, amount: 30 }],
        }),
      ]),
    });
    expect(await isCounterpartyOf(chain, GROUP, ALICE)).toBe(false);
  });

  it("stops paging once the address is found", async () => {
    const { chain, getFullTransactions } = makeChain();
    getFullTransactions.mockResolvedValueOnce([tx({ inputs: [{ address: ALICE, amount: 1 }], outputs: [{ address: GROUP, amount: 1 }] })]);
    getFullTransactions.mockResolvedValue([]);
    expect(await isCounterpartyOf(chain, GROUP, ALICE)).toBe(true);
    expect(getFullTransactions).toHaveBeenCalledTimes(1);
  });

  it("finds a counterparty whose only transaction lies beyond the 500-tx scan window", async () => {
    const { chain } = makeChain({
      getFullTransactions: vi.fn(async (_address, { offset }: { limit: number; offset: number }) => {
        if (offset >= 500) {
          return [
            tx({
              inputs: [{ address: ALICE, amount: 1 }],
              outputs: [{ address: GROUP, amount: 1 }],
            }),
          ];
        }
        return Array.from({ length: 50 }, (_, index) =>
          tx({
            txid: `${offset}-${index}`.padStart(64, "0"),
            inputs: [{ address: BOB, amount: 1 }],
            outputs: [{ address: GROUP, amount: 1 }],
          }),
        );
      }),
    });
    expect(await isCounterpartyOf(chain, GROUP, ALICE)).toBe(true);
  });
});
