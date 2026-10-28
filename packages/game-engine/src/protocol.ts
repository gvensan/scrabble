import { z } from "zod";

export const PROTOCOL_VERSION = 1;
/** WebSocket subprotocols: the token travels in a header, never the URL. */
export const SOCKET_PROTOCOL = "scrabble.v1";
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
  /** Seats; 8 is "4+": as many as the board allows, up to eight. */
  capacity: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(8)]),
  timerSeconds: z.union([z.literal(0), z.literal(120), z.literal(300)]),
  /** Live voice chat between the players; chosen by the host at creation. */
  voice: z.boolean().optional(),
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
export const voiceSessionSchema = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
/** The negotiation payload shared by the client and server voice.signal. */
const voiceSignalFields = {
  /** The sender's voice session, so replies after a rejoin can be dropped. */
  session: voiceSessionSchema,
  /** The recipient's session the sender is talking to. */
  toSession: voiceSessionSchema,
  description: z
    .object({
      type: z.union([z.literal("offer"), z.literal("answer")]),
      sdp: z.string().max(12_000),
    })
    .optional(),
  candidate: z
    .object({
      candidate: z.string().max(1_000),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    })
    .optional(),
  /** The sender hung up on purpose, so the call can close straight away. */
  bye: z.literal(true).optional(),
};
const iceServerSchema = z.object({
  urls: z.union([
    z.string().max(300),
    z.array(z.string().max(300)).min(1).max(10),
  ]),
  username: z.string().max(300).optional(),
  credential: z.string().max(300).optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;
export interface VoicePeer {
  playerId: string;
  session: string;
  muted: boolean;
}
const actionBase = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  actionId: z.uuid(),
  revision: z.number().int().nonnegative(),
});
export const clientMessageSchema = z.discriminatedUnion("type", [
  actionBase.extend({ type: z.literal("room.lock"), locked: z.boolean() }),
  actionBase.extend({ type: z.literal("room.start") }),
  // The host turns voice chat on or off for everyone, at any point.
  actionBase.extend({ type: z.literal("room.voice"), enabled: z.boolean() }),
  // The host changes board size, seats or the turn timer before the start.
  actionBase.extend({
    type: z.literal("room.settings"),
    settings: roomSettingsSchema.omit({ voice: true }),
  }),
  actionBase.extend({ type: z.literal("room.leave") }),
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
  // After a rejected word: take the rejection, or ask the host to rule.
  actionBase.extend({ type: z.literal("game.accept") }),
  actionBase.extend({ type: z.literal("game.challenge") }),
  // The host's ruling on a challenge.
  actionBase.extend({ type: z.literal("game.rule"), approve: z.boolean() }),
  actionBase.extend({ type: z.literal("game.end") }),
  actionBase.extend({
    type: z.literal("game.exchange"),
    tileIds: z.array(z.string().min(1).max(80)).min(1).max(7),
  }),
  // Where the current player is trying tiles, by rack tile. The server reads
  // the letters from the rack itself and relays them; it never stores them.
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("game.draft"),
    cells: z
      .array(
        z.object({
          row: z.number().int().min(0).max(39),
          col: z.number().int().min(0).max(39),
          tileId: z.string().min(1).max(80),
          blankAs: z
            .string()
            .regex(/^[A-Z]$/)
            .optional(),
        }),
      )
      .max(7),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("sync.request"),
  }),
  // Joining (session set) or leaving (null) voice chat, and the mic state.
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("voice.state"),
    session: voiceSessionSchema.nullable(),
    muted: z.boolean(),
  }),
  // WebRTC negotiation for one other player; the server only relays it.
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("voice.signal"),
    to: z.string().min(1).max(80),
    ...voiceSignalFields,
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
  kind: "play" | "pass" | "exchange" | "auto-pass" | "rejected";
  words: { word: string; score: number }[];
  score: number;
  tiles: number;
  /** Where a play put its tiles; absent on moves recorded before replay existed. */
  placed?:
    | {
        row: number;
        col: number;
        letter: string | null;
        blankAs?: string | undefined;
        value: number;
      }[]
    | undefined;
  /** When the turn ended (epoch ms); absent on moves from before it was recorded. */
  at?: number | undefined;
  /** How long the player spent on this turn (ms). */
  took?: number | undefined;
  /** How a dictionary rejection was settled, when this move had one. */
  challenge?:
    | {
        outcome: "accepted" | "approved" | "rejected" | "expired";
        challenged: boolean;
      }
    | undefined;
}
/** A play the dictionary refused, waiting to be accepted or challenged. */
export interface PublicChallenge {
  playerId: string;
  /** decide: the player accepts or challenges. review: the host rules. */
  stage: "decide" | "review";
  /** When the current stage times out and the rejection stands (epoch ms). */
  deadline: number;
  /** The refused words. */
  rejected: string[];
  /** Every word the play forms, scored as if all were accepted. */
  words: { word: string; score: number }[];
  score: number;
  /** The attempted tiles, to show on the board. */
  placed: {
    row: number;
    col: number;
    letter: string | null;
    blankAs?: string | undefined;
    value: number;
  }[];
  /** Challenges the player has left this game, this one not counted. */
  challengesLeft: number;
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
  /** Every finished turn in order. Optional so older servers still parse. */
  history?: PublicLastMove[] | undefined;
  /** When play began (epoch ms). */
  startedAt?: number | null | undefined;
  /** A rejected play that is paused for a challenge; null otherwise. */
  challenge?: PublicChallenge | null | undefined;
  /** Scoreless turns in a row; six end the game. */
  scorelessTurns?: number | undefined;
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
    z.literal("rejected"),
  ]),
  words: z.array(z.object({ word: z.string(), score: z.number().int() })),
  score: z.number().int(),
  tiles: z.number().int().nonnegative(),
  at: z.number().optional(),
  took: z.number().nonnegative().optional(),
  challenge: z
    .object({
      outcome: z.union([
        z.literal("accepted"),
        z.literal("approved"),
        z.literal("rejected"),
        z.literal("expired"),
      ]),
      challenged: z.boolean(),
    })
    .optional(),
  placed: z
    .array(
      z.object({
        row: z.number().int().nonnegative(),
        col: z.number().int().nonnegative(),
        letter: z.string().nullable(),
        blankAs: z.string().optional(),
        value: z.number().int().nonnegative(),
      }),
    )
    .optional(),
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
  history: z.array(publicLastMoveSchema).optional(),
  startedAt: z.number().nullable().optional(),
  scorelessTurns: z.number().int().nonnegative().optional(),
  challenge: z
    .object({
      playerId: z.string(),
      stage: z.union([z.literal("decide"), z.literal("review")]),
      deadline: z.number(),
      rejected: z.array(z.string()),
      words: z.array(z.object({ word: z.string(), score: z.number().int() })),
      score: z.number().int(),
      placed: z.array(
        z.object({
          row: z.number().int().nonnegative(),
          col: z.number().int().nonnegative(),
          letter: z.string().nullable(),
          blankAs: z.string().optional(),
          value: z.number().int().nonnegative(),
        }),
      ),
      challengesLeft: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
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
  z.object({
    type: z.literal("game.draft"),
    playerId: z.string(),
    cells: z
      .array(
        z.object({
          row: z.number(),
          col: z.number(),
          letter: z.string().nullable(),
          blankAs: z.string().optional(),
          value: z.number(),
        }),
      )
      .max(7),
  }),
  z.object({
    type: z.literal("voice.roster"),
    peers: z
      .array(
        z.object({
          playerId: z.string(),
          session: voiceSessionSchema,
          muted: z.boolean(),
        }),
      )
      .max(4),
  }),
  z.object({
    type: z.literal("voice.config"),
    iceServers: z.array(iceServerSchema).max(10),
  }),
  z.object({
    type: z.literal("voice.signal"),
    from: z.string(),
    ...voiceSignalFields,
  }),
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
  /** Hidden from the admin rooms list; the room itself is unaffected. */
  archived: boolean;
}
export interface AdminGame {
  /** The room's internal id; codes can be reused, ids cannot. */
  id: string;
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
  /** Whether a public summary page exists (not for abandoned or older games). */
  hasSummary: boolean;
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
  kind: "play" | "pass" | "exchange" | "auto-pass" | "rejected";
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
    connections: number;
  } | null;
}
