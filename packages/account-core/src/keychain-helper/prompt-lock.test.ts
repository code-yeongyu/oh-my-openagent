import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"
import { keychainProcessState } from "./process-state"
import { promptLockAt } from "./prompt-lock"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function lockPath(): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-lock-"))
  roots.push(root)
  return join(root, "account.keychain-prompt")
}

function exitedChildPid(): number {
  const child = Bun.spawnSync([process.execPath, "-e", ""])
  return child.pid
}

describe("machine-wide prompt lock (#11262 design 3.6 R4; rows 12, 13)", () => {
  test("#given the lock is held by a live holder #when another caller takes it #then it is refused with no wait", async () => {
    const path = lockPath()
    writeFileSync(path, `keychain-prompt other\n${process.ppid}\n${Date.now()}\nother-instance\n`)
    expect(await promptLockAt(path)()).toBeNull()
  })

  test("#given the holder died while showing the dialog #when the next caller takes it #then the record is reaped and the lock is granted", async () => {
    const path = lockPath()
    writeFileSync(path, `keychain-prompt other\n${exitedChildPid()}\n${Date.now()}\nother-instance\n`)
    const release = await promptLockAt(path)()
    expect(release).not.toBeNull()
    await release?.()
  })

  test("#given a leftover record carrying this pid from another instance #when taking the lock #then it is reaped and granted, never refused for the process lifetime", async () => {
    const path = lockPath()
    // A recycled pid is proven by its recorded process start (team-core lock record line 5); an unknown instance of this
    // pid without that proof may be a live worker thread, which team-core never reaps.
    const start = await getProcessStartIdentity(process.pid)
    if (start === null) throw new Error("process-start identity unavailable")
    const priorStart = `${start.slice(0, start.indexOf(":"))}:0`
    writeFileSync(path, `keychain-prompt leftover\n${process.pid}\n${Date.now()}\nrecycled-instance\n${priorStart}\n`)
    const release = await promptLockAt(path)()
    expect(release).not.toBeNull()
    expect(readFileSync(path, "utf8")).not.toContain("recycled-instance")
    await release?.()
  })

  test("#given a held lock #when released #then this process still holds the path while its record is removed", async () => {
    const path = lockPath()
    let heldWhileRemoving: boolean | undefined
    const release = await promptLockAt(path, {
      removeRecord: async (target) => {
        heldWhileRemoving = keychainProcessState().heldPromptLocks.has(target)
        rmSync(target, { force: true })
      },
    })()
    await release?.()
    expect(heldWhileRemoving).toBe(true)
    expect(keychainProcessState().heldPromptLocks.has(path)).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  test("#given this process holds it #when released and taken again #then the second take succeeds", async () => {
    const path = lockPath()
    const take = promptLockAt(path)
    const first = await take()
    expect(first).not.toBeNull()
    expect(await take()).toBeNull()
    await first?.()
    const second = await take()
    expect(second).not.toBeNull()
    await second?.()
  })
})
