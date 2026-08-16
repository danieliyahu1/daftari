import { describe, expect, it } from "vitest";
import { NetworkError, TimeoutError, UpstreamError } from "./kaspa-client";
import { TxBuilderError } from "./tx-builder";
import {
  AppError,
  requiredStr,
  toRouteResult,
  validAddress,
  validHex64,
  validInt,
  validStr,
  validUint,
} from "./errors";

const VALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpks";
const INVALID_CODE =
  "kaspatest:qxaqrlzlf6wes72en3568khahq66wf27tuhfxn5nytkd8tcep2c0vrse6gdmpk0";
const MAINNET_CODE =
  "kaspa:qp0l70zd5x85ttwd6jv7g3s3a8llzj96d8dncn4zmhv4tlzx5k2jyqh70xmfj";

function errorBody(result: { status: number; body: unknown }): Record<string, unknown> {
  return (result.body as { error: Record<string, unknown> }).error;
}

describe("AppError and the taxonomy", () => {
  it("assigns a default status to every taxonomy kind", () => {
    expect(new AppError("invalid", "nope").status).toBe(422);
    expect(new AppError("conflict", "nope").status).toBe(409);
    expect(new AppError("policy", "nope").status).toBe(422);
    expect(new AppError("network", "nope").status).toBe(503);
    expect(new AppError("upstream", "nope").status).toBe(502);
  });

  it("honours an explicit status override", () => {
    const err = new AppError("invalid", "nope", 400);
    expect(err.status).toBe(400);
  });

  it("carries the upstream source when provided", () => {
    const err = new AppError("upstream", "nope", 502, "unavailable");
    expect(err.source).toBe("unavailable");
  });
});

describe("requiredStr", () => {
  it("returns a trimmed string", () => {
    expect(requiredStr("  hello  ", "name")).toBe("hello");
  });

  it("rejects a missing, blank, or non-string value as a 400 invalid error", () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      let thrown: unknown;
      try {
        requiredStr(value, "user");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        kind: "invalid",
        status: 400,
        message: expect.stringContaining("user") as unknown,
      });
    }
  });
});

describe("validStr", () => {
  it("returns a trimmed string", () => {
    expect(validStr("  x  ", "name")).toBe("x");
  });

  it("rejects missing, blank, and non-string values as 422 invalid errors", () => {
    for (const value of [undefined, "", "   ", 7, []]) {
      expect(() => validStr(value, "name")).toThrow(
        expect.objectContaining({ kind: "invalid", status: 422 }),
      );
    }
  });
});

describe("validInt", () => {
  it("accepts integer numbers and integer strings", () => {
    expect(validInt(5, "n")).toBe(5);
    expect(validInt("-3", "n")).toBe(-3);
    expect(validInt("0", "n")).toBe(0);
  });

  it("rejects floats, non-numeric strings, and non-numbers", () => {
    for (const value of [1.5, "1.5", "abc", null, {}, true]) {
      expect(() => validInt(value, "n")).toThrow(
        expect.objectContaining({ kind: "invalid", status: 422 }),
      );
    }
  });
});

describe("validUint", () => {
  it("accepts non-negative integers", () => {
    expect(validUint(0, "n")).toBe(0);
    expect(validUint("12", "n")).toBe(12);
  });

  it("rejects negative integers", () => {
    expect(() => validUint(-1, "n")).toThrow(
      expect.objectContaining({ kind: "invalid", status: 422 }),
    );
    expect(() => validUint("-1", "n")).toThrow(
      expect.objectContaining({ kind: "invalid", status: 422 }),
    );
  });
});

describe("validHex64", () => {
  it("accepts a 64-character hex string and lowercases it", () => {
    expect(validHex64("A".repeat(64), "id")).toBe("a".repeat(64));
    expect(validHex64("a".repeat(64), "id")).toBe("a".repeat(64));
  });

  it("rejects wrong lengths, non-hex, and non-strings", () => {
    for (const value of ["a".repeat(63), "a".repeat(65), "z".repeat(64), 42, ""]) {
      expect(() => validHex64(value, "id")).toThrow(
        expect.objectContaining({ kind: "invalid", status: 422 }),
      );
    }
  });
});

describe("validAddress", () => {
  it("accepts a well-formed address on this network", () => {
    expect(validAddress(VALID_CODE, "code")).toBe(VALID_CODE);
  });

  it("rejects a bad checksum", () => {
    expect(() => validAddress(INVALID_CODE, "code")).toThrow(
      expect.objectContaining({ kind: "invalid", status: 422 }),
    );
  });

  it("rejects a well-formed address on another network", () => {
    expect(() => validAddress(MAINNET_CODE, "code")).toThrow(
      expect.objectContaining({ kind: "invalid", status: 422 }),
    );
  });

  it("rejects junk", () => {
    expect(() => validAddress("not-an-address", "code")).toThrow(
      expect.objectContaining({ kind: "invalid", status: 422 }),
    );
  });
});

describe("toRouteResult", () => {
  it("maps AppError kinds to their status and a structured body", () => {
    const cases: Array<[AppError, number, string]> = [
      [new AppError("invalid", "bad input"), 422, "invalid"],
      [new AppError("conflict", "already there"), 409, "conflict"],
      [new AppError("policy", "not allowed"), 422, "policy"],
      [new AppError("network", "can't reach the chain"), 503, "network"],
      [new AppError("upstream", "upstream blew up"), 502, "upstream"],
    ];
    for (const [err, status, kind] of cases) {
      const result = toRouteResult(err);
      expect(result.status).toBe(status);
      expect(errorBody(result)).toMatchObject({ kind, message: err.message });
    }
  });

  it("includes the upstream source on upstream AppErrors", () => {
    const result = toRouteResult(new AppError("upstream", "busy", 503, "unavailable"));
    expect(errorBody(result)).toEqual({
      kind: "upstream",
      source: "unavailable",
      message: "busy",
    });
  });

  it("maps UpstreamError sub-kinds to HTTP statuses with source", () => {
    const cases: Array<[number, string, number]> = [
      [400, "bad_request", 400],
      [422, "validation", 422],
      [409, "conflict", 409],
      [429, "rate_limited", 429],
      [503, "unavailable", 503],
      [404, "not_found", 404],
      [500, "server", 502],
      [502, "unknown", 502],
    ];
    for (const [upstreamStatus, kind, status] of cases) {
      const err = new UpstreamError("upstream", upstreamStatus, kind as never, {
        error: "what the upstream said",
      });
      const result = toRouteResult(err);
      expect(result.status).toBe(status);
      expect(errorBody(result)).toEqual({
        kind: "upstream",
        source: kind,
        message: "what the upstream said",
      });
    }
  });

  it("prefers the upstream body message over the generic one", () => {
    const err = new UpstreamError("generic", 503, "unavailable", { error: "busy" });
    expect(errorBody(toRouteResult(err)).message).toBe("busy");
  });

  it("maps chain network and timeout errors to 503 network", () => {
    const network = toRouteResult(new NetworkError("connection refused"));
    expect(network.status).toBe(503);
    expect(errorBody(network)).toMatchObject({ kind: "network" });

    const timeout = toRouteResult(new TimeoutError("timed out"));
    expect(timeout.status).toBe(503);
    expect(errorBody(timeout)).toMatchObject({ kind: "network" });
  });

  it("maps tx-builder errors by their kind", () => {
    const funds = toRouteResult(new TxBuilderError("insufficient-funds", "no funds"));
    expect(funds.status).toBe(422);
    expect(errorBody(funds)).toMatchObject({ kind: "policy", message: "no funds" });

    const amount = toRouteResult(new TxBuilderError("invalid-amount", "bad amount"));
    expect(errorBody(amount)).toMatchObject({ kind: "invalid" });

    const address = toRouteResult(new TxBuilderError("invalid-address", "bad address"));
    expect(errorBody(address)).toMatchObject({ kind: "invalid" });
  });

  it("never leaks stack traces for unexpected errors", () => {
    const result = toRouteResult(new Error("internal: db exploded at /tmp/x"));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("db exploded");
    expect(JSON.stringify(result.body)).not.toContain("/tmp/x");
    expect(errorBody(result)).toMatchObject({ kind: "policy" });
  });

  it("handles non-Error throws as a generic 500", () => {
    const result = toRouteResult("boom");
    expect(result.status).toBe(500);
    expect(errorBody(result)).toMatchObject({ kind: "policy" });
  });
});
