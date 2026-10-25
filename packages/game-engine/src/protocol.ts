import { z } from "zod";

export const PROTOCOL_VERSION = 1;
/** WebSocket subprotocols: the token travels in a header, never the URL. */
export const SOCKET_PROTOCOL = "squabble.v1";
export const SOCKET_TOKEN_PREFIX = "token.";
/** Close codes the client treats as final rather than retrying. */
export const CLOSE_ROOM_GONE = 4004;
export const CLOSE_SEAT_REJECTED = 4401;
export const nicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[\p{L}\p{N} _.-]+$/u);
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,10}$/);
export const roomSettingsSchema = z.object({
  boardSize: z.number().int().min(7).max(40),
  capacity: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  timerSeconds: z.union([z.literal(0), z.literal(120), z.literal(300)]),
});
export const createRoomSchema = z.object({
  nickname: nicknameSchema,
  settings: roomSettingsSchema,
});
export const joinRoomSchema = z.object({ nickname: nicknameSchema });
/** GET /api/rooms/{code}: whether an invite link can be used right now. */
export type RoomStatus =
  | { joinable: true; reason: null; host: string | null }
  | {
      joinable: false;
      reason: "locked" | "full" | "started" | "missing";
      host?: string | null;
    };
const actionBase = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  actionId: z.uuid(),
  revision: z.number().int().nonnegative(),
});
export const clientMessageSchema = z.discriminatedUnion("type", [
  actionBase.extend({ type: z.literal("room.lock"), locked: z.boolean() }),
  actionBase.extend({ type: z.literal("room.start") }),
  actionBase.extend({ type: z.literal("room.leave") }),
  actionBase.extend({
    type: z.literal("room.rematch"),
    roomCode: roomCodeSchema,
  }),
  actionBase.extend({
    type: z.literal("game.play"),
    placements: z
      .array(
        z.object({
          tileId: z.string().min(1).max(80),
          row: z.number().int().min(0).max(39),
          col: z.number().int().min(0).max(39),
          blankAs: z
            .string()
            .regex(/^[A-Z]$/)
            .optional(),
        }),
      )
      .min(1)
      .max(7),
  }),
  actionBase.extend({ type: z.literal("game.pass") }),
  actionBase.extend({
    type: z.literal("game.exchange"),
    tileIds: z.array(z.string().min(1).max(80)).min(1).max(7),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("sync.request"),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export interface PublicPlayer {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  rackCount: number;
  host: boolean;
  left: boolean;
}
export interface PublicLastMove {
  playerId: string | null;
  kind: "play" | "pass" | "exchange" | "auto-pass";
  words: { word: string; score: number }[];
  score: number;
  tiles: number;
}
export interface PublicRoom {
  roomCode: string;
  phase: "lobby" | "active" | "results";
  settings: z.infer<typeof roomSettingsSchema>;
  players: PublicPlayer[];
  board: unknown[];
  bagRemaining: number;
  currentPlayerId: string | null;
  turnNumber: number;
  turnDeadline: number | null;
  revision: number;
  expiresAt: number;
  endReason: string | null;
  lastMove: PublicLastMove | null;
  rematchCode: string | null;
  locked: boolean;
}
export interface PrivateSeat {
  playerId: string;
  rack: unknown[];
}

const publicPlayerSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  score: z.number(),
  connected: z.boolean(),
  rackCount: z.number().int().nonnegative(),
  host: z.boolean(),
  left: z.boolean(),
});
const publicLastMoveSchema = z.object({
  playerId: z.string().nullable(),
  kind: z.union([
    z.literal("play"),
    z.literal("pass"),
    z.literal("exchange"),
    z.literal("auto-pass"),
  ]),
  words: z.array(z.object({ word: z.string(), score: z.number().int() })),
  score: z.number().int(),
  tiles: z.number().int().nonnegative(),
});
const publicCellSchema = z.object({
  premium: z.union([
    z.literal("TW"),
    z.literal("DW"),
    z.literal("TL"),
    z.literal("DL"),
    z.null(),
  ]),
  tile: z
    .object({
      letter: z.string().nullable(),
      blankAs: z.string().optional(),
      value: z.number().int().nonnegative(),
    })
    .nullable(),
});
export const publicRoomSchema = z.object({
  roomCode: roomCodeSchema,
  phase: z.union([
    z.literal("lobby"),
    z.literal("active"),
    z.literal("results"),
  ]),
  settings: roomSettingsSchema,
  players: z.array(publicPlayerSchema),
  board: z.array(z.array(publicCellSchema)),
  bagRemaining: z.number().int().nonnegative(),
  currentPlayerId: z.string().nullable(),
  turnNumber: z.number().int().nonnegative(),
  turnDeadline: z.number().nullable(),
  revision: z.number().int().nonnegative(),
  expiresAt: z.number(),
  endReason: z.string().nullable(),
  lastMove: publicLastMoveSchema.nullable(),
  rematchCode: roomCodeSchema.nullable(),
  locked: z.boolean(),
});
const seatSchema = z.object({
  playerId: z.string(),
  rack: z.array(
    z.object({
      id: z.string(),
      letter: z.string().nullable(),
      value: z.number().int().nonnegative(),
    }),
  ),
});
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room.snapshot"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    serverTime: z.number(),
    room: publicRoomSchema,
  }),
  z.object({
    type: z.literal("seat.private"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    revision: z.number().int().nonnegative(),
    seat: seatSchema,
  }),
  z.object({ type: z.literal("game.pending"), actionId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Admin overview served by GET /api/admin/overview behind ADMIN_TOKEN. */
export interface AdminPlayer {
  nickname: string;
  score: number;
  connected: boolean;
  left: boolean;
  host: boolean;
}
export interface AdminRoom {
  roomCode: string;
  status: "lobby" | "active" | "results" | "closed";
  closeReason: string | null;
  boardSize: number;
  capacity: number;
  timerSeconds: number;
  locked: boolean;
  players: AdminPlayer[];
  turnNumber: number;
  bagRemaining: number;
  plays: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  closedAt: number | null;
  updatedAt: number;
  endReason: string | null;
}
export interface AdminGame {
  roomCode: string;
  startedAt: number;
  endedAt: number;
  boardSize: number;
  timerSeconds: number;
  players: AdminPlayer[];
  winners: string[];
  winningScore: number;
  endReason: string;
  turns: number;
  plays: number;
  bestPlay: { word: string; score: number; by: string } | null;
}
export interface AdminDay {
  day: string;
  metrics: Record<string, number>;
}
export interface AdminLeader {
  nickname: string;
  games: number;
  wins: number;
  bestScore: number;
  totalScore: number;
}
export interface AdminOverview {
  generatedAt: number;
  limits: { roomsPerHour: number; joinsPer10Min: number };
  totals: {
    lobbies: number;
    activeGames: number;
    playersOnline: number;
    roomsToday: number;
    gamesToday: number;
    gamesRecorded: number;
    averageDurationMs: number | null;
    averageWinningScore: number | null;
    highestScore: { nickname: string; score: number; roomCode: string } | null;
    bestPlay: {
      word: string;
      score: number;
      by: string;
      roomCode: string;
    } | null;
  };
  rooms: AdminRoom[];
  games: AdminGame[];
  daily: AdminDay[];
  leaders: AdminLeader[];
  rateLimited: { kind: string; count: number; resetsAt: number }[];
}
export interface AdminMove {
  turn: number;
  nickname: string;
  kind: "play" | "pass" | "exchange" | "auto-pass";
  words: { word: string; score: number }[];
  score: number;
  tiles: number;
}
export interface AdminSeat extends AdminPlayer {
  rackCount: number;
  plays: number;
  tilesPlayed: number;
  passes: number;
  exchanges: number;
  bestPlay: { words: string; score: number } | null;
  /** Points from moves; the final score also includes end-of-game tile adjustments. */
  movePoints: number;
}
export interface AdminCell {
  premium: "TW" | "DW" | "TL" | "DL" | null;
  tile: { letter: string | null; blankAs?: string; value: number } | null;
}
/** GET /api/admin/rooms/{code}: the dashboard row plus live state while the room exists. */
export interface AdminRoomDetail {
  room: AdminRoom;
  live: {
    seats: AdminSeat[];
    moves: AdminMove[];
    board: AdminCell[][];
    currentPlayer: string | null;
    turnDeadline: number | null;
    expiresAt: number;
    rematchCode: string | null;
    connections: number;
  } | null;
}
