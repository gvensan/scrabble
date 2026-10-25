import { isSupportedBoardSize } from "./config.js";
import type { Cell, Premium } from "./types.js";

const ORIGINAL_15: Readonly<
  Record<Exclude<Premium, null>, readonly [number, number][]>
> = {
  TW: [
    [0, 0],
    [0, 7],
    [0, 14],
    [7, 0],
    [7, 14],
    [14, 0],
    [14, 7],
    [14, 14],
  ],
  DW: [
    [2, 2],
    [2, 12],
    [4, 4],
    [4, 10],
    [10, 4],
    [10, 10],
    [12, 2],
    [12, 12],
  ],
  TL: [
    [1, 5],
    [1, 9],
    [5, 1],
    [5, 13],
    [9, 1],
    [9, 13],
    [13, 5],
    [13, 9],
  ],
  DL: [
    [0, 3],
    [0, 11],
    [3, 0],
    [3, 14],
    [11, 0],
    [11, 14],
    [14, 3],
    [14, 11],
  ],
};
function startKeys(size: number): ReadonlySet<string> {
  const hi = Math.floor(size / 2);
  const lo = size % 2 === 0 ? hi - 1 : hi;
  return new Set([`${lo}:${lo}`, `${lo}:${hi}`, `${hi}:${lo}`, `${hi}:${hi}`]);
}
function scaledLayout(size: number): ReadonlyMap<string, Premium> {
  const result = new Map<string, Premium>();
  const starts = startKeys(size);
  const maximumPremiums = Math.floor(size * size * 0.15);
  for (const premium of ["DL", "TL", "DW", "TW"] as const)
    for (const [r, c] of ORIGINAL_15[premium]) {
      const row = Math.round((r / 14) * (size - 1));
      const col = Math.round((c / 14) * (size - 1));
      const orbit = [
        [row, col],
        [size - 1 - row, col],
        [row, size - 1 - col],
        [size - 1 - row, size - 1 - col],
      ] as const;
      const newKeys = new Set(
        orbit
          .map(([orbitRow, orbitCol]) => `${orbitRow}:${orbitCol}`)
          .filter((cell) => !starts.has(cell) && !result.has(cell)),
      );
      if (result.size + newKeys.size > maximumPremiums) continue;
      for (const [orbitRow, orbitCol] of orbit) {
        const cell = `${orbitRow}:${orbitCol}`;
        if (!starts.has(cell)) result.set(cell, premium);
      }
    }
  return result;
}
export function createBoard(size: number): readonly (readonly Cell[])[] {
  if (!isSupportedBoardSize(size))
    throw new RangeError("Board size must be an integer from 7 to 40.");
  const layout = scaledLayout(size);
  return Array.from({ length: size }, (_, row) =>
    Array.from(
      { length: size },
      (_, col): Cell => ({
        premium: layout.get(`${row}:${col}`) ?? null,
        tile: null,
      }),
    ),
  );
}
export function getOpeningCells(
  size: number,
): readonly { row: number; col: number }[] {
  const hi = Math.floor(size / 2);
  const lo = size % 2 === 0 ? hi - 1 : hi;
  return size % 2 === 0
    ? [
        { row: lo, col: lo },
        { row: lo, col: hi },
        { row: hi, col: lo },
        { row: hi, col: hi },
      ]
    : [{ row: hi, col: hi }];
}
