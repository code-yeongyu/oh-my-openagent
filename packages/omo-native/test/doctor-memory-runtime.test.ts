import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { measureRuntimeSize } from "../../memory-core/src/retention/size"
import {
  memoryRuntimeDiscardResolver,
  memoryRuntimeMaxBytesResolver,
  memoryRuntimeReport,
} from "../bin/lib/doctor-memory-runtime.js"
import { DEFAULT_RUNTIME_MAX_BYTES } from "../../memory-core/src/retention/size"
import * as taskConfigRuntime from "../task-config-entry"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memoryHome(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-memory-runtime-"))
  roots.push(root)
  return root
}

function identity(root: string, id: string, runtimeBytes: number, durable = true): string {
  const identityRoot = join(root, "agents", id)
  mkdirSync(join(identityRoot, "runtime", "transcripts", "s1"), { recursive: true })
  if (durable) mkdirSync(join(identityRoot, "repo"), { recursive: true })
  writeFileSync(join(identityRoot, "runtime", "transcripts", "s1", "transcript.jsonl"), Buffer.alloc(runtimeBytes, 1))
  return join(identityRoot, "runtime")
}

describe("omo doctor memory runtime sizes (B11)", () => {
  test("#given three durable identities and one over 80 % of its cap #when the report runs #then it prints each size, the total and one WARN", async () => {
    const root = memoryHome()
    const runtimes = {
      "agent-a": identity(root, "agent-a", 900_000),
      "agent-b": identity(root, "agent-b", 100_000),
      "agent-c": identity(root, "agent-c", 10_000),
    }
    identity(root, "transient-x", 2_000_000, false)
    const measured = Object.fromEntries(
      await Promise.all(
        Object.entries(runtimes).map(async ([id, runtime]) => [id, (await measureRuntimeSize(runtime)).bytes] as const),
      ),
    )
    const total = measured["agent-a"] + measured["agent-b"] + measured["agent-c"]

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 1_000_000 })

    expect(report.identities.map((entry) => [entry.identity, entry.bytes])).toEqual([
      ["agent-a", measured["agent-a"]],
      ["agent-b", measured["agent-b"]],
      ["agent-c", measured["agent-c"]],
    ])
    expect(report.totalBytes).toBe(total)
    expect(report.lines.filter((line) => line.startsWith("WARN "))).toHaveLength(1)
    expect(report.lines.find((line) => line.startsWith("WARN "))).toContain("(agent-a)")
    expect(report.lines.filter((line) => line.startsWith("INFO memory runtime: agent-"))).toHaveLength(3)
    expect(report.lines.some((line) => line.startsWith("INFO memory runtime total:"))).toBe(true)
  })

  test("#given an identity over its cap held by an unreflected journal and the switch off #when the report runs #then it reports the held bytes (r4 R1)", async () => {
    const root = memoryHome()
    const runtime = identity(root, "agent-a", 900_000)
    writeFileSync(
      join(runtime, "transcripts", "s1", "state.json"),
      JSON.stringify({ total_completed_steps: 2, reflected_completed_steps: 0 }),
    )

    const byDefault = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 100_000 })
    const on = await memoryRuntimeReport({
      env: { OMO_MEMORY_HOME: root },
      maxBytesFor: () => 100_000,
      discardFor: () => true,
    })

    expect(byDefault.identities[0]?.unreflectedBytes).toBeGreaterThan(900_000)
    expect(byDefault.identities[0]?.discardUnreflectedJournals).toBe(false)
    expect(byDefault.lines.filter((line) => line.includes("discard_unreflected_journals off"))).toHaveLength(1)
    expect(on.lines.filter((line) => line.includes("discard_unreflected_journals off"))).toEqual([])
  })

  test("#given an identity under its cap holding an unreflected journal #when the report runs #then the unreflected bytes, which only the over-cap line prints, are not measured (#12538 review r3 M2)", async () => {
    const root = memoryHome()
    const runtime = identity(root, "agent-a", 900_000)
    writeFileSync(
      join(runtime, "transcripts", "s1", "state.json"),
      JSON.stringify({ total_completed_steps: 2, reflected_completed_steps: 0 }),
    )

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 10_000_000 })

    expect(report.identities[0]?.bytes).toBeGreaterThan(900_000)
    expect(report.identities[0]?.unreflectedBytes).toBeUndefined()
  })

  test("#given an identity whose transcripts hold a stray file and an unreadable state.json #when the report runs #then it still reports the identity (#12538 review r3 M1)", async () => {
    const root = memoryHome()
    const runtime = identity(root, "agent-a", 900_000)
    writeFileSync(join(runtime, "transcripts", ".DS_Store"), "x")
    mkdirSync(join(runtime, "transcripts", "s2", "state.json"), { recursive: true })

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 100_000 })

    expect(report.identities[0]?.bytes).toBeGreaterThan(900_000)
  })

  test("#given an identity over its cap with folded runs to evict and an unreflected journal, switch off #when the report runs #then it measures the evictable bytes and does not blame the unreflected journals (#12538 review M1)", async () => {
    const root = memoryHome()
    const runtime = identity(root, "agent-a", 900_000)
    writeFileSync(
      join(runtime, "transcripts", "s1", "state.json"),
      JSON.stringify({ total_completed_steps: 2, reflected_completed_steps: 0 }),
    )
    for (const index of [1, 2, 3]) {
      const dir = join(runtime, "reflection", "runs", `reflection-run-${index}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "final.json"),
        JSON.stringify({
          runId: `reflection-run-${index}`,
          outcome: "merged",
          finishedAt: new Date(Date.now() - (4 - index) * 86_400_000).toISOString(),
        }),
      )
      writeFileSync(join(dir, "child-1.log"), Buffer.alloc(300_000, 1))
    }
    const total = (await measureRuntimeSize(runtime)).bytes

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => total - 100_000 })

    expect(report.identities[0]?.evictableBytes).toBeGreaterThanOrEqual(600_000)
    expect(report.lines.filter((line) => line.includes("discard_unreflected_journals off"))).toEqual([])
  })

  test("#given the measurement deadline has fired #when the report runs #then the identity reports size unknown with the budget instead of a number (#12538 review L5)", async () => {
    const root = memoryHome()
    identity(root, "agent-a", 900_000)

    const report = await memoryRuntimeReport({
      env: { OMO_MEMORY_HOME: root },
      maxBytesFor: () => 1_000_000,
      measureBudgetMs: 60_000,
      measureSignal: AbortSignal.abort(),
    })

    expect(report.identities[0]?.sizeUnknown?.budgetMs).toBe(60_000)
    expect(report.totalBytes).toBe(0)
    expect(report.lines.some((line) => line.startsWith("WARN ") && line.includes("(agent-a)"))).toBe(true)
  })

  test("#given an unbounded cap #when the report runs #then sizes are measured and nothing warns (B06)", async () => {
    const root = memoryHome()
    identity(root, "agent-a", 900_000)

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 0 })

    expect(report.identities).toHaveLength(1)
    expect(report.identities[0]?.bytes).toBeGreaterThan(900_000)
    expect(report.lines.filter((line) => line.startsWith("WARN "))).toEqual([])
  })

  test("#given more identities than the listing shows #when the report runs #then the rest are folded into one line and still counted in the total", async () => {
    const root = memoryHome()
    for (let index = 0; index < 13; index += 1)
      identity(root, `agent-${String(index).padStart(2, "0")}`, 1_000 * (index + 1))

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 0 })

    expect(report.identities).toHaveLength(13)
    expect(report.lines.filter((line) => line.startsWith("INFO memory runtime: agent-"))).toHaveLength(10)
    expect(report.lines.some((line) => line.startsWith("INFO memory runtime: 3 more identities"))).toBe(true)
    expect(report.totalBytes).toBe(report.identities.reduce((sum, entry) => sum + entry.bytes, 0))
  })

  test("#given one identity whose runtime logged a cleanup and one that never did #when the report runs #then each listed line says when it was last cleaned (#12932)", async () => {
    const root = memoryHome()
    const cleaned = identity(root, "agent-a", 2_000)
    identity(root, "agent-b", 1_000)
    writeFileSync(
      join(cleaned, "retention-log.jsonl"),
      `${JSON.stringify({ v: 1, at: "2026-11-05T00:00:00.000Z", total: 3, removed: { runs: ["reflection-run-1", "reflection-run-2", "reflection-run-3"] } })}\n`,
    )

    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: root }, maxBytesFor: () => 0 })

    expect(report.identities.map((entry) => [entry.identity, entry.lastCleanup])).toEqual([
      ["agent-a", { at: "2026-11-05T00:00:00.000Z", total: 3 }],
      ["agent-b", undefined],
    ])
    expect(report.lines.find((line) => line.startsWith("INFO memory runtime: agent-a "))).toEndWith(
      "; last cleanup 2026-11-05T00:00:00.000Z removed 3",
    )
    expect(report.lines.find((line) => line.startsWith("INFO memory runtime: agent-b "))).toEndWith(
      "; no cleanup recorded",
    )
  })

  test("#given no memory home on disk #when the report runs #then it prints nothing", async () => {
    const report = await memoryRuntimeReport({ env: { OMO_MEMORY_HOME: join(memoryHome(), "missing") } })
    expect(report.lines).toEqual([])
  })
})

describe("omo doctor memory runtime cap resolution", () => {
  test("#given configured caps #when an identity is resolved #then its agent override wins over the default", () => {
    const resolve = memoryRuntimeMaxBytesResolver({
      pluginRoot: "/unused",
      loadRuntime: () => ({ resolveMemoryRuntimeCaps: () => ({ maxBytes: 1_000, agents: { "agent-b": 0 } }) }),
    })
    expect(resolve("agent-a")).toBe(1_000)
    expect(resolve("agent-b")).toBe(0)
  })

  test("#given omo.jsonc in the user layer #when caps resolve through the staged config runtime #then the user's cap and agent override are read", () => {
    const home = memoryHome()
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.jsonc"),
      JSON.stringify({
        memory: { runtime: { max_bytes: 4096 }, agents: { "agent-b": { runtime: { max_bytes: 0 } } } },
      }),
    )

    const resolve = memoryRuntimeMaxBytesResolver({
      pluginRoot: "/unused",
      cwd: home,
      env: { HOME: home },
      loadRuntime: () => taskConfigRuntime,
    })

    expect(resolve("agent-a")).toBe(4096)
    expect(resolve("agent-b")).toBe(0)
  })

  test("#given discard_unreflected_journals on for one agent #when resolved through the config runtime #then that agent is on and the rest keep the default off", () => {
    const home = memoryHome()
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.jsonc"),
      JSON.stringify({ memory: { agents: { "agent-b": { runtime: { discard_unreflected_journals: true } } } } }),
    )

    const discard = memoryRuntimeDiscardResolver({
      pluginRoot: "/unused",
      cwd: home,
      env: { HOME: home },
      loadRuntime: () => taskConfigRuntime,
    })

    expect(discard("agent-a")).toBe(false)
    expect(discard("agent-b")).toBe(true)
  })

  test("#given a payload without the config runtime #when an identity is resolved #then the shipped default applies", () => {
    const resolve = memoryRuntimeMaxBytesResolver({ pluginRoot: join(memoryHome(), "no-plugin") })
    expect(resolve("agent-a")).toBe(DEFAULT_RUNTIME_MAX_BYTES)
  })
})
