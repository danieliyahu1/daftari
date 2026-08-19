import type { AuthStore, ChallengeRecord } from "./auth-store";
import type { MembershipStore } from "./membership-store";
import type { WalletStore } from "./wallet-store";
import type { Membership, Wallet, WalletKind } from "../shared/types";
import { AppError } from "./errors";

// In-memory async fakes for the three store interfaces. These are used only in
// tests so that unit and integration tests never touch a real database.

export class FakeAuthStore implements AuthStore {
  private readonly challenges = new Map<string, ChallengeRecord>();

  async create(address: string): Promise<ChallengeRecord> {
    const record: ChallengeRecord = {
      nonce: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
      address,
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.challenges.set(record.nonce, record);
    return record;
  }

  async consume(nonce: string, address: string): Promise<ChallengeRecord | null> {
    const record = this.challenges.get(nonce);
    if (record === undefined || record.address !== address) return null;
    this.challenges.delete(nonce);
    return record;
  }

  close(): void {
    this.challenges.clear();
  }
}

export class FakeWalletStore implements WalletStore {
  private readonly wallets = new Map<string, Wallet>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async register(address: string, name: string, kind: WalletKind): Promise<Wallet> {
    if (this.wallets.has(address)) {
      throw new AppError("conflict", "This wallet is already named");
    }
    const wallet: Wallet = { address, name, kind, created_at: this.now() };
    this.wallets.set(address, wallet);
    return wallet;
  }

  async get(address: string): Promise<Wallet | null> {
    return this.wallets.get(address) ?? null;
  }

  async resolveMany(addresses: string[]): Promise<Wallet[]> {
    const unique = [...new Set(addresses)];
    return unique
      .map((address) => this.wallets.get(address))
      .filter((wallet): wallet is Wallet => wallet !== undefined);
  }

  close(): void {
    this.wallets.clear();
  }
}

export class FakeMembershipStore implements MembershipStore {
  private readonly memberships: Membership[] = [];
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async listForUser(userAddress: string): Promise<Membership[]> {
    return this.memberships
      .filter((m) => m.user_address === userAddress)
      .sort((a, b) => a.created_at - b.created_at || a.chama_address.localeCompare(b.chama_address));
  }

  async listForChama(chamaAddress: string): Promise<Membership[]> {
    return this.memberships
      .filter((m) => m.chama_address === chamaAddress)
      .sort((a, b) => a.created_at - b.created_at || a.user_address.localeCompare(b.user_address));
  }

  async addMember(chamaAddress: string, userAddress: string): Promise<Membership> {
    const membership: Membership = { user_address: userAddress, chama_address: chamaAddress, created_at: this.now() };
    if (!this.memberships.some((m) => m.user_address === userAddress && m.chama_address === chamaAddress)) {
      this.memberships.push(membership);
    }
    return membership;
  }

  async isMember(chamaAddress: string, userAddress: string): Promise<boolean> {
    return this.memberships.some((m) => m.user_address === userAddress && m.chama_address === chamaAddress);
  }

  close(): void {
    this.memberships.length = 0;
  }
}
