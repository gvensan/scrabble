import {
  createGame,
  endGame,
  maxPlayersFor,
  seatsFor,
  exchangeTiles,
  isLetter,
  passTurn,
  playMove,
  stampMoves,
  withChallenge,
  type GameState,
  type LastMove,
  type MoveTile,
  type Placement,
  type RandomSource,
  type WordValidator,
} from "@scrabble/game-engine";
import type {
  ClientMessage,
  PublicLastMove,
  PublicRoom,
  RoomStatus,
} from "@scrabble/game-engine/protocol";

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
    /** 8 is "4+": as many as the board allows, up to eight. */
    capacity: 2 | 3 | 4 | 8;
    timerSeconds: 0 | 120 | 300;
    voice?: boolean | undefined;
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
  /** Set by the host in the lobby to stop new players joining. */
  locked?: boolean;
  pending?: {
    actionId: string;
    actorId: string;
    revision: number;
    startedAt?: number;
  };
  /** A play the dictionary refused; the game waits until it is settled. */
  challenge?: Challenge | null;
  /** Challenges each player has made this game, by player id. */
  challengesUsed?: Record<string, number>;
  /** Words the host approved on a challenge; valid for the rest of the game. */
  approvedWords?: string[];
}
export interface Challenge {
  playerId: string;
  stage: "decide" | "review";
  deadline: number;
  /** The play as submitted. Tile ids stay on the server. */
  placements: Placement[];
  rejected: string[];
  words: { word: string; score: number }[];
  score: number;
  placed: MoveTile[];
}
/** Time to accept or challenge, and then for the host to rule. */
export const CHALLENGE_MS = 60_000;
export const MAX_CHALLENGES = 3;
/** A dictionary check never takes this long; an older reservation is stale. */
export const PENDING_TIMEOUT_MS = 30_000;
export const DISCONNECT_GRACE_MS = 3 * 60_000;
const EMPTY_ROOM_MS = 15 * 60_000;
/** An unstarted room nobody is connected to closes sooner. */
export const EMPTY_LOBBY_MS = 3 * 60_000;
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
    emptyExpiresAt:
      room.emptyExpiresAt ??
      now + (room.phase === "lobby" ? EMPTY_LOBBY_MS : EMPTY_ROOM_MS),
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
          : room.members.length >=
              seatsFor(room.settings.capacity, room.settings.boardSize)
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
  if (
    room.members.length >=
    seatsFor(room.settings.capacity, room.settings.boardSize)
  )
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
function publicMove(room: RoomData, move: LastMove): PublicLastMove {
  return {
    playerId: room.members[move.playerIndex]?.id ?? null,
    kind: move.kind,
    words: move.words.map(({ word, score }) => ({ word, score })),
    score: move.score,
    tiles: move.tiles,
    ...(move.placed === undefined
      ? {}
      : {
          placed: move.placed.map((tile) => ({
            row: tile.row,
            col: tile.col,
            letter: tile.letter,
            value: tile.value,
            ...(tile.blankAs === undefined ? {} : { blankAs: tile.blankAs }),
          })),
        }),
    ...(move.at === undefined ? {} : { at: move.at }),
    ...(move.took === undefined ? {} : { took: move.took }),
    ...(move.challenge === undefined
      ? {}
      : {
          challenge: {
            outcome: move.challenge.outcome,
            challenged: move.challenge.challenged,
          },
        }),
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
    lastMove: game?.lastMove ? publicMove(room, game.lastMove) : null,
    history: (game?.history ?? []).map((move) => publicMove(room, move)),
    startedAt: game?.startedAt ?? null,
    scorelessTurns: game?.scorelessTurns ?? 0,
    challenge:
      room.phase === "active" && room.challenge
        ? {
            playerId: room.challenge.playerId,
            stage: room.challenge.stage,
            deadline: room.challenge.deadline,
            rejected: room.challenge.rejected,
            words: room.challenge.words,
            score: room.challenge.score,
            placed: room.challenge.placed.map((tile) => ({
              row: tile.row,
              col: tile.col,
              letter: tile.letter,
              value: tile.value,
              ...(tile.blankAs === undefined ? {} : { blankAs: tile.blankAs }),
            })),
            challengesLeft: Math.max(
              0,
              MAX_CHALLENGES -
                (room.challengesUsed?.[room.challenge.playerId] ?? 0),
            ),
          }
        : null,
    locked: room.locked === true,
  };
}
export function applyAction(
  room: RoomData,
  actorId: string,
  message: Exclude<
    ClientMessage,
    { type: "sync.request" | "game.draft" | "voice.state" | "voice.signal" }
  >,
  random: RandomSource,
  validator: WordValidator,
  now = Date.now(),
): RoomData {
  if (message.type === "room.leave")
    throw new Error("Room control messages are handled by the session.");
  if (room.actionIds.includes(message.actionId)) return room;
  if (room.pending && now - (room.pending.startedAt ?? 0) < PENDING_TIMEOUT_MS)
    throw new Error("A word is already being validated.");
  room = withoutPending(room);
  // Lock is an explicit on/off value and start re-checks the roster, so a
  // concurrent join must not reject them; game moves need the exact state.
  // Ending early applies to whatever state the game has reached.
  if (
    message.revision !== room.revision &&
    message.type !== "room.lock" &&
    message.type !== "room.voice" &&
    message.type !== "room.settings" &&
    message.type !== "room.start" &&
    message.type !== "game.end" &&
    // Settling a challenge is checked against the challenge itself, so a
    // voice toggle or a reconnect at the same moment must not refuse it.
    message.type !== "game.accept" &&
    message.type !== "game.challenge" &&
    message.type !== "game.rule"
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
  } else if (message.type === "room.voice") {
    if (actorId !== room.hostId)
      throw new Error("Only the host can change voice chat.");
    if ((room.settings.voice === true) === message.enabled) return room;
    next = {
      ...room,
      settings: { ...room.settings, voice: message.enabled },
    };
  } else if (message.type === "room.settings") {
    if (room.phase !== "lobby")
      throw new Error("Settings can only change before the game starts.");
    if (actorId !== room.hostId)
      throw new Error("Only the host can change the room settings.");
    // An explicit full value, so a join at the same moment cannot make it
    // stale; only the seat count depends on who is here.
    if (message.settings.capacity < room.members.length)
      throw new Error(
        `${room.members.length} players are already here, so the room needs at least ${room.members.length} seats.`,
      );
    const most = maxPlayersFor(message.settings.boardSize);
    if (room.members.length > most)
      throw new Error(
        `${room.members.length} players are already here, and a ${message.settings.boardSize}×${message.settings.boardSize} board has tiles for at most ${most}. Choose a bigger board.`,
      );
    const { boardSize, capacity, timerSeconds } = message.settings;
    if (
      boardSize === room.settings.boardSize &&
      capacity === room.settings.capacity &&
      timerSeconds === room.settings.timerSeconds
    )
      return room;
    next = {
      ...room,
      settings: { ...room.settings, boardSize, capacity, timerSeconds },
    };
  } else if (message.type === "room.start") {
    if (actorId !== room.hostId) throw new Error("Only the host can start.");
    if (room.members.length < 2)
      throw new Error("At least two players are needed to start.");
    const game = {
      ...createGame(
        {
          boardSize: room.settings.boardSize,
          timerSeconds: room.settings.timerSeconds,
        },
        room.members.map((member) => member.nickname),
        random,
      ),
      startedAt: now,
      turnStartedAt: now,
    };
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
    const game = room.game,
      challenge = room.challenge ?? null;
    if (message.type === "game.end") {
      if (actorId !== room.hostId)
        throw new Error("Only the host can end the game.");
      next = finishMove(
        room,
        { ...room, challenge: null, game: endGame(game) },
        now,
      );
    } else if (
      message.type === "game.accept" ||
      message.type === "game.challenge" ||
      message.type === "game.rule"
    ) {
      if (!challenge) throw new Error("There is no rejected word to settle.");
      if (message.type === "game.rule") {
        if (actorId !== room.hostId)
          throw new Error("Only the host can rule on a challenge.");
        if (challenge.stage !== "review")
          throw new Error("That word has not been challenged.");
        next = settleChallenge(
          room,
          message.approve ? "approved" : "rejected",
          now,
        );
      } else {
        if (actorId !== challenge.playerId)
          throw new Error(
            "Only the player whose word was rejected can do that.",
          );
        if (challenge.stage !== "decide")
          throw new Error("The challenge is already with the host.");
        if (message.type === "game.accept")
          next = settleChallenge(room, "accepted", now);
        else {
          const used = room.challengesUsed?.[actorId] ?? 0;
          if (used >= MAX_CHALLENGES)
            throw new Error(
              `You have used all ${MAX_CHALLENGES} challenges this game.`,
            );
          next = {
            ...room,
            challenge: {
              ...challenge,
              stage: "review",
              deadline: now + CHALLENGE_MS,
            },
            challengesUsed: { ...room.challengesUsed, [actorId]: used + 1 },
          };
        }
      }
    } else {
      if (challenge)
        throw new Error("Waiting for the rejected word to be settled.");
      if (game.currentPlayerIndex !== actorIndex)
        throw new Error("It is not your turn.");
      if (message.type === "game.pass")
        next = finishMove(room, { ...room, game: passTurn(game) }, now);
      else if (message.type === "game.exchange") {
        const result = exchangeTiles(game, message.tileIds, random);
        if (!result.ok) throw new Error(result.error);
        next = finishMove(room, { ...room, game: result.state }, now);
      } else {
        const placements = message.placements as readonly Placement[],
          approved = new Set(room.approvedWords ?? []),
          result = playMove(game, placements, (words) => {
            const validity = new Map(validator(words));
            for (const word of words)
              if (approved.has(word)) validity.set(word, true);
            return validity;
          });
        if (!result.ok) throw new Error(result.error);
        if (result.rejected) {
          // Pause for the player to accept or challenge; nothing moves yet.
          const ideal = playMove(
            game,
            placements,
            (words) => new Map(words.map((word) => [word, true])),
          );
          next = {
            ...room,
            turnDeadline: null,
            challenge: {
              playerId: actorId,
              stage: "decide",
              deadline: now + CHALLENGE_MS,
              placements: [...placements],
              rejected: [...result.rejected],
              words: ideal.ok ? [...ideal.words] : [],
              score: ideal.ok ? ideal.score : 0,
              placed: ideal.ok ? [...(ideal.state.lastMove?.placed ?? [])] : [],
            },
          };
        } else next = finishMove(room, { ...room, game: result.state }, now);
      }
    }
  }
  return {
    ...next,
    revision: room.revision + 1,
    actionIds: [...room.actionIds.slice(-199), message.actionId],
  };
}
/** Stamps the move and starts the next turn's clock, or ends the game. */
function finishMove(room: RoomData, next: RoomData, now: number): RoomData {
  if (!room.game || !next.game) return next;
  const game = stampMoves(room.game, next.game, now);
  if (game.phase === "results")
    return {
      ...next,
      game,
      challenge: null,
      phase: "results",
      expiresAt: now + RESULTS_MS,
      turnDeadline: null,
      resultReason: game.endReason,
    };
  return {
    ...next,
    game,
    turnDeadline:
      room.settings.timerSeconds === 0
        ? null
        : now + room.settings.timerSeconds * 1000,
  };
}
/**
 * Ends a paused rejected play. Approved: it is played as if the dictionary
 * had accepted it, and its words stay valid for the rest of the game.
 * Otherwise the turn is lost and the tiles stay on the rack.
 */
export function settleChallenge(
  room: RoomData,
  outcome: "accepted" | "approved" | "rejected" | "expired",
  now: number,
): RoomData {
  const challenge = room.challenge,
    game = room.game;
  if (!challenge || !game) return room;
  const rejected = new Set(challenge.rejected),
    approve = outcome === "approved",
    result = playMove(
      game,
      challenge.placements,
      (words) =>
        new Map(words.map((word) => [word, approve || !rejected.has(word)])),
    );
  // The board and racks are frozen while a challenge is open, so the play
  // is still legal; were it not, the turn is simply lost.
  const tagged = withChallenge(result.ok ? result.state : passTurn(game), {
    outcome: result.ok || !approve ? outcome : "rejected",
    challenged: challenge.stage === "review",
  });
  return finishMove(
    room,
    {
      ...room,
      game: tagged,
      challenge: null,
      approvedWords: approve
        ? [...new Set([...(room.approvedWords ?? []), ...challenge.rejected])]
        : (room.approvedWords ?? []),
    },
    now,
  );
}
/** The rejection stands when nobody acts in time; used by the room alarm. */
export function expireChallenge(room: RoomData, now: number): RoomData {
  if (!room.challenge || room.challenge.deadline > now) return room;
  return {
    ...settleChallenge(room, "expired", now),
    revision: room.revision + 1,
  };
}
/**
 * Checks a live draft from the player whose turn it is and returns the tiles
 * to relay to everyone else, or null to drop it. Letters and values come from
 * the player's own rack, so a draft cannot show tiles they do not hold, and
 * tile ids never leave the server. Only empty in-bounds squares pass, each
 * square and tile once. Nothing is stored; clients drop it when the turn ends.
 */
export function draftCells(
  room: RoomData,
  playerId: string,
  cells: readonly {
    row: number;
    col: number;
    tileId: string;
    blankAs?: string | undefined;
  }[],
): MoveTile[] | null {
  const game = room.game;
  if (room.phase !== "active" || !game) return null;
  if (room.members[game.currentPlayerIndex]?.id !== playerId) return null;
  const rack = new Map(
      game.players[game.currentPlayerIndex]?.rack.map((tile) => [
        tile.id,
        tile,
      ]),
    ),
    squares = new Set<string>(),
    used = new Set<string>(),
    relayed: MoveTile[] = [];
  for (const { row, col, tileId, blankAs } of cells) {
    const key = `${row}:${col}`,
      tile = rack.get(tileId);
    // Off-board squares read as undefined and filled ones as a tile.
    if (
      !tile ||
      squares.has(key) ||
      used.has(tileId) ||
      game.board[row]?.[col]?.tile !== null
    )
      continue;
    squares.add(key);
    used.add(tileId);
    relayed.push({
      row,
      col,
      letter: tile.letter,
      value: tile.value,
      ...(tile.letter === null && blankAs && isLetter(blankAs)
        ? { blankAs }
        : {}),
    });
  }
  return relayed;
}
