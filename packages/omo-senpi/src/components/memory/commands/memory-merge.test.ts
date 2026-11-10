import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, recordIdentityBind, resolveAutoIdentity, type MemoryIdentity } from "@oh-my-opencode/memory-core"
import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { registerMemoryMergeCommand } from "./memory-merge"
import { removeTree } from "../../../../../../test-support/remove-tree"

const GIT = ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false"]
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...GIT, ...args], { cwd, stdio: "ignore" })
}

async function seed(identity: MemoryIdentity, files: Record<string, string>): Promise<GitMemoryRepo> {
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ authorName: "qa" })
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo.dir, path)), { recursive: true })
    await writeFile(join(repo.dir, path), content)
  }
  await repo.commitWrite(Object.keys(files), "seed", { agentId: identity.id, authorName: "qa" })
  return repo
}

const note = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`

async function desktopLayout() {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-memory-merge-cmd-")))
  roots.push(parent)
  const main = join(parent, "project")
  const thread = join(parent, "project-thread-1")
  mkdirSync(main)
  git(main, ["init", "--quiet", "--initial-branch=main"])
  git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
  git(main, ["worktree", "add", "--quiet", "-b", "thread-1", thread])
  const env = { OMO_MEMORY_HOME: join(parent, "memory") }
  const target = resolveAutoIdentity(main, env, "git")
  const old = resolveAutoIdentity(thread, env, "path")
  const targetRepo = await seed(target, { "system/persona.md": note("main persona") })
  await seed(old, { "notes/habit.md": note("thread habit"), "system/persona.md": note("thread persona") })
  await recordIdentityBind(old.paths.root, { id: old.id, kind: "auto", mode: "path", source: thread, spelling: thread }, 1000)
  const pi = new MemoryFakeExtensionAPI()
  const deps = fakeDeps({ identity: target.id, identityPaths: target.paths }, { env })
  registerMemoryMergeCommand(pi, deps)
  return { pi, deps, target, old, targetRepo }
}

describe("/memory-merge (#10070)", () => {
  test("#given a Desktop thread worktree that wrote its own store #when /memory-merge runs without --apply #then it lists the store and its actions and changes nothing", async () => {
    const { pi, old, targetRepo } = await desktopLayout()
    const headBefore = await targetRepo.head()

    const text = await invoke(pi, "memory-merge", "", fakeCommandContext())

    expect(text).toContain(old.id)
    expect(text).toContain("1 to add")
    expect(text).toContain("1 kept aside")
    expect(text).toContain("/memory-merge --apply")
    expect(await targetRepo.head()).toBe(headBefore)
  }, 60_000)

  test("#given the same layout #when /memory-merge --apply runs twice #then the thread's memory lands in the repository store once, system/ is untouched, and the prompt cache is busted", async () => {
    const { pi, deps, target, old } = await desktopLayout()

    const first = await invoke(pi, "memory-merge", "--apply", fakeCommandContext())
    const second = await invoke(pi, "memory-merge", "--apply", fakeCommandContext())

    expect(first).toContain(`merged ${old.id}`)
    expect(second).toContain("already merged")
    expect(await readFile(join(target.paths.repo, "notes/habit.md"), "utf8")).toBe(note("thread habit"))
    expect(await readFile(join(target.paths.repo, "system/persona.md"), "utf8")).toBe(note("main persona"))
    expect(deps.busts).toEqual(["bust"])
  }, 60_000)

  test("#given an unknown flag #when /memory-merge runs #then it answers with usage and merges nothing", async () => {
    const { pi } = await desktopLayout()

    expect(await invoke(pi, "memory-merge", "--force", fakeCommandContext())).toContain("usage: /memory-merge [--apply]")
  }, 60_000)
  test("#given a user who pinned auto_identity to path #when /memory-merge runs at the repository root #then a subfolder store kept on purpose is not offered (#12974 review r6)", async () => {
    const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-memory-merge-path-")))
    roots.push(parent)
    const main = join(parent, "project")
    const sub = join(main, "packages", "sub")
    mkdirSync(sub, { recursive: true })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    const env = { OMO_MEMORY_HOME: join(parent, "memory") }
    const target = resolveAutoIdentity(main, env, "path")
    const subStore = resolveAutoIdentity(sub, env, "path")
    await seed(target, { "notes/root.md": note("root") })
    await seed(subStore, { "notes/sub.md": note("sub") })
    await recordIdentityBind(target.paths.root, { id: target.id, kind: "auto", mode: "path", source: main, spelling: main }, 1)
    await recordIdentityBind(subStore.paths.root, { id: subStore.id, kind: "auto", mode: "path", source: sub, spelling: sub }, 2)
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryMergeCommand(pi, fakeDeps({ identity: target.id, identityPaths: target.paths }, { env, loadSettings: () => ({ settings: memorySettings({ auto_identity: "path" }) }) }))

    const text = await invoke(pi, "memory-merge", "", fakeCommandContext())

    expect(text).toContain(`no other memory store maps to ${target.id}`)
  }, 60_000)
})
