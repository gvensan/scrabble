const API = "https://wordsohard.com/api/v1";
export const DICTIONARY_CREDIT = "Word data by WordSoHard (wordsohard.com)";
export class DictionaryError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

async function request(path: string, fetcher: typeof fetch) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(`${API}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4500),
      });
      if (response.ok) return (await response.json()) as unknown;
      if (response.status !== 429 && response.status < 500)
        throw new DictionaryError(
          `Dictionary rejected the request (${response.status}).`,
        );
      lastError = new Error(`Provider returned ${response.status}.`);
    } catch (error) {
      if (error instanceof DictionaryError) throw error;
      lastError = error;
    }
  }
  throw new DictionaryError(
    lastError instanceof Error
      ? `Dictionary unavailable: ${lastError.message}`
      : "Dictionary unavailable.",
  );
}

/**
 * Browser-side check for local games. Like the Worker adapter it accepts a
 * word only on an explicit `valid: true` and fails closed otherwise.
 */
export async function checkWords(
  words: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<ReadonlyMap<string, boolean>> {
  const unique = [...new Set(words.map((word) => word.toUpperCase()))];
  if (
    unique.length < 1 ||
    unique.length > 20 ||
    unique.some((word) => !/^[A-Z]{2,30}$/.test(word))
  )
    throw new DictionaryError(
      "The dictionary supports 2 to 30 letter words; this play cannot be verified.",
    );
  const body = await request(
    `/check/${unique.map((word) => encodeURIComponent(word.toLowerCase())).join(",")}`,
    fetcher,
  );
  if (!isRecord(body) || !Array.isArray(body.results))
    throw new DictionaryError("Dictionary unavailable: malformed response.");
  const returned = new Map<string, boolean>();
  for (const item of body.results) {
    if (
      !isRecord(item) ||
      typeof item.word !== "string" ||
      typeof item.valid !== "boolean"
    )
      throw new DictionaryError("Dictionary unavailable: malformed response.");
    returned.set(item.word.toUpperCase(), item.valid);
  }
  if (unique.some((word) => !returned.has(word)))
    throw new DictionaryError("Dictionary unavailable: a word was missing.");
  return returned;
}

export interface Definition {
  word: string;
  found: boolean;
  phonetic: string | null;
  senses: { partOfSpeech: string | null; definition: string }[];
  attribution: string;
}
const definitions = new Map<string, Promise<Definition>>();

/** Definitions are presentation only; they never decide whether a word is legal. */
export function defineWord(
  word: string,
  fetcher: typeof fetch = fetch,
): Promise<Definition> {
  const key = word.toLowerCase();
  const cached = definitions.get(key);
  if (cached) return cached;
  const pending = request(`/define/${encodeURIComponent(key)}`, fetcher).then(
    (body): Definition => {
      if (!isRecord(body)) throw new DictionaryError("Definition unavailable.");
      const senses = Array.isArray(body.definitions)
        ? body.definitions.flatMap((item) =>
            isRecord(item) && typeof item.definition === "string"
              ? [
                  {
                    partOfSpeech:
                      typeof item.partOfSpeech === "string"
                        ? item.partOfSpeech
                        : null,
                    definition: item.definition,
                  },
                ]
              : [],
          )
        : [];
      return {
        word: word.toUpperCase(),
        found: body.found === true && senses.length > 0,
        phonetic: typeof body.phonetic === "string" ? body.phonetic : null,
        senses: senses.slice(0, 3),
        attribution:
          typeof body.attribution === "string"
            ? body.attribution
            : DICTIONARY_CREDIT,
      };
    },
  );
  definitions.set(key, pending);
  pending.catch(() => definitions.delete(key));
  return pending;
}
