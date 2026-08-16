import { getNetworkConfig } from "../shared/network";
import type { NetworkConfig } from "../shared/types";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

const GENERATORS = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
] as const;

const CHECKSUM_WORDS = 8;

function polymod(values: readonly number[]): bigint {
  let checksum = 1n;
  for (const value of values) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < GENERATORS.length; i++) {
      if ((top & (1n << BigInt(i))) !== 0n) {
        checksum ^= GENERATORS[i];
      }
    }
  }
  return checksum ^ 1n;
}

function convert5to8(values: readonly number[]): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const value of values) {
    buffer = (buffer << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

export function isWellFormedKaspaAddress(raw: string, prefix: string): boolean {
  const separator = raw.lastIndexOf(":");
  if (separator !== prefix.length || raw.slice(0, separator) !== prefix) {
    return false;
  }
  const dataPart = raw.slice(separator + 1);
  if (dataPart.length < CHECKSUM_WORDS) {
    return false;
  }

  const values: number[] = [];
  for (const char of dataPart) {
    const value = CHARSET.indexOf(char);
    if (value < 0) {
      return false;
    }
    values.push(value);
  }

  const payload = values.slice(0, values.length - CHECKSUM_WORDS);
  const checksumWords = values.slice(values.length - CHECKSUM_WORDS);
  if (payload.length < 1) {
    return false;
  }

  const prefixValues: number[] = [];
  for (const char of prefix) {
    prefixValues.push(char.charCodeAt(0) & 0x1f);
  }

  const expected = polymod([
    ...prefixValues,
    0,
    ...payload,
    ...new Array<number>(CHECKSUM_WORDS).fill(0),
  ]);
  const actual = convert5to8(checksumWords).reduce(
    (acc, byte) => (acc << 8n) | BigInt(byte),
    0n,
  );
  return expected === actual;
}

export interface DecodedAddress {
  version: number;
  payload: Uint8Array;
}

export function decodeAddressPayload(
  address: string,
  prefix: string,
): DecodedAddress | null {
  if (!isWellFormedKaspaAddress(address, prefix)) {
    return null;
  }
  const separator = address.lastIndexOf(":");
  const dataPart = address.slice(separator + 1);
  const values: number[] = [];
  for (const char of dataPart) {
    values.push(CHARSET.indexOf(char));
  }
  const payloadValues = values.slice(0, values.length - CHECKSUM_WORDS);
  const bytes = convert5to8(payloadValues);
  if (bytes.length < 1) {
    return null;
  }
  return { version: bytes[0], payload: Uint8Array.from(bytes.slice(1)) };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// Script public key hex (without the 2-byte version prefix) for a standard
// v0 address, per the txscript templates: PubKey = <pubkey> OP_CHECKSIG,
// PubKeyECDSA = <pubkey> OP_CHECKSIGECDSA, ScriptHash = OP_BLAKE2B <hash>
// OP_EQUAL. The script public key version is 0 for all three address types.
export function scriptPublicKeyForAddress(
  address: string,
  prefix: string,
): string | null {
  const decoded = decodeAddressPayload(address, prefix);
  if (decoded === null) {
    return null;
  }
  switch (decoded.version) {
    case 0:
      if (decoded.payload.length !== 32) return null;
      return `20${bytesToHex(decoded.payload)}ac`;
    case 1:
      if (decoded.payload.length !== 33) return null;
      return `21${bytesToHex(decoded.payload)}ab`;
    case 8:
      if (decoded.payload.length !== 32) return null;
      return `aa20${bytesToHex(decoded.payload)}87`;
    default:
      return null;
  }
}

export function isValidMembershipCode(
  code: string,
  config: NetworkConfig = getNetworkConfig(),
): boolean {
  return isWellFormedKaspaAddress(code, config.addressPrefix.replace(/:$/, ""));
}
