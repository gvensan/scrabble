import { z } from "zod";

export const PROTOCOL_VERSION = 1;
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
const actionBase = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  actionId: z.uuid(),
  revision: z.number().int().nonnegative(),
});
export const clientMessageSchema = z.discriminatedUnion("type", [
  actionBase.extend({ type: z.literal("room.ready"), ready: z.boolean() }),
  actionBase.extend({ type: z.literal("room.start") }),
  actionBase.extend({ type: z.literal("room.leave") }),
  actionBase.extend({ type: z.literal("room.close") }),
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
  ready: boolean;
  rackCount: number;
  host: boolean;
}
export interface PublicRoom {
  roomCode: string;
  phase: "lobby" | "active" | "results";
  settings: z.infer<typeof roomSettingsSchema>;
  players: PublicPlayer[];
  board: unknown[];
  bagRemaining: number;
  currentPlayerId: string | null;
  turnDeadline: number | null;
  revision: number;
  expiresAt: number;
  endReason: string | null;
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
  ready: z.boolean(),
  rackCount: z.number().int().nonnegative(),
  host: z.boolean(),
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
  turnDeadline: z.number().nullable(),
  revision: z.number().int().nonnegative(),
  expiresAt: z.number(),
  endReason: z.string().nullable(),
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
