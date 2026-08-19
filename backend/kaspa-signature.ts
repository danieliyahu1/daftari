import { blake2b } from "@noble/hashes/blake2.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { decodeAddressPayload } from "./kaspa-address";
import { getNetworkConfig } from "../shared/network";

// Mirrors Kaspa's `PersonalMessageSigningHash`: BLAKE2b-256 keyed with the
// domain string `PersonalMessageSigningHash` over the exact message bytes.
// See kaspanet/rusty-kaspa `crypto/hashes/src/hashers.rs`.
const MESSAGE_SIGNING_KEY = new TextEncoder().encode("PersonalMessageSigningHash");

export function messageHash(message: string): Uint8Array {
  return blake2b(new TextEncoder().encode(message), { key: MESSAGE_SIGNING_KEY, dkLen: 32 });
}

// Verifies a Kaspa message signature. The claimed address must be a v0 P2PK
// address whose 32-byte payload is the x-only public key the signature must
// verify against. Matches `verify_message` in rusty-kaspa `wallet/core`.
export function verifySignature(input: {
  address: string;
  message: string;
  signature: string;
}): boolean {
  const prefix = getNetworkConfig().addressPrefix.replace(/:$/, "");
  const decoded = decodeAddressPayload(input.address, prefix);
  if (decoded === null || decoded.version !== 0 || decoded.payload.length !== 32) {
    return false;
  }
  if (!/^[0-9a-fA-F]{128}$/.test(input.signature)) {
    return false;
  }
  const sigBytes = hexToBytes(input.signature);
  const hash = messageHash(input.message);
  return schnorr.verify(sigBytes, hash, decoded.payload);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
