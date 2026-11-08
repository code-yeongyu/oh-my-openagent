import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { GitMemoryRepo, buildDefaultSeedFiles, buildIdentityPaths, type FactsPeopleRouting, type MemoryIdentity } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import { applyMemoryFacts } from "./facts-apply-runtime"
import { applyFactsWithRetriesUnderLock, withFactsWriterLock } from "./facts-batch-apply"

const PEOPLE: FactsPeopleRouting = { enabled: true, maxEntries: 40, maxEntryChars: 200 }
const PROJECT = { scope: "project" as const, text: "The project runs tests with bun.", date: "2026-10-18" }
const CHILD = resolve(import.meta.dir, "facts-applied-reconcile-child.ts")
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function memory(): Promise<{ readonly root: string; readonly identity: MemoryIdentity; readonly repo: GitMemoryRepo }> {
  const root = await mkdtemp(join(tmpdir(), "omo-facts-applied-"))
  roots.push(root)
  const identity: MemoryIdentity = { id: "apply-agent", safeSlug: "apply-agent", paths: buildIdentityPaths(root, "apply-agent") }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  return { root, identity, repo }
}

async function batchCommits(repo: GitMemoryRepo, batchId: string): Promise<number> {
  return (await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] === batchId).length
}

function runChild(root: string): Promise<{ readonly code: number | null; readonly output: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CHILD, root], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error(`reconcile child did not exit within 25s: ${output}`)) }, 25_000)
    child.on("error", (error) => { clearTimeout(timer); rejectRun(error) })
    child.on("exit", (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
}

// Storage/recovery contract (#10481): an onboarding apply keeps the extractor's crash recovery.
describe("facts/applied recovery envelopes", () => {
  test("#given a clean apply #when it commits #then its recovery envelope is removed", async () => {
    const { identity, repo } = await memory()
    const batchId = randomUUID()
    const applied = await applyFactsWithRetriesUnderLock({ identity, batchId, records: [PROJECT], people: PEOPLE })

    expect(applied?.outcome).toBe("committed")
    expect(await batchCommits(repo, batchId)).toBe(1)
    expect(existsSync(join(identity.paths.facts, "applied", batchId))).toBe(false)
  }, 60_000)

  test("#given an apply that throws mid-write #when a fresh process reconciles memory #then the kept envelope settles into one commit and is removed", async () => {
    const { root, identity, repo } = await memory()
    const hooks = join(root, "failing-hooks")
    await mkdir(hooks)
    await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    execFileSync("git", ["-C", identity.paths.repo, "config", "core.hooksPath", hooks], { windowsHide: true })

    const batchId = randomUUID()
    await expect(applyFactsWithRetriesUnderLock({ identity, batchId, records: [PROJECT], people: PEOPLE })).rejects.toThrow()

    const envelope = join(identity.paths.facts, "applied", batchId)
    const ledger = JSON.parse(await readFile(join(envelope, "ledger.json"), "utf8")) as { applyRecovery?: unknown }
    expect(ledger.applyRecovery).toBeDefined()
    expect(await batchCommits(repo, batchId)).toBe(0)

    execFileSync("git", ["-C", identity.paths.repo, "config", "--unset", "core.hooksPath"], { windowsHide: true })
    const run = await runChild(root)
    expect(run).toEqual({ code: 0, output: "" })

    expect(await batchCommits(repo, batchId)).toBe(1)
    expect(existsSync(envelope)).toBe(false)
    expect(await readdir(join(identity.paths.facts, "applied"))).toEqual([])
  }, 60_000)

  test("#given a kept envelope #when a same-batchId retry finds the memory-write lock busy #then the envelope and its recovery survive for maintenance to finish", async () => {
    const { root, identity, repo } = await memory()
    const hooks = join(root, "failing-hooks")
    await mkdir(hooks)
    await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    execFileSync("git", ["-C", identity.paths.repo, "config", "core.hooksPath", hooks], { windowsHide: true })
    const batchId = randomUUID()
    await expect(applyFactsWithRetriesUnderLock({ identity, batchId, records: [PROJECT], people: PEOPLE })).rejects.toThrow()
    execFileSync("git", ["-C", identity.paths.repo, "config", "--unset", "core.hooksPath"], { windowsHide: true })

    const envelope = join(identity.paths.facts, "applied", batchId)
    const retried = await withFactsWriterLock(identity.paths.locks, () => applyFactsWithRetriesUnderLock({ identity, batchId, records: [PROJECT], people: PEOPLE }), 1, "holder")

    expect(retried).toBeUndefined()
    expect(existsSync(envelope)).toBe(true)
    const ledger = JSON.parse(await readFile(join(envelope, "ledger.json"), "utf8")) as { applyRecovery?: unknown; pid?: number }
    expect(ledger.applyRecovery).toBeDefined()
    expect(ledger.pid).toBeUndefined()
    expect(await batchCommits(repo, batchId)).toBe(0)

    const run = await runChild(root)
    expect(run).toEqual({ code: 0, output: "" })
    expect(await batchCommits(repo, batchId)).toBe(1)
    expect(existsSync(envelope)).toBe(false)
  }, 60_000)

  test("#given a client batchId #when the same request is applied twice #then it commits once and the retry is answered from the receipt", async () => {
    const { identity, repo } = await memory()
    const context = createMemoryIdentityContext({ identity: identity.id, identityPaths: identity.paths, binding: {} as never })
    const batchId = randomUUID()
    const request = { records: [PROJECT], batchId }

    const first = await applyMemoryFacts({ context, people: PEOPLE, request })
    const second = await applyMemoryFacts({ context, people: PEOPLE, request })

    expect(first).toMatchObject({ outcome: "committed", batchId })
    expect(second).toEqual(first)
    expect(await batchCommits(repo, batchId)).toBe(1)
  }, 60_000)

  test("#given a batchId that is not a UUID v4 (here a path escape) #when applied #then it is refused before anything is written", async () => {
    const { identity, repo } = await memory()
    const context = createMemoryIdentityContext({ identity: identity.id, identityPaths: identity.paths, binding: {} as never })
    const head = await repo.head()

    const response = await applyMemoryFacts({ context, people: PEOPLE, request: { records: [PROJECT], batchId: "../escape" } })

    expect(response).toMatchObject({ kind: "invalid" })
    expect(await repo.head()).toBe(head)
    expect(existsSync(join(identity.paths.facts, "applied"))).toBe(false)
  }, 60_000)
})
