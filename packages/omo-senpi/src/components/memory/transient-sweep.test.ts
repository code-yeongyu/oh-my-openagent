import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { TRANSIENT_DIRNAME } from "./transient-identity"
import {
  TRANSIENT_IDENTITY_MAX_AGE_MS,
  TRANSIENT_RUN_MAX_AGE_MS,
  sweepTransientMemoryRuns,
} from "./transient-sweep"

const roots: string[] = []
const NOW = Date.parse("2026-09-10T12:00:00Z")

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function memoryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-transient-sweep-"))
  roots.push(root)
  return join(root, "memory")
}

function write(path: string, content = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function ageTree(root: string, ms: number): void {
  const seconds = ms / 1000
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) stack.push(child)
      else utimesSync(child, seconds, seconds)
    }
    utimesSync(current, seconds, seconds)
  }
}

/** A transient run root as the runtime leaves it: `<memory>/transient-runs/<token>/agents/<id>/runtime/...` */
function transientRun(root: string, token: string, identity: string): string {
  const runRoot = join(root, TRANSIENT_DIRNAME, token)
  write(join(runRoot, "agents", identity, "runtime", "transcripts", "stream-1", "transcript.jsonl"), "{}\n")
  return runRoot
}

function identityDir(root: string, identity: string, options: { readonly repo?: boolean } = {}): string {
  const identityRoot = join(root, "agents", identity)
  write(join(identityRoot, "runtime", "transcripts", "stream-1", "transcript.jsonl"), "{}\n")
  if (options.repo === true) write(join(identityRoot, "repo", "system", "persona.md"), `${identity} memory`)
  return identityRoot
}

const sweep = (root: string, overrides: Record<string, unknown> = {}) =>
  sweepTransientMemoryRuns({
    memoryRoot: root,
    now: () => NOW,
    isProcessAlive: () => false,
    ...overrides,
  })

describe("transient memory sweep", () => {
  test("#given a transient run root abandoned by an abnormal exit #when the sweep runs #then it is reclaimed", async () => {
    const root = memoryRoot()
    const abandoned = transientRun(root, "aaa-4242-zz", "project-1")
    ageTree(abandoned, NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000)

    const result = await sweep(root)

    expect(existsSync(abandoned)).toBe(false)
    expect(result.removedRuns).toBe(1)
  })

  test("#given a transient run root younger than the retention window #when the sweep runs #then it is kept", async () => {
    const root = memoryRoot()
    const live = transientRun(root, "bbb-4242-zz", "project-1")
    ageTree(live, NOW - 60_000)

    const result = await sweep(root)

    expect(existsSync(live)).toBe(true)
    expect(result.removedRuns).toBe(0)
  })

  test("#given an old transient run root whose owning process is still alive #when the sweep runs #then it is kept", async () => {
    const root = memoryRoot()
    const owned = transientRun(root, "ccc-4242-zz", "project-1")
    ageTree(owned, NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000)

    const result = await sweep(root, { isProcessAlive: (pid: number) => pid === 4242 })

    expect(existsSync(owned)).toBe(true)
    expect(result.removedRuns).toBe(0)
  })

  test("#given an old transient run whose only fresh write is a leaf transcript #when the sweep runs #then the leaf mtime keeps it", async () => {
    const root = memoryRoot()
    const active = transientRun(root, "eee-4242-zz", "project-1")
    ageTree(active, NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000)
    const leaf = join(active, "agents", "project-1", "runtime", "transcripts", "stream-1", "transcript.jsonl")
    utimesSync(leaf, (NOW - 60_000) / 1000, (NOW - 60_000) / 1000)

    const result = await sweep(root)

    expect(existsSync(active)).toBe(true)
    expect(result.removedRuns).toBe(0)
  })

  test("#given an abandoned transient run that did persist memory #when the sweep runs #then it is promoted into the agents root instead of deleted", async () => {
    const root = memoryRoot()
    const crashed = transientRun(root, "ddd-4242-zz", "project-1")
    write(join(crashed, "agents", "project-1", "repo", "system", "persona.md"), "rescued memory")
    ageTree(crashed, NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000)

    const result = await sweep(root)

    expect(readFileSync(join(root, "agents", "project-1", "repo", "system", "persona.md"), "utf8")).toBe("rescued memory")
    expect(existsSync(crashed)).toBe(false)
    expect(result.promoted).toBe(1)
  })

  test("#given an abandoned transient run holding memory whose durable identity already exists #when the sweep runs #then nothing is deleted or overwritten and it is reported stranded", async () => {
    const root = memoryRoot()
    const crashed = transientRun(root, "fff-4242-zz", "project-1")
    write(join(crashed, "agents", "project-1", "repo", "system", "persona.md"), "transient memory")
    identityDir(root, "project-1", { repo: true })
    ageTree(join(root), NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000)
    const warnings: string[] = []

    const result = await sweep(root, { warn: (message: string) => warnings.push(message) })

    expect(readFileSync(join(root, "agents", "project-1", "repo", "system", "persona.md"), "utf8")).toBe("project-1 memory")
    expect(readFileSync(join(crashed, "agents", "project-1", "repo", "system", "persona.md"), "utf8")).toBe("transient memory")
    expect(result.stranded).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  test("#given equally old identities with and without a repo under the agents root #when the sweep runs #then only the repo-less identity is reclaimed", async () => {
    const root = memoryRoot()
    const durable = identityDir(root, "durable-1", { repo: true })
    const transient = identityDir(root, "transient-1")
    ageTree(join(root, "agents"), NOW - TRANSIENT_IDENTITY_MAX_AGE_MS - 60_000)

    const result = await sweep(root)

    // The discriminator is `repo/`: inverting it would delete the durable identity and keep the
    // dead one, so this assertion is what a flipped discriminator fails on.
    expect(existsSync(transient)).toBe(false)
    expect(readFileSync(join(durable, "repo", "system", "persona.md"), "utf8")).toBe("durable-1 memory")
    expect(existsSync(join(durable, "runtime", "transcripts", "stream-1", "transcript.jsonl"))).toBe(true)
    expect({ removedIdentities: result.removedIdentities, kept: result.kept }).toEqual({ removedIdentities: 1, kept: 1 })
  })

  test("#given a repo-less identity younger than the retention window #when the sweep runs #then it is kept", async () => {
    const root = memoryRoot()
    const fresh = identityDir(root, "fresh-1")
    ageTree(fresh, NOW - 60_000)

    const result = await sweep(root)

    expect(existsSync(fresh)).toBe(true)
    expect(result.removedIdentities).toBe(0)
  })

  test("#given no memory root at all #when the sweep runs #then it reports zeros and creates nothing", async () => {
    const root = memoryRoot()

    const result = await sweep(root)

    expect(existsSync(root)).toBe(false)
    expect(result).toEqual({ removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 })
  })
})
