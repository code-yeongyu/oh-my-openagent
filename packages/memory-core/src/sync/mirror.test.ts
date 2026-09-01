import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { chmodSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo } from "../git"
import * as sync from "./index"
import {
  CONFIG_KEY,
  LOG_NAME,
  MirrorSync,
  SYNC_PUSH_ENV,
  getPostCommitHookScript,
  mirrorLogPath,
} from "./mirror"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    child.on("error", reject)
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })
}

async function tempDir(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

/** A repo with the post-commit snippet installed, run inline so pushes are deterministic. */
async function createRepo(): Promise<{ dir: string; repo: GitMemoryRepo; mirror: MirrorSync }> {
  const dir = await tempDir("memory-mirror-repo-")
  const repo = new GitMemoryRepo({ dir, agentId: "agent-mirror" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "seed\n" }] })
  await installPostCommit(dir)
  return { dir, repo, mirror: new MirrorSync({ repo }) }
}

async function installPostCommit(dir: string): Promise<void> {
  const path = join(dir, ".git", "hooks", "post-commit")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, getPostCommitHookScript(), "utf8")
  chmodSync(path, 0o755)
}

async function createBareMirror(): Promise<string> {
  const dir = await tempDir("memory-mirror-bare-")
  await run(["git", "init", "--bare", "--quiet", "--initial-branch=main"], dir)
  return dir
}

/** Commits through git so the installed post-commit hook actually fires. */
async function commitFile(dir: string, relativePath: string, body: string): Promise<RunResult> {
  const full = join(dir, relativePath)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, body, "utf8")
  await run(["git", "add", "-A"], dir)
  return run(["git", "commit", "-m", `write ${relativePath}`], dir, { [SYNC_PUSH_ENV]: "1" })
}

function readLog(dir: string): Promise<string> {
  return readFile(mirrorLogPath(dir), "utf8").catch(() => "")
}

describe("MirrorSync module surface", () => {
  describe("#given the push-only mirror contract", () => {
    it("#then no pull, fetch or import entry point is exposed", () => {
      // when
      const exported = Object.keys(sync)
      const methods = Object.getOwnPropertyNames(MirrorSync.prototype)

      // then
      for (const name of [...exported, ...methods]) {
        expect(name.toLowerCase()).not.toContain("pull")
        expect(name.toLowerCase()).not.toContain("fetch")
        expect(name.toLowerCase()).not.toContain("import")
      }
    })

    it("#then the config key and log name are the letta-parity omo names", () => {
      expect(CONFIG_KEY).toBe("omo.memoryRepository.url")
      expect(LOG_NAME).toBe("memory-repository-push.log")
    })

    it("#then the hook snippet never pushes from a non-main or detached HEAD", () => {
      // when
      const script = getPostCommitHookScript()

      // then
      expect(script).toContain(CONFIG_KEY)
      expect(script).toContain(LOG_NAME)
      expect(script).toContain("symbolic-ref")
      expect(script).toContain('"$branch" != "main"')
      expect(script).not.toContain("git pull")
      expect(script).not.toContain("git fetch")
    })
  })
})

describe("MirrorSync lifecycle", () => {
  describe("#given a bare file:// mirror", () => {
    it("#when set then a commit lands #then the mirror receives the commit", async () => {
      // given
      const { dir, mirror } = await createRepo()
      const bare = await createBareMirror()

      // when
      const result = await mirror.set(`file://${bare}`)
      const commit = await commitFile(dir, "system/persona.md", "hooked\n")

      // then
      expect(result.pushed).toBe(true)
      expect(commit.code).toBe(0)
      expect((await run(["git", "show", "main:system/persona.md"], bare)).stdout).toBe("hooked\n")
      expect(await readLog(dir)).toContain("exit=0")
    }, 30_000)

    it("#when set is called with trailing slashes #then the stored url is normalized", async () => {
      // given
      const { repo, mirror } = await createRepo()
      const bare = await createBareMirror()

      // when
      await mirror.set(`file://${bare}///`)

      // then
      expect(await repo.configGet(CONFIG_KEY)).toBe(`file://${bare}`)
      expect((await mirror.status()).url).toBe(`file://${bare}`)
    }, 30_000)

    it("#when set is called twice #then the second url wins", async () => {
      // given
      const { dir, mirror } = await createRepo()
      const first = await createBareMirror()
      const second = await createBareMirror()

      // when
      await mirror.set(`file://${first}`)
      await mirror.set(`file://${second}`)
      await commitFile(dir, "reference/notes.md", "second\n")

      // then
      expect((await mirror.status()).url).toBe(`file://${second}`)
      expect((await run(["git", "show", "main:reference/notes.md"], second)).stdout).toBe("second\n")
      expect((await run(["git", "show", "main:reference/notes.md"], first)).code).not.toBe(0)
    }, 30_000)

    it("#when unset #then later commits produce no new log lines", async () => {
      // given
      const { dir, mirror } = await createRepo()
      const bare = await createBareMirror()
      await mirror.set(`file://${bare}`)
      await commitFile(dir, "system/persona.md", "before unset\n")
      const before = await readLog(dir)
      expect(before).toContain("exit=0")

      // when
      await mirror.unset()
      await commitFile(dir, "reference/after.md", "after unset\n")

      // then
      expect(await readLog(dir)).toBe(before)
      expect((await mirror.status()).url).toBeUndefined()
    }, 30_000)
  })

  describe("#given an unreachable mirror", () => {
    it("#when set #then the config survives the failed initial push and the reason is reported", async () => {
      // given
      const { mirror } = await createRepo()
      const missing = join(await tempDir("memory-mirror-gone-"), "gone.git")

      // when
      const result = await mirror.set(`file://${missing}`)
      const status = await mirror.status()

      // then
      expect(result.pushed).toBe(false)
      expect(result.detail).not.toBe("")
      expect(status.url).toBe(`file://${missing}`)
      expect(status.aheadCount).toBeGreaterThan(0)
    }, 30_000)

    it("#when a commit lands #then the commit succeeds and the failure is logged in status", async () => {
      // given
      const { dir, mirror } = await createRepo()
      const missing = join(await tempDir("memory-mirror-gone-"), "gone.git")
      await mirror.set(`file://${missing}`)

      // when
      const commit = await commitFile(dir, "system/persona.md", "still local\n")
      const status = await mirror.status()

      // then
      expect(commit.code).toBe(0)
      expect((await run(["git", "log", "--oneline"], dir)).stdout).toContain("write system/persona.md")
      const log = await readLog(dir)
      expect(log).not.toContain("exit=0")
      expect(status.lastLogLines.length).toBeGreaterThan(0)
      expect(status.lastLogLines.join("\n")).toContain("exit=")
    }, 30_000)
  })

  describe("#given pushNow", () => {
    it("#when no mirror is configured #then it reports not-configured without throwing", async () => {
      // given
      const { mirror } = await createRepo()

      // when
      const result = await mirror.pushNow()

      // then
      expect(result.pushed).toBe(false)
      expect(result.detail).toContain("No memory repository configured")
    }, 30_000)

    it("#when a mirror is configured #then a one-shot foreground push lands and clears ahead", async () => {
      // given
      const { repo, mirror } = await createRepo()
      const bare = await createBareMirror()
      await repo.configSet(CONFIG_KEY, `file://${bare}`)
      expect((await mirror.status()).aheadCount).toBeGreaterThan(0)

      // when
      const result = await mirror.pushNow()

      // then
      expect(result.pushed).toBe(true)
      expect((await run(["git", "log", "--oneline", "main"], bare)).stdout).toContain("initialize")
      expect((await mirror.status()).aheadCount).toBe(0)
    }, 30_000)
  })

  describe("#given a credentialed url", () => {
    it("#when status is read #then the url is exposed redacted alongside the raw value", async () => {
      // given
      const { repo, mirror } = await createRepo()
      await repo.configSet(CONFIG_KEY, "https://alice:s3cr3t@example.com/acme/memory.git")

      // when
      const status = await mirror.status()

      // then
      expect(status.redactedUrl).toBe("https://***:***@example.com/acme/memory.git")
      expect(status.redactedUrl).not.toContain("s3cr3t")
    }, 30_000)

    /**
     * git scrubs userinfo from its own transport errors, so a failing push is
     * not by itself proof of redaction. The credential reaches an operator via
     * the log file, which a credential helper or an older git can write in
     * full, so the log tail is the surface that must be pinned.
     */
    it("#when the log contains a credentialed url #then the status tail is redacted", async () => {
      // given
      const { dir, repo, mirror } = await createRepo()
      await repo.configSet(CONFIG_KEY, "https://x-token:s3cr3t@example.com/acme/memory.git")
      await writeFile(
        mirrorLogPath(dir),
        [
          "--- 2026-08-09T00:00:00 abc1234 on main ---",
          "fatal: could not read from https://x-token:s3cr3t@example.com/acme/memory.git",
          "remote: denied for git@example.com:acme/memory.git",
          "exit=128",
        ].join("\n"),
        "utf8",
      )

      // when
      const status = await mirror.status()
      const tail = status.lastLogLines.join("\n")

      // then
      expect(tail).not.toContain("s3cr3t")
      expect(tail).not.toContain("x-token")
      expect(tail).toContain("https://***:***@example.com/acme/memory.git")
      expect(tail).toContain("***@example.com:acme/memory.git")
      expect(tail).toContain("exit=128")
    }, 30_000)

    it("#when a push to a credentialed remote fails #then the detail leaks no credential", async () => {
      // given
      const { mirror } = await createRepo()
      await mirror.set("https://x-token:s3cr3t@127.0.0.1:1/acme/memory.git")

      // when
      const result = await mirror.pushNow()

      // then
      expect(result.pushed).toBe(false)
      expect(result.detail).not.toContain("s3cr3t")
      expect(result.detail).not.toContain("x-token")
    }, 30_000)
  })
})
