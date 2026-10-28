/**
 * The end-of-game summary: a leaderboard and the game's notable moments.
 * It is built from the move history alone, so the server, the online
 * client and same-device games all produce the same result, and it is small
 * enough to keep after the room itself is gone.
 */

import type { PublicRoom } from "./protocol.js";

export const SUMMARY_VERSION = 1;
/** Highlights kept per list. */
const BEST_PLAYS = 5,
  QUICKEST = 3;
/** Most words whose meanings are looked up and stored with a summary. */
export const SUMMARY_MEANINGS = 8;

export interface SummaryMoveInput {
  /** Seat order of the player who moved. */
  player: number;
  kind: "play" | "pass" | "exchange" | "auto-pass" | "rejected";
  words: readonly { word: string; score: number }[];
  score: number;
  tiles: number;
  /** Milliseconds spent on the turn; missing on older moves. */
  took?: number | undefined;
  challenge?: { outcome: string } | undefined;
}
/** A tile on the final board; premiums come from the board size. */
export interface SummaryTile {
  row: number;
  col: number;
  /** null for a blank; see blankAs. */
  letter: string | null;
  blankAs?: string | undefined;
}
export interface SummaryInput {
  /** The room code for online games; null for same-device games. */
  code: string | null;
  mode: "online" | "device";
  boardSize: number;
  /** Seconds per turn; 0 when the clock was off. */
  timerSeconds: number;
  startedAt: number | null;
  endedAt: number;
  endReason: string | null;
  players: readonly { name: string; score: number; left?: boolean }[];
  moves: readonly SummaryMoveInput[];
  /** Every tile on the board when the game ended. */
  tiles: readonly SummaryTile[];
}

export interface SummaryPlayer {
  name: string;
  /** 1 for the winner; tied players share a rank. */
  rank: number;
  score: number;
  /** Points from moves, before the end-of-game tile adjustment. */
  moveTotal: number;
  /** Final score minus move points: leftover tiles lost, or a bonus gained. */
  adjustment: number;
  turns: number;
  plays: number;
  bingos: number;
  best: { word: string; score: number } | null;
  /** Average time per turn in ms, over turns that were timed. */
  averageMs: number | null;
  left: boolean;
}
export interface SummaryPlay {
  player: string;
  /** The play's headline: its highest-scoring word. */
  word: string;
  /** Every word the play formed. */
  words: string[];
  score: number;
  took: number | null;
  /** 1-based turn number in the game. */
  turn: number;
  bingo: boolean;
  /** Counted only because the host approved it on challenge. */
  approved: boolean;
}
export interface SummaryMeaning {
  partOfSpeech: string | null;
  definition: string;
}
export interface GameSummary {
  version: number;
  code: string | null;
  mode: "online" | "device";
  boardSize: number;
  timerSeconds: number;
  startedAt: number | null;
  endedAt: number;
  endReason: string | null;
  players: SummaryPlayer[];
  totalTurns: number;
  /** The final board's tiles. */
  tiles: SummaryTile[];
  moments: {
    bestPlays: SummaryPlay[];
    quickest: SummaryPlay[];
    longest: SummaryPlay | null;
    bingos: SummaryPlay[];
  };
  /** Stored meanings by word; null when the dictionary had none. */
  meanings: Record<string, SummaryMeaning | null>;
}

function toPlay(
  move: SummaryMoveInput,
  index: number,
  name: string,
  word?: string,
): SummaryPlay {
  const headline =
    word ??
    [...move.words].sort(
      (a, b) => b.score - a.score || b.word.length - a.word.length,
    )[0]?.word ??
    "";
  return {
    player: name,
    word: headline,
    words: move.words.map((item) => item.word),
    score: move.score,
    took: move.took ?? null,
    turn: index + 1,
    bingo: move.tiles === 7,
    approved: move.challenge?.outcome === "approved",
  };
}

export function summarizeGame(input: SummaryInput): GameSummary {
  const name = (index: number) => input.players[index]?.name ?? "Player",
    plays = input.moves.flatMap((move, index) =>
      move.kind === "play" && move.words.length
        ? [{ move, play: toPlay(move, index, name(move.player)) }]
        : [],
    );
  const sorted = [...input.players]
    .map((player, index) => ({ player, index }))
    .sort((a, b) => b.player.score - a.player.score);
  const players = sorted.map(({ player, index }): SummaryPlayer => {
    const own = input.moves.filter((move) => move.player === index),
      ownPlays = plays.filter(({ move }) => move.player === index),
      timed = own.filter((move) => move.took !== undefined && move.took > 0),
      moveTotal = own.reduce((sum, move) => sum + move.score, 0),
      best = ownPlays.reduce<SummaryPlay | null>(
        (top, { play }) =>
          top === null || play.score > top.score ? play : top,
        null,
      );
    return {
      name: player.name,
      rank:
        1 + input.players.filter((other) => other.score > player.score).length,
      score: player.score,
      moveTotal,
      adjustment: player.score - moveTotal,
      turns: own.length,
      plays: ownPlays.length,
      bingos: ownPlays.filter(({ play }) => play.bingo).length,
      best: best && { word: best.word, score: best.score },
      averageMs: timed.length
        ? Math.round(
            timed.reduce((sum, move) => sum + (move.took ?? 0), 0) /
              timed.length,
          )
        : null,
      left: player.left === true,
    };
  });
  // Earlier plays win ties, so the order is stable.
  const bestPlays = [...plays]
    .sort((a, b) => b.play.score - a.play.score || a.play.turn - b.play.turn)
    .slice(0, BEST_PLAYS)
    .map(({ play }) => play);
  const quickest = plays
    .filter(({ play }) => play.took !== null && play.took > 0)
    .sort(
      (a, b) =>
        (a.play.took ?? 0) - (b.play.took ?? 0) || a.play.turn - b.play.turn,
    )
    .slice(0, QUICKEST)
    .map(({ play }) => play);
  let longest: SummaryPlay | null = null,
    longestScore = -1;
  for (const { move, play } of plays)
    for (const item of move.words)
      if (
        longest === null ||
        item.word.length > longest.word.length ||
        (item.word.length === longest.word.length && item.score > longestScore)
      ) {
        longest = { ...play, word: item.word };
        longestScore = item.score;
      }
  return {
    version: SUMMARY_VERSION,
    code: input.code,
    mode: input.mode,
    boardSize: input.boardSize,
    timerSeconds: input.timerSeconds,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    endReason: input.endReason,
    players,
    totalTurns: input.moves.length,
    tiles: input.tiles.map((tile) => ({
      row: tile.row,
      col: tile.col,
      letter: tile.letter,
      ...(tile.blankAs ? { blankAs: tile.blankAs } : {}),
    })),
    moments: {
      bestPlays,
      quickest,
      longest,
      bingos: plays.filter(({ play }) => play.bingo).map(({ play }) => play),
    },
    meanings: {},
  };
}

/** The highlighted words worth a stored meaning, most notable first. */
export function summaryWords(summary: GameSummary): string[] {
  const { bestPlays, longest, bingos, quickest } = summary.moments;
  return [
    ...new Set(
      [...bestPlays, ...(longest ? [longest] : []), ...bingos, ...quickest].map(
        (play) => play.word,
      ),
    ),
  ].slice(0, SUMMARY_MEANINGS);
}

/** The summary of a finished online room, from its public snapshot. */
export function summarizeRoom(room: PublicRoom, endedAt: number): GameSummary {
  return summarizeGame({
    code: room.roomCode,
    mode: "online",
    boardSize: room.settings.boardSize,
    timerSeconds: room.settings.timerSeconds,
    startedAt: room.startedAt ?? null,
    endedAt,
    endReason: room.endReason,
    players: room.players.map((player) => ({
      name: player.nickname,
      score: player.score,
      left: player.left,
    })),
    moves: (room.history ?? []).map((move) => ({
      ...move,
      player: room.players.findIndex((player) => player.id === move.playerId),
    })),
    tiles: boardTiles(
      room.board as readonly (readonly {
        tile: { letter: string | null; blankAs?: string } | null;
      }[])[],
    ),
  });
}

/** The tiles of a board, as a summary keeps them. */
export function boardTiles(
  board: readonly (readonly {
    tile: { letter: string | null; blankAs?: string | undefined } | null;
  }[])[],
): SummaryTile[] {
  return board.flatMap((row, r) =>
    row.flatMap((cell, c) =>
      cell.tile
        ? [
            {
              row: r,
              col: c,
              letter: cell.tile.letter,
              ...(cell.tile.blankAs ? { blankAs: cell.tile.blankAs } : {}),
            },
          ]
        : [],
    ),
  );
}
