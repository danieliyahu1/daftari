import { describe, expect, it } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { FakeAuthStore } from "./test-stores";
import {
  buildSignInMessage,
  handleCreateChallenge,
  handleCreateSession,
  parseSignInMessage,
} from "./auth";
import { messageHash } from "./kaspa-signature";
import { pubkeyToP2PKAddress } from "./kaspa-address";

const ORIGIN = "http://localhost:5173";
const SECRET = new TextEncoder().encode("test-secret-that-is-long-enough-for-hs256");
const PRIV = Uint8Array.from([...Array(31).fill(0), 3]);

function addressFor(priv: Uint8Array): string {
  const address = pubkeyToP2PKAddress(schnorr.getPublicKey(priv), "kaspatest");
  if (address === null) throw new Error("no address");
  return address;
}

function signMessage(message: string, priv: Uint8Array): string {
  const hash = messageHash(message);
  return [...schnorr.sign(hash, priv)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionBody() {
  const store = new FakeAuthStore();
  const address = addressFor(PRIV);
  const challenge = await handleCreateChallenge(store, { address }, { origin: ORIGIN, secret: SECRET });
  const { message } = challenge.body as { message: string; nonce: string };
  const signature = signMessage(message, PRIV);
  return { store, address, message, signature };
}

describe("buildSignInMessage / parseSignInMessage", () => {
  it("round-trips through the parser", () => {
    const address = addressFor(PRIV);
    const message = buildSignInMessage({
      address,
      origin: ORIGIN,
      nonce: "a".repeat(32),
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    const parsed = parseSignInMessage(message);
    expect(parsed).toEqual({ address, origin: ORIGIN, nonce: "a".repeat(32) });
  });

  it("rejects a message with a tampered nonce", () => {
    const address = addressFor(PRIV);
    const message = buildSignInMessage({
      address,
      origin: ORIGIN,
      nonce: "a".repeat(32),
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    const tampered = message.replace("a".repeat(32), "b".repeat(32));
    expect(parseSignInMessage(tampered)).not.toEqual({
      address,
      origin: ORIGIN,
      nonce: "a".repeat(32),
    });
  });
});

describe("handleCreateSession", () => {
  it("issues a token for a valid signature", async () => {
    const { store, address, message, signature } = await sessionBody();
    const result = await handleCreateSession(
      store,
      { message, signature },
      { origin: ORIGIN, secret: SECRET },
    );
    expect(result.status).toBe(200);
    const body = result.body as { token: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".").length).toBe(3);
    store.close();
  });

  it("rejects a replay of the same message", async () => {
    const { store, message, signature } = await sessionBody();
    await handleCreateSession(store, { message, signature }, { origin: ORIGIN, secret: SECRET });
    const second = await handleCreateSession(
      store,
      { message, signature },
      { origin: ORIGIN, secret: SECRET },
    );
    expect(second.status).toBe(401);
    store.close();
  });

  it("rejects a signature for the wrong message", async () => {
    const { store, address, message } = await sessionBody();
    const other = buildSignInMessage({
      address,
      origin: ORIGIN,
      nonce: "f".repeat(32),
      issuedAt: "2026-01-01T00:00:00.000Z",
    });
    const signature = signMessage(other, PRIV);
    const result = await handleCreateSession(
      store,
      { message, signature },
      { origin: ORIGIN, secret: SECRET },
    );
    expect(result.status).toBe(401);
    store.close();
  });

  it("rejects a message from a different origin", async () => {
    const { store, address, message, signature } = await sessionBody();
    const result = await handleCreateSession(
      store,
      { message, signature },
      { origin: "http://evil.example", secret: SECRET },
    );
    expect(result.status).toBe(401);
    store.close();
  });
});

