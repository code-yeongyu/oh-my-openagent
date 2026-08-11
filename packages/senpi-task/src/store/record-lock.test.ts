import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { withTaskRecordLock } from "./record-lock"

describe("withTaskRecordLock", () => {
  test("does not discard a completed operation when lock cleanup fails", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-task-lock-"))
    const recordPath = join(root, "st_cleanup.json")
    const lockPath = `${recordPath}.lock`

    try {
      const result = withTaskRecordLock(recordPath, () => {
        rmSync(lockPath)
        mkdirSync(lockPath)
        return "completed"
      })

      expect(result).toBe("completed")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
