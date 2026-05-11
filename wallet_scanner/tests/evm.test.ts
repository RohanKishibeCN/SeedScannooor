import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddressBalances, scanEvmAddresses } from "../src/evm.js";

describe("evm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getAddressBalances returns zero balances on non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 }))
    );

    const res = await getAddressBalances("key", "0x123", "ethereum");
    expect(res.address).toBe("0x123");
    expect(res.native_balance).toBe(0.0);
    expect(res.usdt).toBe(0.0);
    expect(res.usdc).toBe(0.0);
  });

  it("scanEvmAddresses returns entry even if request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 }))
    );

    const res = await scanEvmAddresses("key", ["0x123"], "ethereum", 1, 0);
    expect(res).toHaveLength(1);
    expect(res[0]?.address).toBe("0x123");
  });
});

