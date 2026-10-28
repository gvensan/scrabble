import { z } from "zod";

const responseSchema = z.object({
  count: z.number().int(),
  allValid: z.boolean(),
  results: z.array(
    z.object({
      word: z.string(),
      valid: z.boolean(),
      score: z.number().int().optional(),
      length: z.number().int().optional(),
      bingo: z.boolean().optional(),
      error: z.string().optional(),
    }),
  ),
  attribution: z.string(),
  license: z.string(),
});
export interface DictionaryResult {
  validity: ReadonlyMap<string, boolean>;
  attribution: string;
  license: string;
}
export class DictionaryUnavailableError extends Error {}

const CACHE_TTL_MS = 60 * 60_000;
const CACHE_LIMIT = 512;
const cache = new Map<string, { valid: boolean; expiresAt: number }>();
let budgetWindow = 0;
let budgetUsed = 0;

function consumeBudget(now: number) {
  if (now - budgetWindow >= 60_000) {
    budgetWindow = now;
    budgetUsed = 0;
  }
  // A conservative per-isolate guard in addition to room admission limits.
  if (budgetUsed >= 90)
    throw new DictionaryUnavailableError(
      "Dictionary is busy. Keep your tiles in place and retry shortly.",
    );
  budgetUsed += 1;
}

export async function validateWithWordSoHard(
  words: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<DictionaryResult> {
  const unique = [...new Set(words.map((word) => word.toUpperCase()))];
  if (
    unique.length < 1 ||
    unique.length > 20 ||
    unique.some((word) => !/^[A-Z]{2,30}$/.test(word))
  )
    throw new DictionaryUnavailableError(
      "The dictionary supports 2–30 letter words; this play cannot be verified.",
    );
  const useSharedGuards = fetcher === fetch;
  const now = Date.now();
  if (useSharedGuards) {
    const cached = unique.map((word) => cache.get(word));
    if (cached.every((item) => item !== undefined && item.expiresAt > now)) {
      const validity = new Map<string, boolean>();
      for (const [index, word] of unique.entries()) {
        const item = cached[index];
        if (item) validity.set(word, item.valid);
      }
      return {
        validity,
        attribution: "Word data by WordSoHard (https://wordsohard.com)",
        license: "Free to use with attribution to wordsohard.com",
      };
    }
    consumeBudget(now);
  }
  const path = unique
    .map((word) => encodeURIComponent(word.toLowerCase()))
    .join(",");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(
        `https://wordsohard.com/api/v1/check/${path}`,
        {
          headers: {
            accept: "application/json",
            "user-agent":
              "Scrabble/1.0 (word game; https://github.com/gvensan/scrabble)",
          },
          signal: AbortSignal.timeout(4500),
        },
      );
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500)
          throw new Error(`Provider returned ${response.status}.`);
        throw new DictionaryUnavailableError(
          `Dictionary rejected the request (${response.status}).`,
        );
      }
      const parsed = responseSchema.parse(await response.json());
      const returned = new Map(
        parsed.results.map((item) => [item.word.toUpperCase(), item.valid]),
      );
      if (unique.some((word) => !returned.has(word)))
        throw new Error("Dictionary response omitted a word.");
      if (useSharedGuards) {
        for (const [word, valid] of returned)
          cache.set(word, { valid, expiresAt: now + CACHE_TTL_MS });
        while (cache.size > CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      return {
        validity: returned,
        attribution: parsed.attribution,
        license: parsed.license,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof DictionaryUnavailableError) break;
    }
  }
  throw new DictionaryUnavailableError(
    lastError instanceof Error
      ? `Dictionary unavailable: ${lastError.message}`
      : "Dictionary unavailable.",
  );
}

const definitionSchema = z.object({
  found: z.boolean().optional(),
  definitions: z
    .array(
      z.object({
        partOfSpeech: z.string().nullable().optional(),
        definition: z.string(),
      }),
    )
    .optional(),
});
export interface StoredMeaning {
  partOfSpeech: string | null;
  definition: string;
}

/**
 * First meaning of each word, for a finished game's summary. Best effort:
 * a word the dictionary can't define, or any failure, gives null, and the
 * page looks it up again when shown. One request per word, in turn, keeps
 * well inside WordSoHard's rate limit.
 */
export async function defineWords(
  words: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, StoredMeaning | null>> {
  const meanings: Record<string, StoredMeaning | null> = {};
  for (const word of words) {
    meanings[word] = null;
    if (!/^[A-Za-z]{2,30}$/.test(word)) continue;
    try {
      const response = await fetcher(
        `https://wordsohard.com/api/v1/define/${encodeURIComponent(word.toLowerCase())}`,
        {
          headers: {
            accept: "application/json",
            "user-agent":
              "Scrabble/1.0 (word game; https://github.com/gvensan/scrabble)",
          },
          signal: AbortSignal.timeout(4500),
        },
      );
      if (!response.ok) continue;
      const parsed = definitionSchema.parse(await response.json()),
        first = parsed.found === false ? undefined : parsed.definitions?.[0];
      if (first)
        meanings[word] = {
          partOfSpeech: first.partOfSpeech ?? null,
          definition: first.definition.slice(0, 400),
        };
    } catch {
      // Left null; the summary page can look it up later.
    }
  }
  return meanings;
}
