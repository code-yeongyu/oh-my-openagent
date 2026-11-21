import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFile } from "node:child_process"
import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { createMemoryTools } from "./tools"
import { boundFixture, git, testRoot, textOf, type BoundFixture } from "./tools.test-support"

const exec = promisify(execFile)

// Each case runs real git children against a real repository whose commit is held open by a hook.
setDefaultTimeout(60_000)

interface HeldCommit {
  readonly insideHook: Promise<string>
  release(): Promise<void>
}

// The first write in a process installs the memory hooks, so the hold hook goes in after one warm-up write.
// The pre-commit hook announces itself on one FIFO and then blocks reading another, so the test
// observes the exact moment the write is stuck in git and decides when it may continue.
async function holdNextCommit(fixture: BoundFixture): Promise<HeldCommit> {
  const [warmUpTool] = createMemoryTools(() => fixture.context)
  const warmUp = await warmUpTool.execute("warm-up", {
    command: "create",
    reason: "Warm up",
    file_path: "warm-up.md",
    description: "d",
  })
  expect(warmUp.isError).toBeUndefined()
  const fifos = await testRoot("omo-memory-call-bound-")
  const started = join(fifos, "started")
  const release = join(fifos, "release")
  await exec("mkfifo", [started, release])
  const hooks = join(fixture.repo.dir, ".git", "hooks")
  await mkdir(hooks, { recursive: true })
  const hook = join(hooks, "pre-commit")
  await writeFile(
    hook,
    `#!/bin/sh\nrm -f "$0"\nprintf started > '${started}'\nread line < '${release}'\nexit 0\n`,
    "utf8",
  )
  await chmod(hook, 0o755)
  return {
    insideHook: readFile(started, "utf8"),
    release: async () => {
      const handle = await open(release, "w")
      await handle.write("go\n")
      await handle.close()
    },
  }
}

describe.skipIf(process.platform === "win32")("memory tool call bound", () => {
  test("#given a commit that never returns #when the call is aborted #then it settles with an error naming the stage", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context)
    const held = await holdNextCommit(fixture)
    const controller = new AbortController()

    // when
    const call = memoryTool.execute(
      "call-1",
      { command: "create", reason: "Held write", file_path: "held.md", description: "d" },
      controller.signal,
    )
    await held.insideHook
    controller.abort()
    const result = await call

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory: create was cancelled while committing to git")
    await held.release()
    const next = await memoryTool.execute("call-2", {
      command: "create",
      reason: "Next write",
      file_path: "next.md",
      description: "d",
    })
    expect(next.isError).toBeUndefined()
    expect((await git(fixture.repo, ["log", "-3", "--format=%s"])).split("\n")).toEqual([
      "Next write",
      "Held write",
      "Warm up",
    ])
  })

  test("#given a commit that never returns #when the call deadline passes #then it settles with a timeout error", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context, { callTimeoutMs: 1_000 })
    const [unboundedTool] = createMemoryTools(() => fixture.context)
    const held = await holdNextCommit(fixture)

    // when
    const result = await memoryTool.execute("call-1", {
      command: "create",
      reason: "Held write",
      file_path: "held.md",
      description: "d",
    })

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^memory: create did not finish within 1s \(stopped while [a-z ]+\)/)

    await held.insideHook
    await held.release()
    const next = await unboundedTool.execute("call-2", {
      command: "create",
      reason: "Next write",
      file_path: "next.md",
      description: "d",
    })
    expect(next.isError).toBeUndefined()
  })

  test("#given a call stopped mid-commit #when its write lands later #then it announces no commit", async () => {
    // given
    const fixture = await boundFixture()
    const announced: string[] = []
    const [memoryTool] = createMemoryTools(() => fixture.context, {
      onCommit: (commit) => announced.push(commit.subject),
    })
    const held = await holdNextCommit(fixture)
    const controller = new AbortController()
    const call = memoryTool.execute(
      "call-1",
      { command: "create", reason: "Held write", file_path: "held.md", description: "d" },
      controller.signal,
    )
    await held.insideHook
    controller.abort()
    expect((await call).isError).toBe(true)

    // when
    await held.release()
    const next = await memoryTool.execute("call-2", {
      command: "create",
      reason: "Next write",
      file_path: "next.md",
      description: "d",
    })

    // then
    expect(next.isError).toBeUndefined()
    expect((await git(fixture.repo, ["log", "-2", "--format=%s"])).split("\n")).toEqual(["Next write", "Held write"])
    expect(announced).toEqual(["Next write"])
  })

  test("#given the commit landed #when the call is stopped while it reports the write #then the stage says so", async () => {
    // given
    const fixture = await boundFixture()
    const controller = new AbortController()
    const [memoryTool] = createMemoryTools(() => fixture.context, { onCommit: () => controller.abort() })

    // when
    const result = await memoryTool.execute(
      "call-1",
      { command: "create", reason: "Landed write", file_path: "landed.md", description: "d" },
      controller.signal,
    )

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory: create was cancelled while reporting the write")
    expect(await git(fixture.repo, ["log", "-1", "--format=%s"])).toBe("Landed write")
  })

  test("#given an already-aborted signal #when the tool executes #then it refuses before touching the repository", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context)
    const controller = new AbortController()
    controller.abort()

    // when
    const result = await memoryTool.execute(
      "call-1",
      { command: "create", reason: "Never", file_path: "never.md", description: "d" },
      controller.signal,
    )

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory: create was cancelled while preparing the memory repository")
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
  })
})
