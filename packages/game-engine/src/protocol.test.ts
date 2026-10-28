import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  createRoomSchema,
  roomCodeSchema,
} from "./protocol.js";

describe("protocol schemas", () => {
  it("normalizes bounded room inputs", () => {
    const parsed = createRoomSchema.parse({
      nickname: "  Ada  ",
      settings: { boardSize: 15, capacity: 2, timerSeconds: 120 },
    });
    expect(parsed.nickname).toBe("Ada");
    expect(roomCodeSchema.parse("abc234")).toBe("ABC234");
  });
  it.each([
    {
      nickname: "<script>",
      settings: { boardSize: 15, capacity: 2, timerSeconds: 0 },
    },
    {
      nickname: "Ada",
      settings: { boardSize: 41, capacity: 2, timerSeconds: 0 },
    },
    {
      nickname: "Ada",
      // Seats are 2, 3, 4 or 8 ("4+"), nothing in between.
      settings: { boardSize: 15, capacity: 5, timerSeconds: 0 },
    },
  ])("rejects malformed room input %#", (input) =>
    expect(createRoomSchema.safeParse(input).success).toBe(false),
  );
  it("rejects forged and oversized gameplay payloads", () => {
    const base = {
      protocolVersion: 1,
      type: "game.play",
      actionId: crypto.randomUUID(),
      revision: 0,
    };
    expect(
      clientMessageSchema.safeParse({ ...base, placements: [] }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        ...base,
        placements: Array.from({ length: 8 }, (_, index) => ({
          tileId: `t${index}`,
          row: 0,
          col: index,
        })),
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        ...base,
        placements: [{ tileId: "t", row: -1, col: 0 }],
      }).success,
    ).toBe(false);
  });
});
