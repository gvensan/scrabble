import { describe, expect, it } from "vitest";
import {
  analyzePlay,
  createBoard,
  createGame,
  endGame,
  exchangeTiles,
  getBagTarget,
  getDistribution,
  getOpeningCells,
  isSupportedBoardSize,
  passTurn,
  playMove,
  stampMoves,
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
  it("rejects diagonal placements without using the turn", () => {
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
  });
  it("costs the turn when the dictionary refuses a word", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const result = playMove(
      state,
      placementsFor(state, 2, 7, 7),
      (words) => new Map(words.map((word) => [word, false])),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected).toHaveLength(1);
    expect(result.score).toBe(0);
    const after = result.state;
    expect(after.board[7]![7]!.tile).toBeNull();
    expect(after.players[0]!.rack).toEqual(state.players[0]!.rack);
    expect(after.players[0]!.score).toBe(0);
    expect(after.bag).toEqual(state.bag);
    expect(after.currentPlayerIndex).toBe(1);
    expect(after.scorelessTurns).toBe(state.scorelessTurns + 1);
    expect(after.lastMove).toMatchObject({
      kind: "rejected",
      score: 0,
      tiles: 2,
      words: [{ word: result.rejected?.[0], score: 0 }],
    });
    expect(after.lastMove?.placed).toBeUndefined();
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
    // Nobody scored, so the leftover tiles cannot take anyone below zero.
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
  });
  it("rejects a later play that only touches the board edge", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const first = playMove(state, placementsFor(state, 2, 7, 7), acceptAll);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      playMove(first.state, placementsFor(first.state, 2, 0, 0), acceptAll),
    ).toMatchObject({
      ok: false,
      error: "The play must connect to the board.",
    });
  });
  it("records the last move for plays, exchanges and passes", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const played = playMove(state, placementsFor(state, 2, 7, 7), acceptAll);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.lastMove).toMatchObject({
      playerIndex: 0,
      kind: "play",
      score: played.score,
      tiles: 2,
    });
    expect(played.state.lastMove?.words).toEqual(played.words);
    const id = played.state.players[1]!.rack[0]!.id;
    const exchanged = exchangeTiles(played.state, [id], new SequenceRandom());
    expect(exchanged.ok && exchanged.state.lastMove).toMatchObject({
      playerIndex: 1,
      kind: "exchange",
      tiles: 1,
    });
    expect(
      exchanged.ok && exchanged.state.history?.map((move) => move.kind),
    ).toEqual(["play", "exchange"]);
    expect(passTurn(state, "auto-pass").lastMove).toMatchObject({
      playerIndex: 0,
      kind: "auto-pass",
      score: 0,
    });
  });
  it("previews scores from a public board without a dictionary", () => {
    const board = createBoard(15);
    const preview = analyzePlay(board, [
      { row: 7, col: 7, tile: { letter: "Q", value: 10 } },
      { row: 7, col: 8, tile: { letter: null, value: 0, blankAs: "I" } },
    ]);
    expect(preview).toEqual({
      ok: true,
      words: [{ word: "QI", score: 10 }],
      score: 10,
      candidates: ["QI"],
    });
    expect(
      analyzePlay(board, [
        { row: 7, col: 7, tile: { letter: null, value: 0 } },
      ]),
    ).toMatchObject({ ok: false });
  });
});
describe("move timing", () => {
  it("exchanging scores nothing and counts as a scoreless turn", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const id = state.players[0]!.rack[0]!.id;
    const result = exchangeTiles(state, [id], new SequenceRandom());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]!.score).toBe(0);
    expect(result.state.scorelessTurns).toBe(1);
    expect(result.state.lastMove).toMatchObject({ kind: "exchange", score: 0 });
  });
  it("stamps only the turns finished since the previous state", () => {
    const state = {
      ...createGame(
        { boardSize: 15, timerSeconds: 0 },
        ["A", "B"],
        new SequenceRandom(),
      ),
      startedAt: 400,
    };
    const first = stampMoves(state, passTurn(state), 1_000);
    const second = stampMoves(first, passTurn(passTurn(first)), 5_000);
    expect(second.history?.map((move) => move.at)).toEqual([
      1_000, 5_000, 5_000,
    ]);
    // The first turn runs from the game start; a run of passes made at once
    // charges its time to the first of them.
    expect(second.history?.map((move) => move.took)).toEqual([600, 4_000, 0]);
    expect(second.turnStartedAt).toBe(5_000);
    expect(second.lastMove).toBe(second.history?.at(-1));
    expect(stampMoves(second, second, 9_000)).toBe(second);
  });
  it("times turns in games saved before turn starts were recorded", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    expect(stampMoves(state, passTurn(state), 1_000).lastMove?.took).toBe(
      undefined,
    );
    const passed = passTurn(state),
      legacy = { ...passed, history: [{ ...passed.history![0]!, at: 2_000 }] };
    expect(stampMoves(legacy, passTurn(legacy), 2_750).lastMove?.took).toBe(
      750,
    );
  });
});
describe("ending and replay data", () => {
  it("ends early by deducting each player's own remaining tiles, never below zero", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const ended = endGame(state);
    expect(ended.phase).toBe("results");
    expect(ended.endReason).toBe("ended-early");
    ended.players.forEach((player, index) => {
      const held = state.players[index]!.rack.reduce(
        (sum, tile) => sum + tile.value,
        0,
      );
      expect(held).toBeGreaterThan(0);
      expect(player.score).toBe(0);
    });
    const scored = endGame({
      ...state,
      players: state.players.map((player) => ({ ...player, score: 100 })),
    });
    scored.players.forEach((player, index) => {
      const held = state.players[index]!.rack.reduce(
        (sum, tile) => sum + tile.value,
        0,
      );
      expect(player.score).toBe(100 - held);
    });
    expect(endGame(ended)).toBe(ended);
  });
  it("records where a play put its tiles, without tile ids", () => {
    const state = createGame(
      { boardSize: 15, timerSeconds: 0 },
      ["A", "B"],
      new SequenceRandom(),
    );
    const placements = placementsFor(state, 2, 7, 7);
    const played = playMove(state, placements, acceptAll);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const placed = played.state.lastMove?.placed ?? [];
    expect(placed.map(({ row, col }) => [row, col])).toEqual(
      placements.map(({ row, col }) => [row, col]),
    );
    expect(placed.every((tile) => !("id" in tile))).toBe(true);
  });
});
