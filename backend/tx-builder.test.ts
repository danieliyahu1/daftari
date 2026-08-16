import { describe, expect, it } from "vitest";
import {
  buildTransfer,
  estimateFee,
  estimateMass,
  kaspaToSompi,
  sompiToKaspa,
  SOMIPI_PER_KASPA,
  TxBuilderError,
} from "./tx-builder";
import type { BuiltTransfer } from "./tx-builder";
import { scriptPublicKeyForAddress } from "./kaspa-address";
import type { UtxoResponse } from "./kaspa-api-types";

const USER = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const GROUP = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";

const USER_SCRIPT =
  "20c526ba87b87d4db186d74143da44444d2b782b7d8eb307ff2c0cde8c85986676ac";
const GROUP_SCRIPT =
  "2098128e28322ae663f5aff740dfac52054124ca6e7c0001cd8de5f1d2235c27a7ac";

const P2PK_SCRIPT_LEN = USER_SCRIPT.length / 2; // 34

function utxo(
  transactionId: string,
  index: number,
  amount: string,
  scriptPublicKey = USER_SCRIPT,
): UtxoResponse {
  return {
    outpoint: { transactionId, index },
    utxoEntry: {
      amount,
      scriptPublicKey: { scriptPublicKey },
      blockDaaScore: "1",
      isCoinbase: false,
    },
  };
}

describe("sompi conversion", () => {
  it("converts KAS to sompi (1 KAS = 10^8 sompi)", () => {
    expect(SOMIPI_PER_KASPA).toBe(100_000_000n);
    expect(kaspaToSompi("1")).toBe(100_000_000n);
    expect(kaspaToSompi("0.5")).toBe(50_000_000n);
    expect(kaspaToSompi("1.5")).toBe(150_000_000n);
    expect(kaspaToSompi("0.00000001")).toBe(1n);
    expect(kaspaToSompi("2")).toBe(200_000_000n);
  });

  it("rejects negative, empty, and over-8-decimal amounts", () => {
    expect(() => kaspaToSompi("-1")).toThrow(TxBuilderError);
    expect(() => kaspaToSompi("")).toThrow(TxBuilderError);
    expect(() => kaspaToSompi("1.000000001")).toThrow(TxBuilderError);
    expect(() => kaspaToSompi("abc")).toThrow(TxBuilderError);
  });

  it("formats sompi back to KAS", () => {
    expect(sompiToKaspa(100_000_000n)).toBe("1");
    expect(sompiToKaspa(150_000_000n)).toBe("1.5");
    expect(sompiToKaspa(123_456_789n)).toBe("1.23456789");
    expect(sompiToKaspa(1n)).toBe("0.00000001");
    expect(sompiToKaspa(0n)).toBe("0");
  });
});

describe("mass and fee model (kaspad verified)", () => {
  it("computes mass 2036 for a 1-in/2-out P2PK v0 tx", () => {
    expect(estimateMass(1, [P2PK_SCRIPT_LEN, P2PK_SCRIPT_LEN])).toBe(2036);
  });

  it("applies fee = mass × feerate", () => {
    expect(estimateFee(1, [P2PK_SCRIPT_LEN, P2PK_SCRIPT_LEN], 100)).toBe(
      203_600n,
    );
  });

  it("increases mass with each extra input", () => {
    const two = estimateMass(2, [P2PK_SCRIPT_LEN, P2PK_SCRIPT_LEN]);
    const one = estimateMass(1, [P2PK_SCRIPT_LEN, P2PK_SCRIPT_LEN]);
    expect(two).toBeGreaterThan(one);
  });
});

describe("address to script", () => {
  it("derives the P2PK script for the user and group addresses", () => {
    expect(scriptPublicKeyForAddress(USER, "kaspatest")).toBe(USER_SCRIPT);
    expect(scriptPublicKeyForAddress(GROUP, "kaspatest")).toBe(GROUP_SCRIPT);
  });

  it("returns null for an undecodable address", () => {
    expect(scriptPublicKeyForAddress("kaspa:qqqq", "kaspatest")).toBeNull();
  });
});

describe("buildTransfer output construction", () => {
  function build(
    amountSompi: string,
    utxos: UtxoResponse[],
    feerate = 100,
  ): BuiltTransfer {
    return buildTransfer({ utxos, userAddress: USER, groupAddress: GROUP, amountSompi, feerate });
  }

  it("builds payment + change outputs and the full safe-JSON template", () => {
    const result = build("500000000", [utxo("a", 0, "1000000000")]);

    expect(result.signing_template.version).toBe(0);
    expect(result.signing_template.id).toHaveLength(64);
    expect(result.signing_template.subnetworkId).toHaveLength(40);
    expect(result.signing_template.lockTime).toBe("0");
    expect(result.signing_template.gas).toBe("0");
    expect(result.signing_template.storageMass).toBe("20000");
    expect(result.signing_template.payload).toBe("");

    expect(result.signing_template.outputs).toEqual([
      { value: "500000000", scriptPublicKey: `0000${GROUP_SCRIPT}`, covenant: null },
      { value: "499796400", scriptPublicKey: `0000${USER_SCRIPT}`, covenant: null },
    ]);

    expect(result.signing_template.inputs).toHaveLength(1);
    const input = result.signing_template.inputs[0];
    expect(input).toMatchObject({
      transactionId: "a",
      index: 0,
      sequence: "0",
      sigOpCount: 1,
      computeBudget: 0,
      signatureScript: "",
      utxo: {
        amount: "1000000000",
        scriptPublicKey: `0000${USER_SCRIPT}`,
        blockDaaScore: "1",
        isCoinbase: false,
      },
    });

    expect(result.sign_inputs).toEqual([{ transactionId: "a", index: 0 }]);
    expect(result.fee_sompi).toBe("203600");
    expect(result.change_sompi).toBe("499796400");
  });

  it("omits the change output when change is zero", () => {
    const result = build("999796400", [utxo("a", 0, "1000000000")]);

    expect(result.signing_template.outputs).toEqual([
      { value: "999796400", scriptPublicKey: `0000${GROUP_SCRIPT}`, covenant: null },
    ]);
    expect(result.change_sompi).toBe("0");
    expect(result.fee_sompi).toBe("203600");
  });

  it("selects additional UTXOs when one does not cover amount + fee", () => {
    const result = build("300000000", [
      utxo("small", 0, "100000000"),
      utxo("big", 1, "250000000"),
    ]);

    expect(result.sign_inputs).toEqual([
      { transactionId: "big", index: 1 },
      { transactionId: "small", index: 0 },
    ]);
    const total = 100_000_000 + 250_000_000;
    const fee = estimateFee(2, [P2PK_SCRIPT_LEN, P2PK_SCRIPT_LEN], 100);
    expect(result.fee_sompi).toBe(fee.toString());
    expect(result.change_sompi).toBe((BigInt(total) - 300_000_000n - fee).toString());
  });
});

describe("buildTransfer deterministic UTXO selection", () => {
  it("returns identical sign_inputs regardless of input order", () => {
    const set = [
      utxo("c", 0, "100000000"),
      utxo("b", 0, "500000000"),
      utxo("a", 0, "300000000"),
    ];
    const forwards = buildTransfer({
      utxos: set,
      userAddress: USER,
      groupAddress: GROUP,
      amountSompi: "600000000",
      feerate: 100,
    });
    const backwards = buildTransfer({
      utxos: [...set].reverse(),
      userAddress: USER,
      groupAddress: GROUP,
      amountSompi: "600000000",
      feerate: 100,
    });

    expect(forwards.sign_inputs).toEqual(backwards.sign_inputs);
    expect(forwards.signing_template).toEqual(backwards.signing_template);
  });
});

describe("buildTransfer failures", () => {
  it("rejects insufficient funds with a policy failure", () => {
    expect(() =>
      buildTransfer({
        utxos: [utxo("a", 0, "1000")],
        userAddress: USER,
        groupAddress: GROUP,
        amountSompi: "500000000",
        feerate: 100,
      }),
    ).toThrowError(expect.objectContaining({ kind: "insufficient-funds" }));
  });

  it("rejects zero amount", () => {
    expect(() =>
      buildTransfer({
        utxos: [utxo("a", 0, "1000000000")],
        userAddress: USER,
        groupAddress: GROUP,
        amountSompi: "0",
        feerate: 100,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-amount" }));
  });

  it("rejects a negative amount", () => {
    expect(() =>
      buildTransfer({
        utxos: [utxo("a", 0, "1000000000")],
        userAddress: USER,
        groupAddress: GROUP,
        amountSompi: "-5",
        feerate: 100,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-amount" }));
  });

  it("rejects an invalid group address", () => {
    expect(() =>
      buildTransfer({
        utxos: [utxo("a", 0, "1000000000")],
        userAddress: USER,
        groupAddress: "kaspatest:not-an-address",
        amountSompi: "1000000",
        feerate: 100,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-address" }));
  });
});
