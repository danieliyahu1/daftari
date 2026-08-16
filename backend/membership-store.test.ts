import { afterEach, describe, expect, it } from "vitest";
import { SqliteMembershipStore } from "./membership-store";
import type { MembershipStore } from "./membership-store";

const USER = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const CHAMA = "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks";
const OTHER_CHAMA = "kaspatest:qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhe837j2d";
const OTHER_USER = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

const stores: MembershipStore[] = [];

function store(): MembershipStore {
  const s = new SqliteMembershipStore({ now: () => 1_000 });
  stores.push(s);
  return s;
}

afterEach(() => {
  for (const s of stores) s.close();
  stores.length = 0;
});

describe("SqliteMembershipStore", () => {
  it("starts empty", () => {
    const s = store();
    expect(s.listForUser(USER)).toEqual([]);
  });

  it("joins and lists a membership with its created_at", () => {
    const s = store();
    const result = s.join(USER, CHAMA);

    expect(result).toEqual({
      outcome: "joined",
      membership: { user_address: USER, chama_address: CHAMA, created_at: 1_000 },
    });
    expect(s.listForUser(USER)).toEqual([
      { user_address: USER, chama_address: CHAMA, created_at: 1_000 },
    ]);
  });

  it("lists memberships ordered by created_at", () => {
    let tick = 1_000;
    const s = new SqliteMembershipStore({ now: () => tick++ });
    stores.push(s);
    s.join(USER, OTHER_CHAMA);
    s.join(USER, CHAMA);

    expect(s.listForUser(USER).map((m) => m.chama_address)).toEqual([
      OTHER_CHAMA,
      CHAMA,
    ]);
  });

  it("is idempotent on duplicate join", () => {
    const s = store();
    const first = s.join(USER, CHAMA);
    const second = s.join(USER, CHAMA);

    expect(second.outcome).toBe("already-member");
    expect(second.membership).toEqual(first.membership);
    expect(s.listForUser(USER)).toHaveLength(1);
  });

  it("scopes memberships per user", () => {
    const s = store();
    s.join(USER, CHAMA);

    expect(s.listForUser(OTHER_USER)).toEqual([]);
  });

  it("leave removes an existing membership and reports it", () => {
    const s = store();
    s.join(USER, CHAMA);

    expect(s.leave(USER, CHAMA)).toBe(true);
    expect(s.listForUser(USER)).toEqual([]);
  });

  it("leave on a missing membership is a no-op", () => {
    const s = store();
    expect(s.leave(USER, CHAMA)).toBe(false);
  });
});
