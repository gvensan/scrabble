import { LETTERS, LETTER_DISTRIBUTION, RACK_SIZE } from "./config.js";
import type { Letter, RandomSource, Tile } from "./types.js";

export function getBagTarget(size: number): number {
  return Math.min(240, Math.max(60, Math.floor((100 * size) / 15 + 0.5)));
}
export function getDistribution(
  size: number,
): Readonly<Record<Letter | "_", number>> {
  if (size === 15)
    return Object.fromEntries([
      ...LETTERS.map((letter) => [letter, LETTER_DISTRIBUTION[letter].count]),
      ["_", 2],
    ]) as Record<Letter | "_", number>;
  const target = getBagTarget(size);
  const blanks = Math.max(2, Math.floor((2 * target) / 100 + 0.5));
  const letterTarget = target - blanks;
  const quotas = LETTERS.map((letter) => {
    const numerator = LETTER_DISTRIBUTION[letter].count * letterTarget;
    return {
      letter,
      count: Math.floor(numerator / 98),
      remainder: numerator % 98,
    };
  });
  let remaining =
    letterTarget - quotas.reduce((sum, item) => sum + item.count, 0);
  for (const item of [...quotas].sort(
    (a, b) => b.remainder - a.remainder || a.letter.localeCompare(b.letter),
  )) {
    if (remaining === 0) break;
    item.count += 1;
    remaining -= 1;
  }
  return Object.fromEntries([
    ...quotas.map(({ letter, count }) => [letter, count]),
    ["_", blanks],
  ]) as Record<Letter | "_", number>;
}
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = random.nextInt(i + 1);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
/** Tiles in the bag for a board size, blanks included. */
export function bagSize(size: number): number {
  return Object.values(getDistribution(size)).reduce((a, b) => a + b, 0);
}
/** The most players any game may have. */
export const MAX_PLAYERS = 8;
/**
 * The most players a board can take: each needs a rack to start and as
 * much again left in the bag to draw from, so the game is still a game.
 * Every board takes four.
 */
export function maxPlayersFor(size: number): number {
  return Math.max(
    4,
    Math.min(MAX_PLAYERS, Math.floor(bagSize(size) / (RACK_SIZE * 2))),
  );
}
/** Seats a room really has: its setting, capped by what the board allows. */
export function seatsFor(capacity: number, boardSize: number): number {
  return Math.min(capacity, maxPlayersFor(boardSize));
}
export function createBag(size: number, random: RandomSource): readonly Tile[] {
  const distribution = getDistribution(size);
  let id = 0;
  const tiles: Tile[] = [];
  for (const letter of LETTERS)
    for (let n = 0; n < distribution[letter]; n += 1)
      tiles.push({
        id: `tile-${id++}`,
        letter,
        value: LETTER_DISTRIBUTION[letter].value,
      });
  for (let n = 0; n < distribution._; n += 1)
    tiles.push({ id: `tile-${id++}`, letter: null, value: 0 });
  return shuffle(tiles, random);
}
export function drawTiles(
  bag: readonly Tile[],
  count: number,
): { readonly drawn: readonly Tile[]; readonly bag: readonly Tile[] } {
  return {
    drawn: bag.slice(-count),
    bag: bag.slice(0, Math.max(0, bag.length - count)),
  };
}
