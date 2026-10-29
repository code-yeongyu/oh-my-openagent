import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { createLockLease } from "./lock-lease"
import { publishLockRecord } from "./lock-publish"
import { buildLockRecord } from "./lock-record"
import { createTempDirectory } from "./lock-test-support"
import { detectStaleLock, LockLeaseLostError, reapStaleLock, withLock } from "./locks"

const FIXTURE = fileURLToPath(new URL("./lock-lease-crash.fixture.ts", import.meta.url))

const spawnChild = () => Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
const stop = async (child: ReturnType<typeof spawnChild>) => {
  child.stdin.end()
  await child.exited
}

async function heldLock(prefix: string) {
  const root = await createTempDirectory(prefix)
  const lockPath = join(root, "lock")
  const owner = buildLockRecord("owner")
  expect(await publishLockRecord(lockPath, owner)).toBe(true)
  return { root, lockPath, owner }
}

test("#given the helper died #when a contender tries to reap between restore's compare and its rename #then the guard turns it away and the client keeps the lock alone", async () => {
  // given
  const { root, lockPath, owner } = await heldLock("lock-lease-race-guarded-")
  const child = spawnChild()
  const attempts: Array<{ reaped: string; published: boolean }> = []
  const lease = createLockLease(lockPath, owner, "owner", {
    beforeRestoreRename: async () => {
      attempts.push({
        reaped: await reapStaleLock(lockPath, Number.POSITIVE_INFINITY),
        published: await publishLockRecord(lockPath, buildLockRecord("contender")),
      })
    },
  })
  await lease.handOver(child.pid)
  await stop(child)

  // when
  await lease.restore()

  // then
  expect(attempts).toEqual([{ reaped: "busy", published: false }])
  expect(await readFile(lockPath, "utf8")).toBe(owner)
  await rm(root, { recursive: true, force: true })
})

test("#given the helper died and a contender already reaped and took the lock #when the client restores #then it gets LockLeaseLostError and the contender keeps the lock", async () => {
  // given
  const { root, lockPath, owner } = await heldLock("lock-lease-race-taken-")
  const child = spawnChild()
  const lease = createLockLease(lockPath, owner, "owner")
  await lease.handOver(child.pid)
  await stop(child)
  expect(await reapStaleLock(lockPath, Number.POSITIVE_INFINITY)).toBe("removed")
  const contender = buildLockRecord("contender")
  expect(await publishLockRecord(lockPath, contender)).toBe(true)

  // when
  const restored = lease.restore()

  // then
  await expect(restored).rejects.toBeInstanceOf(LockLeaseLostError)
  expect(await readFile(lockPath, "utf8")).toBe(contender)
  await rm(root, { recursive: true, force: true })
})

test("#given a reaper holds the guard of the handed-over record #when the client restores #then it treats the lock as lost and never renames", async () => {
  // given
  const { root, lockPath, owner } = await heldLock("lock-lease-race-busy-")
  const child = spawnChild()
  const lease = createLockLease(lockPath, owner, "owner")
  await lease.handOver(child.pid)
  const handed = await readFile(lockPath, "utf8")
  const guardPath = `${lockPath}.reclaim-${createHash("sha256").update(handed).digest("hex").slice(0, 16)}`
  expect(await publishLockRecord(guardPath, buildLockRecord("other-reaper"))).toBe(true)

  // when
  const restored = lease.restore()

  // then
  await expect(restored).rejects.toBeInstanceOf(LockLeaseLostError)
  expect(await readFile(lockPath, "utf8")).toBe(handed)
  await stop(child)
  await rm(root, { recursive: true, force: true })
})

test("#given a held lock #when it is handed to this very process #then handOver refuses", async () => {
  // given
  const { root, lockPath, owner } = await heldLock("lock-lease-self-")

  // when / then
  await expect(createLockLease(lockPath, owner, "owner").handOver(process.pid)).rejects.toThrow(`pid ${process.pid}`)
  expect(await readFile(lockPath, "utf8")).toBe(owner)
  await rm(root, { recursive: true, force: true })
})

test("#given a temp file left by a holder that crashed mid-rename #when the next holder hands over #then the leftover is removed and other files stay", async () => {
  // given
  const { root, lockPath, owner } = await heldLock("lock-lease-leftover-")
  await writeFile(join(root, ".lock.0b1c2d3e-dead-beef-0000-000000000000.lease"), "torn")
  await writeFile(join(root, ".other.0b1c2d3e-dead-beef-0000-000000000000.lease"), "another lock's")
  const child = spawnChild()
  const lease = createLockLease(lockPath, owner, "owner")

  // when
  await lease.handOver(child.pid)
  await lease.restore()

  // then
  expect((await readdir(root)).sort()).toEqual([".other.0b1c2d3e-dead-beef-0000-000000000000.lease", "lock"])
  await stop(child)
  await rm(root, { recursive: true, force: true })
})

async function crashAt(step: "handed" | "restored", lockPath: string, helperPid: number) {
  const holder = Bun.spawn(["bun", FIXTURE], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LOCK_PATH: lockPath, HELPER_PID: String(helperPid), STEP: step },
  })
  const reader = holder.stdout.getReader()
  let seen = ""
  while (!seen.includes(`at ${step}\n`)) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error(`holder exited before ${step}: ${await new Response(holder.stderr).text()}`)
    seen += new TextDecoder().decode(chunk.value)
  }
  holder.kill("SIGKILL")
  await holder.exited
}

test("#given a client killed right after handing the lock to a live helper #when others look #then the lock stays held until the helper exits, then it is taken cleanly", async () => {
  // given
  const root = await createTempDirectory("lock-lease-crash-handed-")
  const lockPath = join(root, "lock")
  const helper = spawnChild()

  // when
  await crashAt("handed", lockPath, helper.pid)

  // then
  expect(await detectStaleLock(lockPath, Number.POSITIVE_INFINITY)).toBe(false)
  expect(await publishLockRecord(lockPath, buildLockRecord("contender"))).toBe(false)
  await stop(helper)
  expect(await detectStaleLock(lockPath, Number.POSITIVE_INFINITY)).toBe(true)
  expect(await withLock(lockPath, async () => "entered", { staleAfterMs: Number.POSITIVE_INFINITY })).toBe("entered")
  await rm(root, { recursive: true, force: true })
}, 30_000)

test("#given a client killed after restoring #when others look #then its own dead record is stale and the lock is taken cleanly", async () => {
  // given
  const root = await createTempDirectory("lock-lease-crash-restored-")
  const lockPath = join(root, "lock")
  const helper = spawnChild()

  // when
  await crashAt("restored", lockPath, helper.pid)
  await stop(helper)

  // then
  expect(await detectStaleLock(lockPath, Number.POSITIVE_INFINITY)).toBe(true)
  expect(await withLock(lockPath, async () => "entered", { staleAfterMs: Number.POSITIVE_INFINITY })).toBe("entered")
  await rm(root, { recursive: true, force: true })
}, 30_000)
