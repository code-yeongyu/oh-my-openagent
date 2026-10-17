import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { memoryWriterLockPath } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity, type FakeCommandContext } from "./commands.test-support"
import { registerMemoryCommand } from "./memory"
import { removeTree } from "../../../../../../test-support/remove-tree"

const tempDirs: string[] = []
const children: ReturnType<typeof spawn>[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 50 })))
})

// Each case runs real git plus the production holder scan, whose lsof answer is bounded at 60 s on
// macOS; on a loaded host that is slow but still a real answer, so the budget covers the bound.
setDefaultTimeout(90_000)

const SEEDS = [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" }]

interface Harness {
  readonly pi: MemoryFakeExtensionAPI
  readonly ctx: FakeCommandContext
  readonly indexLock: string
  readonly refLock: string
  readonly locksDir: string
}

async function harness(options: { readonly hasUI: boolean }): Promise<Harness> {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  await seededRepo(identity, SEEDS)
  const gitDir = join(identity.identityPaths.repo, ".git")
  const indexLock = join(gitDir, "index.lock")
  const refLock = join(gitDir, "refs", "heads", "main.lock")
  await writeFile(indexLock, "", "utf8")
  await writeFile(refLock, "", "utf8")
  await mkdir(identity.identityPaths.locks, { recursive: true })
  const pi = new MemoryFakeExtensionAPI()
  registerMemoryCommand(pi, fakeDeps(identity))
  return { pi, ctx: fakeCommandContext({ hasUI: options.hasUI }), indexLock, refLock, locksDir: identity.identityPaths.locks }
}

async function recordLiveWriter(locksDir: string): Promise<void> {
  const writer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  children.push(writer)
  if (writer.pid === undefined) throw new Error("writer has no pid")
  await writeFile(memoryWriterLockPath(locksDir), JSON.stringify({
    pid: writer.pid,
    process_start: "unavailable",
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: "memory-write",
  }), "utf8")
}

describe("/memory unlock (omo #10199)", () => {
  test("#given an unreadable memory-writer lock record #when unlock runs with --force #then it refuses up front, naming the record and the next step", async () => {
    // #given
    const { pi, ctx, indexLock, locksDir } = await harness({ hasUI: false })
    await writeFile(memoryWriterLockPath(locksDir), "{not json", "utf8")

    // #when
    const text = await invoke(pi, "memory", `unlock ${indexLock} --force`, ctx)

    // #then
    expect(existsSync(indexLock)).toBe(true)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
    expect(text).toContain(memoryWriterLockPath(locksDir))
  })

  test("#given an interactive session and a confirmed dialog #when unlock runs #then only that lock is removed", async () => {
    // #given
    const { pi, ctx, indexLock, refLock } = await harness({ hasUI: true })

    // #when
    await invoke(pi, "memory", `unlock ${indexLock}`, ctx)

    // #then
    expect(ctx.ui.confirms).toHaveLength(1)
    expect(existsSync(indexLock)).toBe(false)
    expect(existsSync(refLock)).toBe(true)
  })

  test("#given an interactive session and a declined dialog #when unlock runs #then nothing is removed", async () => {
    // #given
    const { pi, ctx, indexLock } = await harness({ hasUI: true })
    ctx.ui.confirmResult = false

    // #when
    await invoke(pi, "memory", `unlock ${indexLock}`, ctx)

    // #then
    expect(ctx.ui.confirms).toHaveLength(1)
    expect(existsSync(indexLock)).toBe(true)
  })

  test("#given a noninteractive session without --force #when unlock runs #then nothing is removed and --force is offered", async () => {
    // #given
    const { pi, ctx, indexLock } = await harness({ hasUI: false })

    // #when
    const text = await invoke(pi, "memory", `unlock ${indexLock}`, ctx)

    // #then
    expect(existsSync(indexLock)).toBe(true)
    expect(text).toContain("--force")
  })

  test("#given a noninteractive session with --force #when unlock runs #then the lock is removed without a dialog", async () => {
    // #given
    const { pi, ctx, indexLock } = await harness({ hasUI: false })

    // #when
    await invoke(pi, "memory", `unlock ${indexLock} --force`, ctx)

    // #then
    expect(existsSync(indexLock)).toBe(false)
  })

  test("#given a live memory writer #when unlock runs with --force #then it refuses, never overriding the refusal", async () => {
    // #given
    const { pi, ctx, indexLock, locksDir } = await harness({ hasUI: false })
    await recordLiveWriter(locksDir)

    // #when
    await invoke(pi, "memory", `unlock ${indexLock} --force`, ctx)

    // #then
    expect(existsSync(indexLock)).toBe(true)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a live memory writer in an interactive session #when unlock runs #then it refuses without asking", async () => {
    // #given
    const { pi, ctx, indexLock, locksDir } = await harness({ hasUI: true })
    await recordLiveWriter(locksDir)

    // #when
    await invoke(pi, "memory", `unlock ${indexLock}`, ctx)

    // #then
    expect(ctx.ui.confirms).toHaveLength(0)
    expect(existsSync(indexLock)).toBe(true)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
