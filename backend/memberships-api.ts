import { isCounterpartyOf, UNREGISTERED_GROUP_COPY } from "./book-api";
import type { BookChain } from "./book-api";
import type { Wallet } from "../shared/types";
import { AppError, toRouteResult, validAddress, requiredStr } from "./errors";
import type { RouteResult } from "./errors";
import { KaspaClient } from "./kaspa-client";
import { logger } from "./logger";
import type { MembershipStore } from "./membership-store";
import type { WalletStore } from "./wallet-store";

export function handleGetHome(
  store: MembershipStore,
  wallets: WalletStore,
  user: unknown,
): RouteResult {
  try {
    const userAddress = requiredStr(user, "user");
    const identity = wallets.get(userAddress);
    if (identity === null) {
      logger.info("home for an unregistered wallet", { userAddress });
      return { status: 200, body: { identity: null, members: [], chamas: [] } };
    }
    if (identity.kind === "group") {
      const memberships = store.listForChama(userAddress);
      const resolved = wallets.resolveMany(memberships.map((m) => m.user_address));
      const byAddress = new Map(resolved.map((wallet) => [wallet.address, wallet]));
      const members = memberships.map((membership) => {
        const wallet = byAddress.get(membership.user_address);
        return wallet !== undefined
          ? { address: wallet.address, name: wallet.name, kind: wallet.kind }
          : { address: membership.user_address };
      });
      logger.info("group home served", { chamaAddress: userAddress, members: members.length });
      return { status: 200, body: { identity, members, chamas: [] } };
    }
    const memberships = store.listForUser(userAddress);
    const resolved = wallets.resolveMany(memberships.map((m) => m.chama_address));
    const byAddress = new Map(resolved.map((wallet) => [wallet.address, wallet]));
    const chamas = memberships
      .map((membership) => byAddress.get(membership.chama_address))
      .filter((wallet): wallet is Wallet => wallet !== undefined && wallet.kind === "group")
      .map((wallet) => ({
        address: wallet.address,
        name: wallet.name,
        kind: wallet.kind,
      }));
    logger.info("person home served", { userAddress, chamas: chamas.length });
    return { status: 200, body: { identity, members: [], chamas } };
  } catch (err) {
    return toRouteResult(err);
  }
}

export interface AddMemberInput {
  group_address?: unknown;
  member_address?: unknown;
}

export async function handleAddMember(
  store: MembershipStore,
  wallets: WalletStore,
  input: AddMemberInput,
  chain: BookChain = new KaspaClient(),
): Promise<RouteResult> {
  try {
    const chamaAddress = validAddress(requiredStr(input.group_address, "group_address"), "group_address");
    const memberAddress = validAddress(requiredStr(input.member_address, "member_address"), "member_address");
    const group = wallets.get(chamaAddress);
    if (group === null || group.kind !== "group") {
      logger.warn("member add refused", { chamaAddress, memberAddress, reason: "not-a-registered-group" });
      throw new AppError("invalid", UNREGISTERED_GROUP_COPY);
    }
    if (chamaAddress === memberAddress) {
      logger.warn("member add refused", { chamaAddress, memberAddress, reason: "self-add" });
      throw new AppError("invalid", "A chama cannot add itself as a member.");
    }
    const member = wallets.get(memberAddress);
    if (member !== null && member.kind === "group") {
      logger.warn("member add refused", { chamaAddress, memberAddress, reason: "member-is-a-group" });
      throw new AppError("invalid", "A group cannot join another chama.");
    }
    if (!(await isCounterpartyOf(chain, chamaAddress, memberAddress))) {
      logger.warn("member add refused", { chamaAddress, memberAddress, reason: "not-a-counterparty" });
      throw new AppError("invalid", "This wallet hasn't paid into the chama.");
    }
    const membership = store.addMember(chamaAddress, memberAddress);
    logger.info("member added to chama", { chamaAddress, memberAddress });
    return { status: 201, body: { membership } };
  } catch (err) {
    return toRouteResult(err);
  }
}