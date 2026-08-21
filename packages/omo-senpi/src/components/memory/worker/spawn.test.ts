import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

import { buildIdentityPaths, type FactsPayload, type ReflectionWorktree, type ReservedRun } from "@oh-my-opencode/memory-core"

import { loadedMemoryConfig, memorySettings } from "../memory.test-support"
import { prepareReflectionCandidateSpawn } from "./reflection-spawn-input"
import { prepareFactsSpawn, prepareReflectionForkSpawn, prepareReflectionSpawn } from "./spawn"
import { existsSync, realpathSync } from "node:fs"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

function chmodFailure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`chmod failed: ${code}`), { code })
}

async function root(): Promise<string> {
  const path = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-spawn-")))
  roots.push(path)
  return path
}

const payload: FactsPayload = {
  version: 1,
  identity: "agent-test",
  today: "2026-08-10",
  entries: [],
  knownPeople: [],
  primaryHuman: { slug: "human", aliases: [] },
}

const run: ReservedRun = {
  runId: "run-1",
  request: { trigger: "manual", conversationIds: [], snapshots: [] },
}

describe("worker payload mode relaxation", () => {
  test("#given a missing facts payload from the first launch #when mode relaxation reports ENOENT #then preparation continues", async () => {
    const runDir = await root()

    const prepared = await prepareFactsSpawn({
      runId: "facts-1",
      runDir,
      payload,
      model: "provider/model",
      env: {},
      chmodFile: async () => { throw chmodFailure("ENOENT") },
    })

    expect(prepared.paths.payload).toBe(join(runDir, "facts-payload.json"))
  })

  test("#given facts payload mode relaxation fails unexpectedly #when preparation runs #then the chmod failure is surfaced", async () => {
    const runDir = await root()

    const failure = await prepareFactsSpawn({
      runId: "facts-1",
      runDir,
      payload,
      model: "provider/model",
      env: {},
      chmodFile: async () => { throw chmodFailure("EPERM") },
    }).catch((error: unknown) => error)

    expect((failure as NodeJS.ErrnoException).code).toBe("EPERM")
  })

  test("#given reflection payload mode relaxation fails unexpectedly #when preparation runs #then the chmod failure is surfaced", async () => {
    const base = await root()
    const sessionDir = join(base, "sessions")

    const failure = await prepareReflectionSpawn({
      run,
      worktree: {
        dir: base,
        commonConfigPath: join(base, "config"),
      } as unknown as ReflectionWorktree,
      reflectionSessionsDir: sessionDir,
      category: "quick",
      model: "provider/model",
      env: {},
      mergePolicy: "auto",
      skillsUsageSource: join(base, "skills.json"),
      memoryUsageSource: join(base, "memory-usage.json"),
      dreamStateSource: join(base, "dream.json"),
      peoplePolicy: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      chmodFile: async () => { throw chmodFailure("EACCES") },
    }).catch((error: unknown) => error)

    expect((failure as NodeJS.ErrnoException).code).toBe("EACCES")
  })
})

describe("dream token budget launch contract", () => {
  test("#given a pressure dream fixture repo #when its spawn is prepared #then all three budget inputs carry the committed per-file estimate", async () => {
    const base = await root()
    await mkdir(join(base, "system"), { recursive: true })
    await Promise.all([
      writeFile(join(base, "system", "large.md"), "L".repeat(41)),
      writeFile(join(base, "system", "small.md"), "S".repeat(8)),
    ])
    const dreamRun: ReservedRun = {
      runId: "dream-pressure-1",
      request: { trigger: "dream", origin: "pressure", conversationIds: [], snapshots: [] },
    }

    const prepared = await prepareReflectionSpawn({
      run: dreamRun,
      worktree: {
        dir: base,
        commonConfigPath: join(base, "config"),
      } as unknown as ReflectionWorktree,
      reflectionSessionsDir: join(base, "sessions"),
      category: "quick",
      model: "provider/model",
      env: {},
      mergePolicy: "auto",
      skillsUsageSource: join(base, "skills.json"),
      memoryUsageSource: join(base, "memory-usage.json"),
      dreamStateSource: join(base, "dream.json"),
      peoplePolicy: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      systemTokenBudget: 100,
      systemTokenTarget: 80,
    })

    expect(prepared.env.SYSTEM_TOKENS_PATH).toBe(prepared.paths.systemTokens)
    expect(prepared.env.SYSTEM_TOKEN_BUDGET).toBe("100")
    expect(prepared.env.SYSTEM_TOKEN_TARGET).toBe("80")
    expect(JSON.parse(await readFile(prepared.paths.systemTokens!, "utf8"))).toEqual({
      totalTokens: 13,
      files: [
        { path: "system/large.md", bytes: 41, tokens: 11 },
        { path: "system/small.md", bytes: 8, tokens: 2 },
      ],
    })
  })

  test("#given configured compile pressure #when the production candidate assembly prepares a dream #then budget and target reuse the shared soft ratio", async () => {
    const base = await root()
    await mkdir(join(base, "system"), { recursive: true })
    await writeFile(join(base, "system", "persona.md"), "P".repeat(16))
    const identityPaths = buildIdentityPaths(base, "agent-test")
    const worktree = {
      dir: base,
      commonConfigPath: join(base, "config"),
    } as unknown as ReflectionWorktree

    const prepared = await prepareReflectionCandidateSpawn({
      run: {
        runId: "dream-config-1",
        request: { trigger: "dream", origin: "manual", conversationIds: [], snapshots: [] },
      },
      worktree,
      mergePolicy: "auto",
      category: "quick",
      candidate: { model: "provider/model" },
      attempt: 1,
      hardDeadlineAt: Date.now() + 10_000,
      config: loadedMemoryConfig(memorySettings({ compile_warn_tokens: 101 })).config,
      identity: { id: "agent-test", safeSlug: "agent-test", paths: identityPaths },
      env: {},
      senpiCommand: "/custom/senpi",
    })

    expect(prepared.env.SYSTEM_TOKEN_BUDGET).toBe("101")
    expect(prepared.env.SYSTEM_TOKEN_TARGET).toBe("80")
    expect(JSON.parse(await readFile(prepared.env.SYSTEM_TOKENS_PATH!, "utf8"))).toMatchObject({ totalTokens: 4 })
  })
})

describe("worker senpi command resolution", () => {
  // Reproduces a production reflection failure: the child died with
  // `sandbox-exec: execvp() of 'senpi' failed: No such file or directory`.
  // The senpi process had been launched from an environment whose PATH did not
  // contain the senpi bin dir, the PATH scan found nothing, and the resolver
  // handed the supervisor the bare name "senpi", which cannot be executed.
  test("#given an env whose PATH cannot resolve senpi #when a facts spawn is prepared #then the command is executable rather than the bare name", async () => {
    const runDir = await root()

    const prepared = await prepareFactsSpawn({
      runId: "facts-1",
      runDir,
      payload,
      model: "provider/model",
      env: { PATH: "/nonexistent-bin" },
    })

    expect(prepared.command).not.toBe("senpi")
    expect(isAbsolute(prepared.command)).toBe(true)
    expect(existsSync(prepared.command)).toBe(true)
  })

  test("#given an explicit senpiCommand #when a facts spawn is prepared #then the override is preserved", async () => {
    const runDir = await root()

    const prepared = await prepareFactsSpawn({
      runId: "facts-1",
      runDir,
      payload,
      model: "provider/model",
      env: { PATH: "/nonexistent-bin" },
      senpiCommand: "/custom/senpi",
    })

    expect(prepared.command).toBe("/custom/senpi")
  })
})

describe("worker senpi prefix args", () => {
  const PREFIX_MARKER = "<marker>.js"

  function reflectionInput(base: string) {
    return {
      run,
      worktree: {
        dir: base,
        commonConfigPath: join(base, "config"),
      } as unknown as ReflectionWorktree,
      reflectionSessionsDir: join(base, "sessions"),
      category: "quick",
      model: "provider/model",
      env: {},
      mergePolicy: "auto" as const,
      skillsUsageSource: join(base, "skills.json"),
      memoryUsageSource: join(base, "memory-usage.json"),
      dreamStateSource: join(base, "dream.json"),
      peoplePolicy: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      senpiCommand: "/custom/senpi",
      senpiPrefixArgs: [PREFIX_MARKER],
    }
  }

  test("#given senpiCommand and senpiPrefixArgs #when a reflection spawn is prepared #then the command is preserved and args start with the prefix", async () => {
    const prepared = await prepareReflectionSpawn(reflectionInput(await root()))

    expect(prepared.command).toBe("/custom/senpi")
    expect(prepared.args[0]).toBe(PREFIX_MARKER)
  })

  test("#given senpiCommand and senpiPrefixArgs #when a reflection fork spawn is prepared #then args start with the prefix before -p/--fork", async () => {
    const base = await root()
    const prepared = await prepareReflectionForkSpawn({
      ...reflectionInput(base),
      parentSessionFile: join(base, "parent.jsonl"),
    })

    expect(prepared.args[0]).toBe(PREFIX_MARKER)
    expect(prepared.args.indexOf("-p")).toBeGreaterThan(0)
    expect(prepared.args.indexOf("--fork")).toBeGreaterThan(prepared.args.indexOf("-p"))
  })

  test("#given runner-style senpiPrefixArgs #when prepareReflectionCandidateSpawn builds the spawn #then the prefix is forwarded onto args", async () => {
    const base = await root()
    const prepared = await prepareReflectionCandidateSpawn({
      run,
      worktree: {
        dir: base,
        commonConfigPath: join(base, "config"),
      } as unknown as ReflectionWorktree,
      mergePolicy: "auto",
      category: "quick",
      candidate: { model: "provider/model" },
      attempt: 1,
      hardDeadlineAt: Date.now() + 10_000,
      config: loadedMemoryConfig(memorySettings()).config,
      identity: { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(base, "agent-test") },
      env: {},
      senpiCommand: "/custom/senpi",
      senpiPrefixArgs: [PREFIX_MARKER],
    })

    expect(prepared.command).toBe("/custom/senpi")
    expect(prepared.args[0]).toBe(PREFIX_MARKER)
  })
})
