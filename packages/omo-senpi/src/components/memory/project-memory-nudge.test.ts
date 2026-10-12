import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { MEMORY_ROOT_ENV_VAR, buildIdentityPaths, resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { isGrantedProjectMemoryRead } from "./project-memory-grants"
import { PROJECT_MEMORY_NUDGE_MAX_NOTES, createProjectMemoryScope, type ProjectMemorySwitches } from "./project-memory-nudge"
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
}

function world(childNotes: Record<string, string> = { "reference/deploy.md": "how the child deploys" }): World {
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
  createProjectMemoryScope({
    resolveContext: () => own,
    switches: () => switches.current,
    fallbackCwd: () => workspace,
    env,
  }).register(pi)
  return { pi, own, workspace, child, other, childRepo, switches }
}

const ctx = (w: World) => ({ cwd: w.workspace, sessionManager: { getSessionId: () => "session-1" } })

async function readResult(w: World, path: string, toolName = "read"): Promise<string> {
  const original = [{ type: "text", text: "file body" }]
  const results = await w.pi.dispatch("tool_result", { type: "tool_result", toolName, input: { path }, content: original }, ctx(w))
  const changed = results.find((result): result is { content: { text?: string }[] } => typeof result === "object" && result !== null && "content" in result)
  return changed === undefined ? "" : changed.content.slice(original.length).map((block) => block.text ?? "").join("\n")
}

describe("project memory nudge (#10044)", () => {
  test("#given a child project with memory #when the session first reads a file there #then one nudge lists its notes with a call to consult them", async () => {
    // given
    const w = world()

    // when
    const nudge = await readResult(w, join(w.child, "src", "index.ts"))

    // then
    expect(nudge).toContain(`[Project memory: ${w.child}]`)
    expect(nudge).toContain("- reference/deploy.md: how the child deploys")
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
    expect(second).toContain(`[Project memory: ${w.other}]`)
  })

  test("#given more notes than the cap #when nudged #then the list stops at the cap with a count of the rest", async () => {
    // given
    const notes = Object.fromEntries(Array.from({ length: PROJECT_MEMORY_NUDGE_MAX_NOTES + 4 }, (_, i) => [`n/${String(i).padStart(2, "0")}.md`, `note ${i}`]))
    const w = world(notes)

    // when
    const nudge = await readResult(w, join(w.child, "x.ts"))

    // then
    expect(nudge.split("\n").filter((line) => line.startsWith("- n/"))).toHaveLength(PROJECT_MEMORY_NUDGE_MAX_NOTES)
    expect(nudge).toContain("- +4 more")
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
    expect(await readResult(w, join(w.child, "b.ts"))).toContain("[Project memory:")
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

  test("#given a failed read #when it targets a child file #then nothing is added", async () => {
    // given
    const w = world()

    // when
    const results = await w.pi.dispatch("tool_result", { type: "tool_result", toolName: "read", isError: true, input: { path: join(w.child, "x.ts") }, content: [] }, ctx(w))

    // then
    expect(results.every((result) => result === undefined)).toBe(true)
  })
})
