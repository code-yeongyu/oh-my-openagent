import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "../identity/layout"
import { acquireLock, createLockRecord, releaseLock } from "../locks"
import { HOST_SWEEP_LOCK_FILE, HOST_SWEEP_STATE_FILE, sweepHostIdentities } from "../reflection/host-sweep"
import { createRetentionHostSweepStep, resolveForeignIdentityDiscardUnreflected } from "./host-step"
import { completion, daysAgo, journal, now, reflectionRun } from "./retention.test-support"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const names = Array.from({ length: 30 }, (_, index) => `id-${String(index + 1).padStart(2, "0")}`)
const REPO_LESS = new Set(["id-03", "id-07", "id-11"])
const SETTINGS = { runtime: { discard_unreflected_journals: true }, agents: { "id-14": { runtime: { discard_unreflected_journals: false } } } }

async function host(): Promise<string> {
  const memoryRoot = await mkdtemp(join(tmpdir(), "memory-host-sweep-"))
  roots.push(memoryRoot)
  for (const name of names) {
    const paths = buildIdentityPaths(memoryRoot, name)
    await mkdir(paths.runtime, { recursive: true })
    if (!REPO_LESS.has(name)) await mkdir(paths.repo, { recursive: true })
  }
  for (const name of ["id-05", "id-20", "id-07"]) {
    const paths = buildIdentityPaths(memoryRoot, name)
    await reflectionRun(paths, "reflection-run-1", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
  }
  const failing = buildIdentityPaths(memoryRoot, "id-12")
  await completion(failing, "reflection-run-1", { status: "consumed", finishedAt: daysAgo(2) })
  const failingRecord = JSON.parse(await readFile(join(failing.reflection, "completions", "reflection-run-1.json"), "utf8")) as Record<string, unknown>
  await Bun.write(join(failing.reflection, "completions", "reflection-run-1.json"), JSON.stringify({ ...failingRecord, outcome: "failed" }))
  await journal(failing, "s-never", "never", daysAgo(15))
  await journal(buildIdentityPaths(memoryRoot, "id-14"), "s-never", "never", daysAgo(60))
  await journal(buildIdentityPaths(memoryRoot, "id-15"), "s-never", "never", daysAgo(60))
  return memoryRoot
}

function run(memoryRoot: string, paths: (name: string) => string, name: string, runId: string): boolean {
  return existsSync(join(paths(name), "runtime", "reflection", "runs", runId))
}

describe("retention as a host-sweep step (6b driver 2 / --fix; A34, A38 driver half)", () => {
  test("#given 30 identities and a bounded driver of 25 #when it runs twice #then it visits 25 then 5 in sorted order, prunes repo-less and repo identities alike, and honours the gate and the per-identity switch", async () => {
    const memoryRoot = await host()
    const step = createRetentionHostSweepStep({ settings: SETTINGS, now })
    const identityRoot = (name: string) => join(memoryRoot, "agents", name)

    const first = await sweepHostIdentities({ memoryRoot, steps: [step], maxIdentities: 25, now })
    if (first.status !== "swept") throw new Error("expected a sweep")
    expect(first.visited).toEqual(names.slice(0, 25))
    expect(first.completed).toBe(false)
    expect(JSON.parse(await readFile(join(memoryRoot, HOST_SWEEP_STATE_FILE), "utf8"))).toEqual({ version: 1, cursor: "id-25" })
    expect(run(memoryRoot, identityRoot, "id-05", "reflection-run-1")).toBe(false)
    expect(run(memoryRoot, identityRoot, "id-07", "reflection-run-1")).toBe(false)
    expect(run(memoryRoot, identityRoot, "id-20", "reflection-run-1")).toBe(false)
    expect(run(memoryRoot, identityRoot, "id-20", "reflection-run-9")).toBe(true)
    expect(existsSync(join(identityRoot("id-12"), "runtime", "transcripts", "s-never", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(identityRoot("id-14"), "runtime", "transcripts", "s-never", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(identityRoot("id-15"), "runtime", "transcripts", "s-never"))).toBe(false)
    expect(first.lines.some((line) => line.startsWith("FIXED id-20 retention removed 1"))).toBe(true)

    const second = await sweepHostIdentities({ memoryRoot, steps: [step], maxIdentities: 25, now })
    if (second.status !== "swept") throw new Error("expected a sweep")
    expect(second.visited).toEqual(names.slice(25))
    expect(second.completed).toBe(true)
    const state = JSON.parse(await readFile(join(memoryRoot, HOST_SWEEP_STATE_FILE), "utf8")) as Record<string, unknown>
    expect(state.cursor).toBeUndefined()
    expect(typeof state.completedAt).toBe("string")
  })

  test("#given another driver holds runtime-sweep.lock #when a second driver starts #then it returns busy and removes nothing", async () => {
    const memoryRoot = await host()
    const lockPath = join(memoryRoot, HOST_SWEEP_LOCK_FILE)
    const holder = await createLockRecord("runtime-sweep")
    await acquireLock(lockPath, holder)
    try {
      const result = await sweepHostIdentities({ memoryRoot, steps: [createRetentionHostSweepStep({ settings: SETTINGS, now })], maxIdentities: 25, now })
      expect(result.status).toBe("busy")
      expect(existsSync(join(memoryRoot, "agents", "id-05", "runtime", "reflection", "runs", "reflection-run-1"))).toBe(true)
    } finally {
      await releaseLock(lockPath, holder)
    }
  })

  test("#given --dry-run #when the step runs #then retention changes nothing", async () => {
    const memoryRoot = await host()
    const result = await sweepHostIdentities({ memoryRoot, steps: [createRetentionHostSweepStep({ settings: SETTINGS, now, dryRun: true })], dryRun: true, now })
    if (result.status !== "swept") throw new Error("expected a sweep")
    expect(result.visited).toHaveLength(30)
    expect(existsSync(join(memoryRoot, "agents", "id-05", "runtime", "reflection", "runs", "reflection-run-1"))).toBe(true)
  })

  test("#given global settings #when the foreign-identity switch resolves #then only global on plus no override-off counts as on", () => {
    expect(resolveForeignIdentityDiscardUnreflected(SETTINGS, "id-14")).toBe(false)
    expect(resolveForeignIdentityDiscardUnreflected(SETTINGS, "id-15")).toBe(true)
    expect(resolveForeignIdentityDiscardUnreflected({ agents: { "id-15": { runtime: { discard_unreflected_journals: true } } } }, "id-15")).toBe(false)
    expect(resolveForeignIdentityDiscardUnreflected(undefined, "id-15")).toBe(false)
  })
})
