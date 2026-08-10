import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  GitMemoryRepo,
  type GitExec,
  type GitExecOptions,
  type GitExecResult,
  createNodeGitExec,
  withSerializedGitConfigMutation,
} from "./index"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
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
    const dir = await mkdtemp(join(tmpdir(), "memory-config-lock-"))
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
