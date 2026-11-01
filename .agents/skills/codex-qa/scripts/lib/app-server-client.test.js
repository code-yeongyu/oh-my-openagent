import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExpectedHooks, summarizeRun } from "./app-server-client.mjs";
import { resolveAutoUpdatePlan } from "../../../../../packages/omo-codex/plugin/scripts/auto-update.mjs";

it("#given local-build QA isolation #when its child starts #then published auto-update cannot replace the plugin under test", () => {
  const lib = dirname(fileURLToPath(import.meta.url));
  const child = spawnSync("bash", [
    "-c",
    'source "$1"; cqa_mk_isolated_home; printf "%s" "${OMO_CODEX_AUTO_UPDATE_DISABLED:-}"',
    "qa-test",
    join(lib, "common.sh"),
  ], {
    encoding: "utf8",
    env: { ...process.env, OMO_CODEX_AUTO_UPDATE_DISABLED: "0", LAZYCODEX_AUTO_UPDATE_DISABLED: "0" },
    timeout: 10000,
  });
  expect(child.status).toBe(0);
  expect(resolveAutoUpdatePlan({ env: { OMO_CODEX_AUTO_UPDATE_DISABLED: child.stdout } }).shouldRun).toBe(false);
  expect(child.stdout).toBe("1");
});

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
