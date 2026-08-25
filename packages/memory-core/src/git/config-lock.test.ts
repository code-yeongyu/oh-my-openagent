import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import {
  GitMemoryRepo,
  type GitExec,
  type GitExecOptions,
  type GitExecResult,
  createNodeGitExec,
  isGitLockError,
  withGitLockRetry,
  withSerializedGitConfigMutation,
} from "./index"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

class ContentionProbeExec implements GitExec {
  activeConfigWrites = 0
  maxConfigWrites = 0
  readonly inner = createNodeGitExec()

  async run(argv: readonly string[], options: GitExecOptions): Promise<GitExecResult> {
    const isConfigWrite = argv[0] === "config" && argv.includes("--local") && !argv.includes("--get")
    if (!isConfigWrite) return this.inner.run(argv, options)

    this.activeConfigWrites += 1
    this.maxConfigWrites = Math.max(this.maxConfigWrites, this.activeConfigWrites)
    await Promise.resolve()
    try {
      return await this.inner.run(argv, options)
    } finally {
      this.activeConfigWrites -= 1
    }
  }
}

describe("serialized git config", () => {
  it("#given transient config.lock failures #when a mutation runs #then it retries with bounded backoff", async () => {
    // given
    let attempts = 0

    // when
    await withSerializedGitConfigMutation("/tmp/config-retry-test", async () => {
      attempts += 1
      if (attempts < 3) throw new Error("could not lock config file .git/config: File exists")
    })

    // then
    expect(attempts).toBe(3)
  })

  it("#given two concurrent configSet calls #when they mutate one repo #then their git config processes do not overlap", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-config-lock-")))
    tempDirs.push(dir)
    const exec = new ContentionProbeExec()
    const repo = new GitMemoryRepo({ dir, agentId: "lock-agent", exec })
    await repo.init()

    // when
    await Promise.all([
      repo.configSet("omo.testOne", "one"),
      repo.configSet("omo.testTwo", "two"),
    ])

    // then
    expect(exec.maxConfigWrites).toBe(1)
    expect(await repo.configGet("omo.testOne")).toBe("one")
    expect(await repo.configGet("omo.testTwo")).toBe("two")
  })
})

describe("git lock error classification", () => {
  it("#given a real index.lock contention message #when classified #then it is a retryable lock error", () => {
    // given - verbatim stderr captured from 24 concurrent commits against one repo
    const message = [
      "fatal: Unable to create '/tmp/probe/.git/index.lock': File exists.",
      "",
      "Another git process seems to be running in this repository, e.g.",
      "an editor opened by 'git commit'.",
    ].join("\n")

    // when / then
    expect(isGitLockError(new Error(message))).toBe(true)
  })

  it("#given a ref lock failure #when classified #then it is a retryable lock error", () => {
    // given
    const message = "fatal: cannot lock ref 'HEAD': Unable to create '/tmp/probe/.git/HEAD.lock': File exists."

    // when / then
    expect(isGitLockError(new Error(message))).toBe(true)
  })

  it("#given the config.lock message #when classified #then it stays a retryable lock error", () => {
    // given
    const message = "error: could not lock config file .git/config: File exists"

    // when / then
    expect(isGitLockError(new Error(message))).toBe(true)
  })

  it("#given an unrelated git failure #when classified #then it is NOT retryable", () => {
    // given - a genuine error that must surface immediately, never be retried away
    const message = "error: pathspec 'nope.txt' did not match any file(s) known to git"

    // when / then
    expect(isGitLockError(new Error(message))).toBe(false)
  })
})

describe("git lock retry", () => {
  it("#given transient index.lock failures #when an operation runs #then it retries and finally succeeds", async () => {
    // given
    let attempts = 0

    // when
    const result = await withGitLockRetry(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error("fatal: Unable to create '/tmp/r/.git/index.lock': File exists.")
      }
      return "committed"
    })

    // then
    expect(attempts).toBe(3)
    expect(result).toBe("committed")
  })

  it("#given a lock that never clears #when the retry budget is exhausted #then the original error surfaces", async () => {
    // given - a permanently held lock, which must fail loudly rather than be masked
    let attempts = 0

    // when
    const failure = await withGitLockRetry(async () => {
      attempts += 1
      throw new Error("fatal: Unable to create '/x/.git/index.lock': File exists.")
    }).catch((error: unknown) => error)

    // then - bounded attempts, and the real error is preserved
    expect(attempts).toBe(5)
    expect(String(failure)).toContain("index.lock")
  })

  it("#given a non-lock git failure #when an operation runs #then it surfaces immediately without retrying", async () => {
    // given
    let attempts = 0

    // when
    const failure = await withGitLockRetry(async () => {
      attempts += 1
      throw new Error("error: pathspec 'nope.txt' did not match any file(s) known to git")
    }).catch((error: unknown) => error)

    // then - a real error must not be retried away
    expect(attempts).toBe(1)
    expect(String(failure)).toContain("did not match")
  })
})
