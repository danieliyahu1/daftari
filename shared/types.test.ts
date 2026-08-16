import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveNetwork } from "./network";
import type { Book, BookRow, NetworkConfig } from "./types";

describe("shared type sanity", () => {
  it("resolved network config satisfies NetworkConfig", () => {
    const config = resolveNetwork("testnet-10");
    expectTypeOf(config).toMatchTypeOf<NetworkConfig>();
  });

  it("networkId is the literal testnet-10", () => {
    expectTypeOf(resolveNetwork("testnet-10").networkId).toEqualTypeOf<
      "testnet-10"
    >();
  });

  it("book row fields are the shared contract", () => {
    const row: BookRow = {
      direction: "in",
      amount_sompi: "0",
      other_address: "",
      date: 0,
      txid: "",
      proof_url: "",
      is_accepted: true,
    };
    expectTypeOf(row.direction).toEqualTypeOf<"in" | "out">();
    expectTypeOf(row.amount_sompi).toEqualTypeOf<string>();
    expectTypeOf(row.date).toEqualTypeOf<number>();
  });

  it("book carries balance plus rows", () => {
    const book: Book = { balance_sompi: "0", rows: [] };
    expectTypeOf(book.rows).toEqualTypeOf<BookRow[]>();
  });

  it("payment outcome is recorded | failed", () => {
    expectTypeOf<"recorded">().toMatchTypeOf<"recorded" | "failed">();
  });
});
