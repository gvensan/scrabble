import { describe, expect, it } from "vitest";
import { recallLast } from "./draft.js";

describe("draft recall", () => {
  it("returns provisional placements in last-in, first-out order", () => {
    let draft = ["first", "second", "third"];
    draft = recallLast(draft);
    expect(draft).toEqual(["first", "second"]);
    draft = recallLast(draft);
    expect(draft).toEqual(["first"]);
    draft = recallLast(draft);
    expect(draft).toEqual([]);
    expect(recallLast(draft)).toEqual([]);
  });
});
