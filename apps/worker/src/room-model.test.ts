import { describe, expect, it } from "vitest";
import {
  addMember,
  applyAction,
  createLobby,
  leaveRoom,
  markDisconnected,
  PENDING_TIMEOUT_MS,
  publicRoom,
  recordRematch,
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
  it("records one shared rematch code after the game ends", () => {
    const room = activeRoom(2);
    expect(() => recordRematch(room, room.hostId, "XYZ789")).toThrow(
      /running/i,
    );
    const ended: RoomData = { ...room, phase: "results" };
    const first = recordRematch(ended, ended.members[1]!.id, "XYZ789");
    expect(publicRoom(first).rematchCode).toBe("XYZ789");
    expect(recordRematch(first, ended.hostId, "QRS234")).toBe(first);
    expect(() => recordRematch(ended, "stranger", "XYZ789")).toThrow(/seat/i);
  });
});
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
