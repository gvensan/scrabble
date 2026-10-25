import { describe, expect, it, vi } from "vitest";
import {
  DictionaryUnavailableError,
  validateWithWordSoHard,
} from "./dictionary.js";

const body = {
  count: 2,
  allValid: false,
  results: [
    { word: "cat", valid: true, score: 5, length: 3, bingo: false },
    { word: "zzqzx", valid: false, score: 48, length: 5, bingo: false },
  ],
  attribution: "Word data by WordSoHard (https://wordsohard.com)",
  license: "Free to use with attribution to wordsohard.com",
};
describe("WordSoHard adapter", () => {
  it("uses explicit validity and preserves attribution", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const result = await validateWithWordSoHard(["CAT", "ZZQZX"], fetcher);
    expect(result.validity.get("CAT")).toBe(true);
    expect(result.validity.get("ZZQZX")).toBe(false);
    expect(result.attribution).toContain("WordSoHard");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("retries transient failures then fails closed", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("no", { status: 500 }));
    await expect(
      validateWithWordSoHard(["CAT"], fetcher),
    ).rejects.toBeInstanceOf(DictionaryUnavailableError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects provider-incompatible and malformed responses", async () => {
    await expect(validateWithWordSoHard(["A"], vi.fn())).rejects.toThrow(
      /2–30/,
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ found: true }), { status: 200 }),
      );
    await expect(validateWithWordSoHard(["CAT"], fetcher)).rejects.toThrow(
      /unavailable/i,
    );
  });
});
