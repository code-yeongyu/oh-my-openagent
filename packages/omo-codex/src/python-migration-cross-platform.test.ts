import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runUserPromptSubmitHook } from "../plugin/components/ultrawork/src/codex-hook"

const repoRoot = join(import.meta.dir, "..", "..", "..")

describe("omo-codex Python migration cross-platform behavior", () => {
  it("handles empty inventory, malformed input, and Windows paths without Python", () => {
    // given
    const aggregateHooks = readJson(join(repoRoot, "packages/omo-codex/plugin/hooks/hooks.json"))
    const componentHooks = readJson(join(repoRoot, "packages/omo-codex/plugin/components/ultrawork/hooks/hooks.json"))
    const hookCommands = collectHookCommands([aggregateHooks, componentHooks])

    // when
    const outputs = [
      runUserPromptSubmitHook(undefined),
      runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt: "" }),
      runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt: "refactor ulw_helper.ts" }),
      runUserPromptSubmitHook({
        cwd: "C:\\Users\\codex\\project",
        hook_event_name: "UserPromptSubmit",
        model: "gpt-5.5",
        permission_mode: "default",
        prompt: "please ulw this",
        session_id: "s",
        transcript_path: null,
        turn_id: "t",
      }),
    ]

    // then
    expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b/i))
    expect(hookCommands).toContain('node "${PLUGIN_ROOT}/components/ultrawork/dist/cli.js" hook user-prompt-submit')
    expect(hookCommands).toContain('node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit')
    expect(outputs[0]).toBe("")
    expect(outputs[1]).toBe("")
    expect(outputs[2]).toBe("")
    expect(outputs[3]).toStartWith("<ultrawork-mode>")
  })
})

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function collectHookCommands(values: readonly unknown[]): readonly string[] {
  return values.flatMap(collectHookCommandsFromValue)
}

function collectHookCommandsFromValue(value: unknown): readonly string[] {
  if (typeof value === "string") return []
  if (Array.isArray(value)) return value.flatMap(collectHookCommandsFromValue)
  if (!isRecord(value)) return []
  const ownCommand = typeof value["command"] === "string" ? [value["command"]] : []
  return [...ownCommand, ...Object.values(value).flatMap(collectHookCommandsFromValue)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
