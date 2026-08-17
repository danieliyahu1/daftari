import type { NetworkConfig } from "./types";

const NETWORKS: Record<"testnet-10", NetworkConfig> = {
  "testnet-10": {
    networkId: "testnet-10",
    apiBaseUrl: "https://api-tn10.kaspa.org",
    addressPrefix: "kaspatest:",
    explorer: {
      primary: "https://explorer-tn10.kaspa.org",
    },
  },
};

export function resolveNetwork(raw: string | undefined): NetworkConfig {
  return NETWORKS[raw as "testnet-10"] ?? NETWORKS["testnet-10"];
}

export function getNetworkConfig(
  env: Record<string, string | undefined> = {},
): NetworkConfig {
  return resolveNetwork(env.KASPANET ?? env.VITE_KASPANET);
}

export function proofUrl(network: NetworkConfig, txid: string): string {
  return `${network.explorer.primary}/txs/${txid}`;
}