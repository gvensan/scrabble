import type { Letter } from "./types.js";

export const BOARD_SIZE = { min: 7, max: 40, default: 15 } as const;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const LETTER_DISTRIBUTION: Readonly<
  Record<Letter, { readonly count: number; readonly value: number }>
> = {
  A: { count: 9, value: 1 },
  B: { count: 2, value: 3 },
  C: { count: 2, value: 3 },
  D: { count: 4, value: 2 },
  E: { count: 12, value: 1 },
  F: { count: 2, value: 4 },
  G: { count: 3, value: 2 },
  H: { count: 2, value: 4 },
  I: { count: 9, value: 1 },
  J: { count: 1, value: 8 },
  K: { count: 1, value: 5 },
  L: { count: 4, value: 1 },
  M: { count: 2, value: 3 },
  N: { count: 6, value: 1 },
  O: { count: 8, value: 1 },
  P: { count: 2, value: 3 },
  Q: { count: 1, value: 10 },
  R: { count: 6, value: 1 },
  S: { count: 4, value: 1 },
  T: { count: 6, value: 1 },
  U: { count: 4, value: 1 },
  V: { count: 2, value: 4 },
  W: { count: 2, value: 4 },
  X: { count: 1, value: 8 },
  Y: { count: 2, value: 4 },
  Z: { count: 1, value: 10 },
};
export const LETTERS = Object.keys(LETTER_DISTRIBUTION) as Letter[];
export function isSupportedBoardSize(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= BOARD_SIZE.min &&
    value <= BOARD_SIZE.max
  );
}
export function isLetter(value: string): value is Letter {
  return /^[A-Z]$/.test(value);
}
