/// <reference types="bun-types" />

import { realpathSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import {
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  makeTempDir,
  sourceFile,
  writeFileAt,
} from "./fixtures.test-support"
import {
  gitChurnLoc,
  gitCommitsSince,
  gitCommonDirRealpath,
  gitHead,
  gitIsRepo,
  gitObjectType,
  gitToplevel,
  gitTotalLoc,
  gitTouchedFilesSince,
  gitTrackedFileCount,
} from "./git-helpers"

// This suite creates real Git repositories and commits. Keep the default strict on POSIX,
// but give loaded Windows runners enough headroom for Git-for-Windows process startup.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)

afterEach(() => {
  cleanupTempDirs()
})

function repoWithCommit(): { root: string; sha: string } {
  const root = initRepo("omo-git-helpers-")
  writeFileAt(root, join("src", "a.ts"), sourceFile(10))
  writeFileAt(root, join("src", "b.ts"), sourceFile(10))
  const sha = commitAll(root, "init")
  return { root, sha }
}

describe("gitIsRepo", () => {
  test("#given a git repo #when checking #then it returns true", () => {
    // given
    const { root } = repoWithCommit()

    // when / then
    expect(gitIsRepo(root)).toBe(true)
  })

  test("#given a plain directory #when checking #then it returns false", () => {
    // given
    const dir = makeTempDir("omo-git-nonrepo-")

    // when / then
    expect(gitIsRepo(dir)).toBe(false)
  })

  test("#given a plain directory #when checking from a child process #then stderr is empty, gitIsRepo is false, and gitToplevel is null", async () => {
    // given
    const dir = makeTempDir("omo-git-nonrepo-child-")
    const helpersUrl = pathToFileURL(join(import.meta.dir, "git-helpers.ts")).href
    writeFileAt(
      dir,
      "probe.ts",
      `import { gitIsRepo, gitToplevel } from ${JSON.stringify(helpersUrl)}
const dir = ${JSON.stringify(dir)}
process.stdout.write(JSON.stringify({ isRepo: gitIsRepo(dir), toplevel: gitToplevel(dir) }))
`,
    )

    // when
    const child = Bun.spawn({
      cmd: [process.execPath, join(dir, "probe.ts")],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    // then
    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(JSON.parse(stdout)).toEqual({ isRepo: false, toplevel: null })
  })
})

describe("gitToplevel", () => {
  test("#given a git repo #when resolving toplevel #then it returns the repo root", () => {
    // given
    const { root } = repoWithCommit()

    // when
    const toplevel = gitToplevel(root)

    // then
    expect(toplevel).toBe(realpathSync(root))
    // git prints forward slashes on every platform; the helper hands back a native path.
    expect(toplevel).toBe(resolve(toplevel ?? ""))
    if (sep === "\\") expect(toplevel).not.toContain("/")
  })
})

describe("gitHead and gitCommitsSince", () => {
  test("#given a repo with commits #when reading HEAD #then it matches rev-parse", () => {
    // given
    const { root, sha } = repoWithCommit()

    // when
    const head = gitHead(root)

    // then
    expect(head).toBe(sha)
  })

  test("#given five commits after a base sha #when counting #then it returns five", () => {
    // given
    const { root, sha } = repoWithCommit()
    for (let index = 0; index < 5; index++) {
      writeFileAt(root, join("src", "a.ts"), sourceFile(10 + index + 1))
      commitAll(root, `change ${index}`)
    }

    // when
    const count = gitCommitsSince(root, sha)

    // then
    expect(count).toBe(5)
  })
})

describe("gitTrackedFileCount", () => {
  test("#given a repo with two tracked files #when counting #then it returns two", () => {
    // given
    const { root } = repoWithCommit()

    // when
    const count = gitTrackedFileCount(root)

    // then
    expect(count).toBe(2)
  })

  test("#given a platform-valid delimiter-sensitive filename #when counting #then NUL delimiting keeps the count correct", () => {
    // given
    const { root } = repoWithCommit()
    const filename = process.platform === "win32" ? "we ird.ts" : "we\nird.ts"
    writeFileAt(root, filename, sourceFile(2))
    commitAll(root, "weird name")

    // when
    const count = gitTrackedFileCount(root)

    // then
    expect(count).toBe(3)
  })
})

describe("gitTouchedFilesSince", () => {
  test("#given commits touching one file #when listing touched files #then only that file is returned", () => {
    // given
    const { root, sha } = repoWithCommit()
    writeFileAt(root, join("src", "a.ts"), sourceFile(30))
    commitAll(root, "touch a")

    // when
    const touched = gitTouchedFilesSince(root, sha)

    // then
    expect(touched).toEqual(["src/a.ts"])
  })

  test("#given commits touching only AGENTS.md and the snapshot #when listing touched files #then they are excluded", () => {
    // given
    const { root, sha } = repoWithCommit()
    writeFileAt(root, "AGENTS.md", "# root")
    writeFileAt(root, join("src", "AGENTS.md"), "# nested")
    writeFileAt(root, join(".omo", "init-deep.json"), "{}")
    commitAll(root, "add agents docs")

    // when
    const touched = gitTouchedFilesSince(root, sha)

    // then
    expect(touched).toEqual([])
  })
})

describe("gitChurnLoc", () => {
  test("#given a file grown by two lines #when summing churn #then added and deleted lines both count", () => {
    // given
    const { root, sha } = repoWithCommit()
    writeFileAt(root, join("src", "a.ts"), sourceFile(12))
    commitAll(root, "grow a")

    // when
    const churn = gitChurnLoc(root, sha)

    // then
    expect(churn).toBe(4)
  })

  test("#given a binary file change #when summing churn #then binary rows contribute zero", () => {
    // given
    const { root, sha } = repoWithCommit()
    writeFileAt(root, "blob.bin", "\u0000\u0001\u0002binary\u0000")
    commitAll(root, "add binary")

    // when
    const churn = gitChurnLoc(root, sha)

    // then
    expect(churn).toBe(0)
  })
})

describe("gitTotalLoc", () => {
  test("#given tracked source files #when summing total LOC #then it counts their lines", () => {
    // given
    const { root } = repoWithCommit()

    // when
    const totalLoc = gitTotalLoc(root)

    // then
    expect(totalLoc).toBe(18)
  })
})

describe("gitObjectType", () => {
  test("#given a commit sha #when reading its object type #then it is commit", () => {
    // given
    const { root, sha } = repoWithCommit()

    // when / then
    expect(gitObjectType(root, sha)).toBe("commit")
  })

  test("#given tree, blob, tag and invalid shas #when reading object types #then non-commit types are reported", () => {
    // given
    const { root } = repoWithCommit()
    const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]).trim()
    const blobSha = git(root, ["rev-parse", "HEAD:src/a.ts"]).trim()
    git(root, ["tag", "-a", "v1", "-m", "tagged"])
    const tagSha = git(root, ["rev-parse", "v1"]).trim()

    // when / then
    expect(gitObjectType(root, treeSha)).toBe("tree")
    expect(gitObjectType(root, blobSha)).toBe("blob")
    expect(gitObjectType(root, tagSha)).toBe("tag")
    expect(gitObjectType(root, "0".repeat(40))).toBeNull()
  })
})

describe("gitCommonDirRealpath", () => {
  test("#given a repo #when resolving the common dir #then it is the realpath of .git", () => {
    // given
    const { root } = repoWithCommit()

    // when
    const commonDir = gitCommonDirRealpath(root)

    // then
    expect(commonDir).toBe(realpathSync(join(root, ".git")))
  })
})
