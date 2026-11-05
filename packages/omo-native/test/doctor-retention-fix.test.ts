import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readGlobalMemorySettings, reflectionLockFix } from "../bin/lib/doctor-reflection-lock.js"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const DAY = 24 * 60 * 60 * 1000

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-retention-"))
  roots.push(root)
  return root
}

function ageTree(path: string, at: number): void {
  utimesSync(path, at / 1000, at / 1000)
}

/** A never-reflected journal idle 60 days: state with no anchor and a one-row transcript. */
function neverReflected(memory: string, id: string): string {
  const dir = join(memory, "agents", id, "runtime", "transcripts", "s-never")
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(memory, "agents", id, "repo"), { recursive: true })
  writeFileSync(join(dir, "state.json"), JSON.stringify({ schema_version: "v3_assistant_steps", total_completed_steps: 1, reflected_completed_steps: 0, steps_since_last_successful_reflection: 1 }))
  writeFileSync(join(dir, "transcript.jsonl"), `${JSON.stringify({ kind: "assistant", text: "a", captured_at: "2026-09-01T00:00:00.000Z", source_line_id: "a1:assistant", source_message_id: "a1" })}\n`)
  const at = Date.now() - 60 * DAY
  for (const path of [join(dir, "state.json"), join(dir, "transcript.jsonl"), dir]) ageTree(path, at)
  return dir
}

describe("omo doctor --fix retention step (A38 CLI half)", () => {
  test("#given the global switch on and one identity's global override off #when --fix runs #then that identity's never-reflected journal is kept and the other's is removed", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.jsonc"), `// user layer\n{ "memory": { "runtime": { "discard_unreflected_journals": true }, "agents": { "agent-off": { "runtime": { "discard_unreflected_journals": false } } } } }\n`)
    const kept = neverReflected(memory, "agent-off")
    const removed = neverReflected(memory, "agent-on")

    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home })

    expect(result.failed).toBe(false)
    expect(existsSync(join(kept, "transcript.jsonl"))).toBe(true)
    expect(existsSync(removed)).toBe(false)
    expect(result.lines.some((line: string) => line.startsWith("FIXED agent-on retention removed 1"))).toBe(true)
  })

  test("#given no global config #when --fix runs #then unreflected input is kept (switch off)", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    const kept = neverReflected(memory, "agent-plain")

    expect(readGlobalMemorySettings(home)).toBeUndefined()
    await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home })

    expect(existsSync(join(kept, "transcript.jsonl"))).toBe(true)
  })

  test("#given a [native] block #when the global settings are read #then it wins key by key over the base", () => {
    const home = scratch()
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.json"), JSON.stringify({ memory: { runtime: { discard_unreflected_journals: false } }, "[native]": { memory: { runtime: { discard_unreflected_journals: true } } } }))
    expect(readGlobalMemorySettings(home)?.runtime).toEqual({ discard_unreflected_journals: true })
  })
})
