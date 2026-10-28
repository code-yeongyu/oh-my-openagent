import { expect, test } from "bun:test"
import { readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createLockLease } from "./lock-lease"
import { publishLockRecord } from "./lock-publish"
import { buildLockRecord } from "./lock-record"
import { createTempDirectory } from "./lock-test-support"

const UUID = "0b1c2d3e-dead-beef-0000-000000000000"

test("#given leftovers of this lock and in-flight temps of sibling locks #when the holder hands over #then only this lock's exact temp names are removed", async () => {
  // given
  const root = await createTempDirectory("lock-lease-temp-names-")
  const lockPath = join(root, "lock")
  const owner = buildLockRecord("owner")
  expect(await publishLockRecord(lockPath, owner)).toBe(true)
  const kept = [
    `.lock.x.${UUID}.lease`,
    `.lock.${UUID}.lease.bak`,
    `.lock.not-a-uuid.lease`,
    `.lockx.${UUID}.lease`,
    "lock.reclaim-0123456789abcdef",
  ]
  for (const name of [`.lock.${UUID}.lease`, ...kept]) await writeFile(join(root, name), "temp")
  const child = Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })

  // when
  const lease = createLockLease(lockPath, owner, "owner")
  await lease.handOver(child.pid)
  await lease.restore()

  // then
  expect((await readdir(root)).sort()).toEqual([...kept, "lock"].sort())
  child.stdin.end()
  await child.exited
  await rm(root, { recursive: true, force: true })
})
