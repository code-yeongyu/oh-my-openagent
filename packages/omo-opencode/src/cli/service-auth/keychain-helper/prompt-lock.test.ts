import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  const child = Bun.spawnSync(["/usr/bin/true"])
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

  test("#given a record carrying this process's pid that this process does not hold #when taking the lock #then it is refused, never reaped", async () => {
    const path = lockPath()
    writeFileSync(path, `keychain-prompt leftover\n${process.pid}\n${Date.now()}\nanother-copy\n`)
    expect(await promptLockAt(path)()).toBeNull()
    expect(readFileSync(path, "utf8")).toContain("another-copy")
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
