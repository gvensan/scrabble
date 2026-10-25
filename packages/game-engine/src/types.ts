export type Letter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";
export type Premium = "TW" | "DW" | "TL" | "DL" | null;
export interface Tile {
  readonly id: string;
  readonly letter: Letter | null;
  readonly value: number;
}
export interface PlacedTile extends Tile {
  readonly blankAs?: Letter;
}
export interface Cell {
  readonly premium: Premium;
  readonly tile: PlacedTile | null;
}
export type BoardTile = Pick<PlacedTile, "letter" | "value" | "blankAs">;
export interface BoardCell {
  readonly premium: Premium;
  readonly tile: BoardTile | null;
}
export interface Placement {
  readonly tileId: string;
  readonly row: number;
  readonly col: number;
  readonly blankAs?: Letter;
}
export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly rack: readonly Tile[];
}
export interface GameSettings {
  readonly boardSize: number;
  readonly timerSeconds: 0 | 120 | 300;
}
export interface GameState {
  readonly version: 1;
  readonly settings: GameSettings;
  readonly phase: "active" | "results";
  readonly board: readonly (readonly Cell[])[];
  readonly bag: readonly Tile[];
  readonly players: readonly PlayerState[];
  readonly currentPlayerIndex: number;
  readonly scorelessTurns: number;
  readonly turnNumber: number;
  readonly endReason: "rack-emptied" | "six-scoreless-turns" | null;
  readonly lastMove?: LastMove;
  /** Every finished turn in order; absent in games saved before it existed. */
  readonly history?: readonly LastMove[];
}
export interface LastMove {
  readonly playerIndex: number;
  readonly kind: "play" | "pass" | "exchange" | "auto-pass";
  readonly words: readonly WordScore[];
  readonly score: number;
  readonly tiles: number;
}
export interface WordScore {
  readonly word: string;
  readonly score: number;
}
export type PlayAnalysis =
  | {
      readonly ok: true;
      readonly words: readonly WordScore[];
      readonly score: number;
      readonly candidates: readonly string[];
    }
  | { readonly ok: false; readonly error: string };
export type MoveResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly words: readonly WordScore[];
      readonly score: number;
    }
  | { readonly ok: false; readonly error: string };
export type WordValidator = (
  words: readonly string[],
) => ReadonlyMap<string, boolean>;
export interface RandomSource {
  nextInt(maxExclusive: number): number;
}
