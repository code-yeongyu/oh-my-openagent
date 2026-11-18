import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTreeSync } from "../../../../../test-support/remove-tree"
import { Outbox } from "./outbox"

// #12506 (review of #12299): Outbox.sweep ignored every readdir error, so an unreadable pending/ directory
// skipped cleanup without a word and brought back the segment-file leak #12299 fixed. Only ENOENT is ignored now.

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const pending = join(root, "pending")
    if (existsSync(pending)) chmodSync(pending, 0o700)
    removeTreeSync(root, { maxRetries: 10, retryDelay: 200 })
  }
})

function syncDir(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-outbox-sweep-")))
  roots.push(root)
  return root
}

const nothingPending = { items: [], outgoing: null } as const
// Root reads an unreadable directory anyway, and Windows has no POSIX mode bits to deny it with.
const canDenyRead = process.platform !== "win32" && process.getuid?.() !== 0

describe("Outbox.sweep directory errors (#12506)", () => {
  test("#given no pending directory yet #when the outbox is swept #then there is nothing to clean and it resolves", async () => {
    // given
    const outbox = new Outbox(syncDir())

    // when / then
    await expect(outbox.sweep(nothingPending)).resolves.toBeUndefined()
  })

  test.skipIf(!canDenyRead)(
    "#given a pending directory that cannot be read #when the outbox is swept #then the error surfaces instead of skipping cleanup",
    async () => {
      // given: a stray segment the sweep would remove, behind a directory it cannot list
      const root = syncDir()
      const pending = join(root, "pending")
      mkdirSync(pending)
      writeFileSync(join(pending, "seg-stray.bin"), "ops")
      chmodSync(pending, 0o000)
      const outbox = new Outbox(root)

      // when
      const swept = outbox.sweep(nothingPending)

      // then
      await expect(swept).rejects.toMatchObject({ code: "EACCES" })
    },
  )
})
