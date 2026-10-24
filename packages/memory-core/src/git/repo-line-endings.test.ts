import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { createNodeGitExec } from "./exec"
import { GitMemoryRepo } from "./repo"
import { ensureRepoConfigDefaults } from "./repo-config-defaults"

const AUTHOR = { agentId: "agent", authorName: "Agent" }
const MIXED = "---\ndescription: mixed endings\n---\n# Note\r\n\r\nBody line.  \r\nlast\n"
const roots: string[] = []
const exec = createNodeGitExec()

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root)))
})

async function tempRoot(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-line-endings-")))
  roots.push(root)
  return root
}

async function git(cwd: string, argv: readonly string[]): Promise<string> {
  const result = await exec.run(argv, { cwd, timeoutMs: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (result.code !== 0) throw new Error(`git ${argv.join(" ")} failed: ${result.stderr}`)
  return result.stdout
}

// Git for Windows ships core.autocrlf=true in its system/global config. GIT_CONFIG_GLOBAL puts the
// same setting at the global layer on any OS, below the repository's own local config.
async function withWindowsDefaultAutocrlf<T>(root: string, task: () => Promise<T>): Promise<T> {
  const globalConfig = join(root, "global.gitconfig")
  await writeFile(globalConfig, "[core]\n\tautocrlf = true\n")
  const previous = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  try {
    return await task()
  } finally {
    if (previous.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previous.global
    if (previous.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = previous.nosystem
  }
}

// An older build never pinned core.autocrlf, so a converting checkout (Git for Windows) rewrote
// committed LF notes as CRLF and the index cached that copy's stat as clean. The file's mtime is moved
// into the past before the refresh, so the index entry is not "racily clean" and git trusts its stat.
async function convertedRepository(root: string): Promise<{ repo: GitMemoryRepo }> {
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
  await repo.init({ installHooks: async () => {} })
  await writeFile(join(repo.dir, "converted.md"), "alpha\nbeta\n")
  await writeFile(join(repo.dir, "edited.md"), "one\ntwo\n")
  await repo.commitWrite(["converted.md", "edited.md"], "seed", AUTHOR)
  await git(repo.dir, ["config", "--local", "core.autocrlf", "true"])
  await rm(join(repo.dir, "converted.md"))
  await git(repo.dir, ["checkout", "--", "converted.md"])
  const past = new Date("2020-01-01T00:00:00Z")
  await utimes(join(repo.dir, "converted.md"), past, past)
  await git(repo.dir, ["update-index", "-q", "--refresh"])
  await git(repo.dir, ["config", "--local", "--unset", "core.autocrlf"])
  await writeFile(join(repo.dir, "edited.md"), "one\r\ntwo changed\r\n")
  return { repo }
}

describe("memory repository line endings (#11109)", () => {
  test("#given a host whose git converts line endings #when a note is committed and checked out in a worktree #then git keeps every byte", async () => {
    const root = await tempRoot()
    await withWindowsDefaultAutocrlf(root, async () => {
      const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
      await repo.init({ installHooks: async () => {} })
      await writeFile(join(repo.dir, "note.md"), MIXED)
      await repo.commitWrite(["note.md"], "add a mixed-ending note", AUTHOR)

      expect(await git(repo.dir, ["cat-file", "blob", "HEAD:note.md"])).toBe(MIXED)
      const checkout = join(root, "checkout")
      await git(repo.dir, ["worktree", "add", "--detach", checkout, "HEAD"])
      expect(await readFile(join(checkout, "note.md"), "utf8")).toBe(MIXED)
    })
  })

  test("#given a converted CRLF copy that git's stat cache calls clean #when the repository is opened #then the committed bytes are restored and a real edit is kept", async () => {
    const { repo } = await convertedRepository(await tempRoot())
    // Precondition of the field case: git reports the CRLF copy as unchanged.
    expect(await readFile(join(repo.dir, "converted.md"), "utf8")).toBe("alpha\r\nbeta\r\n")
    expect((await git(repo.dir, ["status", "--porcelain", "--", "converted.md"])).trim()).toBe("")

    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })

    expect(await readFile(join(repo.dir, "converted.md"), "utf8")).toBe("alpha\nbeta\n")
    expect(await readFile(join(repo.dir, "edited.md"), "utf8")).toBe("one\r\ntwo changed\r\n")
    expect((await git(repo.dir, ["status", "--porcelain"])).trim()).toBe("M edited.md")
    expect((await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"])).trim()).toBe("false")
  })

  test("#given a pre-pin repository left mid-merge with a conflicted note #when it is opened #then init succeeds and records the pin", async () => {
    const root = await tempRoot()
    const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
    await repo.init({ installHooks: async () => {} })
    await writeFile(join(repo.dir, "note.md"), "base\n")
    await repo.commitWrite(["note.md"], "base", AUTHOR)
    await git(repo.dir, ["checkout", "-q", "-b", "side"])
    await writeFile(join(repo.dir, "note.md"), "side\n")
    await repo.commitWrite(["note.md"], "side", AUTHOR)
    await git(repo.dir, ["checkout", "-q", "main"])
    await writeFile(join(repo.dir, "note.md"), "main\n")
    await repo.commitWrite(["note.md"], "main", AUTHOR)
    await git(repo.dir, ["merge", "side"]).catch(() => "conflict")
    expect((await git(repo.dir, ["ls-files", "-u", "--", "note.md"])).trim()).not.toBe("")
    await git(repo.dir, ["config", "--local", "--unset", "core.autocrlf"])

    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })

    expect((await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"])).trim()).toBe("false")
    expect((await git(repo.dir, ["ls-files", "-u", "--", "note.md"])).trim()).not.toBe("")
  })

  test("#given a pre-pin repository stopped mid-rebase on a conflicted note #when it is opened #then init succeeds and the rebase state is untouched", async () => {
    const root = await tempRoot()
    const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
    await repo.init({ installHooks: async () => {} })
    await writeFile(join(repo.dir, "note.md"), "base\n")
    await repo.commitWrite(["note.md"], "base", AUTHOR)
    await git(repo.dir, ["checkout", "-q", "-b", "side"])
    await writeFile(join(repo.dir, "note.md"), "side\n")
    await repo.commitWrite(["note.md"], "side", AUTHOR)
    await git(repo.dir, ["checkout", "-q", "main"])
    await writeFile(join(repo.dir, "note.md"), "main\n")
    await repo.commitWrite(["note.md"], "main", AUTHOR)
    await git(repo.dir, ["checkout", "-q", "side"])
    await git(repo.dir, ["rebase", "main"]).catch(() => "conflict")
    const rebaseDir = (await git(repo.dir, ["rev-parse", "--git-path", "rebase-merge"])).trim()
    expect(await readFile(join(repo.dir, rebaseDir, "head-name"), "utf8").catch(() => "missing")).not.toBe("missing")
    await git(repo.dir, ["config", "--local", "--unset", "core.autocrlf"])

    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })

    expect((await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"])).trim()).toBe("false")
    expect(await readFile(join(repo.dir, rebaseDir, "head-name"), "utf8").catch(() => "missing")).not.toBe("missing")
    expect((await git(repo.dir, ["ls-files", "-u", "--", "note.md"])).trim()).not.toBe("")
  })

  test("#given a converted copy whose committed blob is missing #when it is opened #then init succeeds and the copy is left as it is", async () => {
    const { repo } = await convertedRepository(await tempRoot())
    const blob = (await git(repo.dir, ["rev-parse", ":converted.md"])).trim()
    const objectPath = (await git(repo.dir, ["rev-parse", "--git-path", `objects/${blob.slice(0, 2)}/${blob.slice(2)}`])).trim()
    await rm(join(repo.dir, objectPath))
    // A fresh mtime makes git list the path as changed, so the repair has to read the missing blob.
    await utimes(join(repo.dir, "converted.md"), new Date(), new Date())

    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })

    expect(await readFile(join(repo.dir, "converted.md"), "utf8")).toBe("alpha\r\nbeta\r\n")
    expect(await readFile(join(repo.dir, "edited.md"), "utf8")).toBe("one\r\ntwo changed\r\n")
  })

  test("#given a git call in the repair rejects (a Windows command-line limit, a timeout) #when the defaults are ensured #then they resolve and the pin is not recorded", async () => {
    const { repo } = await convertedRepository(await tempRoot())
    const config = async (argv: readonly string[]) => exec.run(["config", "--local", ...argv], { cwd: repo.dir, timeoutMs: 30_000 })
    const target = {
      dir: repo.dir,
      agentId: AUTHOR.agentId,
      configGet: async (key: string) => { const r = await config(["--get", key]); return r.code === 0 ? r.stdout.trim() : null },
      configSet: async (key: string, value: string) => { await config([key, value]) },
    }
    const rejecting = {
      result: async (argv: readonly string[], stdin?: string) => {
        if (argv.includes("update-index")) throw Object.assign(new Error("spawn ENAMETOOLONG"), { code: "ENAMETOOLONG" })
        return exec.run(argv, { cwd: repo.dir, timeoutMs: 30_000, ...(stdin === undefined ? {} : { stdin }) })
      },
    }

    await ensureRepoConfigDefaults(target, rejecting, AUTHOR.authorName)

    expect(await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"]).catch(() => "unset")).toBe("unset")
  })

  test("#given the repair cannot update the index #when the repository is opened #then init succeeds, the pin is not recorded, and the next open repairs it", async () => {
    const { repo } = await convertedRepository(await tempRoot())
    const lock = join(repo.dir, ".git", "index.lock")
    await writeFile(lock, "")

    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })
    expect(await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"]).catch(() => "unset")).toBe("unset")

    await rm(lock)
    await new GitMemoryRepo({ dir: repo.dir, agentId: AUTHOR.agentId }).init({ installHooks: async () => {} })
    expect(await readFile(join(repo.dir, "converted.md"), "utf8")).toBe("alpha\nbeta\n")
    expect((await git(repo.dir, ["status", "--porcelain", "--", "converted.md"])).trim()).toBe("")
    expect((await git(repo.dir, ["config", "--local", "--get", "core.autocrlf"])).trim()).toBe("false")
  })
})
