import { describe, expect, it } from "bun:test"
import { join, resolve } from "node:path"
import { type GitLayoutProbe, resolveLinkedWorktreeSource } from "./git-layout"

interface FakeTree {
  readonly directories?: readonly string[]
  readonly files?: Readonly<Record<string, string>>
  readonly realPaths?: Readonly<Record<string, string>>
}

function fakeProbe(tree: FakeTree): GitLayoutProbe {
  const directories = new Set(tree.directories ?? [])
  const files = new Map(Object.entries(tree.files ?? {}))
  const realPaths = new Map(Object.entries(tree.realPaths ?? {}))
  return {
    entryKind(path) {
      if (directories.has(path)) return "directory"
      if (files.has(path)) return "file"
      return undefined
    },
    readText(path) {
      return files.get(path)
    },
    realPath(path) {
      return realPaths.get(path) ?? path
    },
  }
}

const MAIN = resolve("/repos/project")
const COMMON = join(MAIN, ".git")
const WORKTREE = resolve("/worktrees/project-feature")
const ADMIN = join(COMMON, "worktrees", "project-feature")

function linkedWorktree(extra: Readonly<Record<string, string>> = {}): FakeTree {
  return {
    directories: [COMMON],
    files: {
      [join(WORKTREE, ".git")]: `gitdir: ${ADMIN}\n`,
      [join(ADMIN, "commondir")]: "../..\n",
      [join(ADMIN, "gitdir")]: `${join(WORKTREE, ".git")}\n`,
      ...extra,
    },
  }
}

function worktreeOf(commonDir: string, config: string): { readonly worktree: string; readonly tree: FakeTree } {
  const admin = join(commonDir, "worktrees", "feature")
  const worktree = resolve("/work/feature")
  return {
    worktree,
    tree: {
      directories: [commonDir],
      files: {
        [join(worktree, ".git")]: `gitdir: ${admin}\n`,
        [join(admin, "commondir")]: "../..\n",
        [join(admin, "gitdir")]: `${join(worktree, ".git")}\n`,
        [join(commonDir, "config")]: config,
      },
    },
  }
}

describe("resolveLinkedWorktreeSource", () => {
  it("#given a main checkout with a .git directory #when resolved #then it is not a linked worktree", () => {
    // given
    const probe = fakeProbe({ directories: [COMMON] })
    // when
    const source = resolveLinkedWorktreeSource(MAIN, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given the root of a linked worktree #when resolved #then the main working tree is the source", () => {
    // given
    const probe = fakeProbe(linkedWorktree())
    // when
    const source = resolveLinkedWorktreeSource(WORKTREE, probe)
    // then
    expect(source).toEqual({ hashSource: MAIN, slugSource: "project" })
  })

  it("#given a subdirectory of a linked worktree #when resolved #then it maps onto the same subdirectory of the main tree", () => {
    // given
    const probe = fakeProbe(linkedWorktree())
    // when
    const source = resolveLinkedWorktreeSource(join(WORKTREE, "packages", "api"), probe)
    // then
    expect(source).toEqual({ hashSource: join(MAIN, "packages", "api"), slugSource: "api" })
  })

  it("#given relative gitdir, commondir and back-pointer files with CRLF endings #when resolved #then each is resolved against its own directory", () => {
    // given
    const worktree = join(MAIN, "..", "project-relative")
    const admin = join(COMMON, "worktrees", "project-relative")
    const probe = fakeProbe({
      directories: [COMMON],
      files: {
        [join(worktree, ".git")]: "gitdir: ../project/.git/worktrees/project-relative\r\n",
        [join(admin, "commondir")]: "../..\r\n",
        [join(admin, "gitdir")]: "../../../../project-relative/.git\r\n",
      },
    })
    // when
    const source = resolveLinkedWorktreeSource(worktree, probe)
    // then
    expect(source).toEqual({ hashSource: MAIN, slugSource: "project" })
  })

  it("#given a worktree opened through a symlinked path #when resolved #then the back-pointer still matches its real path", () => {
    // given
    const link = resolve("/links/feature")
    const tree = linkedWorktree({ [join(link, ".git")]: `gitdir: ${ADMIN}\n` })
    const probe = fakeProbe({ ...tree, realPaths: { [join(link, ".git")]: join(WORKTREE, ".git") } })
    // when
    const source = resolveLinkedWorktreeSource(join(link, "src"), probe)
    // then
    expect(source).toEqual({ hashSource: join(MAIN, "src"), slugSource: "src" })
  })

  it("#given a pointer into another clone's admin dir whose back-pointer names a different checkout #when resolved #then it falls back to the path", () => {
    // given
    const forged = resolve("/elsewhere/forged")
    const tree = linkedWorktree({ [join(forged, ".git")]: `gitdir: ${ADMIN}\n` })
    const probe = fakeProbe(tree)
    // when
    const source = resolveLinkedWorktreeSource(forged, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given an admin dir without a gitdir back-pointer #when resolved #then it falls back to the path", () => {
    // given
    const probe = fakeProbe({
      directories: [COMMON],
      files: { [join(WORKTREE, ".git")]: `gitdir: ${ADMIN}\n`, [join(ADMIN, "commondir")]: "../..\n" },
    })
    // when
    const source = resolveLinkedWorktreeSource(WORKTREE, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given a worktree of a core.bare repository #when resolved #then the common dir is the source without its .git suffix in the slug", () => {
    // given
    const bare = resolve("/repos/project.git")
    const { worktree, tree } = worktreeOf(bare, "[core]\n\trepositoryformatversion = 0\n\tbare = true\n")
    const probe = fakeProbe(tree)
    // when
    const atRoot = resolveLinkedWorktreeSource(worktree, probe)
    const inSubdir = resolveLinkedWorktreeSource(join(worktree, "docs"), probe)
    // then
    expect(atRoot).toEqual({ hashSource: bare, slugSource: "project" })
    expect(inSubdir).toEqual({ hashSource: join(bare, "docs"), slugSource: "docs" })
  })

  it("#given a common dir with core.worktree set #when resolved #then that working tree is the source", () => {
    // given
    const commonDir = resolve("/gitdirs/project")
    const { worktree, tree } = worktreeOf(commonDir, '[core]\n\tbare = false\n\tworktree = "../../repos/main" ; set by hand\n')
    const probe = fakeProbe(tree)
    // when
    const source = resolveLinkedWorktreeSource(worktree, probe)
    // then
    expect(source).toEqual({ hashSource: resolve("/repos/main"), slugSource: "main" })
  })

  it("#given a --separate-git-dir common dir that names no working tree #when resolved #then it falls back to the path", () => {
    // given
    const commonDir = resolve("/gitdirs/sep.git")
    const { worktree, tree } = worktreeOf(commonDir, "[core]\n\trepositoryformatversion = 0\n\tbare = false\n")
    const probe = fakeProbe(tree)
    // when
    const source = resolveLinkedWorktreeSource(worktree, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given a gitdir pointer without a commondir file #when resolved #then it is treated as its own repository", () => {
    // given
    const submodule = join(MAIN, "vendor", "lib")
    const admin = join(COMMON, "modules", "lib")
    const probe = fakeProbe({
      directories: [COMMON],
      files: { [join(submodule, ".git")]: `gitdir: ${admin}\n` },
    })
    // when
    const source = resolveLinkedWorktreeSource(submodule, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given a .git file that is not a gitdir pointer #when resolved #then it falls back to the path", () => {
    // given
    const probe = fakeProbe({ files: { [join(WORKTREE, ".git")]: "not a pointer\n" } })
    // when
    const source = resolveLinkedWorktreeSource(WORKTREE, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given an unreadable .git file #when resolved #then it falls back to the path", () => {
    // given
    const probe: GitLayoutProbe = {
      entryKind: (path) => (path === join(WORKTREE, ".git") ? "file" : undefined),
      readText: () => undefined,
      realPath: (path) => path,
    }
    // when
    const source = resolveLinkedWorktreeSource(WORKTREE, probe)
    // then
    expect(source).toBeUndefined()
  })

  it("#given a directory outside any git checkout #when resolved #then the walk stops at the filesystem root", () => {
    // given
    const visited: string[] = []
    const probe: GitLayoutProbe = {
      entryKind(path) {
        visited.push(path)
        return undefined
      },
      readText: () => undefined,
      realPath: (path) => path,
    }
    const cwd = resolve("/plain/nested/dir")
    // when
    const source = resolveLinkedWorktreeSource(cwd, probe)
    // then
    expect(source).toBeUndefined()
    expect(visited).toEqual([
      join(cwd, ".git"),
      join(resolve("/plain/nested"), ".git"),
      join(resolve("/plain"), ".git"),
      join(resolve("/"), ".git"),
    ])
  })
})
