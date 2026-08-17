export type NetworkId = "testnet-10";

export interface ExplorerConfig {
  primary: string;
}

export interface NetworkConfig {
  networkId: NetworkId;
  apiBaseUrl: string;
  addressPrefix: string;
  explorer: ExplorerConfig;
}

export interface Membership {
  user_address: string;
  chama_address: string;
  created_at: number;
}

export type WalletKind = "user" | "group";

export interface Wallet {
  address: string;
  name: string;
  kind: WalletKind;
  created_at: number;
}

export type BookDirection = "in" | "out";

export interface BookGroup {
  address: string;
  name: string;
  kind: WalletKind;
}

export interface BookRow {
  direction: BookDirection;
  amount_sompi: string;
  other_address: string;
  other_name?: string;
  other_kind?: WalletKind;
  other_is_member?: boolean;
  date: number;
  txid: string;
  proof_url: string;
}

export interface Book {
  balance_sompi: string;
  rows: BookRow[];
  group: BookGroup;
}

export interface RosterMember {
  address: string;
  name?: string;
  kind?: WalletKind;
}

export interface Home {
  identity: Wallet | null;
  members: RosterMember[];
  chamas: BookGroup[];
}

export type PaymentOutcome = "recorded" | "failed";

export interface PaymentResult {
  outcome: PaymentOutcome;
  txid?: string;
}
