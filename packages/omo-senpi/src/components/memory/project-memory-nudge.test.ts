import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from "node:fs"
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { MEMORY_ROOT_ENV_VAR, buildIdentityPaths, resolveMemoryIdentity, type ProjectScopeFs } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { isGrantedProjectMemoryRead } from "./project-memory-grants"
import { PROJECT_MEMORY_NUDGE_MAX_NOTES, createProjectMemoryScope, type ProjectMemorySwitches } from "./project-memory-nudge"
import { createSharedRecallCorpusCache } from "./recall-wiring"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`)
}

function commitNotes(repo: string, notes: Record<string, string>): void {
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q")
  // A synchronous commit can still launch detached maintenance that races root teardown.
  git(repo, "config", "maintenance.auto", "false")
  git(repo, "config", "gc.auto", "0")
  for (const [path, description] of Object.entries(notes)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), `---\ndescription: ${description}\n---\nbody of ${path}\n`)
  }
  git(repo, "add", "-A")
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed")
}

interface World {
  readonly pi: FakeExtensionAPI
  readonly own: MemoryIdentityContext
  readonly workspace: string
  readonly child: string
  readonly other: string
  readonly childRepo: string
  readonly switches: { current: ProjectMemorySwitches }
  readonly switchReads: () => number
}

function world(childNotes: Record<string, string> = { "reference/deploy.md": "how the child deploys" }, fs?: ProjectScopeFs, corpusCache = createSharedRecallCorpusCache(undefined)): World {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "project-memory-nudge-")))
  roots.push(root)
  const workspace = join(root, "workspace")
  const child = join(workspace, "child")
  const other = join(workspace, "other")
  for (const dir of [child, other]) mkdirSync(dir, { recursive: true })
  const env = { [MEMORY_ROOT_ENV_VAR]: join(root, "memory") }
  const childRepo = resolveMemoryIdentity("auto", child, env).paths.repo
  commitNotes(childRepo, childNotes)
  commitNotes(resolveMemoryIdentity("auto", other, env).paths.repo, { "notes/other.md": "the other project" })
  const ownIdentity = resolveMemoryIdentity("auto", workspace, env)
  const own = createMemoryIdentityContext({
    identity: ownIdentity.id,
    identityPaths: buildIdentityPaths(join(root, "memory"), ownIdentity.id),
    binding: { identity: ownIdentity.id, repoPathHash: "hash", boundAt: 1 },
  })
  const pi = new FakeExtensionAPI()
  const switches = { current: { nudge: true, recall: true } }
  let switchReads = 0
  createProjectMemoryScope({
    resolveContext: () => own,
    switches: () => {
      switchReads += 1
      return switches.current
    },
    fallbackCwd: () => workspace,
    corpusCache,
    env,
    ...(fs === undefined ? {} : { fs }),
  }).register(pi)
  return { pi, own, workspace, child, other, childRepo, switches, switchReads: () => switchReads }
}

function countingFs(): { readonly fs: ProjectScopeFs; readonly calls: () => number } {
  let calls = 0
  const counted = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => (...args: A): Promise<R> => {
    calls += 1
    return call(...args)
  }
  return {
    fs: {
      realpath: counted((path: string) => realpath(path)),
      lstat: counted((path: string) => lstat(path)),
      stat: counted((path: string) => stat(path)),
      readFile: counted((path: string, encoding: "utf8") => readFile(path, encoding)),
      readdir: counted((path: string) => readdir(path)),
    },
    calls: () => calls,
  }
}

const ctx = (w: World) => ({ cwd: w.workspace, sessionManager: { getSessionId: () => "session-1" } })

function holdCorpusReads(cache: ReturnType<typeof createSharedRecallCorpusCache>, failFirst = false) {
  const firstEntered = Promise.withResolvers<void>()
  const nextEntered = Promise.withResolvers<void>()
  const thirdEntered = Promise.withResolvers<void>()
  const firstRelease = Promise.withResolvers<void>()
  const nextRelease = Promise.withResolvers<void>()
  const load = cache.load.bind(cache)
  let calls = 0
  const spy = spyOn(cache, "load").mockImplementation(async (repo) => {
    const first = ++calls === 1
    if (calls === 3) thirdEntered.resolve()
    const entered = first ? firstEntered : nextEntered
    entered.resolve()
    await (first ? firstRelease : nextRelease).promise
    if (first && failFirst) throw new Error("project notes temporarily unavailable")
    return await load(repo)
  })
  return {
    spy, firstEntered: firstEntered.promise, nextEntered: nextEntered.promise, thirdEntered: thirdEntered.promise,
    releaseFirst: () => firstRelease.resolve(),
    releaseNext: () => nextRelease.resolve(),
    release: () => { firstRelease.resolve(); nextRelease.resolve() },
  }
}

async function readResult(w: World, path: string, toolName = "read"): Promise<string> {
  const original = [{ type: "text", text: "file body" }]
  const results = await w.pi.dispatch("tool_result", { type: "tool_result", toolName, input: { path }, content: original }, ctx(w))
  const changed = results.find((result): result is { content: { text?: string }[] } => typeof result === "object" && result !== null && "content" in result)
  return changed === undefined ? "" : changed.content.slice(original.length).map((block) => block.text ?? "").join("\n")
}

describe("project memory nudge (#10044)", () => {
  test("#given a fixture repo #when a commit finishes #then no automatic git maintenance child can outlive teardown", () => {
    const w = world()
    const trace = join(dirname(w.workspace), "git-trace.jsonl")

    const result = Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-q", "-m", "trace maintenance"],
      { cwd: w.childRepo, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_TRACE2_EVENT: trace } },
    )

    expect(result.exitCode).toBe(0)
    const events = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    expect(events.some((event) => event.event === "exit")).toBe(true)
    expect(events.filter((event) => event.event === "child_start" && event.argv?.some((arg) => arg === "maintenance" || arg === "gc"))).toEqual([])
  })

  test("#given a child project with memory #when the session first reads a file there #then one nudge lists its notes with a call to consult them", async () => {
    // given
    const w = world()

    // when
    const nudge = await readResult(w, join(w.child, "src", "index.ts"))

    // then
    expect(nudge).toContain(w.child)
    expect(nudge).toContain("reference/deploy.md")
    expect(nudge).toContain(w.childRepo)
    expect(nudge).not.toContain("body of reference/deploy.md")
  })

  test("#given a nudge was shown #when the session touches the same project again #then nothing more is added, while a second project gets its own", async () => {
    // given
    const w = world()
    await readResult(w, join(w.child, "a.ts"))

    // when
    const again = await readResult(w, join(w.child, "b.ts"), "edit")
    const second = await readResult(w, join(w.other, "c.ts"), "write")

    // then
    expect(again).toBe("")
    expect(second).toContain(w.other)
  })

  test("#given a project corpus read is pending #when another tool result touches it #then only the reserved read appends a nudge", async () => {
    const cache = createSharedRecallCorpusCache(undefined)
    const w = world(undefined, undefined, cache)
    const held = holdCorpusReads(cache)
    const first = readResult(w, join(w.child, "a.ts"))
    await held.firstEntered
    const second = readResult(w, join(w.child, "b.ts"), "edit")
    try {
      await Promise.race([second, held.nextEntered])
      held.release()
      const nudges = await Promise.all([first, second])
      expect(nudges[0]).toContain("reference/deploy.md")
      expect(nudges[1]).toBe("")
      expect(held.spy).toHaveBeenCalledTimes(1)
    } finally {
      held.release()
      await Promise.allSettled([first, second])
      held.spy.mockRestore()
    }
  })

  test("#given a project corpus read fails #when another touch retries #then the failed reservation does not suppress its nudge", async () => {
    const cache = createSharedRecallCorpusCache(undefined)
    const w = world(undefined, undefined, cache)
    const held = holdCorpusReads(cache, true)
    const first = readResult(w, join(w.child, "a.ts"))
    try {
      await held.firstEntered
      held.release()
      expect(await first).toBe("")
      expect(await readResult(w, join(w.child, "b.ts"))).toContain("reference/deploy.md")
      expect(held.spy).toHaveBeenCalledTimes(2)
    } finally {
      held.release()
      await first
      held.spy.mockRestore()
    }
  })

  test.each([{ failFirst: false }, { failFirst: true }])("#given a corpus read crosses compaction (fails=$failFirst) #when a new reservation starts #then the old completion neither nudges nor removes it", async ({ failFirst }) => {
    const cache = createSharedRecallCorpusCache(undefined)
    const w = world(undefined, undefined, cache)
    const held = holdCorpusReads(cache, failFirst)
    const first = readResult(w, join(w.child, "a.ts"))
    await held.firstEntered
    await w.pi.dispatch("session_compact", { type: "session_compact", accepted: true }, ctx(w))
    const second = readResult(w, join(w.child, "b.ts"))
    try {
      await held.nextEntered
      held.releaseFirst()
      expect(await first).toBe("")
      const third = readResult(w, join(w.child, "c.ts"))
      const thirdResult = await Promise.race([third, held.thirdEntered.then(() => undefined)])
      held.releaseNext()
      await third
      expect(thirdResult).toBe("")
      expect(held.spy).toHaveBeenCalledTimes(2)
      expect(await second).toContain("reference/deploy.md")
    } finally {
      held.release()
      await Promise.allSettled([first, second])
      held.spy.mockRestore()
    }
  })

  test("#given a project corpus read is pending #when its session shuts down #then completion leaves the tool result unchanged", async () => {
    const cache = createSharedRecallCorpusCache(undefined)
    const w = world(undefined, undefined, cache)
    const held = holdCorpusReads(cache)
    const first = readResult(w, join(w.child, "a.ts"))
    try {
      await held.firstEntered
      await w.pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx(w))
      held.release()
      expect(await first).toBe("")
      expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(false)
    } finally {
      held.release()
      await first
      held.spy.mockRestore()
    }
  })

  test("#given more notes than the cap #when nudged #then the list stops at the cap with a count of the rest", async () => {
    // given
    const notes = Object.fromEntries(Array.from({ length: PROJECT_MEMORY_NUDGE_MAX_NOTES + 4 }, (_, i) => [`n/${String(i).padStart(2, "0")}.md`, `note ${i}`]))
    const w = world(notes)

    // when
    const nudge = await readResult(w, join(w.child, "x.ts"))

    // then
    expect(nudge.split("\n").filter((line) => line.startsWith("- n/"))).toHaveLength(PROJECT_MEMORY_NUDGE_MAX_NOTES)
    expect(nudge).not.toContain(`n/${String(PROJECT_MEMORY_NUDGE_MAX_NOTES).padStart(2, "0")}.md`)
  })

  test("#given a file in the session's own project or outside any project with memory #when read #then the result is unchanged", async () => {
    // given
    const w = world()

    // when / then
    expect(await readResult(w, join(w.workspace, "README.md"))).toBe("")
    expect(await readResult(w, join(tmpdir(), "elsewhere.ts"))).toBe("")
  })

  test("#given the nudge switch is off #when a child file is read #then the result is unchanged but the project is still granted for recall", async () => {
    // given
    const w = world()
    w.switches.current = { nudge: false, recall: true }

    // when
    const nudge = await readResult(w, join(w.child, "x.ts"))

    // then
    expect(nudge).toBe("")
    expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(true)
  })

  test("#given both switches are off #when a child file is read #then nothing is added and nothing is granted", async () => {
    // given
    const w = world()
    w.switches.current = { nudge: false, recall: false }

    // when
    const nudge = await readResult(w, join(w.child, "x.ts"))

    // then
    expect(nudge).toBe("")
    expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(false)
  })

  test("#given a nudge was shown #when the session compacts #then the next touch nudges again", async () => {
    // given
    const w = world()
    await readResult(w, join(w.child, "a.ts"))

    // when
    await w.pi.dispatch("session_compact", { type: "session_compact", accepted: true }, ctx(w))

    // then
    expect(await readResult(w, join(w.child, "b.ts"))).toContain(w.child)
  })

  test("#given a session that shuts down #when it had read a child project #then that project's notes are no longer readable", async () => {
    // given
    const w = world()
    await readResult(w, join(w.child, "x.ts"))
    expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(true)

    // when
    await w.pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx(w))

    // then
    expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(false)
  })

  test("#given a session that touched a child project #when it touches files in the same directory again #then neither configuration nor the filesystem is read again", async () => {
    // given
    const counter = countingFs()
    const w = world(undefined, counter.fs)
    await readResult(w, join(w.child, "src", "a.ts"))
    const fsCallsAfterFirst = counter.calls()

    // when
    await readResult(w, join(w.child, "src", "b.ts"), "edit")
    await readResult(w, join(w.child, "src", "c.ts"), "write")

    // then
    expect(fsCallsAfterFirst).toBeGreaterThan(0)
    expect(counter.calls()).toBe(fsCallsAfterFirst)
    expect(w.switchReads()).toBe(1)
    expect(isGrantedProjectMemoryRead(w.own, join(w.childRepo, "reference", "deploy.md"))).toBe(true)
  })

  test("#given the tool-result path modules #when their sources are read #then none calls a synchronous filesystem API", () => {
    // given - architecture contract (#10044 review): the per-tool tool_result handler never blocks the event loop on fs.
    const sources = [
      join(import.meta.dir, "project-memory-nudge.ts"),
      join(import.meta.dir, "../../../../memory-core/src/identity/project-scope.ts"),
      join(import.meta.dir, "../../../../memory-core/src/identity/project-scope-fs.ts"),
    ]

    // when
    const syncCalls = sources.flatMap((source) => readFileSync(source, "utf8").match(/\b\w+Sync\b/g) ?? [])

    // then
    expect(syncCalls).toEqual([])
  })

  test("#given a failed read #when it targets a child file #then nothing is added", async () => {
    // given
    const w = world()

    // when
    const results = await w.pi.dispatch("tool_result", { type: "tool_result", toolName: "read", isError: true, input: { path: join(w.child, "x.ts") }, content: [] }, ctx(w))

    // then
    expect(results.every((result) => result === undefined)).toBe(true)
  })
})
