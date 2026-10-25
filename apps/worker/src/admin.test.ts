import { describe, expect, it } from "vitest";
import { roomLive, roomReport, utcDay, winners } from "./admin.js";
import { addMember, applyAction, createLobby } from "./room-model.js";

const player = (nickname: string, score: number, left = false) => ({
  nickname,
  score,
  connected: !left,
  left,
  host: false,
});

describe("admin bookkeeping", () => {
  it("picks the top score, shares ties, and skips players who walked out", () => {
    expect(winners([player("Ada", 120), player("Lin", 90)])).toEqual(["Ada"]);
    expect(winners([player("Ada", 90), player("Lin", 90)])).toEqual([
      "Ada",
      "Lin",
    ]);
    expect(winners([player("Ada", 150, true), player("Lin", 40)])).toEqual([
      "Lin",
    ]);
  });
  it("reports rooms without tokens or racks", () => {
    let room = createLobby(
      "ABC234",
      "Host",
      "secret-hash",
      { boardSize: 15, capacity: 2, timerSeconds: 0 },
      0,
    );
    room = addMember(room, "Friend", "other-hash").room;
    const report = roomReport("room-1", room);
    expect(report).toMatchObject({
      kind: "state",
      roomCode: "ABC234",
      phase: "lobby",
      lastPlay: null,
    });
    expect(JSON.stringify(report)).not.toContain("hash");
    expect(utcDay(0)).toBe("1970-01-01");
  });
  it("summarises each seat's moves for the room page", () => {
    let room = createLobby(
      "ABC234",
      "Host",
      "one",
      { boardSize: 15, capacity: 2, timerSeconds: 0 },
      0,
    );
    room = addMember(room, "Friend", "two").room;
    const random = { nextInt: (max: number) => Math.max(0, max - 1) };
    const message = (type: "room.start" | "game.pass") => ({
      protocolVersion: 1 as const,
      type,
      actionId: crypto.randomUUID(),
      revision: room.revision,
    });
    room = applyAction(
      room,
      room.hostId,
      message("room.start"),
      random,
      () => new Map(),
    );
    room = applyAction(
      room,
      room.hostId,
      message("game.pass"),
      random,
      () => new Map(),
    );
    const live = roomLive(room, 1);
    expect(live.moves).toEqual([
      {
        turn: 1,
        nickname: "Host",
        kind: "pass",
        words: [],
        score: 0,
        tiles: 0,
      },
    ]);
    expect(live.seats[0]).toMatchObject({ passes: 1, plays: 0, rackCount: 7 });
    expect(live.currentPlayer).toBe("Friend");
    expect(JSON.stringify(live)).not.toContain('"rack"');
  });
});
