import { describe, expect, it } from "vitest";
import {
  addMember,
  applyAction,
  createLobby,
  publicRoom,
} from "./room-model.js";

const random = { nextInt: (max: number) => Math.max(0, max - 1) };
const settings = {
  boardSize: 15,
  capacity: 2 as const,
  timerSeconds: 0 as const,
};
const readyMessage = (revision: number, ready: boolean) => ({
  protocolVersion: 1 as const,
  type: "room.ready" as const,
  actionId: crypto.randomUUID(),
  revision,
  ready,
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
  it("enforces readiness, host start, revisions, and idempotency", () => {
    let room = createLobby("ABC234", "Host", "one", settings, 0);
    room = addMember(room, "Friend", "two").room;
    const host = room.hostId,
      friend = room.members[1]!.id;
    room = applyAction(
      room,
      host,
      readyMessage(room.revision, true),
      random,
      () => new Map(),
    );
    room = applyAction(
      room,
      friend,
      readyMessage(room.revision, true),
      random,
      () => new Map(),
    );
    const start = startMessage(room.revision);
    room = applyAction(room, host, start, random, () => new Map());
    expect(room.phase).toBe("active");
    expect(room.game?.players).toHaveLength(2);
    expect(applyAction(room, host, start, random, () => new Map())).toBe(room);
    expect(() =>
      applyAction(room, friend, readyMessage(0, true), random, () => new Map()),
    ).toThrow(/sync/i);
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
      readyMessage(room.revision, true),
      random,
      () => new Map(),
      1_000,
    );
    room = applyAction(
      room,
      room.members[1]!.id,
      readyMessage(room.revision, true),
      random,
      () => new Map(),
      1_000,
    );
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
      ),
    ).toThrow(/validated/i);
  });
});
