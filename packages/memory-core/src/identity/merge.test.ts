import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync, symlinkSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { buildIdentityPaths } from "./layout"
import {
  applyIdentityMerge,
  findMergePredecessors,
  planIdentityMerge,
  repositoryCandidateDirs,
  repositoryWorktreeDirs,
} from "./merge"
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
    await recordIdentityBind(paths.root, { id, kind: "auto", mode: "path", source: spelling, spelling })
  }
  return { id, paths, repo }
}

const note = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`

function plumb(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync(
    "git",
    ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, input, stdio: ["pipe", "pipe", "ignore"] },
  ).toString()
}

/**
 * Commits `path` on top of HEAD with plumbing, replacing the top-level entry of the same name. `git mktree`
 * takes any entry name (`..`, `.git`, one holding a backslash), so this builds the tree porcelain refuses to
 * build but a store can still hold: written by another tool, cloned, or carried over from another system.
 */
function commitTreePath(repoDir: string, path: string, content: string): void {
  const names = path.split("/")
  let entry = `100644 blob ${plumb(repoDir, ["hash-object", "-w", "--stdin"], content).trim()}`
  for (const name of names.slice(1).reverse()) {
    entry = `040000 tree ${plumb(repoDir, ["mktree", "-z"], `${entry}\t${name}\0`).trim()}`
  }
  const kept = plumb(repoDir, ["ls-tree", "-z", "HEAD"])
    .split("\0")
    .filter((line) => line !== "" && !line.endsWith(`\t${names[0]}`))
  const tree = plumb(repoDir, ["mktree", "-z"], [...kept, `${entry}\t${names[0]}`, ""].join("\0")).trim()
  const commit = plumb(repoDir, ["commit-tree", tree, "-p", "HEAD", "-m", "a tree porcelain would refuse"]).trim()
  plumb(repoDir, ["update-ref", "HEAD", commit])
}

/** Every directory, file and link under `dir` (links unresolved), so a test can show what a merge touched. */
async function fingerprint(dir: string, skip: readonly string[] = []): Promise<Record<string, string>> {
  const seen: Record<string, string> = {}
  const walk = async (current: string, label: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const name = `${label}${entry.name}`
      if (skip.includes(name)) continue
      if (entry.isSymbolicLink()) seen[name] = `link to ${await readlink(join(current, entry.name))}`
      else if (entry.isDirectory()) {
        seen[`${name}/`] = "directory"
        await walk(join(current, entry.name), `${name}/`)
      } else seen[name] = await readFile(join(current, entry.name), "utf8")
    }
  }
  await walk(dir, "")
  return seen
}

function changedEntries(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after })
    .filter((name) => before[name] !== after[name])
    .sort()
}

// Object storage and the index are rewritten by git reads; no path a merge writes can name them.
const GIT_READ_STATE = ["repo/.git/objects", "repo/.git/index"]

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

  it("#given a predecessor with new, identical, differing and system files #when the merge is planned #then nothing is written and each file gets its action", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "notes/same.md": note("same"), "notes/diff.md": note("target") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      {
        "notes/new.md": note("new"),
        "notes/same.md": note("same"),
        "notes/diff.md": note("source"),
        "system/persona.md": note("persona"),
      },
      ["/work/project-feature"],
    )
    const headBefore = await target.repo.head()

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "notes/diff.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/notes/diff.md",
      },
      { path: "notes/new.md", action: "add", destination: "notes/new.md" },
      { path: "notes/same.md", action: "skip" },
      {
        path: "system/persona.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/system/persona.md",
      },
    ])
    expect(await target.repo.head()).toBe(headBefore)
  }, 30_000)

  it("#given a planned merge #when it is applied twice #then one commit carries the merge trailers, the target system/ is untouched, the source is marked mergedInto and the second apply is a no-op", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "system/persona.md": note("target persona"), "notes/diff.md": note("target") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      {
        "notes/new.md": note("new"),
        "notes/diff.md": note("source"),
        "system/persona.md": note("source persona"),
      },
      ["/work/project-feature"],
    )
    const sourceHead = await source.repo.head()

    const first = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    const second = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(first.status).toBe("merged")
    expect(second.status).toBe("already-merged")
    const commit = (await target.repo.log({ limit: 1 }))[0]
    expect(commit?.trailers["Omo-Merged-From"]).toBe("project-feature-bbbb2222")
    expect(commit?.trailers["Omo-Merged-Head"]).toBe(sourceHead ?? "")
    expect(await readFile(join(target.paths.repo, "system/persona.md"), "utf8")).toBe(note("target persona"))
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("new"))
    expect(
      await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/diff.md"), "utf8"),
    ).toBe(note("source"))
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({
      mergedInto: "project-aaaa1111",
      mergedHead: sourceHead,
    })
    expect(await source.repo.head()).toBe(sourceHead)
  }, 30_000)

  it("#given a source file whose path differs from a target file only in letter case #when the merge is planned #then it goes aside instead of overwriting the target on a case-insensitive disk (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/Habit.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/habit.md": note("source") }, [
      "/work/project-feature",
    ])

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "notes/habit.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/notes/habit.md",
      },
    ])
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

  it("#given an aside copy the user edited and committed in the target #when the source changes that file and the merge reruns #then the edit is kept and the new copy goes to a fresh aside path (#12974 review r4)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/diff.md": note("source v1") }, [
      "/work/project-feature",
    ])
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    const aside = "reference/merged/project-feature-bbbb2222/notes/diff.md"
    await writeFile(join(target.paths.repo, aside), note("user edit"))
    await target.repo.commitWrite([aside], "edit aside", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/diff.md"), note("source v2"))
    await source.repo.commitWrite(["notes/diff.md"], "v2", AUTHOR)

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, aside), "utf8")).toBe(note("user edit"))
    const fresh = rerun.plan.actions.find((action) => action.path === "notes/diff.md")
    expect(fresh?.action).toBe("keep-aside")
    expect(fresh !== undefined && fresh.action !== "skip" ? fresh.destination : "").not.toBe(aside)
    expect(
      await readFile(
        join(target.paths.repo, fresh !== undefined && fresh.action !== "skip" ? fresh.destination : ""),
        "utf8",
      ),
    ).toBe(note("source v2"))
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

  it("#given a source file that is not UTF-8 #when the merge applies #then it is refused before anything is written (#12974 review r5)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
      "/work/project-feature",
    ])
    await mkdir(join(source.paths.repo, "skills"), { recursive: true })
    await writeFile(
      join(source.paths.repo, "skills/icon.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]),
    )
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "skills/icon.png"], {
      cwd: source.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "icon"],
      { cwd: source.paths.repo, stdio: "ignore" },
    )
    const before = await target.repo.head()

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(Error)
    expect(String(outcome)).toContain("skills/icon.png")
    expect(await target.repo.head()).toBe(before)
    expect((await target.repo.status()).trim()).toBe("")
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

  it("#given a source path whose first segment is System/ #when the merge is planned #then it goes aside like system/ (#12974 review r6)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "system/persona.md": note("persona") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "System/x.md": note("x") }, [
      "/work/project-feature",
    ])

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "System/x.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/System/x.md",
      },
    ])
  }, 30_000)

  it("#given a merge that commits #when the write lock is released #then the source is already marked merged (#12974 review r6)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])
    let markedAtRelease: unknown
    const observingLock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => {
      const result = await operation()
      markedAtRelease = (await readIdentityRecord(source.paths.root))?.mergedInto
      return result
    }

    await applyIdentityMerge({ source: source.paths, target: target.paths, lock: observingLock, author: AUTHOR })

    expect(markedAtRelease).toBe("project-aaaa1111")
  }, 30_000)

  it("#given a target identity whose memory repository does not exist yet #when a store is merged into it #then the target repository is created and receives the files (#12974 review r7)", async () => {
    const root = await memoryRoot()
    const target = buildIdentityPaths(root, "project-aaaa1111")
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])

    const result = await applyIdentityMerge({
      source: source.paths,
      target,
      lock,
      author: AUTHOR,
      initTarget: (repo) => repo.init({ authorName: AUTHOR.authorName }),
    })

    expect(result.status).toBe("merged")
    expect(await readFile(join(target.repo, "notes/new.md"), "utf8")).toBe(note("new"))
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

  it("#given another writer creates the same path between the plan and the lock #when the merge applies #then the target's file is kept and the source copy goes aside (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("from source") }, [
      "/work/project-feature",
    ])
    const racingLock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => {
      await writeFile(join(target.paths.repo, "notes/new.md"), note("written meanwhile"))
      await target.repo.commitWrite(["notes/new.md"], "concurrent write", AUTHOR)
      return operation()
    }

    const result = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock: racingLock,
      author: AUTHOR,
    })

    expect(result.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("written meanwhile"))
    expect(
      await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/new.md"), "utf8"),
    ).toBe(note("from source"))
  }, 30_000)

  it("#given a carried file the commit refuses #when the merge applies #then it fails and the target is left clean (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
      "/work/project-feature",
    ])
    await writeFile(join(source.paths.repo, "notes/key.md"), note("aws AKIAABCDEFGHIJKLMNOP"))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "notes/key.md"], {
      cwd: source.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "seed key"],
      { cwd: source.paths.repo, stdio: "ignore" },
    )
    expect((await source.repo.lsTree("HEAD")).includes("notes/key.md")).toBe(true)

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect((await target.repo.status()).trim()).toBe("")
    expect(outcome).toBeInstanceOf(Error)
  }, 30_000)

  it("#given a store merged once whose target later deleted a file #when the source gains a new note and the merge reruns #then only the new note arrives and the deleted file stays deleted (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "notes/old.md": note("old"), "notes/aside.md": note("source aside") },
      ["/work/project-feature"],
    )
    await writeFile(join(target.paths.repo, "notes/aside.md"), note("target aside"))
    await target.repo.commitWrite(["notes/aside.md"], "target aside", AUTHOR)
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    await rm(join(target.paths.repo, "notes/old.md"))
    await target.repo.commitWrite(["notes/old.md"], "drop old", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/later.md"), note("later"))
    await source.repo.commitWrite(["notes/later.md"], "later", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("merged")
    expect(rerun.plan.actions.map((action) => action.path)).toEqual(["notes/later.md"])
    expect(await readFile(join(target.paths.repo, "notes/later.md"), "utf8")).toBe(note("later"))
    expect((await target.repo.lsTree("HEAD")).includes("notes/old.md")).toBe(false)
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)

  it("#given a merged store whose new commit only repeats content the target already has #when the merge reruns #then it reports nothing to merge and records the new head (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "notes/shared.md": note("shared"), "notes/diff.md": note("target diff") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "notes/one.md": note("one"), "notes/diff.md": note("source diff") },
      ["/work/project-feature"],
    )
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    await writeFile(join(source.paths.repo, "notes/shared.md"), note("shared"))
    await source.repo.commitWrite(["notes/shared.md"], "same as target", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("nothing-to-merge")
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)

  // Skipped on Windows because the fixture cannot be built there: Windows git refuses a backslash index path
  // (git update-index --cacheinfo ...\\..\\outside.md fails), a setup limit, not a gap in the guard. The same
  // escape is still covered on Windows by the table row "notes\\..\\..\\outside.md" in
  // "#given a source tree entry named %j ... both refuse it" below, whose tree is built with git mktree.
  it.skipIf(process.platform === "win32")(
    "#given a source path whose backslashes decode to a climb out of the repository #when the merge applies #then it is refused and nothing is written outside",
    async () => {
      const root = await memoryRoot()
      const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
      const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
        "/work/project-feature",
      ])
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: source.paths.repo,
        input: note("escaped"),
      })
        .toString()
        .trim()
      execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},notes\\..\\..\\outside.md`], {
        cwd: source.paths.repo,
        stdio: "ignore",
      })
      execFileSync(
        "git",
        ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "escape"],
        { cwd: source.paths.repo, stdio: "ignore" },
      )
      const before = await target.repo.head()
      const escaped = join(target.paths.repo, "..", "outside.md")

      const outcome = await applyIdentityMerge({
        source: source.paths,
        target: target.paths,
        lock,
        author: AUTHOR,
      }).catch((error: unknown) => error)

      expect(outcome).toBeInstanceOf(Error)
      expect(String(outcome)).toContain("outside the memory repository")
      expect(await target.repo.head()).toBe(before)
      expect(existsSync(escaped)).toBe(false)
    },
    30_000,
  )

  it("#given the target notes directory is a symlink to outside the repository #when the merge applies #then the write is refused and the outside directory stays empty", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])
    const outside = join(root, "outside")
    await mkdir(outside)
    await rm(join(target.paths.repo, "notes"), { recursive: true })
    symlinkSync(outside, join(target.paths.repo, "notes"))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "notes"], {
      cwd: target.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "link notes"],
      {
        cwd: target.paths.repo,
        stdio: "ignore",
      },
    )

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(Error)
    expect(existsSync(join(outside, "new.md"))).toBe(false)
  }, 30_000)

  // Security contract (#12974): a source tree is data. An entry name that is not plain `/`-separated names
  // must never reach the disk: `..` leaves the repository (or lands in its `.git`), a backslash is a
  // separator on Windows and in `restorePaths`, and git's own directory has more spellings than `.git`.
  it.each([
    ["deep/../../outside.md", note("carried")],
    ["deep/../system/persona.md", note("carried")],
    ["deep/.. /system/persona.md", note("carried")],
    ["deep/../.git/hooks/pre-commit", "#!/bin/sh\ntouch ../hook-ran\n"],
    ["deep/../.git/refs/heads/planted", note("carried")],
    ["notes/./base.md", note("carried")],
    ["notes\\..\\..\\outside.md", note("carried")],
    ["notes\\..\\system\\persona.md", note("carried")],
    ["system\\persona.md", note("carried")],
    ["skills/.git/config", "[core]\n\tbare = false\n"],
    ["skills/.GIT/config", "[core]\n\tbare = false\n"],
    ["skills/git~1/config", "[core]\n\tbare = false\n"],
    ["skills/.git./config", "[core]\n\tbare = false\n"],
    ["skills/.git /config", "[core]\n\tbare = false\n"],
    ["skills/.git::$INDEX_ALLOCATION/config", "[core]\n\tbare = false\n"],
    ["skills/.g\u200cit/config", "[core]\n\tbare = false\n"],
  ])(
    "#given a source tree entry named %j #when the merge is planned and applied #then both refuse it and nothing in or beside the target repository changes (#12974 security)",
    async (path, content) => {
      const root = await memoryRoot()
      const target = await identity(
        root,
        "project-aaaa1111",
        { "notes/base.md": note("base"), "system/persona.md": note("target persona") },
        ["/work/project"],
      )
      const hook = join(target.paths.repo, ".git/hooks/pre-commit")
      await mkdir(dirname(hook), { recursive: true })
      await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
      const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
        "/work/project-feature",
      ])
      commitTreePath(source.paths.repo, path, content)
      const before = await fingerprint(target.paths.root, GIT_READ_STATE)

      const planned = await planIdentityMerge(source.paths, target.paths).then(
        () => "planned",
        (error: unknown) => String(error),
      )
      const applied = await applyIdentityMerge({
        source: source.paths,
        target: target.paths,
        lock,
        author: AUTHOR,
      }).then(
        (result) => result.status,
        (error: unknown) => String(error),
      )

      expect(changedEntries(before, await fingerprint(target.paths.root, GIT_READ_STATE))).toEqual([])
      expect(planned).toContain(path)
      expect(applied).toContain(path)
    },
    30_000,
  )

  it.each([
    [
      "a tracked directory link",
      { "notes/kept.md": note("from source") },
      async (repo: string, outside: string) => {
        await rm(join(repo, "notes"), { recursive: true })
        symlinkSync(outside, join(repo, "notes"))
      },
    ],
    [
      "the aside root as a tracked link",
      { "notes/base.md": note("from source") },
      async (repo: string, outside: string) => {
        symlinkSync(outside, join(repo, "reference"))
      },
    ],
    [
      "a git-ignored file link",
      { "local/kept.md": note("from source") },
      async (repo: string, outside: string) => {
        await mkdir(join(repo, "local"))
        symlinkSync(join(outside, "kept.md"), join(repo, "local/kept.md"))
      },
    ],
  ] as const)(
    "#given a destination that leaves the target repository through %s #when the merge applies #then it is refused and nothing outside the repository is written, created or removed (#12974 security)",
    async (_link, sourceFiles, plant) => {
      const root = await memoryRoot()
      const outside = join(root, "outside")
      await mkdir(outside)
      await writeFile(join(outside, "kept.md"), "not memory\n")
      const target = await identity(
        root,
        "project-aaaa1111",
        { ".gitignore": "local/\n", "notes/base.md": note("base") },
        ["/work/project"],
      )
      await plant(target.paths.repo, outside)
      plumb(target.paths.repo, ["add", "-A"])
      plumb(target.paths.repo, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "links"])
      const source = await identity(root, "project-feature-bbbb2222", sourceFiles, ["/work/project-feature"])
      const outsideBefore = await fingerprint(outside)
      const targetBefore = await fingerprint(target.paths.root, GIT_READ_STATE)

      const outcome = await applyIdentityMerge({
        source: source.paths,
        target: target.paths,
        lock,
        author: AUTHOR,
      }).catch((error: unknown) => error)

      expect(changedEntries(outsideBefore, await fingerprint(outside))).toEqual([])
      expect(changedEntries(targetBefore, await fingerprint(target.paths.root, GIT_READ_STATE))).toEqual([])
      expect(outcome).toBeInstanceOf(Error)
    },
    30_000,
  )

  it("#given a merge that creates a new directory and is then refused at a later path #when it rolls back #then the directories it created are gone too (#12974 security review)", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { ".gitignore": "local/\n", "notes/base.md": note("base") },
      ["/work/project"],
    )
    await mkdir(join(target.paths.repo, "local"))
    await writeFile(join(target.paths.repo, "local/mine.md"), "kept out of memory on purpose\n")
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "fresh/deep/new.md": note("new"), "local/mine.md": note("from source") },
      ["/work/project-feature"],
    )

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(Error)
    expect(existsSync(join(target.paths.repo, "fresh"))).toBe(false)
    expect(await readFile(join(target.paths.repo, "local/mine.md"), "utf8")).toBe("kept out of memory on purpose\n")
    expect((await target.repo.status()).trim()).toBe("")
  }, 30_000)

  it.each([
    [
      "a git-ignored file",
      (repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "local/mine.md", note("from source"))
        return writeFile(join(repo, "local/mine.md"), "kept out of memory on purpose\n")
      },
    ],
    [
      "a git-ignored link to a tracked file",
      async (repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "local/mine.md", note("from source"))
        symlinkSync(join(repo, "system/persona.md"), join(repo, "local/mine.md"))
      },
    ],
    [
      // The same file only where the disk folds Unicode forms (default macOS); elsewhere a second file.
      "the other Unicode form of a tracked name",
      async (_repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "people/cafe\u0301.md", note("from source"))
      },
    ],
  ] as const)(
    "#given a planned path that is already on the target disk as %s #when the merge applies #then what was there keeps its bytes and the target is left clean (#12974 security)",
    async (_existing, plant) => {
      const root = await memoryRoot()
      const target = await identity(
        root,
        "project-aaaa1111",
        {
          ".gitignore": "local/\n",
          "system/persona.md": note("target persona"),
          "people/caf\u00e9.md": note("target person"),
        },
        ["/work/project"],
      )
      await mkdir(join(target.paths.repo, "local"))
      const source = await identity(root, "project-feature-bbbb2222", {}, ["/work/project-feature"])
      await plant(target.paths.repo, source.paths.repo)
      const before = await fingerprint(target.paths.repo, [".git"])

      await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR }).catch(
        (error: unknown) => error,
      )

      const after = await fingerprint(target.paths.repo, [".git"])
      expect(Object.keys(before).filter((name) => after[name] !== before[name])).toEqual([])
      expect((await target.repo.status()).trim()).toBe("")
    },
    30_000,
  )
})
