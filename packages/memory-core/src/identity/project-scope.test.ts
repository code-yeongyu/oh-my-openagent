import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MEMORY_ROOT_ENV_VAR } from "./layout"
import { createProjectIdentityResolver } from "./project-scope"
import { resolveAutoIdentity, resolveMemoryIdentity } from "./resolve"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(identityDirs: (layout: { workspace: string; child: string; sibling: string }) => readonly string[]) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "project-scope-")))
  roots.push(root)
  const workspace = join(root, "workspace")
  const child = join(workspace, "projects", "child")
  const sibling = join(root, "sibling")
  for (const dir of [join(child, "src"), sibling]) mkdirSync(dir, { recursive: true })
  const memoryRoot = join(root, "memory")
  const env = { [MEMORY_ROOT_ENV_VAR]: memoryRoot }
  for (const dir of identityDirs({ workspace, child, sibling })) {
    mkdirSync(resolveMemoryIdentity("auto", dir, env).paths.repo, { recursive: true })
  }
  return { workspace, child, sibling, env }
}

describe("createProjectIdentityResolver", () => {
  it("#given a child project with its own memory #when a file under it is touched #then that identity is returned", () => {
    // given
    const { workspace, child, env } = fixture(({ child }) => [child])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when
    const found = resolver.forPath(join(child, "src", "index.ts"))

    // then
    expect(found?.projectDir).toBe(child)
    expect(found?.identity.id).toBe(resolveMemoryIdentity("auto", child, env).id)
  })

  it("#given the session's own project has memory #when a file in it is touched #then nothing is returned", () => {
    // given
    const { workspace, env } = fixture(({ workspace }) => [workspace])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath(join(workspace, "README.md"))).toBeUndefined()
  })

  it("#given a project outside the session's working tree has memory #when its file is touched #then it is never returned", () => {
    // given
    const { workspace, sibling, env } = fixture(({ sibling }) => [sibling])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath(join(sibling, "notes.md"))).toBeUndefined()
  })

  it("#given no project under the file has memory #when it is touched #then nothing is returned and nothing is created", () => {
    // given
    const { workspace, child, env } = fixture(() => [])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when
    const found = resolver.forPath(join(child, "src", "index.ts"))

    // then
    expect(found).toBeUndefined()
    expect(existsSync(resolveMemoryIdentity("auto", child, env).paths.root)).toBe(false)
  })

  it("#given nested projects both with memory #when a file in the inner one is touched #then the nearest wins", () => {
    // given
    const { workspace, child, env } = fixture(({ workspace, child }) => [join(workspace, "projects"), child])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath(join(child, "src", "index.ts"))?.projectDir).toBe(child)
    expect(resolver.forPath(join(workspace, "projects", "other.md"))?.projectDir).toBe(join(workspace, "projects"))
  })

  it("#given a directory was already probed #when another file under it is touched #then the filesystem is not probed again", () => {
    // given
    const { workspace, child, env } = fixture(({ child }) => [child])
    let probes = 0
    const resolver = createProjectIdentityResolver({
      sessionCwd: workspace,
      env,
      exists: (path) => {
        probes += 1
        return existsSync(path)
      },
    })

    // when
    resolver.forPath(join(child, "src", "a.ts"))
    const afterFirst = probes
    resolver.forPath(join(child, "src", "b.ts"))

    // then
    expect(afterFirst).toBeGreaterThan(0)
    expect(probes).toBe(afterFirst)
  })

  it("#given a relative path #when it is touched #then it resolves against the session's working tree", () => {
    // given
    const { workspace, child, env } = fixture(({ child }) => [child])
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath("projects/child/src/index.ts")?.projectDir).toBe(child)
  })

  it("#given a workspace that links a project in by symlink #when a file is touched through the link or by its real path #then the project's identity is returned", () => {
    // given - Q's layout: a non-git workspace with `projects/omo -> /Volumes/.../omo`.
    const { workspace, sibling, env } = fixture(({ sibling }) => [sibling])
    mkdirSync(join(workspace, "projects"), { recursive: true })
    symlinkSync(sibling, join(workspace, "projects", "linked"))
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })
    const expected = resolveMemoryIdentity("auto", sibling, env).id

    // when
    const throughLink = resolver.forPath(join(workspace, "projects", "linked", "notes.md"))
    const byRealPath = resolver.forPath(join(sibling, "src", "notes.md"))

    // then
    expect(throughLink?.identity.id).toBe(expected)
    expect(byRealPath?.identity.id).toBe(expected)
  })

  it("#given a link to an ancestor of the session root #when a file of an unrelated project is touched through it or directly #then that project is never in scope", () => {
    // given - `ln -s <root> ws/up` would otherwise make every project under the root a linked project.
    const { workspace, sibling, env } = fixture(({ sibling }) => [sibling])
    symlinkSync(join(workspace, ".."), join(workspace, "up"))
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath(join(workspace, "up", "sibling", "notes.md"))).toBeUndefined()
    expect(resolver.forPath(join(sibling, "notes.md"))).toBeUndefined()
  })

  it("#given a link to a directory holding the memory root #when a project with memory beside the memory root is touched through it #then it is never in scope, with or without the root passed in", () => {
    // given - the memory root and a project with memory share one parent; the session links that parent.
    const { workspace, sibling } = fixture(() => [])
    const memoryRoot = join(sibling, "memory")
    const neighbour = join(sibling, "neighbour")
    mkdirSync(neighbour, { recursive: true })
    const env = { [MEMORY_ROOT_ENV_VAR]: memoryRoot }
    mkdirSync(resolveMemoryIdentity("auto", neighbour, env).paths.repo, { recursive: true })
    symlinkSync(sibling, join(workspace, "shared"))

    // when
    const passed = createProjectIdentityResolver({ sessionCwd: workspace, env, memoryRoot }).forPath(join(workspace, "shared", "neighbour", "a.ts"))
    const fromEnv = createProjectIdentityResolver({ sessionCwd: workspace, env }).forPath(join(workspace, "shared", "neighbour", "a.ts"))

    // then
    expect(passed).toBeUndefined()
    expect(fromEnv).toBeUndefined()
  })

  it("#given a symlink committed inside a git work tree #when a file through it is touched #then it is never followed", () => {
    // given - a symlink that is the repository's own content, not a linked-in project.
    const { workspace, sibling, env } = fixture(({ sibling }) => [sibling])
    mkdirSync(join(workspace, ".git"))
    symlinkSync(sibling, join(workspace, "linked"))
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env })

    // when / then
    expect(resolver.forPath(join(workspace, "linked", "notes.md"))).toBeUndefined()
    expect(resolver.forPath(join(sibling, "notes.md"))).toBeUndefined()
  })

  it("#given a relative OMO_MEMORY_HOME #when a child project is resolved #then its memory is looked up under the session's memory root, not per candidate directory", () => {
    // given
    const { workspace, child } = fixture(() => [])
    const env = { [MEMORY_ROOT_ENV_VAR]: "mem" }
    const memoryRoot = join(workspace, "mem")
    mkdirSync(resolveMemoryIdentity("auto", child, { [MEMORY_ROOT_ENV_VAR]: memoryRoot }).paths.repo, { recursive: true })
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env, memoryRoot })

    // when
    const found = resolver.forPath(join(child, "src", "index.ts"))

    // then
    expect(found?.identity.paths.repo.startsWith(memoryRoot)).toBe(true)
  })

  it("#given a linked worktree of a linked-in project #when a file in the worktree is touched #then git mode answers the main checkout and path mode the worktree's own memory", () => {
    // given - a linked main checkout and its linked worktree, each with memory.
    const { workspace, sibling, env } = fixture(() => [])
    const main = join(sibling, "main")
    const worktree = join(sibling, "main-wt")
    mkdirSync(main, { recursive: true })
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" })
    git(main, "init", "-q")
    git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init")
    git(main, "worktree", "add", "-q", worktree)
    mkdirSync(join(workspace, "projects"), { recursive: true })
    symlinkSync(main, join(workspace, "projects", "main"))
    symlinkSync(worktree, join(workspace, "projects", "main-wt"))
    const mainId = resolveAutoIdentity(main, env, "git").id
    const worktreeOwnId = resolveAutoIdentity(worktree, env, "path").id
    for (const id of [mainId, worktreeOwnId]) mkdirSync(join(env[MEMORY_ROOT_ENV_VAR], "agents", id, "repo"), { recursive: true })

    // when
    const gitMode = createProjectIdentityResolver({ sessionCwd: workspace, env, autoIdentity: "git" }).forPath(join(worktree, "a.ts"))
    const pathMode = createProjectIdentityResolver({ sessionCwd: workspace, env, autoIdentity: "path" }).forPath(join(worktree, "a.ts"))

    // then
    expect(gitMode?.identity.id).toBe(mainId)
    expect(pathMode?.identity.id).toBe(worktreeOwnId)
  })

  it("#given the session's own identity sits on a child path #when a file there is touched #then the bound identity is never returned", () => {
    // given
    const { workspace, child, env } = fixture(({ child }) => [child])
    const boundId = resolveMemoryIdentity("auto", child, env).id
    const resolver = createProjectIdentityResolver({ sessionCwd: workspace, env, boundId })

    // when / then
    expect(resolver.forPath(join(child, "src", "index.ts"))).toBeUndefined()
  })
})
