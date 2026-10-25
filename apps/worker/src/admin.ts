import type {
  AdminCell,
  AdminGame,
  AdminMove,
  AdminPlayer,
  AdminRoom,
  AdminRoomDetail,
  AdminSeat,
} from "@squabble/game-engine/protocol";
import { publicRoom, type RoomData } from "./room-model.js";

/** What a Room tells the directory after each change; never tokens or racks. */
export type RoomReport =
  | {
      kind: "state";
      roomId: string;
      roomCode: string;
      revision: number;
      phase: RoomData["phase"];
      settings: RoomData["settings"];
      locked: boolean;
      players: AdminPlayer[];
      turnNumber: number;
      bagRemaining: number;
      endReason: string | null;
      lastPlay: { nickname: string; word: string; score: number } | null;
      createdAt: number;
    }
  | {
      kind: "closed";
      roomId: string;
      reason: "emptied" | "expired" | "abandoned";
    };

export const ROOM_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const GAME_HISTORY_MS = 180 * 24 * 60 * 60_000;
export const METRICS = [
  "rooms_created",
  "players_joined",
  "games_started",
  "games_finished",
  "plays",
  "words_rejected",
  "dictionary_errors",
  "rate_limited",
] as const;
export type Metric = (typeof METRICS)[number];

export function roomReport(
  roomId: string,
  room: RoomData,
): Extract<RoomReport, { kind: "state" }> {
  const view = publicRoom(room),
    names = new Map(view.players.map((player) => [player.id, player.nickname])),
    move = view.lastMove;
  return {
    kind: "state",
    roomId,
    roomCode: room.roomCode,
    revision: room.revision,
    phase: room.phase,
    settings: room.settings,
    locked: view.locked,
    players: view.players.map((player) => ({
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
      left: player.left,
      host: player.host,
    })),
    turnNumber: view.turnNumber,
    bagRemaining: view.bagRemaining,
    endReason: view.endReason,
    lastPlay:
      move?.kind === "play"
        ? {
            nickname: (move.playerId && names.get(move.playerId)) ?? "Unknown",
            word: move.words.map((item) => item.word).join(", "),
            score: move.score,
          }
        : null,
    createdAt: room.createdAt,
  };
}

/**
 * Highest score wins. A player who walked out cannot win while someone stayed
 * to finish; ties share the win.
 */
export function winners(players: readonly AdminPlayer[]): string[] {
  const stayed = players.filter((player) => !player.left),
    pool = stayed.length ? stayed : players,
    top = Math.max(...pool.map((player) => player.score));
  return pool
    .filter((player) => player.score === top)
    .map((player) => player.nickname);
}

export function utcDay(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

// SQL rows must be type aliases: the storage API needs an index signature.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ActivityRow = {
  room_id: string;
  code: string;
  phase: string;
  revision: number;
  settings_json: string;
  players_json: string;
  locked: number;
  turn_number: number;
  bag_remaining: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  closed_at: number | null;
  close_reason: string | null;
  end_reason: string | null;
  updated_at: number;
  best_word: string | null;
  best_score: number | null;
  best_by: string | null;
  plays: number;
};
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type GameRow = {
  room_id: string;
  code: string;
  started_at: number;
  ended_at: number;
  board_size: number;
  timer_seconds: number;
  players_json: string;
  winners_json: string;
  winning_score: number;
  end_reason: string;
  turns: number;
  plays: number;
  best_word: string | null;
  best_score: number | null;
  best_by: string | null;
};

export function adminRoom(row: ActivityRow): AdminRoom {
  const settings = JSON.parse(row.settings_json) as RoomData["settings"],
    phase =
      row.phase === "active" || row.phase === "results" ? row.phase : "lobby";
  return {
    roomCode: row.code,
    status: row.closed_at === null ? phase : "closed",
    closeReason: row.close_reason,
    boardSize: settings.boardSize,
    capacity: settings.capacity,
    timerSeconds: settings.timerSeconds,
    locked: row.locked === 1,
    players: JSON.parse(row.players_json) as AdminPlayer[],
    turnNumber: row.turn_number,
    bagRemaining: row.bag_remaining,
    plays: row.plays,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
    endReason: row.end_reason,
  };
}

export function adminGame(row: GameRow): AdminGame {
  return {
    roomCode: row.code,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    boardSize: row.board_size,
    timerSeconds: row.timer_seconds,
    players: JSON.parse(row.players_json) as AdminPlayer[],
    winners: JSON.parse(row.winners_json) as string[],
    winningScore: row.winning_score,
    endReason: row.end_reason,
    turns: row.turns,
    plays: row.plays,
    bestPlay:
      row.best_word === null || row.best_score === null
        ? null
        : { word: row.best_word, score: row.best_score, by: row.best_by ?? "" },
  };
}

/** Live room statistics for the admin room page; never tokens or rack letters. */
export function roomLive(
  room: RoomData,
  connections: number,
): NonNullable<AdminRoomDetail["live"]> {
  const view = publicRoom(room),
    history = room.game?.history ?? [],
    moves: AdminMove[] = history.map((move, index) => ({
      turn: index + 1,
      nickname: room.members[move.playerIndex]?.nickname ?? "Unknown",
      kind: move.kind,
      words: move.words.map(({ word, score }) => ({ word, score })),
      score: move.score,
      tiles: move.tiles,
    }));
  const seats = view.players.map((player, index): AdminSeat => {
    const own = history.filter((move) => move.playerIndex === index),
      plays = own.filter((move) => move.kind === "play"),
      best = plays.reduce<(typeof plays)[number] | null>(
        (top, move) => (top === null || move.score > top.score ? move : top),
        null,
      );
    return {
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
      left: player.left,
      host: player.host,
      rackCount: player.rackCount,
      plays: plays.length,
      tilesPlayed: plays.reduce((sum, move) => sum + move.tiles, 0),
      passes: own.filter(
        (move) => move.kind === "pass" || move.kind === "auto-pass",
      ).length,
      exchanges: own.filter((move) => move.kind === "exchange").length,
      bestPlay: best
        ? {
            words: best.words.map((item) => item.word).join(", "),
            score: best.score,
          }
        : null,
      movePoints: own.reduce((sum, move) => sum + move.score, 0),
    };
  });
  return {
    seats,
    moves,
    board: (room.game?.board ?? []).map((row) =>
      row.map(
        (cell): AdminCell => ({
          premium: cell.premium,
          tile: cell.tile
            ? {
                letter: cell.tile.letter,
                ...(cell.tile.blankAs === undefined
                  ? {}
                  : { blankAs: cell.tile.blankAs }),
                value: cell.tile.value,
              }
            : null,
        }),
      ),
    ),
    currentPlayer:
      view.players.find((player) => player.id === view.currentPlayerId)
        ?.nickname ?? null,
    turnDeadline: view.turnDeadline,
    expiresAt: view.expiresAt,
    rematchCode: view.rematchCode,
    connections,
  };
}

/** What a Room returns to the directory for its admin page. */
export interface AdminLiveSnapshot {
  report: Extract<RoomReport, { kind: "state" }>;
  live: NonNullable<AdminRoomDetail["live"]>;
}

/** Stands in for a dashboard row when a room predates admin tracking. */
export function activityFromLive(snapshot: AdminLiveSnapshot): ActivityRow {
  const report = snapshot.report;
  return {
    room_id: report.roomId,
    code: report.roomCode,
    phase: report.phase,
    revision: report.revision,
    settings_json: JSON.stringify(report.settings),
    players_json: JSON.stringify(report.players),
    locked: report.locked ? 1 : 0,
    turn_number: report.turnNumber,
    bag_remaining: report.bagRemaining,
    created_at: report.createdAt,
    started_at: null,
    ended_at: null,
    closed_at: null,
    close_reason: null,
    end_reason: report.endReason,
    updated_at: Date.now(),
    best_word: null,
    best_score: null,
    best_by: null,
    plays: snapshot.live.moves.filter((move) => move.kind === "play").length,
  };
}
