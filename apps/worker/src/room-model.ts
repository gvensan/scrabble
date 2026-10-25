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
import type { ClientMessage, PublicRoom } from "@squabble/game-engine/protocol";

export interface Member {
  id: string;
  nickname: string;
  tokenHash: string;
  ready: boolean;
  connected: boolean;
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
  pending?: { actionId: string; actorId: string; revision: number };
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
    members: [{ id, nickname, tokenHash, ready: false, connected: false }],
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
export function addMember(
  room: RoomData,
  nickname: string,
  tokenHash: string,
): { room: RoomData; playerId: string } {
  if (room.phase !== "lobby") throw new Error("Game already started.");
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
    ready: false,
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
        ready: member.ready,
        rackCount: player?.rack.length ?? 0,
        host: member.id === room.hostId,
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
    turnDeadline: room.turnDeadline,
    revision: room.revision,
    expiresAt: room.expiresAt,
    endReason: room.resultReason ?? game?.endReason ?? null,
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
  if (message.type === "room.leave" || message.type === "room.close")
    throw new Error("Room control messages are handled by the session.");
  if (room.actionIds.includes(message.actionId)) return room;
  if (room.pending) throw new Error("A word is already being validated.");
  if (message.revision !== room.revision)
    throw new Error("State changed; sync and retry.");
  const actorIndex = room.members.findIndex((member) => member.id === actorId);
  if (actorIndex < 0) throw new Error("Seat not found.");
  let next: RoomData;
  if (message.type === "room.ready") {
    if (room.phase !== "lobby") throw new Error("Lobby is closed.");
    next = {
      ...room,
      members: room.members.map((member, index) =>
        index === actorIndex ? { ...member, ready: message.ready } : member,
      ),
    };
  } else if (message.type === "room.start") {
    if (actorId !== room.hostId) throw new Error("Only the host can start.");
    if (
      room.members.length < 2 ||
      !room.members.every((member) => member.ready)
    )
      throw new Error("Everyone must be ready.");
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
        expiresAt: now + 10 * 60_000,
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
