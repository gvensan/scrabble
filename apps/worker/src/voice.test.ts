import { afterEach, describe, expect, it } from "vitest";
import { clientMessageSchema } from "@scrabble/game-engine/protocol";
import { addMember, createLobby, leaveRoom } from "./room-model.js";
import {
  iceServers,
  resetIceCache,
  STUN_SERVERS,
  voiceAllowed,
  voiceRoster,
} from "./voice.js";

const settings = {
  boardSize: 15,
  capacity: 3 as const,
  timerSeconds: 0 as const,
};
function room(voice: boolean) {
  let r = createLobby("ABC234", "Host", "one", { ...settings, voice }, 0);
  r = addMember(r, "Lin", "two").room;
  return addMember(r, "Kai", "three").room;
}

describe("voice chat", () => {
  afterEach(resetIceCache);
  it("is only open to seated players in rooms that turned it on", () => {
    const on = room(true),
      off = room(false),
      [host, lin] = on.members;
    expect(voiceAllowed(on, host!.id)).toBe(true);
    expect(voiceAllowed(on, "stranger")).toBe(false);
    expect(voiceAllowed(off, off.hostId)).toBe(false);
    const left = leaveRoom(on, lin!.id, 1);
    expect(left && voiceAllowed(left, lin!.id)).toBe(false);
  });
  it("lists one entry per player in voice and skips everyone else", () => {
    const r = room(true),
      [host, lin, kai] = r.members.map((member) => member.id);
    const roster = voiceRoster(r, [
      { playerId: host!, voice: { session: "session-a1", muted: false } },
      { playerId: lin!, voice: { session: "session-b1", muted: true } },
      { playerId: kai! },
      null,
      { playerId: "stranger", voice: { session: "session-c1", muted: false } },
      {
        playerId: lin!,
        left: true,
        voice: { session: "x".repeat(8), muted: false },
      },
    ]);
    expect(roster).toEqual([
      { playerId: host, session: "session-a1", muted: false },
      { playerId: lin, session: "session-b1", muted: true },
    ]);
    expect(
      voiceRoster(room(false), [
        { playerId: host!, voice: { session: "session-a1", muted: false } },
      ]),
    ).toEqual([]);
  });
  it("validates signals and caps their size", () => {
    const base = {
      protocolVersion: 1,
      type: "voice.signal",
      to: "player",
      session: "session-a1",
      toSession: "session-b1",
    };
    expect(
      clientMessageSchema.safeParse({
        ...base,
        description: { type: "offer", sdp: "v=0" },
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        ...base,
        description: { type: "offer", sdp: "x".repeat(20_000) },
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({ ...base, session: "bad session" })
        .success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        protocolVersion: 1,
        type: "voice.state",
        session: null,
        muted: false,
      }).success,
    ).toBe(true);
  });
  it("uses STUN alone until TURN is configured", async () => {
    let calls = 0;
    const fetcher = (() => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    expect(await iceServers({}, 0, fetcher)).toBe(STUN_SERVERS);
    expect(calls).toBe(0);
  });
  it("fetches, filters and caches TURN credentials", async () => {
    let calls = 0;
    const fetcher = (() => {
      calls += 1;
      return Promise.resolve(
        Response.json({
          iceServers: [
            {
              urls: [
                "stun:stun.cloudflare.com:3478",
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
              ],
              username: "u",
              credential: "c",
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const env = { TURN_KEY_ID: "key", TURN_KEY_API_TOKEN: "token" };
    const servers = await iceServers(env, 0, fetcher);
    expect(servers).toEqual([
      {
        urls: [
          "stun:stun.cloudflare.com:3478",
          "turn:turn.cloudflare.com:3478?transport=udp",
        ],
        username: "u",
        credential: "c",
      },
    ]);
    await iceServers(env, 60_000, fetcher);
    expect(calls).toBe(1);
  });
  it("falls back to STUN when TURN is unreachable", async () => {
    const fetcher = (() =>
      Promise.resolve(
        new Response("nope", { status: 500 }),
      )) as unknown as typeof fetch;
    expect(
      await iceServers(
        { TURN_KEY_ID: "key", TURN_KEY_API_TOKEN: "token" },
        0,
        fetcher,
      ),
    ).toBe(STUN_SERVERS);
  });
});
