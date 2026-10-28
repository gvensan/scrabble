import { describe, expect, it } from "vitest";
import {
  addMember,
  applyAction,
  CHALLENGE_MS,
  expireChallenge,
  MAX_CHALLENGES,
  createLobby,
  draftCells,
  EMPTY_LOBBY_MS,
  leaveRoom,
  markDisconnected,
  PENDING_TIMEOUT_MS,
  publicRoom,
  roomStatus,
  type RoomData,
} from "./room-model.js";

const random = { nextInt: (max: number) => Math.max(0, max - 1) };
const settings = {
  boardSize: 15,
  capacity: 2 as const,
  timerSeconds: 0 as const,
};
const lockMessage = (revision: number, locked: boolean) => ({
  protocolVersion: 1 as const,
  type: "room.lock" as const,
  actionId: crypto.randomUUID(),
  revision,
  locked,
});
const startMessage = (revision: number) => ({
  protocolVersion: 1 as const,
  type: "room.start" as const,
  actionId: crypto.randomUUID(),
  revision,
});

describe("room model", () => {
  it("allocates unique lobby seats and never serializes tokens or racks", () => {
    const lobby = createLobby("ABC234", "Host", "secret-hash", settings, 0),
      joined = addMember(lobby, "Friend", "other-hash");
    expect(joined.room.members).toHaveLength(2);
    const serialized = JSON.stringify(publicRoom(joined.room));
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).not.toContain('"rack"');
  });
  it("enforces two players, host start, revisions, and idempotency", () => {
    let room = createLobby("ABC234", "Host", "one", settings, 0);
    const host = room.hostId;
    expect(() =>
      applyAction(room, host, startMessage(0), random, () => new Map()),
    ).toThrow(/two players/i);
    room = addMember(room, "Friend", "two").room;
    const friend = room.members[1]!.id;
    expect(() =>
      applyAction(
        room,
        friend,
        startMessage(room.revision),
        random,
        () => new Map(),
      ),
    ).toThrow(/host/i);
    // A start sent before the host saw the latest join still succeeds.
    const start = startMessage(0);
    room = applyAction(room, host, start, random, () => new Map());
    expect(room.phase).toBe("active");
    expect(room.game?.players).toHaveLength(2);
    expect(applyAction(room, host, start, random, () => new Map())).toBe(room);
    expect(() =>
      applyAction(room, host, passMessage(0), random, () => new Map()),
    ).toThrow(/sync/i);
  });
  it("lets only the host lock the lobby against new players", () => {
    let room = createLobby(
      "ABC234",
      "Host",
      "one",
      { ...settings, capacity: 3 },
      0,
    );
    room = addMember(room, "Friend", "two").room;
    expect(() =>
      applyAction(
        room,
        room.members[1]!.id,
        lockMessage(room.revision, true),
        random,
        () => new Map(),
      ),
    ).toThrow(/host/i);
    room = applyAction(
      room,
      room.hostId,
      lockMessage(0, true),
      random,
      () => new Map(),
    );
    expect(publicRoom(room).locked).toBe(true);
    expect(() => addMember(room, "Late", "three")).toThrow(/locked/i);
    room = applyAction(
      room,
      room.hostId,
      lockMessage(room.revision, false),
      random,
      () => new Map(),
    );
    expect(addMember(room, "Late", "three").room.members).toHaveLength(3);
  });
  it("tells an invite link whether the room can be joined", () => {
    let room = createLobby("ABC234", "Host", "one", settings, 0);
    expect(roomStatus(room)).toEqual({
      joinable: true,
      reason: null,
      host: "Host",
    });
    expect(roomStatus({ ...room, locked: true }).reason).toBe("locked");
    room = addMember(room, "Friend", "two").room;
    expect(roomStatus(room).reason).toBe("full");
    expect(roomStatus(activeRoom(2)).reason).toBe("started");
  });
  it("rejects duplicate nicknames and over-capacity joins", () => {
    let room = createLobby("ABC234", "Host", "one", settings, 0);
    expect(() => addMember(room, "host", "two")).toThrow(/nickname/i);
    room = addMember(room, "Friend", "two").room;
    expect(() => addMember(room, "Third", "three")).toThrow(/full/i);
  });
  it("issues durable turn deadlines and blocks actions while validation is pending", () => {
    const timed = { ...settings, timerSeconds: 120 as const };
    let room = createLobby("ABC234", "Host", "one", timed, 0);
    room = addMember(room, "Friend", "two").room;
    room = applyAction(
      room,
      room.hostId,
      startMessage(room.revision),
      random,
      () => new Map(),
      1_000,
    );
    expect(room.turnDeadline).toBe(121_000);
    expect(() =>
      applyAction(
        {
          ...room,
          pending: {
            actionId: "pending",
            actorId: room.hostId,
            revision: room.revision,
            startedAt: 5_000,
          },
        },
        room.hostId,
        {
          protocolVersion: 1,
          type: "game.pass",
          actionId: crypto.randomUUID(),
          revision: room.revision,
        },
        random,
        () => new Map(),
        6_000,
      ),
    ).toThrow(/validated/i);
  });
  it("releases a validation reservation left behind by a lost check", () => {
    const room = activeRoom(3);
    const passed = applyAction(
      {
        ...room,
        pending: {
          actionId: "lost",
          actorId: room.hostId,
          revision: room.revision,
          startedAt: 5_000,
        },
      },
      room.hostId,
      passMessage(room.revision),
      random,
      () => new Map(),
      5_000 + PENDING_TIMEOUT_MS,
    );
    expect(passed.pending).toBeUndefined();
    expect(passed.game?.currentPlayerIndex).toBe(1);
  });
  it("publishes the last move and who left", () => {
    let room = activeRoom(3);
    room = applyAction(
      room,
      room.hostId,
      passMessage(room.revision),
      random,
      () => new Map(),
    );
    const leaver = room.members[2]!.id;
    room = leaveRoom(room, leaver, 10_000)!;
    const view = publicRoom(room);
    expect(view.lastMove).toMatchObject({
      playerId: room.hostId,
      kind: "pass",
      score: 0,
    });
    expect(view.players.find((player) => player.id === leaver)?.left).toBe(
      true,
    );
    expect(room.phase).toBe("active");
    expect(room.disconnectDeadlines[leaver]).toBe(10_000);
  });
  it("ends an active game once fewer than two players remain", () => {
    const room = activeRoom(2);
    const ended = leaveRoom(room, room.members[1]!.id, 10_000)!;
    expect(ended.phase).toBe("results");
    expect(ended.resultReason).toBe("players-left");
    expect(ended.turnDeadline).toBeNull();
    expect(ended.revision).toBe(room.revision + 1);
  });
  it("suspends an active room when the last connected player leaves", () => {
    let room = activeRoom(3, 120);
    room = {
      ...room,
      turnDeadline: 70_000,
      members: room.members.map((member, index) => ({
        ...member,
        connected: index === 0,
      })),
    };
    const left = leaveRoom(room, room.hostId, 10_000)!;
    expect(left.phase).toBe("active");
    expect(left.turnDeadline).toBeNull();
    expect(left.remainingTurnMs).toBe(60_000);
    expect(left.emptyExpiresAt).toBe(10_000 + 15 * 60_000);
  });
  it("starts a grace period and suspends when everyone disconnects", () => {
    let room = activeRoom(2, 120);
    room = {
      ...room,
      turnDeadline: 50_000,
      members: room.members.map((member) => ({ ...member, connected: true })),
    };
    const first = markDisconnected(room, room.members[0]!.id, 10_000);
    expect(first.disconnectDeadlines[room.members[0]!.id]).toBe(190_000);
    expect(first.turnDeadline).toBe(50_000);
    const both = markDisconnected(first, room.members[1]!.id, 20_000);
    expect(both.turnDeadline).toBeNull();
    expect(both.remainingTurnMs).toBe(30_000);
  });
  it("closes an unstarted room soon after everyone disconnects", () => {
    let room = addMember(
      createLobby("ABC234", "Host", "one", settings, 0),
      "Friend",
      "two",
    ).room;
    room = {
      ...room,
      members: room.members.map((member) => ({ ...member, connected: true })),
    };
    room = markDisconnected(room, room.members[0]!.id, 10_000);
    expect(room.emptyExpiresAt).toBeNull();
    room = markDisconnected(room, room.members[1]!.id, 20_000);
    expect(room.emptyExpiresAt).toBe(20_000 + EMPTY_LOBBY_MS);
  });
  it("hands a lobby to a connected player and deletes an empty lobby", () => {
    let room = createLobby(
      "ABC234",
      "Host",
      "one",
      { ...settings, capacity: 3 },
      0,
    );
    room = addMember(room, "Away", "two").room;
    room = addMember(room, "Here", "three").room;
    room = {
      ...room,
      members: room.members.map((member) => ({
        ...member,
        connected: member.nickname === "Here",
      })),
    };
    const next = leaveRoom(room, room.hostId, 0)!;
    expect(
      next.members.find((member) => member.id === next.hostId)?.nickname,
    ).toBe("Here");
    const solo = createLobby("ABC234", "Host", "one", settings, 0);
    expect(leaveRoom(solo, solo.hostId, 0)).toBeNull();
  });
  it("seats more than four, as many as the board's bag allows", () => {
    let room = createLobby(
      "ABC234",
      "Host",
      "h",
      { ...settings, capacity: 8 },
      0,
    );
    for (let i = 2; i <= 7; i += 1)
      room = addMember(room, `P${i}`, `t${i}`).room;
    expect(room.members).toHaveLength(7);
    expect(() => addMember(room, "P8", "t8")).toThrow(/full/i);
    const bigger = applyAction(
      room,
      room.hostId,
      {
        protocolVersion: 1,
        type: "room.settings",
        actionId: crypto.randomUUID(),
        revision: room.revision,
        settings: { boardSize: 21, capacity: 8, timerSeconds: 0 },
      },
      random,
      () => new Map(),
    );
    room = addMember(bigger, "P8", "t8").room;
    expect(room.members).toHaveLength(8);
    expect(() =>
      applyAction(
        room,
        room.hostId,
        {
          protocolVersion: 1,
          type: "room.settings",
          actionId: crypto.randomUUID(),
          revision: room.revision,
          settings: { boardSize: 15, capacity: 8, timerSeconds: 0 },
        },
        random,
        () => new Map(),
      ),
    ).toThrow(/at most 7/);
    const started = applyAction(
      room,
      room.hostId,
      startMessage(room.revision),
      random,
      () => new Map(),
    );
    expect(started.game?.players).toHaveLength(8);
  });
  it("lets only the host change settings, in the lobby, never below the roster", () => {
    const change = (
      next: {
        boardSize: number;
        capacity: 2 | 3 | 4;
        timerSeconds: 0 | 120 | 300;
      },
      revision = 0,
    ) => ({
      protocolVersion: 1 as const,
      type: "room.settings" as const,
      actionId: crypto.randomUUID(),
      revision,
      settings: next,
    });
    let room = createLobby(
      "ABC234",
      "Host",
      "one",
      { ...settings, capacity: 3 },
      0,
    );
    room = addMember(room, "Friend", "two").room;
    room = addMember(room, "Third", "three").room;
    const friend = room.members[1]!.id;
    expect(() =>
      applyAction(room, friend, change(settings), random, () => new Map()),
    ).toThrow(/host/i);
    expect(() =>
      applyAction(room, room.hostId, change(settings), random, () => new Map()),
    ).toThrow(/at least 3 seats/i);
    const changed = applyAction(
      room,
      room.hostId,
      change({ boardSize: 21, capacity: 4, timerSeconds: 120 }),
      random,
      () => new Map(),
    );
    expect(changed.settings).toMatchObject({
      boardSize: 21,
      capacity: 4,
      timerSeconds: 120,
    });
    expect(changed.revision).toBe(room.revision + 1);
    expect(
      applyAction(
        changed,
        changed.hostId,
        change({ boardSize: 21, capacity: 4, timerSeconds: 120 }),
        random,
        () => new Map(),
      ).revision,
    ).toBe(changed.revision);
    const started = applyAction(
      changed,
      changed.hostId,
      startMessage(changed.revision),
      random,
      () => new Map(),
    );
    expect(started.game?.board).toHaveLength(21);
    expect(() =>
      applyAction(
        started,
        started.hostId,
        change(settings),
        random,
        () => new Map(),
      ),
    ).toThrow(/before the game starts/i);
  });
  it("lets only the host switch voice chat, mid-game and from any revision", () => {
    const room = activeRoom(2),
      friend = room.members[1]!.id,
      voice = (enabled: boolean, revision = 0) => ({
        protocolVersion: 1 as const,
        type: "room.voice" as const,
        actionId: crypto.randomUUID(),
        revision,
        enabled,
      });
    expect(() =>
      applyAction(
        room,
        friend,
        voice(true, room.revision),
        random,
        () => new Map(),
      ),
    ).toThrow(/host/i);
    const on = applyAction(
      room,
      room.hostId,
      voice(true),
      random,
      () => new Map(),
    );
    expect(on.settings.voice).toBe(true);
    expect(on.phase).toBe("active");
    expect(on.game).toBe(room.game);
    expect(on.revision).toBe(room.revision + 1);
    expect(
      applyAction(on, on.hostId, voice(true), random, () => new Map()).revision,
    ).toBe(on.revision);
    const off = applyAction(
      on,
      on.hostId,
      voice(false),
      random,
      () => new Map(),
    );
    expect(off.settings.voice).toBe(false);
  });
  it("lets only the host end the game early, from any revision", () => {
    const room = activeRoom(2),
      friend = room.members[1]!.id,
      end = (revision: number) => ({
        protocolVersion: 1 as const,
        type: "game.end" as const,
        actionId: crypto.randomUUID(),
        revision,
      });
    expect(() =>
      applyAction(room, friend, end(room.revision), random, () => new Map()),
    ).toThrow(/host/i);
    const ended = applyAction(
      room,
      room.hostId,
      end(0),
      random,
      () => new Map(),
    );
    expect(ended.phase).toBe("results");
    expect(publicRoom(ended).endReason).toBe("ended-early");
    expect(() =>
      applyAction(
        ended,
        ended.hostId,
        end(ended.revision),
        random,
        () => new Map(),
      ),
    ).toThrow(/not active/i);
  });
  it("relays live drafts from the current player's own rack only", () => {
    const room = activeRoom(2),
      friend = room.members[1]!.id,
      [first, second] = room.game!.players[0]!.rack;
    expect(
      draftCells(room, friend, [{ row: 7, col: 7, tileId: first!.id }]),
    ).toBeNull();
    const relayed = draftCells(room, room.hostId, [
      { row: 7, col: 7, tileId: first!.id },
      { row: 7, col: 7, tileId: second!.id },
      { row: 7, col: 8, tileId: first!.id },
      { row: 7, col: 9, tileId: "forged" },
      { row: 99, col: 0, tileId: second!.id },
      { row: 7, col: 8, tileId: second!.id },
    ]);
    expect(relayed).toEqual([
      { row: 7, col: 7, letter: first!.letter, value: first!.value },
      { row: 7, col: 8, letter: second!.letter, value: second!.value },
    ]);
    expect(JSON.stringify(relayed)).not.toContain(first!.id);
  });
  it("timestamps moves and shares history without tile ids", () => {
    const room = activeRoom(2),
      passed = applyAction(
        room,
        room.hostId,
        passMessage(room.revision),
        random,
        () => new Map(),
        5_000,
      ),
      view = publicRoom(passed);
    expect(view.startedAt).toBe(1_000);
    expect(view.history).toEqual([
      expect.objectContaining({ kind: "pass", score: 0, at: 5_000 }),
    ]);
  });
  it("pauses a rejected play until the player accepts it", () => {
    const room = activeRoom(2, 120),
      paused = applyAction(
        room,
        room.hostId,
        playMessage(room),
        random,
        rejectAll,
        5_000,
      );
    expect(paused.challenge).toMatchObject({
      playerId: room.hostId,
      stage: "decide",
      deadline: 5_000 + CHALLENGE_MS,
    });
    expect(paused.turnDeadline).toBeNull();
    expect(paused.game).toBe(room.game);
    const view = publicRoom(paused);
    expect(view.challenge?.challengesLeft).toBe(MAX_CHALLENGES);
    expect(view.challenge?.placed).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain("tileId");
    const friend = room.members[1]!.id;
    expect(() =>
      applyAction(
        paused,
        friend,
        passMessage(paused.revision),
        random,
        rejectAll,
      ),
    ).toThrow(/settled/);
    expect(() =>
      applyAction(paused, friend, settle("game.accept"), random, rejectAll),
    ).toThrow(/rejected can/);
    const accepted = applyAction(
      paused,
      room.hostId,
      settle("game.accept"),
      random,
      rejectAll,
      9_000,
    );
    expect(accepted.challenge).toBeNull();
    expect(accepted.game!.currentPlayerIndex).toBe(1);
    expect(accepted.turnDeadline).toBe(9_000 + 120_000);
    expect(publicRoom(accepted).lastMove).toMatchObject({
      kind: "rejected",
      score: 0,
      challenge: { outcome: "accepted", challenged: false },
    });
  });
  it("lets the host approve a challenged word, including their own", () => {
    const room = activeRoom(2),
      paused = applyAction(
        room,
        room.hostId,
        playMessage(room),
        random,
        rejectAll,
      ),
      friend = room.members[1]!.id;
    expect(() =>
      applyAction(paused, room.hostId, rule(true), random, rejectAll),
    ).toThrow(/not been challenged/);
    const challenged = applyAction(
      paused,
      room.hostId,
      settle("game.challenge"),
      random,
      rejectAll,
      2_000,
    );
    expect(challenged.challenge).toMatchObject({
      stage: "review",
      deadline: 2_000 + CHALLENGE_MS,
    });
    expect(publicRoom(challenged).challenge?.challengesLeft).toBe(
      MAX_CHALLENGES - 1,
    );
    expect(() =>
      applyAction(challenged, friend, rule(true), random, rejectAll),
    ).toThrow(/host/);
    const approved = applyAction(
      challenged,
      room.hostId,
      rule(true),
      random,
      rejectAll,
    );
    expect(approved.challenge).toBeNull();
    expect(approved.game!.lastMove).toMatchObject({
      kind: "play",
      challenge: { outcome: "approved", challenged: true },
    });
    expect(approved.game!.players[0]!.score).toBeGreaterThan(0);
    expect(approved.approvedWords).toEqual(paused.challenge!.rejected);
  });
  it("keeps the rejection when the host rules against it or time runs out", () => {
    const room = activeRoom(2),
      paused = applyAction(
        room,
        room.hostId,
        playMessage(room),
        random,
        rejectAll,
        0,
      ),
      challenged = applyAction(
        paused,
        room.hostId,
        settle("game.challenge"),
        random,
        rejectAll,
        0,
      );
    const ruled = applyAction(
      challenged,
      room.hostId,
      rule(false),
      random,
      rejectAll,
    );
    expect(ruled.game!.lastMove).toMatchObject({
      kind: "rejected",
      challenge: { outcome: "rejected", challenged: true },
    });
    expect(expireChallenge(paused, CHALLENGE_MS - 1)).toBe(paused);
    const expired = expireChallenge(paused, CHALLENGE_MS);
    expect(expired.revision).toBe(paused.revision + 1);
    expect(expired.challenge).toBeNull();
    expect(expired.game!.lastMove).toMatchObject({
      kind: "rejected",
      challenge: { outcome: "expired", challenged: false },
    });
  });
  it("allows three challenges per player", () => {
    const room = activeRoom(2),
      paused = {
        ...applyAction(room, room.hostId, playMessage(room), random, rejectAll),
        challengesUsed: { [room.hostId]: MAX_CHALLENGES },
      };
    expect(publicRoom(paused).challenge?.challengesLeft).toBe(0);
    expect(() =>
      applyAction(
        paused,
        room.hostId,
        settle("game.challenge"),
        random,
        rejectAll,
      ),
    ).toThrow(/all 3 challenges/);
  });
});
const rejectAll = (words: readonly string[]) =>
  new Map(words.map((word) => [word, false]));
function playMessage(room: RoomData) {
  const [first, second] = room.game!.players[0]!.rack.filter(
    (tile) => tile.letter !== null,
  );
  return {
    protocolVersion: 1 as const,
    type: "game.play" as const,
    actionId: crypto.randomUUID(),
    revision: room.revision,
    placements: [
      { tileId: first!.id, row: 7, col: 7 },
      { tileId: second!.id, row: 7, col: 8 },
    ],
  };
}
function settle(type: "game.accept" | "game.challenge") {
  return {
    protocolVersion: 1 as const,
    type,
    actionId: crypto.randomUUID(),
    revision: 0,
  };
}
function rule(approve: boolean) {
  return {
    protocolVersion: 1 as const,
    type: "game.rule" as const,
    actionId: crypto.randomUUID(),
    revision: 0,
    approve,
  };
}
function passMessage(revision: number) {
  return {
    protocolVersion: 1 as const,
    type: "game.pass" as const,
    actionId: crypto.randomUUID(),
    revision,
  };
}
function activeRoom(players: 2 | 3 | 4, timerSeconds: 0 | 120 = 0): RoomData {
  let room = createLobby(
    "ABC234",
    "Host",
    "token-0",
    { ...settings, capacity: players, timerSeconds },
    0,
  );
  for (let index = 1; index < players; index += 1)
    room = addMember(room, `Friend${index}`, `token-${index}`).room;
  return applyAction(
    room,
    room.hostId,
    startMessage(room.revision),
    random,
    () => new Map(),
    1_000,
  );
}
