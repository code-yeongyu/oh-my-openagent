import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { realpathSync, symlinkSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { buildIdentityPaths } from "./layout"
import { applyIdentityMerge, findMergePredecessors, planIdentityMerge, repositoryCandidateDirs, repositoryWorktreeDirs } from "./merge"
import { resolveAutoIdentity } from "./resolve"
import { readIdentityRecord, recordIdentityBind } from "./record"

const AUTHOR: GitCommitAuthor = { agentId: "merge-test", authorName: "Merge Test", authorEmail: "merge@example.com" }
const lock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => operation()
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function memoryRoot(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-merge-")))
  roots.push(root)
  return root
}

async function identity(root: string, id: string, files: Record<string, string>, spellings: readonly string[]) {
  const paths = buildIdentityPaths(root, id)
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const written = Object.keys(files)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(paths.repo, path)), { recursive: true })
    await writeFile(join(paths.repo, path), content)
  }
  if (written.length > 0) await repo.commitWrite(written, `seed ${id}`, AUTHOR)
  for (const [index, spelling] of spellings.entries()) {
    await recordIdentityBind(paths.root, { id, kind: "auto", mode: "path", source: spelling, spelling }, 1000 + index)
  }
  return { id, paths, repo }
}

const note = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`

describe("identity merge (#10070)", () => {
  it("#given per-worktree identities whose recorded spellings now resolve to the repository identity #when predecessors are found #then they are listed and an unrelated identity is reported unmapped", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", {}, ["/work/project"])
    await identity(root, "project-feature-bbbb2222", { "notes/a.md": note("a") }, ["/work/project-feature"])
    await identity(root, "other-cccc3333", { "notes/b.md": note("b") }, ["/elsewhere/other"])
    const resolve = (spelling: string) => spelling.startsWith("/work/project") ? target.id : "other-cccc3333"

    const found = await findMergePredecessors(root, target.id, resolve)

    expect(found.predecessors.map((entry) => entry.id)).toEqual(["project-feature-bbbb2222"])
    expect(found.unmapped).toEqual(["other-cccc3333"])
  }, 30_000)

  it("#given a predecessor with new, identical, differing and system files #when the merge is planned #then nothing is written and each file gets its action", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/same.md": note("same"), "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", {
      "notes/new.md": note("new"),
      "notes/same.md": note("same"),
      "notes/diff.md": note("source"),
      "system/persona.md": note("persona"),
    }, ["/work/project-feature"])
    const headBefore = await target.repo.head()

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      { path: "notes/diff.md", action: "keep-aside", destination: "reference/merged/project-feature-bbbb2222/notes/diff.md" },
      { path: "notes/new.md", action: "add", destination: "notes/new.md" },
      { path: "notes/same.md", action: "skip" },
      { path: "system/persona.md", action: "keep-aside", destination: "reference/merged/project-feature-bbbb2222/system/persona.md" },
    ])
    expect(await target.repo.head()).toBe(headBefore)
  }, 30_000)

  it("#given a planned merge #when it is applied twice #then one commit carries the merge trailers, the target system/ is untouched, the source is marked mergedInto and the second apply is a no-op", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "system/persona.md": note("target persona"), "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", {
      "notes/new.md": note("new"),
      "notes/diff.md": note("source"),
      "system/persona.md": note("source persona"),
    }, ["/work/project-feature"])
    const sourceHead = await source.repo.head()

    const first = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })
    const second = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 6000 })

    expect(first.status).toBe("merged")
    expect(second.status).toBe("already-merged")
    const commit = (await target.repo.log({ limit: 1 }))[0]
    expect(commit?.trailers["Omo-Merged-From"]).toBe("project-feature-bbbb2222")
    expect(commit?.trailers["Omo-Merged-Head"]).toBe(sourceHead ?? "")
    expect(await readFile(join(target.paths.repo, "system/persona.md"), "utf8")).toBe(note("target persona"))
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("new"))
    expect(await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/diff.md"), "utf8")).toBe(note("source"))
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedInto: "project-aaaa1111", mergedHead: sourceHead })
    expect(await source.repo.head()).toBe(sourceHead)
  }, 30_000)

  it("#given a source file whose path differs from a target file only in letter case #when the merge is planned #then it goes aside instead of overwriting the target on a case-insensitive disk (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/Habit.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/habit.md": note("source") }, ["/work/project-feature"])

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([{ path: "notes/habit.md", action: "keep-aside", destination: "reference/merged/project-feature-bbbb2222/notes/habit.md" }])
  }, 30_000)

  it("#given a worktree store written before identity.json existed #when predecessors are found with the repository's live worktrees as candidates #then the store is found by its path-derived id (#12974 review)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "project")
    const thread = join(root, "checkout", "project-thread")
    await mkdir(main, { recursive: true })
    const git = (cwd: string, args: readonly string[]) => execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], { cwd, stdio: "ignore" })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "thread", thread])
    const env = { OMO_MEMORY_HOME: root }
    const targetId = resolveAutoIdentity(main, env, "git").id
    const legacyId = resolveAutoIdentity(thread, env, "path").id
    await identity(root, targetId, {}, [main])
    await identity(root, legacyId, { "notes/old.md": note("old") }, [])

    const found = await findMergePredecessors(root, targetId, (spelling) => resolveAutoIdentity(spelling, env, "git").id, await repositoryWorktreeDirs([main]))

    expect(found.predecessors.map((entry) => entry.id)).toEqual([legacyId])
  }, 30_000)

  it("#given pre-record stores for a repository subdirectory and for a symlinked spelling of the checkout #when candidates are collected from the target's recorded spellings #then both stores are found (#12974 review r3)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "proj")
    const alias = join(root, "checkout", "proj-link")
    await mkdir(join(main, "packages", "sub"), { recursive: true })
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: main, stdio: "ignore" })
    symlinkSync(main, alias)
    const env = { OMO_MEMORY_HOME: root }
    const targetId = resolveAutoIdentity(main, env, "git").id
    const subId = resolveAutoIdentity(join(main, "packages", "sub"), env, "path").id
    const aliasId = resolveAutoIdentity(alias, env, "path").id
    await identity(root, targetId, {}, [main, alias])
    await identity(root, subId, { "notes/sub.md": note("sub") }, [])
    await identity(root, aliasId, { "notes/alias.md": note("alias") }, [])

    const found = await findMergePredecessors(root, targetId, (spelling) => resolveAutoIdentity(spelling, env, "git").id, await repositoryCandidateDirs([main, alias]))

    expect(found.predecessors.map((entry) => entry.id).sort()).toEqual([aliasId, subId].sort())
  }, 30_000)

  it("#given an aside copy the user edited and committed in the target #when the source changes that file and the merge reruns #then the edit is kept and the new copy goes to a fresh aside path (#12974 review r4)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/diff.md": note("source v1") }, ["/work/project-feature"])
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })
    const aside = "reference/merged/project-feature-bbbb2222/notes/diff.md"
    await writeFile(join(target.paths.repo, aside), note("user edit"))
    await target.repo.commitWrite([aside], "edit aside", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/diff.md"), note("source v2"))
    await source.repo.commitWrite(["notes/diff.md"], "v2", AUTHOR)

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 6000 })

    expect(rerun.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, aside), "utf8")).toBe(note("user edit"))
    const fresh = rerun.plan.actions.find((action) => action.path === "notes/diff.md")
    expect(fresh?.action).toBe("keep-aside")
    expect(fresh !== undefined && fresh.action !== "skip" ? fresh.destination : "").not.toBe(aside)
    expect(await readFile(join(target.paths.repo, fresh !== undefined && fresh.action !== "skip" ? fresh.destination : ""), "utf8")).toBe(note("source v2"))
  }, 30_000)

  it("#given a nested repository inside the checkout with a pre-record store #when candidates are collected #then the nested repository's own store is not offered to the parent (#12974 review r4)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "proj")
    const nested = join(main, "libs", "lib")
    await mkdir(nested, { recursive: true })
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: main, stdio: "ignore" })
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: nested, stdio: "ignore" })
    const env = { OMO_MEMORY_HOME: root }
    const resolveGit = (spelling: string) => resolveAutoIdentity(spelling, env, "git").id
    const targetId = resolveGit(main)
    const nestedId = resolveAutoIdentity(nested, env, "path").id
    await identity(root, targetId, {}, [main])
    await identity(root, nestedId, { "notes/lib.md": note("lib") }, [])

    const found = await findMergePredecessors(root, targetId, resolveGit, await repositoryCandidateDirs([main]))

    expect(found.predecessors.map((entry) => entry.id)).not.toContain(nestedId)
  }, 30_000)

  it("#given a pre-record worktree store that was merged #when predecessors are collected again #then it carries its merge record so it is no longer pending (#12974 review r5)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "project")
    const thread = join(root, "checkout", "project-thread")
    await mkdir(main, { recursive: true })
    const git = (cwd: string, args: readonly string[]) => execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], { cwd, stdio: "ignore" })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "thread", thread])
    const env = { OMO_MEMORY_HOME: root }
    const resolveGit = (spelling: string) => resolveAutoIdentity(spelling, env, "git").id
    const targetId = resolveGit(main)
    const legacyId = resolveAutoIdentity(thread, env, "path").id
    const target = await identity(root, targetId, {}, [main])
    const legacy = await identity(root, legacyId, { "notes/old.md": note("old") }, [])
    await applyIdentityMerge({ source: legacy.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })

    const found = await findMergePredecessors(root, targetId, resolveGit, await repositoryCandidateDirs([main]))

    expect(found.predecessors.find((entry) => entry.id === legacyId)).toMatchObject({ mergedInto: targetId, mergedHead: await legacy.repo.head() })
  }, 30_000)

  it("#given a source file that is not UTF-8 #when the merge applies #then it is refused before anything is written (#12974 review r5)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, ["/work/project-feature"])
    await mkdir(join(source.paths.repo, "skills"), { recursive: true })
    await writeFile(join(source.paths.repo, "skills/icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "skills/icon.png"], { cwd: source.paths.repo, stdio: "ignore" })
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "icon"], { cwd: source.paths.repo, stdio: "ignore" })
    const before = await target.repo.head()

    const outcome = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(Error)
    expect(String(outcome)).toContain("skills/icon.png")
    expect(await target.repo.head()).toBe(before)
    expect((await target.repo.status()).trim()).toBe("")
  }, 30_000)

  it("#given another writer creates the same path between the plan and the lock #when the merge applies #then the target's file is kept and the source copy goes aside (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("from source") }, ["/work/project-feature"])
    const racingLock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => {
      await writeFile(join(target.paths.repo, "notes/new.md"), note("written meanwhile"))
      await target.repo.commitWrite(["notes/new.md"], "concurrent write", AUTHOR)
      return operation()
    }

    const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock: racingLock, author: AUTHOR, now: 5000 })

    expect(result.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("written meanwhile"))
    expect(await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/new.md"), "utf8")).toBe(note("from source"))
  }, 30_000)

  it("#given a carried file the commit refuses #when the merge applies #then it fails and the target is left clean (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, ["/work/project-feature"])
    await writeFile(join(source.paths.repo, "notes/key.md"), note("aws AKIAABCDEFGHIJKLMNOP"))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "notes/key.md"], { cwd: source.paths.repo, stdio: "ignore" })
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "seed key"], { cwd: source.paths.repo, stdio: "ignore" })
    expect((await source.repo.lsTree("HEAD")).includes("notes/key.md")).toBe(true)

    const outcome = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 }).catch((error: unknown) => error)

    expect((await target.repo.status()).trim()).toBe("")
    expect(outcome).toBeInstanceOf(Error)
  }, 30_000)

  it("#given a store merged once whose target later deleted a file #when the source gains a new note and the merge reruns #then only the new note arrives and the deleted file stays deleted (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/old.md": note("old"), "notes/aside.md": note("source aside") }, ["/work/project-feature"])
    await writeFile(join(target.paths.repo, "notes/aside.md"), note("target aside"))
    await target.repo.commitWrite(["notes/aside.md"], "target aside", AUTHOR)
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })
    await rm(join(target.paths.repo, "notes/old.md"))
    await target.repo.commitWrite(["notes/old.md"], "drop old", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/later.md"), note("later"))
    await source.repo.commitWrite(["notes/later.md"], "later", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 6000 })

    expect(rerun.status).toBe("merged")
    expect(rerun.plan.actions.map((action) => action.path)).toEqual(["notes/later.md"])
    expect(await readFile(join(target.paths.repo, "notes/later.md"), "utf8")).toBe(note("later"))
    expect((await target.repo.lsTree("HEAD")).includes("notes/old.md")).toBe(false)
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)

  it("#given a merged store whose new commit only repeats content the target already has #when the merge reruns #then it reports nothing to merge and records the new head (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/shared.md": note("shared"), "notes/diff.md": note("target diff") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/one.md": note("one"), "notes/diff.md": note("source diff") }, ["/work/project-feature"])
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })
    await writeFile(join(source.paths.repo, "notes/shared.md"), note("shared"))
    await source.repo.commitWrite(["notes/shared.md"], "same as target", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 6000 })

    expect(rerun.status).toBe("nothing-to-merge")
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)
})
