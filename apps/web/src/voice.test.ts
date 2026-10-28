import { describe, expect, it } from "vitest";
import { isVoiceMessage, rms, speakingAt } from "./voice.js";

describe("voice helpers", () => {
  it("measures loudness", () => {
    expect(rms(new Float32Array(8))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
  it("keeps a name lit briefly after the voice drops", () => {
    const loudAt = new Map([
      ["ada", 1_000],
      ["lin", 400],
    ]);
    expect([...speakingAt(loudAt, 1_200)]).toEqual(["ada"]);
    expect(speakingAt(loudAt, 2_000).size).toBe(0);
  });
  it("accepts well-formed voice messages only", () => {
    expect(
      isVoiceMessage({
        type: "voice.roster",
        peers: [{ playerId: "a", session: "abcdef123456", muted: false }],
      }),
    ).toBe(true);
    expect(
      isVoiceMessage({
        type: "voice.roster",
        peers: [{ playerId: "a", session: "no", muted: false }],
      }),
    ).toBe(false);
    expect(
      isVoiceMessage({
        type: "voice.signal",
        from: "a",
        session: "abcdef123456",
        toSession: "123456abcdef",
        description: { type: "offer", sdp: "v=0" },
      }),
    ).toBe(true);
    expect(
      isVoiceMessage({
        type: "voice.signal",
        from: "a",
        session: "abcdef123456",
        toSession: "123456abcdef",
        description: { type: "rollback", sdp: "" },
      }),
    ).toBe(false);
    expect(
      isVoiceMessage({
        type: "voice.config",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      }),
    ).toBe(true);
    expect(isVoiceMessage({ type: "room.snapshot" })).toBe(false);
  });
});
