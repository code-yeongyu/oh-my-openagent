import { describe, expect, it } from "bun:test";
import { parseExpectedHooks, summarizeRun } from "./app-server-client.mjs";

describe("app-server-client summary", () => {
  it("#given a completed expected event also has a failed hook run #when summarized #then the QA run fails", () => {
    const summary = summarizeRun({
      turnStatus: "completed",
      assistantText: "ok",
      threadId: "thread",
      turnId: "turn",
      expectHook: ["sessionStart", "userPromptSubmit"],
      hooks: [
        { method: "hook/completed", eventName: "sessionStart", status: "completed", source: "plugin" },
        { method: "hook/completed", eventName: "userPromptSubmit", status: "completed", source: "plugin" },
        { method: "hook/completed", eventName: "userPromptSubmit", status: "failed", source: "plugin" },
      ],
      stderr: "",
    });

    expect(summary.ok).toBe(false);
    expect(summary.missingHooks).toEqual([]);
    expect(summary.failedHooks).toEqual([
      { method: "hook/completed", eventName: "userPromptSubmit", status: "failed", source: "plugin" },
    ]);
  });

  it("#given all expected hooks complete #when summarized #then the QA run passes", () => {
    const summary = summarizeRun({
      turnStatus: "completed",
      assistantText: "ok",
      threadId: "thread",
      turnId: "turn",
      expectHook: ["sessionStart", "userPromptSubmit"],
      hooks: [
        { method: "hook/completed", eventName: "sessionStart", status: "completed", source: "plugin" },
        { method: "hook/completed", eventName: "userPromptSubmit", status: "completed", source: "plugin" },
      ],
      stderr: "",
    });

    expect(summary.ok).toBe(true);
    expect(summary.failedHooks).toEqual([]);
  });

  it("#given a comma-separated expectation #when parsed #then whitespace and empties are ignored", () => {
    expect(parseExpectedHooks(" sessionStart, ,userPromptSubmit ")).toEqual(["sessionStart", "userPromptSubmit"]);
  });
});
