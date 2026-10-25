import { describe, expect, it } from "vitest";
import { formatClock } from "./sound.js";

describe("turn clock presentation", () => {
  it("formats bounded countdown values", () => {
    expect(formatClock(120)).toBe("2:00");
    expect(formatClock(61)).toBe("1:01");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-4)).toBe("0:00");
  });
});
