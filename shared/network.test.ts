import { describe, expect, it } from "vitest";
import {
  getNetworkConfig,
  resolveNetwork,
} from "./network";

describe("resolveNetwork", () => {
  it("resolves testnet-10", () => {
    const config = resolveNetwork("testnet-10");
    expect(config.networkId).toBe("testnet-10");
    expect(config.apiBaseUrl).toBe("https://api-tn10.kaspa.org");
    expect(config.addressPrefix).toBe("kaspatest:");
  });

  it("falls back to testnet-10 when undefined", () => {
    expect(resolveNetwork(undefined).networkId).toBe("testnet-10");
  });

  it("falls back to testnet-10 on unknown values", () => {
    for (const raw of ["", "mainnet", "testnet-11", "foo"]) {
      expect(resolveNetwork(raw).networkId).toBe("testnet-10");
    }
  });
});

describe("getNetworkConfig", () => {
  it("defaults to testnet-10 with no env", () => {
    expect(getNetworkConfig({}).networkId).toBe("testnet-10");
  });

  it("reads KASPANET", () => {
    expect(getNetworkConfig({ KASPANET: "testnet-10" }).networkId).toBe(
      "testnet-10",
    );
  });

  it("reads VITE_KASPANET", () => {
    expect(getNetworkConfig({ VITE_KASPANET: "testnet-10" }).networkId).toBe(
      "testnet-10",
    );
  });

  it("KASPANET wins over VITE_KASPANET", () => {
    expect(
      getNetworkConfig({
        KASPANET: "testnet-10",
        VITE_KASPANET: "testnet-10",
      }).networkId,
    ).toBe("testnet-10");
  });

  it("falls back to testnet-10 when env asks for an unsupported network", () => {
    expect(getNetworkConfig({ KASPANET: "mainnet" }).networkId).toBe(
      "testnet-10",
    );
    expect(getNetworkConfig({ VITE_KASPANET: "bogus" }).networkId).toBe(
      "testnet-10",
    );
  });
});
