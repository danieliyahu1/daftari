import type { MembershipStore } from "./membership-store";
import { isValidMembershipCode } from "./kaspa-address";

export interface RouteResult {
  status: number;
  body: unknown;
}

function badRequest(message: string): RouteResult {
  return { status: 400, body: { error: message } };
}

function requireString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function handleListMemberships(
  store: MembershipStore,
  user: unknown,
): RouteResult {
  const userAddress = requireString(user);
  if (userAddress === null) {
    return badRequest("The user query parameter is required");
  }
  return { status: 200, body: { memberships: store.listForUser(userAddress) } };
}

export interface JoinInput {
  user_address?: unknown;
  chama_address?: unknown;
}

export function handleJoinMembership(
  store: MembershipStore,
  input: JoinInput,
): RouteResult {
  const userAddress = requireString(input.user_address);
  if (userAddress === null) {
    return badRequest("user_address is required");
  }
  const chamaAddress = requireString(input.chama_address);
  if (chamaAddress === null) {
    return badRequest("chama_address is required");
  }
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
}

export interface LeaveInput {
  user_address?: unknown;
  chama_address?: unknown;
}

export function handleLeaveMembership(
  store: MembershipStore,
  input: LeaveInput,
): RouteResult {
  const userAddress = requireString(input.user_address);
  if (userAddress === null) {
    return badRequest("user_address is required");
  }
  const chamaAddress = requireString(input.chama_address);
  if (chamaAddress === null) {
    return badRequest("chama_address is required");
  }
  store.leave(userAddress, chamaAddress);
  return { status: 200, body: { outcome: "left" } };
}
