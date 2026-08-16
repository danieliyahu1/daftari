import { afterEach, describe, expect, it } from "vitest";
import { SqliteMembershipStore } from "./membership-store";
import type { MembershipStore } from "./membership-store";
import {
  handleJoinMembership,
  handleLeaveMembership,
  handleListMemberships,
} from "./memberships-api";

const USER = "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya";
const VALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks";
const INVALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpk0";
const MAINNET_CODE =
  "kaspa:qp0l70zd5x85ttwd6jv7g3s3a8llzj96d8dncn4zmhv4tlzx5k2jyqh70xmfj";

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

describe("handleListMemberships", () => {
  it("returns 400 when the user param is missing", () => {
    const result = handleListMemberships(store(), undefined);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: expect.stringMatching(/user/) });
  });

  it("returns 400 when the user param is blank", () => {
    const result = handleListMemberships(store(), "   ");
    expect(result.status).toBe(400);
  });

  it("returns an empty list for a user with no memberships", () => {
    const result = handleListMemberships(store(), USER);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ memberships: [] });
  });

  it("returns the stored memberships for the user", () => {
    const s = store();
    s.join(USER, VALID_CODE);

    const result = handleListMemberships(s, USER);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      memberships: [
        { user_address: USER, chama_address: VALID_CODE, created_at: 1_000 },
      ],
    });
  });
});

describe("handleJoinMembership", () => {
  it("joins with a well-formed code", () => {
    const result = handleJoinMembership(store(), {
      user_address: USER,
      chama_address: VALID_CODE,
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      outcome: "joined",
      membership: {
        user_address: USER,
        chama_address: VALID_CODE,
        created_at: 1_000,
      },
    });
  });

  it("is idempotent on a duplicate join", () => {
    const s = store();
    handleJoinMembership(s, { user_address: USER, chama_address: VALID_CODE });

    const result = handleJoinMembership(s, {
      user_address: USER,
      chama_address: VALID_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ outcome: "already-member" });
  });

  it("returns the invalid-code outcome for a bad checksum", () => {
    const result = handleJoinMembership(store(), {
      user_address: USER,
      chama_address: INVALID_CODE,
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ outcome: "invalid-code" });
  });

  it("returns the invalid-code outcome for a well-formed address on another network", () => {
    const result = handleJoinMembership(store(), {
      user_address: USER,
      chama_address: MAINNET_CODE,
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ outcome: "invalid-code" });
  });

  it("returns the invalid-code outcome for junk input", () => {
    const result = handleJoinMembership(store(), {
      user_address: USER,
      chama_address: "not-an-address",
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ outcome: "invalid-code" });
  });

  it("returns 400 when user_address is missing", () => {
    const result = handleJoinMembership(store(), {
      chama_address: VALID_CODE,
    });
    expect(result.status).toBe(400);
  });

  it("returns 400 when chama_address is missing", () => {
    const result = handleJoinMembership(store(), {
      user_address: USER,
    });
    expect(result.status).toBe(400);
  });

  it("does not store a rejected join", () => {
    const s = store();
    handleJoinMembership(s, { user_address: USER, chama_address: INVALID_CODE });

    expect(s.listForUser(USER)).toEqual([]);
  });
});

describe("handleLeaveMembership", () => {
  it("leaves an existing membership", () => {
    const s = store();
    s.join(USER, VALID_CODE);

    const result = handleLeaveMembership(s, {
      user_address: USER,
      chama_address: VALID_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ outcome: "left" });
    expect(s.listForUser(USER)).toEqual([]);
  });

  it("is idempotent when the membership does not exist", () => {
    const result = handleLeaveMembership(store(), {
      user_address: USER,
      chama_address: VALID_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ outcome: "left" });
  });

  it("returns 400 when user_address is missing", () => {
    const result = handleLeaveMembership(store(), {
      chama_address: VALID_CODE,
    });
    expect(result.status).toBe(400);
  });

  it("returns 400 when chama_address is missing", () => {
    const result = handleLeaveMembership(store(), {
      user_address: USER,
    });
    expect(result.status).toBe(400);
  });
});
