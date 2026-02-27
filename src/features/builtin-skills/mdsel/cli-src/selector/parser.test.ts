import { describe, expect, it } from "bun:test";
import { parseSelector } from "./parser";

describe("parseSelector", () => {
  it("expands range after comma from previous index", () => {
    const dotSelector = parseSelector("h1.1,3-5");
    const bracketSelector = parseSelector("h1[1,3-5]");

    expect(dotSelector.segments[0]?.index).toEqual([1, 3, 4, 5]);
    expect(bracketSelector.segments[0]?.index).toEqual([1, 3, 4, 5]);
  });
});
