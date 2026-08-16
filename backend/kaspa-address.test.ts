import { describe, expect, it } from "vitest";
import {
  isWellFormedKaspaAddress,
  isValidMembershipCode,
} from "./kaspa-address";

const VALID_TESTNET = [
  "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhqrxplya",
  "kaspatest:qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhe837j2d",
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks",
];

const VALID_MAINNET = [
  "kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx9awp4e",
  "kaspa:qp0l70zd5x85ttwd6jv7g3s3a8llzj96d8dncn4zmhv4tlzx5k2jyqh70xmfj",
  "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
];

describe("isWellFormedKaspaAddress", () => {
  it("accepts the kaspa-addresses test vectors (testnet)", () => {
    for (const address of VALID_TESTNET) {
      expect(isWellFormedKaspaAddress(address, "kaspatest")).toBe(true);
    }
  });

  it("accepts the kaspa-addresses test vectors (mainnet)", () => {
    for (const address of VALID_MAINNET) {
      expect(isWellFormedKaspaAddress(address, "kaspa")).toBe(true);
    }
  });

  it("rejects a corrupted checksum", () => {
    const address = VALID_MAINNET[0];
    const corrupted = address.slice(0, -1) + (address.endsWith("q") ? "p" : "q");
    expect(isWellFormedKaspaAddress(corrupted, "kaspa")).toBe(false);
  });

  it("rejects the wrong prefix for the data", () => {
    for (const address of VALID_TESTNET) {
      expect(isWellFormedKaspaAddress(address, "kaspa")).toBe(false);
    }
    for (const address of VALID_MAINNET) {
      expect(isWellFormedKaspaAddress(address, "kaspatest")).toBe(false);
    }
  });

  it("rejects characters outside the bech32 charset", () => {
    const address = VALID_MAINNET[0];
    const withBadChar = address.replace("kaspa:q", "kaspa:!");
    expect(isWellFormedKaspaAddress(withBadChar, "kaspa")).toBe(false);
  });

  it("rejects uppercase input", () => {
    expect(isWellFormedKaspaAddress(VALID_MAINNET[0].toUpperCase(), "kaspa")).toBe(
      false,
    );
  });

  it("rejects a missing or malformed separator", () => {
    expect(isWellFormedKaspaAddress("kaspaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx9awp4e", "kaspa")).toBe(false);
    expect(isWellFormedKaspaAddress("kaspa1:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx9awp4e", "kaspa")).toBe(false);
  });

  it("rejects too-short input", () => {
    expect(isWellFormedKaspaAddress("kaspa:q", "kaspa")).toBe(false);
    expect(isWellFormedKaspaAddress("", "kaspa")).toBe(false);
  });
});

describe("isValidMembershipCode", () => {
  it("validates against the testnet-10 address prefix", () => {
    expect(isValidMembershipCode(VALID_TESTNET[0])).toBe(true);
  });

  it("rejects a mainnet address on the testnet-10 config", () => {
    expect(isValidMembershipCode(VALID_MAINNET[0])).toBe(false);
  });

  it("rejects a well-shaped but bad-checksum code", () => {
    const address = VALID_TESTNET[0];
    const corrupted = address.slice(0, -1) + (address.endsWith("a") ? "p" : "a");
    expect(isValidMembershipCode(corrupted)).toBe(false);
  });
});
