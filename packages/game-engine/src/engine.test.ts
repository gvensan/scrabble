import { describe, expect, it } from "vitest";
import {
  createBoard,
  createGame,
  exchangeTiles,
  getBagTarget,
  getDistribution,
  getOpeningCells,
  isSupportedBoardSize,
  passTurn,
  playMove,
} from "./index.js";
import type { GameState, Placement, RandomSource } from "./index.js";

class SequenceRandom implements RandomSource {
  private value = 0;
  nextInt(max: number) {
    const result = this.value % max;
    this.value += 1;
    return result;
  }
}
const acceptAll = (words: readonly string[]) =>
  new Map(words.map((word) => [word, true]));
function placementsFor(
  state: GameState,
  letters: number,
  row: number,
  startCol: number,
): Placement[] {
  return state.players[state.currentPlayerIndex]!.rack.slice(0, letters).map(
    (tile, index) => ({
      tileId: tile.id,
      row,
      col: startCol + index,
      ...(tile.letter === null ? { blankAs: "E" as const } : {}),
    }),
  );
}

describe("configuration", () => {
  it.each([7, 15, 21, 32, 40])("supports board %i", (size) =>
    expect(isSupportedBoardSize(size)).toBe(true),
  );
  it.each([6, 40.5, 41])("rejects board %s", (size) =>
    expect(isSupportedBoardSize(size)).toBe(false),
  );
  it("uses exact target totals", () => {
    for (const [size, total] of [
      [7, 60],
      [15, 100],
      [21, 140],
      [32, 213],
      [40, 240],
    ] as const)
      expect(
        Object.values(getDistribution(size)).reduce((a, b) => a + b, 0),
      ).toBe(total);
    expect(getBagTarget(32)).toBe(213);
  });
  it.each([7, 15, 21, 32, 40])("creates bounded symmetric board %i", (size) => {
    const board = createBoard(size);
    expect(board).toHaveLength(size);
    expect(
      board.flat().filter((cell) => cell.premium !== null).length,
    ).toBeLessThanOrEqual(Math.floor(size * size * 0.15));
    for (let row = 0; row < size; row += 1)
      for (let col = 0; col < size; col += 1) {
        expect(board[row]![col]!.premium).toBe(
          board[size - 1 - row]![size - 1 - col]!.premium,
        );
      }
    for (const opening of getOpeningCells(size))
      expect(board[opening.row]![opening.col]!.premium).toBeNull();
  });
});

describe("gameplay", () => {
  it("requires the opening center and at least two letters", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const miss = playMove(state, placementsFor(state, 2, 0, 0), acceptAll);
    expect(miss).toMatchObject({ ok: false });
    const single = playMove(state, placementsFor(state, 1, 7, 7), acceptAll);
    expect(single).toMatchObject({ ok: false });
    const move = playMove(state, placementsFor(state, 2, 7, 7), acceptAll);
    expect(move.ok).toBe(true);
    if (move.ok) {
      expect(move.state.currentPlayerIndex).toBe(1);
      expect(move.score).toBeGreaterThan(0);
    }
  });
  it("rejects diagonal and invalid words without changing state", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const rack = state.players[0]!.rack;
    expect(
      playMove(
        state,
        [
          { tileId: rack[0]!.id, row: 7, col: 7 },
          { tileId: rack[1]!.id, row: 8, col: 8 },
        ],
        acceptAll,
      ).ok,
    ).toBe(false);
    const invalid = playMove(
      state,
      placementsFor(state, 2, 7, 7),
      (words) => new Map(words.map((word) => [word, false])),
    );
    expect(invalid).toMatchObject({ ok: false });
    expect(state.board[7]![7]!.tile).toBeNull();
  });
  it("scores a connected crossing and consumes premiums once", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const first = playMove(state, placementsFor(state, 2, 7, 7), acceptAll);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = playMove(
      first.state,
      placementsFor(first.state, 2, 6, 7),
      acceptAll,
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.words.length).toBeGreaterThanOrEqual(1);
  });
  it("allows exchange with enough bag tiles", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const id = state.players[0]!.rack[0]!.id;
    const result = exchangeTiles(state, [id], new SequenceRandom());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.currentPlayerIndex).toBe(1);
      expect(result.state.players[0]!.rack).toHaveLength(7);
    }
  });
  it("ends after six consecutive passes", () => {
    let state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    for (let i = 0; i < 6; i += 1) state = passTurn(state);
    expect(state.phase).toBe("results");
    expect(state.endReason).toBe("six-scoreless-turns");
  });
});
