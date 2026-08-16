import type { NetworkConfig } from "./types";

export const SUPPORTED_NETWORKS = ["testnet-10"] as const;

type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

const NETWORKS: Record<SupportedNetwork, NetworkConfig> = {
  "testnet-10": {
    networkId: "testnet-10",
    apiBaseUrl: "https://api-tn10.kaspa.org",
    addressPrefix: "kaspatest:",
    explorer: {
      primary: "https://explorer-tn10.kaspa.org",
      fallback: "https://tn10.kaspa.stream",
    },
  },
};

export function resolveNetwork(raw: string | undefined): NetworkConfig {
  return (SUPPORTED_NETWORKS as readonly string[]).includes(raw ?? "")
    ? NETWORKS[raw as SupportedNetwork]
    : NETWORKS["testnet-10"];
}

export function getNetworkConfig(
  env: Record<string, string | undefined> = {},
): NetworkConfig {
  return resolveNetwork(env.KASPANET ?? env.VITE_KASPANET);
}

export function proofUrl(network: NetworkConfig, txid: string): string {
  return `${network.explorer.primary}/txs/${txid}`;
}

export function proofUrlFallback(network: NetworkConfig, txid: string): string {
  return `${network.explorer.fallback}/transactions/${txid}`;
}
