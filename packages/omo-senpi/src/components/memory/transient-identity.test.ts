import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import {
  TRANSIENT_DIRNAME,
  finalizeIdentityRun,
  isDurableIdentityRoot,
  isOneShotSurface,
  resolveIdentityRunPaths,
} from "./transient-identity"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const IDENTITY = "project-deadbeef"

function memoryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-transient-identity-"))
  roots.push(root)
  return join(root, "memory")
}

function durablePaths(root: string): MemoryIdentityPaths {
  return buildIdentityPaths(root, IDENTITY)
}

function seedRepo(paths: MemoryIdentityPaths, content = "persona"): string {
  const file = join(paths.repo, "system", "persona.md")
  mkdirSync(join(paths.repo, "system"), { recursive: true })
  writeFileSync(file, content)
  return file
}

function transientRun(root: string) {
  return resolveIdentityRunPaths({
    identity: IDENTITY,
    identityPaths: durablePaths(root),
    memoryRoot: root,
    oneShot: true,
    runToken: () => "token-1",
  })
}

describe("transient memory identity runs", () => {
  test("#given a one-shot run whose identity owns no repo #when run paths resolve #then the whole runtime tree lives under a transient run root and nothing is created", () => {
    const root = memoryRoot()

    const run = transientRun(root)

    expect(run.transientRunRoot).toBe(join(root, TRANSIENT_DIRNAME, "token-1"))
    expect(run.paths.root).toBe(join(root, TRANSIENT_DIRNAME, "token-1", "agents", IDENTITY))
    expect(run.paths.transcripts.startsWith(join(root, TRANSIENT_DIRNAME))).toBe(true)
    expect(run.durableRoot).toBe(join(root, "agents", IDENTITY))
    expect(existsSync(root)).toBe(false)
  })

  test("#given an identity that already owns a repo #when a one-shot run resolves paths #then the durable identity paths are used unchanged", () => {
    const root = memoryRoot()
    const paths = durablePaths(root)
    seedRepo(paths)

    const run = resolveIdentityRunPaths({
      identity: IDENTITY,
      identityPaths: paths,
      memoryRoot: root,
      oneShot: true,
      runToken: () => "token-1",
    })

    expect(run.transientRunRoot).toBeUndefined()
    expect(run.paths).toEqual(paths)
    expect(run.durableRoot).toBe(paths.root)
  })

  test("#given an interactive run #when run paths resolve #then the durable identity paths are used even without a repo", () => {
    const root = memoryRoot()
    const paths = durablePaths(root)

    const run = resolveIdentityRunPaths({
      identity: IDENTITY,
      identityPaths: paths,
      memoryRoot: root,
      oneShot: false,
      runToken: () => "token-1",
    })

    expect(run.transientRunRoot).toBeUndefined()
    expect(run.paths).toEqual(paths)
  })

  test("#given a transient run that persisted no memory #when the run is finalized #then the transient root is removed and the agents root was never created", async () => {
    const root = memoryRoot()
    const run = transientRun(root)
    mkdirSync(run.paths.transcripts, { recursive: true })
    writeFileSync(join(run.paths.transcripts, "state.json"), "{}")

    const disposition = await finalizeIdentityRun({ run })

    expect(disposition).toBe("removed")
    expect(existsSync(join(root, TRANSIENT_DIRNAME, "token-1"))).toBe(false)
    expect(existsSync(join(root, "agents"))).toBe(false)
  })

  test("#given a transient run that never wrote anything #when the run is finalized #then it is reported removed and no directory appears", async () => {
    const root = memoryRoot()
    const run = transientRun(root)

    expect(await finalizeIdentityRun({ run })).toBe("removed")
    expect(existsSync(root)).toBe(false)
  })

  test("#given a transient run that did persist memory #when the run is finalized #then the tree is kept intact for the sweep to promote instead of being deleted", async () => {
    const root = memoryRoot()
    const run = transientRun(root)
    mkdirSync(run.paths.transcripts, { recursive: true })
    seedRepo(run.paths, "persisted persona")

    const disposition = await finalizeIdentityRun({ run })

    expect(disposition).toBe("kept")
    expect(readFileSync(join(run.paths.repo, "system", "persona.md"), "utf8")).toBe("persisted persona")
    expect(existsSync(join(root, "agents"))).toBe(false)
  })

  test("#given a durable run #when it is finalized #then no filesystem work happens at all", async () => {
    const root = memoryRoot()
    const paths = durablePaths(root)
    seedRepo(paths)
    const run = resolveIdentityRunPaths({
      identity: IDENTITY,
      identityPaths: paths,
      memoryRoot: root,
      oneShot: true,
    })

    expect(await finalizeIdentityRun({ run })).toBe("durable")
    expect(existsSync(join(paths.repo, "system", "persona.md"))).toBe(true)
  })

  test("#given identity roots with and without repo/ #when the discriminator runs #then only the repo owner is durable", () => {
    const root = memoryRoot()
    const durable = durablePaths(root)
    seedRepo(durable)
    const runtimeOnly = buildIdentityPaths(root, "runtime-only")
    mkdirSync(runtimeOnly.transcripts, { recursive: true })

    expect(isDurableIdentityRoot(durable.root)).toBe(true)
    expect(isDurableIdentityRoot(runtimeOnly.root)).toBe(false)
  })

  test("#given every surface spelling #when the one-shot classification runs #then only headless and rpc-child runs are one-shot", () => {
    expect(isOneShotSurface({ hasUI: false, env: {} })).toBe(true)
    expect(isOneShotSurface({ env: { OMO_SENPI_TASK_RPC_CHILD: "1" } })).toBe(true)
    expect(isOneShotSurface({ hasUI: true, env: {} })).toBe(false)
    expect(isOneShotSurface({ env: {} })).toBe(false)
    expect(isOneShotSurface({ hasUI: true, env: { OMO_SENPI_TASK_RPC_CHILD: "0" } })).toBe(false)
  })
})
