import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { realpathSync, symlinkSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"

import { applyIdentityMerge, findMergePredecessors, repositoryCandidateDirs, repositoryWorktreeDirs } from "./merge"
import { AUTHOR, identity, lock, memoryRoot, note, removeMergeRoots } from "./merge.test-support"
import { resolveAutoIdentity } from "./resolve"
import { recordIdentityBind } from "./record"

afterEach(removeMergeRoots)

describe("identity merge (#10070)", () => {
  it("#given per-worktree identities whose recorded spellings now resolve to the repository identity #when predecessors are found #then they are listed and an unrelated identity is reported unmapped", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", {}, ["/work/project"])
    await identity(root, "project-feature-bbbb2222", { "notes/a.md": note("a") }, ["/work/project-feature"])
    await identity(root, "other-cccc3333", { "notes/b.md": note("b") }, ["/elsewhere/other"])
    const resolve = (spelling: string) => (spelling.startsWith("/work/project") ? target.id : "other-cccc3333")

    const found = await findMergePredecessors(root, target.id, resolve)

    expect(found.predecessors.map((entry) => entry.id)).toEqual(["project-feature-bbbb2222"])
    expect(found.unmapped).toEqual(["other-cccc3333"])
  }, 30_000)

  it("#given a worktree store written before identity.json existed #when predecessors are found with the repository's live worktrees as candidates #then the store is found by its path-derived id (#12974 review)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "project")
    const thread = join(root, "checkout", "project-thread")
    await mkdir(main, { recursive: true })
    const git = (cwd: string, args: readonly string[]) =>
      execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], {
        cwd,
        stdio: "ignore",
      })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "thread", thread])
    const env = { OMO_MEMORY_HOME: root }
    const targetId = resolveAutoIdentity(main, env, "git").id
    const legacyId = resolveAutoIdentity(thread, env, "path").id
    await identity(root, targetId, {}, [main])
    await identity(root, legacyId, { "notes/old.md": note("old") }, [])

    const found = await findMergePredecessors(
      root,
      targetId,
      (spelling) => resolveAutoIdentity(spelling, env, "git").id,
      await repositoryWorktreeDirs([main]),
    )

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

    const found = await findMergePredecessors(
      root,
      targetId,
      (spelling) => resolveAutoIdentity(spelling, env, "git").id,
      await repositoryCandidateDirs([main, alias]),
    )

    expect(found.predecessors.map((entry) => entry.id).sort()).toEqual([aliasId, subId].sort())
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
    const git = (cwd: string, args: readonly string[]) =>
      execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], {
        cwd,
        stdio: "ignore",
      })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "thread", thread])
    const env = { OMO_MEMORY_HOME: root }
    const resolveGit = (spelling: string) => resolveAutoIdentity(spelling, env, "git").id
    const targetId = resolveGit(main)
    const legacyId = resolveAutoIdentity(thread, env, "path").id
    const target = await identity(root, targetId, {}, [main])
    const legacy = await identity(root, legacyId, { "notes/old.md": note("old") }, [])
    await applyIdentityMerge({ source: legacy.paths, target: target.paths, lock, author: AUTHOR })

    const found = await findMergePredecessors(root, targetId, resolveGit, await repositoryCandidateDirs([main]))

    expect(found.predecessors.find((entry) => entry.id === legacyId)).toMatchObject({
      mergedInto: targetId,
      mergedHead: await legacy.repo.head(),
    })
  }, 30_000)

  it("#given an explicit record on the path-derived store of a candidate directory #when predecessors are found #then the profile is not offered (#10070)", async () => {
    const root = await memoryRoot()
    const dir = "/work/project"
    const id = resolveAutoIdentity(dir, { OMO_MEMORY_HOME: root }, "path").id
    await identity(root, "project-aaaa1111", {}, ["/work/main"])
    const profile = await identity(root, id, { "notes/p.md": note("profile") }, [])
    await recordIdentityBind(profile.paths.root, { id, kind: "explicit", mode: "path", source: dir, spelling: dir })

    const found = await findMergePredecessors(
      root,
      "project-aaaa1111",
      (spelling) => (spelling === dir ? "project-aaaa1111" : "other"),
      [dir],
    )

    expect(found.predecessors.map((entry) => entry.id)).not.toContain(id)
    expect(found.unmapped).not.toContain(id)
  }, 30_000)

  it("#given an explicit profile store bound from a folder of this repository #when predecessors are found #then the profile is not offered (#12974 review r6)", async () => {
    const root = await memoryRoot()
    await identity(root, "project-aaaa1111", {}, ["/work/project"])
    const profile = await identity(root, "work-00e13ed7", { "notes/p.md": note("profile") }, [])
    await recordIdentityBind(profile.paths.root, {
      id: "work-00e13ed7",
      kind: "explicit",
      mode: "git",
      source: "work",
      spelling: "/work/project",
    })

    const found = await findMergePredecessors(root, "project-aaaa1111", (spelling) =>
      spelling === "/work/project" ? "project-aaaa1111" : spelling,
    )

    expect(found.predecessors.map((entry) => entry.id)).not.toContain("work-00e13ed7")
  }, 30_000)

  it("#given a linked worktree that lives outside the repository #when candidates are collected from its spelling #then the main checkout and every sibling worktree are found (#12974 review r7)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "project")
    const outside = join(root, "desktop", "threads", "t1")
    const sibling = join(root, "desktop", "threads", "t2")
    await mkdir(main, { recursive: true })
    await mkdir(dirname(outside), { recursive: true })
    const git = (cwd: string, args: readonly string[]) =>
      execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], {
        cwd,
        stdio: "ignore",
      })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "t1", outside])
    git(main, ["worktree", "add", "--quiet", "-b", "t2", sibling])

    const dirs = await repositoryWorktreeDirs([outside])

    expect(dirs).toEqual(expect.arrayContaining([realpathSync(main), realpathSync(sibling)]))
  }, 30_000)

  it("#given a linked worktree whose gitdir pointer is relative (worktree.useRelativePaths) #when candidates are collected #then it resolves against the pointer's own directory, never the process cwd (#12974 review)", async () => {
    const root = await memoryRoot()
    const main = join(root, "checkout", "project")
    const sibling = join(root, "checkout", "project-sibling")
    await mkdir(main, { recursive: true })
    const git = (cwd: string, args: readonly string[]) =>
      execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], {
        cwd,
        stdio: "ignore",
      })
    git(main, ["init", "--quiet", "--initial-branch=main"])
    git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(main, ["worktree", "add", "--quiet", "-b", "sibling", sibling])
    const pointer = join(main, ".git", "worktrees", basename(sibling), "gitdir")
    const absolute = (await readFile(pointer, "utf8")).trim()
    await writeFile(pointer, `${relative(dirname(pointer), absolute)}\n`)

    const dirs = await repositoryWorktreeDirs([main])

    expect(dirs).toEqual(expect.arrayContaining([realpathSync(main), realpathSync(sibling)]))
  }, 30_000)
})
