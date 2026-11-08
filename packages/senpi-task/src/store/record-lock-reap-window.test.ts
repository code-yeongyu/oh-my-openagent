import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { readProcessStartIdentity } from "./lock-owner"
import { type RecordLockReapStage, setRecordLockReapHookForTests, withTaskRecordLock } from "./record-lock"

const dirs: string[] = []
const children: Bun.Subprocess[] = []
const restores: Array<() => void> = []

afterEach(async () => {
  for (const restore of restores.splice(0)) restore()
  for (const child of children.splice(0)) {
    child.kill()
    await child.exited
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function recordPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "record-lock-window-"))
  dirs.push(dir)
  return join(dir, "st_1.json")
}

function liveBody(token: string): string {
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" })
  children.push(child)
  return `${child.pid}\n${Date.now()}\n${token}\n${readProcessStartIdentity(child.pid)}\n${hostname()}\n`
}

async function writeDeadLock(path: string): Promise<string> {
  const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await child.exited
  const body = `${child.pid}\n0\ncrashed-holder\n`
  writeFileSync(`${path}.lock`, body)
  const longAgo = new Date(Date.now() - 60_000)
  utimesSync(`${path}.lock`, longAgo, longAgo)
  return body
}

function stepReaperOnce(stage: RecordLockReapStage, step: () => void): void {
  let stepped = false
  restores.push(setRecordLockReapHookForTests((reached) => {
    if (reached !== stage || stepped) return
    stepped = true
    step()
  }))
}

function lockTaken(path: string): unknown {
  try {
    return withTaskRecordLock(path, () => "ran")
  } catch (error) {
    return error
  }
}

describe("task record lock reap window", () => {
  test("#given a reaper holding the recovery lock #when a live holder publishes before the reaper re-reads #then the live lock is never removed", async () => {
    // given - the dead lock is judged, then replaced by a live holder's lock inside the window
    const path = recordPath()
    await writeDeadLock(path)
    const live = liveBody("fresh-holder")
    stepReaperOnce("recovery_held", () => {
      rmSync(`${path}.lock`)
      writeFileSync(`${path}.lock`, live)
    })

    // when
    const result = lockTaken(path)

    // then
    expect(result).toBeInstanceOf(Error)
    expect(readFileSync(`${path}.lock`, "utf8")).toBe(live)
  })

  test("#given a reaper that re-read the dead lock unchanged #when another reaper owns the recovery lock by then #then the reaper does not unlink the primary", async () => {
    // given - the recovery lock is taken over by a live reaper between the re-read and the unlink
    const path = recordPath()
    const dead = await writeDeadLock(path)
    const otherReaper = liveBody("other-reaper")
    stepReaperOnce("judged_unchanged", () => writeFileSync(`${path}.lock.recovery`, otherReaper))

    // when
    const result = lockTaken(path)

    // then
    expect(result).toBeInstanceOf(Error)
    expect(readFileSync(`${path}.lock`, "utf8")).toBe(dead)
    expect(readFileSync(`${path}.lock.recovery`, "utf8")).toBe(otherReaper)
  })
})
