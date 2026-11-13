import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"

import { readGlobalMemorySettings, reflectionLockFix } from "../bin/lib/doctor-reflection-lock.js"
import * as taskConfigRuntime from "../task-config-entry"

// The staged plugin/runtime/task-config bundle is built from task-config-entry.ts; tests load the source.
const loadTaskConfig = () => taskConfigRuntime

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
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      schema_version: "v3_assistant_steps",
      total_completed_steps: 1,
      reflected_completed_steps: 0,
      steps_since_last_successful_reflection: 1,
    }),
  )
  writeFileSync(
    join(dir, "transcript.jsonl"),
    `${JSON.stringify({ kind: "assistant", text: "a", captured_at: "2026-09-01T00:00:00.000Z", source_line_id: "a1:assistant", source_message_id: "a1" })}\n`,
  )
  const at = Date.now() - 60 * DAY
  for (const path of [join(dir, "state.json"), join(dir, "transcript.jsonl"), dir]) ageTree(path, at)
  return dir
}

describe("omo doctor --fix retention step (A38 CLI half)", () => {
  test("#given the global switch on and one identity's global override off #when --fix runs #then that identity's never-reflected journal is kept and the other's is removed", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.jsonc"),
      `// user layer\n{ "memory": { "runtime": { "discard_unreflected_journals": true }, "agents": { "agent-off": { "runtime": { "discard_unreflected_journals": false } } } } }\n`,
    )
    const kept = neverReflected(memory, "agent-off")
    const removed = neverReflected(memory, "agent-on")

    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home, loadTaskConfig })

    expect(result.failed).toBe(false)
    expect(existsSync(join(kept, "transcript.jsonl"))).toBe(true)
    expect(existsSync(removed)).toBe(false)
    expect(result.lines.some((line: string) => line.startsWith("FIXED agent-on retention removed 1"))).toBe(true)
  })

  test("#given a global max_bytes the identity exceeds #when --fix runs #then the cap evicts its oldest folded runs and keeps the newest (#12538 review L2)", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({ memory: { runtime: { max_bytes: 1 } } }))
    mkdirSync(join(memory, "agents", "agent-big", "repo"), { recursive: true })
    const runs = join(memory, "agents", "agent-big", "runtime", "reflection", "runs")
    const at = Date.now()
    for (const index of [1, 2, 3]) {
      const dir = join(runs, `reflection-run-${index}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "final.json"),
        JSON.stringify({
          runId: `reflection-run-${index}`,
          outcome: "merged",
          finishedAt: new Date(at - (4 - index) * DAY).toISOString(),
        }),
      )
      writeFileSync(join(dir, "child-1.log"), Buffer.alloc(64 * 1024, 1))
    }

    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home, loadTaskConfig })

    expect(result.failed).toBe(false)
    expect([1, 2, 3].map((index) => existsSync(join(runs, `reflection-run-${index}`)))).toEqual([false, false, true])
  })

  test("#given no global config #when --fix runs #then unreflected input is kept (switch off)", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    const kept = neverReflected(memory, "agent-plain")

    expect(readGlobalMemorySettings(home, { loadTaskConfig })).toBeUndefined()
    await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home, loadTaskConfig })

    expect(existsSync(join(kept, "transcript.jsonl"))).toBe(true)
  })

  test("#given a [native] block #when the global settings are read #then it wins key by key over the base", () => {
    const home = scratch()
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.json"),
      JSON.stringify({
        memory: { runtime: { discard_unreflected_journals: false } },
        "[native]": { memory: { runtime: { discard_unreflected_journals: true } } },
      }),
    )
    expect(readGlobalMemorySettings(home, { loadTaskConfig })?.runtime.discard_unreflected_journals).toBe(true)
  })
})

describe("omo doctor --fix resolves the global memory settings as the config loader does (REVIEW-7 L2)", () => {
  test("#given a [native].agents.<id> entry without runtime #when --fix runs with the global switch on #then that identity keeps its base runtime switch off and its journal stays", async () => {
    const home = scratch()
    const memory = join(home, "memory")
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.jsonc"),
      JSON.stringify({
        memory: {
          runtime: { discard_unreflected_journals: true },
          agents: { "agent-off": { runtime: { discard_unreflected_journals: false } } },
        },
        "[native]": { memory: { agents: { "agent-off": { recall: { tool_budget: 4 } } } } },
      }),
    )
    const kept = neverReflected(memory, "agent-off")
    const removed = neverReflected(memory, "agent-on")

    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: memory }, home, loadTaskConfig })

    expect(result.failed).toBe(false)
    expect(existsSync(join(kept, "transcript.jsonl"))).toBe(true)
    expect(existsSync(removed)).toBe(false)
  })

  const BASE = {
    runtime: { discard_unreflected_journals: true, retention_days: 9 },
    agents: { "agent-a": { runtime: { discard_unreflected_journals: false, pass_budget_ms: 5_000 } } },
  }
  const PROFILES = {
    work: {
      memory: {
        runtime: { abandoned_journal_days: 21 },
        agents: { "agent-c": { runtime: { discard_unreflected_journals: false } } },
      },
    },
  }

  test.each([
    [
      "a [native] block",
      {
        memory: BASE,
        "[native]": { memory: { agents: { "agent-a": { recall: { tool_budget: 4 } } } } },
        profiles: PROFILES,
      },
    ],
    [
      "only the legacy [senpi] block",
      {
        memory: BASE,
        "[senpi]": {
          memory: { runtime: { completions_days: 12 }, agents: { "agent-b": { runtime: { retention_days: 3 } } } },
        },
        profiles: PROFILES,
      },
    ],
  ] as const)(
    "#given a global config with a base, %s and an active profile #when the CLI reads it #then it equals the memory settings the session loader resolves from the same file",
    (_name, document) => {
      const home = scratch()
      const project = join(home, "project")
      mkdirSync(join(home, ".omo"), { recursive: true })
      mkdirSync(project, { recursive: true })
      writeFileSync(join(home, ".omo", "omo.jsonc"), `// user layer\n${JSON.stringify(document)}\n`)
      const env = { HOME: home, OMO_PROFILE: "work" }

      const session = loadOmoConfig({ cwd: project, env, harness: "senpi" }).config.memory
      const cli = readGlobalMemorySettings(home, { env, loadTaskConfig })

      expect(session).toBeDefined()
      expect(cli).toEqual({ runtime: session?.runtime, agents: session?.agents })
      expect(cli?.runtime).toMatchObject({
        discard_unreflected_journals: true,
        retention_days: 9,
        abandoned_journal_days: 21,
      })
      expect(cli?.agents["agent-a"]?.runtime?.discard_unreflected_journals).toBe(false)
      if ("[senpi]" in document) {
        expect(cli?.runtime.completions_days).toBe(12)
        expect(cli?.agents["agent-b"]?.runtime?.retention_days).toBe(3)
      }
    },
  )
})
