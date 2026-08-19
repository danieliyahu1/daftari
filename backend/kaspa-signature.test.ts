import { describe, expect, it } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { isWellFormedKaspaAddress, pubkeyToP2PKAddress } from "./kaspa-address";
import { messageHash, verifySignature } from "./kaspa-signature";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function testPubkeyAddress(privkey: Uint8Array): string {
  const pubkey = schnorr.getPublicKey(privkey);
  const address = pubkeyToP2PKAddress(pubkey, "kaspatest");
  if (address === null) throw new Error("failed to build address");
  expect(isWellFormedKaspaAddress(address, "kaspatest")).toBe(true);
  return address;
}

describe("messageHash", () => {
  it("is deterministic and 32 bytes", () => {
    const a = messageHash("Hello Kaspa!");
    const b = messageHash("Hello Kaspa!");
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });
});

describe("verifySignature", () => {
  const PRIV = hexToBytes("0000000000000000000000000000000000000000000000000000000000000003");

  it("accepts a valid signature for a matching address", () => {
    const address = testPubkeyAddress(PRIV);
    const message = "Daftari wants you to sign in with your Kaspa account";
    const hash = messageHash(message);
    const signature = bytesToHex(schnorr.sign(hash, PRIV));

    expect(verifySignature({ address, message, signature })).toBe(true);
  });

  it("rejects a signature for a different message", () => {
    const address = testPubkeyAddress(PRIV);
    const hash = messageHash("sign me");
    const signature = bytesToHex(schnorr.sign(hash, PRIV));

    expect(verifySignature({ address, message: "sign something else", signature })).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = hexToBytes("0000000000000000000000000000000000000000000000000000000000000004");
    const address = testPubkeyAddress(other);
    const hash = messageHash("hello");
    const signature = bytesToHex(schnorr.sign(hash, PRIV));

    expect(verifySignature({ address, message: "hello", signature })).toBe(false);
  });

  it("rejects a malformed signature string", () => {
    const address = testPubkeyAddress(PRIV);
    expect(
      verifySignature({ address, message: "hello", signature: "not-a-signature" }),
    ).toBe(false);
  });

  it("rejects an empty signature", () => {
    const address = testPubkeyAddress(PRIV);
    expect(verifySignature({ address, message: "hello", signature: "" })).toBe(false);
  });
});
