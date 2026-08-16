import type { MembershipStore } from "./membership-store";
import { isValidMembershipCode } from "./kaspa-address";
import { requiredStr, toRouteResult } from "./errors";
import type { RouteResult } from "./errors";

export function handleListMemberships(
  store: MembershipStore,
  user: unknown,
): RouteResult {
  try {
    const userAddress = requiredStr(user, "user");
    return { status: 200, body: { memberships: store.listForUser(userAddress) } };
  } catch (err) {
    return toRouteResult(err);
  }
}

export interface JoinInput {
  user_address?: unknown;
  chama_address?: unknown;
}

export function handleJoinMembership(
  store: MembershipStore,
  input: JoinInput,
): RouteResult {
  try {
    const userAddress = requiredStr(input.user_address, "user_address");
    const chamaAddress = requiredStr(input.chama_address, "chama_address");
    if (!isValidMembershipCode(chamaAddress)) {
      return { status: 422, body: { outcome: "invalid-code" } };
    }

    const result = store.join(userAddress, chamaAddress);
    if (result.outcome === "joined") {
      return {
        status: 201,
        body: { outcome: "joined", membership: result.membership },
      };
    }
    return {
      status: 200,
      body: { outcome: "already-member", membership: result.membership },
    };
  } catch (err) {
    return toRouteResult(err);
  }
}

export interface LeaveInput {
  user_address?: unknown;
  chama_address?: unknown;
}

export function handleLeaveMembership(
  store: MembershipStore,
  input: LeaveInput,
): RouteResult {
  try {
    const userAddress = requiredStr(input.user_address, "user_address");
    const chamaAddress = requiredStr(input.chama_address, "chama_address");
    store.leave(userAddress, chamaAddress);
    return { status: 200, body: { outcome: "left" } };
  } catch (err) {
    return toRouteResult(err);
  }
}
