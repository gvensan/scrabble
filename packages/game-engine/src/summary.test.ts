import { describe, expect, it } from "vitest";
import { maxPlayersFor, seatsFor } from "./bag.js";
import { createGame } from "./game.js";
import { summarizeGame, summaryWords, type SummaryInput } from "./summary.js";

describe("player limits", () => {
  it("lets each board take as many players as its bag can feed", () => {
    expect(maxPlayersFor(7)).toBe(4);
    expect(maxPlayersFor(15)).toBe(7);
    expect(maxPlayersFor(21)).toBe(8);
    expect(maxPlayersFor(40)).toBe(8);
    expect(seatsFor(8, 15)).toBe(7);
    expect(seatsFor(3, 21)).toBe(3);
  });
  it("deals eight racks on a big board and refuses too many on a small one", () => {
    const random = { nextInt: () => 0 },
      names = Array.from({ length: 8 }, (_, i) => `P${i + 1}`);
    const game = createGame({ boardSize: 21, timerSeconds: 0 }, names, random);
    expect(game.players).toHaveLength(8);
    expect(game.players.every((player) => player.rack.length === 7)).toBe(true);
    expect(() =>
      createGame({ boardSize: 15, timerSeconds: 0 }, names, random),
    ).toThrow(/2 to 7 players/);
  });
});

const base: SummaryInput = {
  code: "ABC234",
  mode: "online",
  boardSize: 15,
  timerSeconds: 0,
  startedAt: 0,
  endedAt: 100_000,
  endReason: "rack-emptied",
  players: [
    { name: "Ada", score: 52 },
    { name: "Lin", score: 70 },
  ],
  tiles: [
    { row: 7, col: 7, letter: "C" },
    { row: 7, col: 8, letter: null, blankAs: "A" },
  ],
  moves: [
    {
      player: 0,
      kind: "play",
      words: [{ word: "CAT", score: 10 }],
      score: 10,
      tiles: 3,
      took: 20_000,
    },
    {
      player: 1,
      kind: "play",
      words: [
        { word: "QUIZZES", score: 60 },
        { word: "AT", score: 2 },
      ],
      score: 62,
      tiles: 7,
      took: 5_000,
    },
    { player: 0, kind: "pass", words: [], score: 0, tiles: 0, took: 1_000 },
    {
      player: 1,
      kind: "rejected",
      words: [{ word: "XQ", score: 0 }],
      score: 0,
      tiles: 2,
      took: 3_000,
    },
    {
      player: 0,
      kind: "play",
      words: [{ word: "KWA", score: 45 }],
      score: 45,
      tiles: 3,
      took: 9_000,
      challenge: { outcome: "approved" },
    },
  ],
};

describe("summarizeGame", () => {
  it("ranks players and explains the end-of-game adjustment", () => {
    const summary = summarizeGame(base);
    expect(summary.players.map((player) => player.name)).toEqual([
      "Lin",
      "Ada",
    ]);
    const [lin, ada] = summary.players;
    expect(lin).toMatchObject({
      rank: 1,
      moveTotal: 62,
      adjustment: 8,
      plays: 1,
      bingos: 1,
      best: { word: "QUIZZES", score: 62 },
      averageMs: 4_000,
    });
    expect(ada).toMatchObject({ rank: 2, moveTotal: 55, adjustment: -3 });
    expect(summary.totalTurns).toBe(5);
    expect(summary.tiles).toEqual(base.tiles);
  });
  it("shares a rank on a tie", () => {
    const summary = summarizeGame({
      ...base,
      players: [
        { name: "Ada", score: 30 },
        { name: "Lin", score: 30 },
      ],
    });
    expect(summary.players.map((player) => player.rank)).toEqual([1, 1]);
  });
  it("picks the best, quickest, longest and bingo plays", () => {
    const { moments } = summarizeGame(base);
    expect(moments.bestPlays.map((play) => play.word)).toEqual([
      "QUIZZES",
      "KWA",
      "CAT",
    ]);
    expect(moments.bestPlays[1]).toMatchObject({ approved: true, turn: 5 });
    expect(moments.quickest.map((play) => play.word)).toEqual([
      "QUIZZES",
      "KWA",
      "CAT",
    ]);
    expect(moments.longest).toMatchObject({ word: "QUIZZES", player: "Lin" });
    expect(moments.bingos.map((play) => play.word)).toEqual(["QUIZZES"]);
  });
  it("leaves rejected words out and lists the words to define", () => {
    const summary = summarizeGame(base);
    expect(summaryWords(summary)).toEqual(["QUIZZES", "KWA", "CAT"]);
    const empty = summarizeGame({ ...base, moves: [] });
    expect(empty.moments.longest).toBeNull();
    expect(summaryWords(empty)).toEqual([]);
  });
});
