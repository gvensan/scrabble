import { describe, expect, it } from "vitest";
import { checkWords, defineWord, DictionaryError } from "./dictionary.js";

const reply = (body: unknown, status = 200) =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status }),
    )) as unknown as typeof fetch;

describe("browser dictionary", () => {
  it("accepts only explicit valid results for every word", async () => {
    const result = await checkWords(
      ["qi", "ZZQZX"],
      reply({
        results: [
          { word: "qi", valid: true },
          { word: "zzqzx", valid: false },
        ],
      }),
    );
    expect(result.get("QI")).toBe(true);
    expect(result.get("ZZQZX")).toBe(false);
  });
  it("fails closed on missing words, malformed bodies and outages", async () => {
    await expect(
      checkWords(
        ["CAT", "DOG"],
        reply({ results: [{ word: "cat", valid: true }] }),
      ),
    ).rejects.toBeInstanceOf(DictionaryError);
    await expect(
      checkWords(["CAT"], reply({ results: [{ word: "cat", valid: "yes" }] })),
    ).rejects.toBeInstanceOf(DictionaryError);
    await expect(checkWords(["CAT"], reply({}, 503))).rejects.toThrow(
      /unavailable/i,
    );
    await expect(checkWords(["A"], reply({ results: [] }))).rejects.toThrow(
      /2 to 30/,
    );
  });
  it("reads definitions without letting them decide legality", async () => {
    const found = await defineWord(
      "quiz",
      reply({
        found: true,
        phonetic: "/kwɪz/",
        definitions: [{ partOfSpeech: "noun", definition: "A brief test." }],
        attribution: "Definitions by WordSoHard",
      }),
    );
    expect(found).toMatchObject({
      word: "QUIZ",
      found: true,
      senses: [{ partOfSpeech: "noun", definition: "A brief test." }],
    });
    const missing = await defineWord(
      "zzqzx",
      reply({ found: false, definitions: [] }),
    );
    expect(missing.found).toBe(false);
  });
});
