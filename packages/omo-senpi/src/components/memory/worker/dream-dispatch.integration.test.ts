import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { rmEfaultTolerant } from "../teardown.test-support"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  loadDreamPersona,
  type MemoryIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import type { SenpiOmoConfigResult } from "../../config-resolution"
import { SenpiSubprocessRunner } from "./runner"
import type { ReflectionSpawnArgs } from "./spawn"

// Each case drives a real supervisor, bootstrap, and model child - three spawned bun processes
// plus git work. The 5s default is a fast-machine assumption, not a budget those subprocesses
// fit on a loaded CI runner; the assertions stay event-driven with no sleeps.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 30_000)

const childFixture = join(import.meta.dir, "__fixtures__", "dream-child.ts")
const supervisorFixture = join(import.meta.dir, "memory-run-supervisor.ts")
const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function launchDream(
  people: { enabled: boolean; max_entries: number; max_entry_chars: number },
  options: { readonly seedLedgers?: boolean; readonly targetDoc?: string } = {},
): Promise<{
  readonly identity: MemoryIdentity
  readonly baseSha: string
  readonly result: Awaited<ReturnType<SenpiSubprocessRunner["launch"]>>
  readonly spawn: ReflectionSpawnArgs
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-dream-dispatch-")))
  roots.push(root)
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [
    { relativePath: "system/base.md", content: "---\ndescription: Base\n---\nBase.\n" },
    ...(options.targetDoc === undefined
      ? []
      : [{ relativePath: options.targetDoc, content: "---\ndescription: Style\n---\nOriginal.\n" }]),
  ] })
  const baseSha = await repo.head()
  if (!baseSha) throw new Error("expected fixture base SHA")
  if (options.seedLedgers !== false) {
    await mkdir(join(identity.paths.runtime, "dream"), { recursive: true })
    await writeFile(join(identity.paths.runtime, "skills-usage.json"), `${JSON.stringify({
      review: { count: 2, lastUsedAt: "2026-08-01T00:00:00.000Z" },
    })}\n`)
    await writeFile(join(identity.paths.runtime, "dream", "state.json"), `${JSON.stringify({
      last_dream_at: "2026-07-01T00:00:00.000Z",
      lastRunId: "prior-run",
    })}\n`)
  }

  const memory = OmoMemorySettingsSchema.parse({
    reflection: { category: "quick", merge: "auto", sandbox: "off" },
    people: { enabled: true, max_entries: 40, max_entry_chars: 200 },
    agents: { "agent-test": { people } },
  })
  const config: OmoConfig = { memory, categories: { quick: { model: "omo-mock/mock-1", reasoning: "high" } } }
  const loaded: SenpiOmoConfigResult = { config, diagnostics: [], layers: [], sources: [] }
  const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
  const calls: ReflectionSpawnArgs[] = []
  const senpiCommand = join(root, "fake-senpi")
  await writeFile(senpiCommand, '#!/bin/sh\nprintf "omo-mock/mock-1\\n"\n', "utf8")
  await chmod(senpiCommand, 0o700)
  const runner = new SenpiSubprocessRunner({
    identity,
    reservation: {
      readState: async () => ({}),
      complete: async (_runId, outcome) => ({ outcome }),
    },
    resolveModelRegistry: () => ({
      getAvailable: () => [model],
      find: (provider, modelId) => provider === model.provider && modelId === model.id ? model : undefined,
    }),
    loadConfig: () => loaded,
    cwd: root,
    env: options.seedLedgers === false ? { DREAM_FIXTURE_EMPTY_LEDGERS: "1" } : {},
    // Not the behavior under test - just the chain's safety bound. 5s assumed a fast dev machine;
    // a loaded CI runner needs more for the supervisor + bootstrap + child chain to finish.
    deadlineMs: 20_000,
    supervisorPath: supervisorFixture,
    senpiCommand,
    sandbox: (spawn) => {
      calls.push(spawn)
      return { ...spawn, command: process.execPath, args: [childFixture] }
    },
  })
  const run: ReservedRun = {
    runId: "dream-run-1",
    request: {
      trigger: "dream",
      origin: "manual",
      conversationIds: [],
      snapshots: [],
      ...(options.targetDoc === undefined ? {} : { targetDoc: options.targetDoc }),
    },
  }
  const result = await runner.launch(run)
  const spawn = calls[0]
  if (!spawn) throw new Error("expected dream spawn")
  return { identity, baseSha, result, spawn }
}

describe("dream worker dispatch", () => {
  test("#given a dream with people disabled #when the worker launches #then it selects dream inputs and touches no people path", async () => {
    // given
    const expectedPolicy = { version: 1, people: { enabled: false, max_entries: 7, max_entry_chars: 80 } }

    // when
    const item = await launchDream(expectedPolicy.people)

    // then
    expect(item.result.outcome).toBe("merged")
    expect(await readFile(item.spawn.paths.persona, "utf8")).toBe(loadDreamPersona().markdown)
    expect(basename(item.spawn.env.SKILLS_USAGE_PATH ?? "")).toBe("skills-usage.json")
    expect(basename(item.spawn.env.DREAM_STATE_PATH ?? "")).toBe("dream-state.json")
    expect(basename(item.spawn.env.DREAM_POLICY_PATH ?? "")).toBe("dream-policy.json")
    expect(JSON.parse(await readFile(item.spawn.env.DREAM_POLICY_PATH ?? "", "utf8"))).toEqual(expectedPolicy)
    expect(existsSync(join(item.identity.paths.repo, "people"))).toBe(false)
  }, 30_000)

  test("#given absent dream ledgers #when the worker launches #then it supplies readable empty objects", async () => {
    // given
    const people = { enabled: false, max_entries: 40, max_entry_chars: 200 }

    // when
    const item = await launchDream(people, { seedLedgers: false })

    // then
    expect(item.result.outcome).toBe("merged")
    expect(JSON.parse(await readFile(item.spawn.env.SKILLS_USAGE_PATH ?? "", "utf8"))).toEqual({})
    expect(JSON.parse(await readFile(item.spawn.env.DREAM_STATE_PATH ?? "", "utf8"))).toEqual({})
  }, 30_000)

  test("#given custom people limits #when the dream writes fixture entries #then it honors the resolved limits exactly", async () => {
    // given
    const limits = { enabled: true, max_entries: 3, max_entry_chars: 64 }

    // when
    const item = await launchDream(limits)

    // then
    expect(item.result.outcome).toBe("merged")
    // git materializes merged files through the runner's autocrlf filter on Windows, so the card
    // can arrive with CRLF endings there; normalize before measuring line lengths.
    const lines = (await readFile(join(item.identity.paths.repo, "people", "fixture", "card.md"), "utf8")).replace(/\r\n/g, "\n").trim().split("\n")
    expect(lines).toHaveLength(limits.max_entries)
    expect(lines.every((line) => line.length === limits.max_entry_chars)).toBe(true)
  }, 30_000)

  test("#given a memory document target #when the dream completes #then only that document is merged", async () => {
    // given
    const targetDoc = "reference/style.md"

    // when
    const item = await launchDream(
      { enabled: false, max_entries: 40, max_entry_chars: 200 },
      { targetDoc },
    )
    const repo = new GitMemoryRepo({ dir: item.identity.paths.repo, agentId: item.identity.id })
    const commits = await repo.log({ range: `${item.baseSha}..HEAD`, includePaths: true })
    const ledger = JSON.parse(await readFile(join(item.spawn.paths.sessionDir, "ledger.json"), "utf8"))

    // then
    expect(item.result.outcome).toBe("merged")
    expect(await readFile(join(item.identity.paths.repo, targetDoc), "utf8")).toContain("Maintained by dream")
    expect(new Set(commits.flatMap((commit) => commit.paths ?? []))).toEqual(new Set([targetDoc]))
    expect(item.spawn.env.DREAM_TARGET_PATH).toBe(join(item.spawn.paths.worktree, targetDoc))
    expect(ledger.targetDoc).toBe(targetDoc)
  }, 30_000)
})
