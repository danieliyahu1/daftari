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
    expect(s.listForChama(CHAMA)).toEqual([]);
  });

  it("adds a member and lists it for both sides", () => {
    const s = store();
    const result = s.addMember(CHAMA, USER);

    expect(result).toEqual({
      user_address: USER,
      chama_address: CHAMA,
      created_at: 1_000,
    });
    expect(s.listForUser(USER)).toEqual([
      { user_address: USER, chama_address: CHAMA, created_at: 1_000 },
    ]);
    expect(s.listForChama(CHAMA)).toEqual([
      { user_address: USER, chama_address: CHAMA, created_at: 1_000 },
    ]);
  });

  it("lists a chama's members ordered by created_at", () => {
    let tick = 1_000;
    const s = new SqliteMembershipStore({ now: () => tick++ });
    stores.push(s);
    s.addMember(CHAMA, OTHER_USER);
    s.addMember(CHAMA, USER);

    expect(s.listForChama(CHAMA).map((m) => m.user_address)).toEqual([
      OTHER_USER,
      USER,
    ]);
  });

  it("is idempotent on duplicate add", () => {
    const s = store();
    s.addMember(CHAMA, USER);
    const second = s.addMember(CHAMA, USER);

    expect(second).toEqual(s.addMember(CHAMA, USER));
    expect(s.listForChama(CHAMA)).toHaveLength(1);
  });

  it("scopes memberships per chama", () => {
    const s = store();
    s.addMember(CHAMA, USER);

    expect(s.listForChama(OTHER_CHAMA)).toEqual([]);
    expect(s.listForUser(OTHER_USER)).toEqual([]);
  });

  it("reports membership with isMember", () => {
    const s = store();
    s.addMember(CHAMA, USER);

    expect(s.isMember(CHAMA, USER)).toBe(true);
    expect(s.isMember(CHAMA, OTHER_USER)).toBe(false);
    expect(s.isMember(OTHER_CHAMA, USER)).toBe(false);
  });
});