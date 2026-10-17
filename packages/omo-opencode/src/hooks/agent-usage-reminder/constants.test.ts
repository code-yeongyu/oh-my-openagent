import { describe, expect, test } from "bun:test";
import { REMINDER_MESSAGE } from "./constants";

describe("agent usage reminder policy", () => {
  test("limits parallel fan-out guidance to read-only work", () => {
    expect(REMINDER_MESSAGE).toContain("read-only");
    expect(REMINDER_MESSAGE).toContain("mutation-capable");
    expect(REMINDER_MESSAGE).toContain("worktree");
    expect(REMINDER_MESSAGE).not.toContain(
      "ALWAYS prefer: Multiple parallel task calls > Direct tool calls",
    );
  });
});
