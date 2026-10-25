import {
  createGame,
  exchangeTiles,
  passTurn,
  playMove,
  type GameState,
  type Placement,
  type RandomSource,
  type WordValidator,
} from "@squabble/game-engine";
import type {
  ClientMessage,
  PublicRoom,
  RoomStatus,
} from "@squabble/game-engine/protocol";

export interface Member {
  id: string;
  nickname: string;
  tokenHash: string;
  connected: boolean;
  left?: boolean;
}
export interface RoomData {
  roomCode: string;
  phase: "lobby" | "active" | "results";
  settings: {
    boardSize: number;
    capacity: 2 | 3 | 4;
    timerSeconds: 0 | 120 | 300;
  };
  members: Member[];
  hostId: string;
  game: GameState | null;
  revision: number;
  actionIds: string[];
  createdAt: number;
  expiresAt: number;
  turnDeadline: number | null;
  disconnectDeadlines: Record<string, number>;
  emptyExpiresAt: number | null;
  remainingTurnMs: number | null;
  resultReason: string | null;
  rematchCode?: string | null;
  /** Set by the host in the lobby to stop new players joining. */
  locked?: boolean;
  pending?: {
    actionId: string;
    actorId: string;
    revision: number;
    startedAt?: number;
  };
}
/** A dictionary check never takes this long; an older reservation is stale. */
export const PENDING_TIMEOUT_MS = 30_000;
export const DISCONNECT_GRACE_MS = 3 * 60_000;
const EMPTY_ROOM_MS = 15 * 60_000;
const RESULTS_MS = 10 * 60_000;
export function withoutPending(room: RoomData): RoomData {
  const copy = { ...room };
  delete copy.pending;
  return copy;
}
/** Pauses clocks once nobody is connected; reconnecting resumes them. */
function suspendIfEmpty(room: RoomData, now: number): RoomData {
  if (room.members.some((member) => member.connected)) return room;
  return {
    ...room,
    remainingTurnMs:
      room.turnDeadline === null
        ? room.remainingTurnMs
        : Math.max(0, room.turnDeadline - now),
    turnDeadline: null,
    emptyExpiresAt: room.emptyExpiresAt ?? now + EMPTY_ROOM_MS,
  };
}
export function markDisconnected(
  room: RoomData,
  playerId: string,
  now: number,
): RoomData {
  return suspendIfEmpty(
    {
      ...room,
      members: room.members.map((member) =>
        member.id === playerId ? { ...member, connected: false } : member,
      ),
      disconnectDeadlines: {
        ...room.disconnectDeadlines,
        [playerId]: now + DISCONNECT_GRACE_MS,
      },
    },
    now,
  );
}
/**
 * Applies an explicit leave. Returns null when the lobby is now empty and the
 * room should be deleted.
 */
export function leaveRoom(
  room: RoomData,
  playerId: string,
  now: number,
): RoomData | null {
  if (room.phase === "lobby") {
    const members = room.members.filter((member) => member.id !== playerId);
    const nextHost = members.find((member) => member.connected) ?? members[0];
    if (!nextHost) return null;
    return {
      ...room,
      members,
      hostId: room.hostId === playerId ? nextHost.id : room.hostId,
      revision: room.revision + 1,
    };
  }
  const members = room.members.map((member) =>
    member.id === playerId
      ? { ...member, connected: false, left: true }
      : member,
  );
  const left: RoomData = {
    ...room,
    members,
    disconnectDeadlines: { ...room.disconnectDeadlines, [playerId]: now },
    revision: room.revision + 1,
  };
  if (room.phase !== "active") return left;
  if (members.filter((member) => !member.left).length < 2)
    return {
      ...withoutPending(left),
      phase: "results",
      resultReason: "players-left",
      expiresAt: now + RESULTS_MS,
      turnDeadline: null,
      remainingTurnMs: null,
      emptyExpiresAt: null,
    };
  return suspendIfEmpty(left, now);
}
export function recordRematch(
  room: RoomData,
  actorId: string,
  roomCode: string,
): RoomData {
  if (room.phase !== "results") throw new Error("The game is still running.");
  if (!room.members.some((member) => member.id === actorId))
    throw new Error("Seat not found.");
  if (room.rematchCode) return room;
  return { ...room, rematchCode: roomCode, revision: room.revision + 1 };
}
export function createLobby(
  roomCode: string,
  nickname: string,
  tokenHash: string,
  settings: RoomData["settings"],
  now: number,
): RoomData {
  const id = crypto.randomUUID();
  return {
    roomCode,
    phase: "lobby",
    settings,
    members: [{ id, nickname, tokenHash, connected: false }],
    hostId: id,
    game: null,
    revision: 0,
    actionIds: [],
    createdAt: now,
    expiresAt: now + 30 * 60_000,
    turnDeadline: null,
    disconnectDeadlines: {},
    emptyExpiresAt: null,
    remainingTurnMs: null,
    resultReason: null,
  };
}
/** What an invite link shows before asking for a nickname. */
export function roomStatus(room: RoomData): RoomStatus {
  const host =
      room.members.find((member) => member.id === room.hostId)?.nickname ??
      null,
    reason =
      room.phase !== "lobby"
        ? "started"
        : room.locked
          ? "locked"
          : room.members.length >= room.settings.capacity
            ? "full"
            : null;
  return reason
    ? { joinable: false, reason, host }
    : { joinable: true, reason: null, host };
}
export function addMember(
  room: RoomData,
  nickname: string,
  tokenHash: string,
): { room: RoomData; playerId: string } {
  if (room.phase !== "lobby") throw new Error("Game already started.");
  if (room.locked)
    throw new Error("The host has locked this room. Ask them to unlock it.");
  if (room.members.length >= room.settings.capacity)
    throw new Error("Room is full.");
  if (
    room.members.some(
      (member) =>
        member.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase(),
    )
  )
    throw new Error("Nickname is already in use.");
  const playerId = crypto.randomUUID();
  const member = {
    id: playerId,
    nickname,
    tokenHash,
    connected: false,
  };
  return {
    playerId,
    room: {
      ...room,
      members: [...room.members, member],
      revision: room.revision + 1,
    },
  };
}
export function publicRoom(room: RoomData): PublicRoom {
  const game = room.game;
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    settings: room.settings,
    players: room.members.map((member, index) => {
      const player =
        game?.players.find((item) => item.id === member.id) ??
        game?.players[index];
      return {
        id: member.id,
        nickname: member.nickname,
        score: player?.score ?? 0,
        connected: member.connected,
        rackCount: player?.rack.length ?? 0,
        host: member.id === room.hostId,
        left: member.left === true,
      };
    }),
    board:
      game?.board.map((row) =>
        row.map((cell) => ({
          premium: cell.premium,
          tile: cell.tile
            ? {
                letter: cell.tile.letter,
                blankAs: cell.tile.blankAs,
                value: cell.tile.value,
              }
            : null,
        })),
      ) ?? [],
    bagRemaining: game?.bag.length ?? 0,
    currentPlayerId:
      game === null
        ? null
        : (room.members[game.currentPlayerIndex]?.id ?? null),
    turnNumber: game?.turnNumber ?? 0,
    turnDeadline: room.turnDeadline,
    revision: room.revision,
    expiresAt: room.expiresAt,
    endReason: room.resultReason ?? game?.endReason ?? null,
    lastMove: game?.lastMove
      ? {
          playerId: room.members[game.lastMove.playerIndex]?.id ?? null,
          kind: game.lastMove.kind,
          words: game.lastMove.words.map(({ word, score }) => ({
            word,
            score,
          })),
          score: game.lastMove.score,
          tiles: game.lastMove.tiles,
        }
      : null,
    rematchCode: room.rematchCode ?? null,
    locked: room.locked === true,
  };
}
export function applyAction(
  room: RoomData,
  actorId: string,
  message: Exclude<ClientMessage, { type: "sync.request" }>,
  random: RandomSource,
  validator: WordValidator,
  now = Date.now(),
): RoomData {
  if (message.type === "room.leave" || message.type === "room.rematch")
    throw new Error("Room control messages are handled by the session.");
  if (room.actionIds.includes(message.actionId)) return room;
  if (room.pending && now - (room.pending.startedAt ?? 0) < PENDING_TIMEOUT_MS)
    throw new Error("A word is already being validated.");
  room = withoutPending(room);
  // Lock is an explicit on/off value and start re-checks the roster, so a
  // concurrent join must not reject them; game moves need the exact state.
  if (
    message.revision !== room.revision &&
    message.type !== "room.lock" &&
    message.type !== "room.start"
  )
    throw new Error("State changed; sync and retry.");
  const actorIndex = room.members.findIndex((member) => member.id === actorId);
  if (actorIndex < 0) throw new Error("Seat not found.");
  let next: RoomData;
  if (message.type === "room.lock") {
    if (room.phase !== "lobby")
      throw new Error("The game has already started.");
    if (actorId !== room.hostId)
      throw new Error("Only the host can lock the room.");
    next = { ...room, locked: message.locked };
  } else if (message.type === "room.start") {
    if (actorId !== room.hostId) throw new Error("Only the host can start.");
    if (room.members.length < 2)
      throw new Error("At least two players are needed to start.");
    const game = createGame(
      {
        boardSize: room.settings.boardSize,
        timerSeconds: room.settings.timerSeconds,
      },
      room.members.map((member) => member.nickname),
      random,
    );
    next = {
      ...room,
      phase: "active",
      game,
      expiresAt: room.createdAt + 4 * 60 * 60_000,
      turnDeadline:
        room.settings.timerSeconds === 0
          ? null
          : now + room.settings.timerSeconds * 1000,
    };
  } else {
    if (room.phase !== "active" || room.game === null)
      throw new Error("Game is not active.");
    if (room.game.currentPlayerIndex !== actorIndex)
      throw new Error("It is not your turn.");
    if (message.type === "game.pass")
      next = { ...room, game: passTurn(room.game) };
    else if (message.type === "game.exchange") {
      const result = exchangeTiles(room.game, message.tileIds, random);
      if (!result.ok) throw new Error(result.error);
      next = { ...room, game: result.state };
    } else {
      const result = playMove(
        room.game,
        message.placements as readonly Placement[],
        validator,
      );
      if (!result.ok) throw new Error(result.error);
      next = { ...room, game: result.state };
    }
    if (next.game?.phase === "results")
      next = {
        ...next,
        phase: "results",
        expiresAt: now + RESULTS_MS,
        turnDeadline: null,
        resultReason: next.game.endReason,
      };
    else
      next = {
        ...next,
        turnDeadline:
          room.settings.timerSeconds === 0
            ? null
            : now + room.settings.timerSeconds * 1000,
      };
  }
  return {
    ...next,
    revision: room.revision + 1,
    actionIds: [...room.actionIds.slice(-199), message.actionId],
  };
}
