import { describe, expect, it } from "vitest";
import type {
  PublicLastMove,
  PublicRoom,
} from "@scrabble/game-engine/protocol";
import { roomNotices } from "./notices.js";

const base: PublicRoom = {
  roomCode: "ABC234",
  phase: "active",
  settings: { boardSize: 15, capacity: 2, timerSeconds: 0 },
  players: [
    {
      id: "ada",
      nickname: "Ada",
      score: 0,
      connected: true,
      rackCount: 7,
      host: true,
      left: false,
    },
    {
      id: "lin",
      nickname: "Lin",
      score: 0,
      connected: true,
      rackCount: 7,
      host: false,
      left: false,
    },
  ],
  board: [],
  bagRemaining: 86,
  currentPlayerId: "lin",
  turnNumber: 1,
  turnDeadline: null,
  revision: 3,
  expiresAt: 0,
  endReason: null,
  lastMove: null,
  history: [],
  challenge: null,
  locked: false,
};
const move = (extra: Partial<PublicLastMove>): PublicLastMove => ({
  playerId: "lin",
  kind: "rejected",
  words: [{ word: "KWA", score: 0 }],
  score: 0,
  tiles: 3,
  ...extra,
});

describe("room notices", () => {
  it("says nothing for the first snapshot", () => {
    expect(roomNotices(null, base, "ada")).toEqual([]);
  });
  it("tells everyone how a challenge was settled", () => {
    const approved = {
      ...base,
      history: [
        move({
          kind: "play",
          score: 12,
          challenge: { outcome: "approved", challenged: true },
        }),
      ],
    };
    expect(roomNotices(base, approved, "ada")).toEqual([
      {
        tone: "good",
        text: "You (host) approved KWA on challenge: Lin scores 12 points.",
      },
    ]);
    const expired = {
      ...base,
      history: [move({ challenge: { outcome: "expired", challenged: false } })],
    };
    const [notice] = roomNotices(base, expired, "lin");
    expect(notice?.tone).toBe("bad");
    expect(notice?.text).toMatch(/Time ran out.*your turn is lost/);
  });
  it("announces a challenge going to the host", () => {
    const challenge = {
      playerId: "lin",
      stage: "decide" as const,
      deadline: 1,
      rejected: ["KWA"],
      words: [],
      score: 0,
      placed: [],
      challengesLeft: 3,
    };
    const deciding = { ...base, challenge },
      reviewing = {
        ...base,
        challenge: { ...challenge, stage: "review" as const },
      };
    expect(roomNotices(deciding, reviewing, "lin")).toEqual([
      { tone: "info", text: "You challenged KWA. Ada will rule on it." },
    ]);
  });
  it("reports voice, lock, joins and leaves", () => {
    const lobby = {
      ...base,
      phase: "lobby" as const,
      players: [base.players[0]!],
    };
    expect(
      roomNotices(
        lobby,
        { ...lobby, locked: true, players: base.players },
        "ada",
      ).map((notice) => notice.text),
    ).toEqual([
      "Lin joined the room.",
      "The host locked the room. Nobody new can join.",
    ]);
    expect(
      roomNotices(
        base,
        { ...base, settings: { ...base.settings, voice: true } },
        "lin",
      )[0]?.text,
    ).toMatch(/voice chat on/);
  });
});
