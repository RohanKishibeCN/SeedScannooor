import { afterEach, describe, expect, it, vi } from "vitest";
import { getSolBalance } from "../src/solana.js";

describe("solana", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getSolBalance returns 0 on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 }))
    );

    const res = await getSolBalance("http://invalid-rpc.example.com", "Sol1234567890");
    expect(res).toBe(0.0);
  });
});

