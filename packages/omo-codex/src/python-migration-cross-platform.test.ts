import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")

describe("omo-codex Python migration cross-platform behavior", () => {
  it("keeps aggregate hook commands Node-based and platform-neutral", () => {
    // given
    const aggregateHooks = readJson(join(repoRoot, "packages/omo-codex/plugin/hooks/hooks.json"))

    // when
    const hookCommands = collectHookCommands([aggregateHooks])

    // then
    expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b/i))
    expect(hookCommands).toContain('node "${PLUGIN_ROOT}/components/ultrawork/dist/cli.js" hook user-prompt-submit')
    expect(hookCommands.every((command) => command.startsWith("node "))).toBe(true)
    expect(hookCommands.every((command) => !command.includes("\\"))).toBe(true)
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
