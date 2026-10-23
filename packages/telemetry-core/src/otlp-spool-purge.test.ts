import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { createBatchId } from "./otlp-spool-dir"
import { type PurgeReport, purgeSpool } from "./otlp-spool-purge"
import { createSpoolRoot, spoolNames } from "./otlp-test-support"
import type { TelemetrySpoolEntryKind } from "./types"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function spool(): { dir: string; sealed: string; wal: string } {
  const created = createSpoolRoot("telemetry-core-spool-purge-")
  roots.push(created.cleanup)
  mkdirSync(created.dir, { recursive: true })
  const sealed = `batch-logs-${createBatchId(Date.now())}.otlp`
  const wal = `active-logs-999-${"b".repeat(32)}.otlp`
  writeFileSync(join(created.dir, sealed), "sealed")
  writeFileSync(join(created.dir, wal), "wal")
  return { dir: created.dir, sealed, wal }
}

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** Records what the purge reports: skipped entries by kind, failed deletions by errno code. */
function recorder(): PurgeReport & { readonly kinds: TelemetrySpoolEntryKind[]; readonly failed: string[] } {
  const kinds: TelemetrySpoolEntryKind[] = []
  const failed: string[] = []
  return { kinds, failed, onSkipped: (kind) => kinds.push(kind), onFailed: (code) => failed.push(code) }
}

describe("the purge never follows, opens or deletes a spool-named entry that is not a regular file", () => {
  test.skipIf(process.platform === "win32")(
    "#given a spool-named FIFO next to a real spool file #when the purge runs #then the FIFO survives without blocking the purge, it is reported as other, and the real spool file is deleted",
    () => {
      // given
      const { dir, sealed, wal } = spool()
      const fifo = `batch-traces-${createBatchId(Date.now() - 1)}.otlp`
      execFileSync("mkfifo", [join(dir, fifo)])
      const report = recorder()

      // when
      const outcome = purgeSpool(dir, dirname(dir), report)

      // then
      expect(outcome).toBe("purged")
      expect(report.kinds).toEqual(["other"])
      expect(spoolNames(dir)).toEqual([fifo])
      expect(spoolNames(dir)).not.toContain(sealed)
      expect(spoolNames(dir)).not.toContain(wal)
    },
    5_000,
  )

  test("#given a spool-named symlink to a file outside the spool #when the purge runs #then neither the link nor its target is touched, the skip is reported as symlink, and the real spool files are deleted", () => {
    // given
    const { dir } = spool()
    const target = join(dirname(dir), "link-target.txt")
    writeFileSync(target, "keep")
    const link = `active-traces-1-${"c".repeat(32)}.otlp`
    symlinkSync(target, join(dir, link), "file")
    const report = recorder()

    // when
    const outcome = purgeSpool(dir, dirname(dir), report)

    // then
    expect(outcome).toBe("purged")
    expect(report.kinds).toEqual(["symlink"])
    expect(spoolNames(dir)).toEqual([link])
    expect(readFileSync(target, "utf8")).toBe("keep")
  })
})

describe("the purge keeps sweeping when one entry cannot be deleted", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY", "EISDIR", "ENOTDIR"]) {
    test(`#given a regular spool file of the current user whose unlink fails with ${code} while the entry stays the same #when the purge runs #then it is reported as a failed deletion with the code, not as a skip, the outcome is incomplete, and every other spool file is still deleted`, () => {
      // given
      const { dir, sealed, wal } = spool()
      const report = recorder()
      const stuck = join(dir, sealed)
      const unlink = (path: string): void => {
        if (path === stuck) throw errnoError(code)
        unlinkSync(path)
      }

      // when
      const outcome = purgeSpool(dir, dirname(dir), report, { unlink })

      // then
      expect(outcome).toBe("incomplete")
      expect(report.failed).toEqual([code])
      expect(report.kinds).toEqual([])
      expect(spoolNames(dir)).toEqual([sealed])
      expect(spoolNames(dir)).not.toContain(wal)
    })
  }

  test("#given a spool file swapped for a directory between its check and its unlink #when the unlink fails with EPERM #then the entry is reported as a skip of kind other, not as a failure, and the sweep goes on", () => {
    // given
    const { dir, sealed, wal } = spool()
    const report = recorder()
    const swapped = join(dir, sealed)
    const unlink = (path: string): void => {
      if (path !== swapped) return unlinkSync(path)
      unlinkSync(path)
      mkdirSync(path)
      throw errnoError("EPERM")
    }

    // when
    const outcome = purgeSpool(dir, dirname(dir), report, { unlink })

    // then
    expect(outcome).toBe("purged")
    expect(report.kinds).toEqual(["other"])
    expect(report.failed).toEqual([])
    expect(spoolNames(dir)).toEqual([sealed])
    expect(spoolNames(dir)).not.toContain(wal)
  })

  test("#given a spool file replaced by a different regular file (new inode) between its check and its unlink #when the unlink fails with EACCES #then the entry is reported as a skip of kind other, not as a failure, and the sweep goes on", () => {
    // given
    const { dir, sealed, wal } = spool()
    const report = recorder()
    const swapped = join(dir, sealed)
    const unlink = (path: string): void => {
      if (path !== swapped) return unlinkSync(path)
      const replacement = join(dirname(dir), "replacement.otlp")
      writeFileSync(replacement, "other")
      renameSync(replacement, path)
      throw errnoError("EACCES")
    }

    // when
    const outcome = purgeSpool(dir, dirname(dir), report, { unlink })

    // then
    expect(outcome).toBe("purged")
    expect(report.kinds).toEqual(["other"])
    expect(report.failed).toEqual([])
    expect(spoolNames(dir)).toEqual([sealed])
    expect(spoolNames(dir)).not.toContain(wal)
  })

  test("#given a spool file that another process deleted between its check and its unlink #when the unlink fails with EPERM #then nothing is reported and the purge completes", () => {
    // given
    const { dir, sealed } = spool()
    const report = recorder()
    const gone = join(dir, sealed)
    const unlink = (path: string): void => {
      unlinkSync(path)
      if (path === gone) throw errnoError("EPERM")
    }

    // when
    const outcome = purgeSpool(dir, dirname(dir), report, { unlink })

    // then
    expect(outcome).toBe("purged")
    expect(report.kinds).toEqual([])
    expect(report.failed).toEqual([])
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given an unlink failure that is not a swapped entry #when the purge runs #then the error still propagates", () => {
    // given
    const { dir } = spool()
    const unlink = (): void => {
      throw errnoError("EIO")
    }

    // when
    const run = (): unknown => purgeSpool(dir, dirname(dir), recorder(), { unlink })

    // then
    expect(run).toThrow("EIO")
  })
})

describe("the purge leaves a spool file of another user in an owned spool directory", () => {
  test.skipIf(typeof process.getuid !== "function")(
    "#given the spool directory is owned by the current user and one spool file by another #when the purge runs #then that file survives, is reported as foreign_owner, and the rest is deleted",
    () => {
      // given
      const { dir, sealed, wal } = spool()
      const foreign = join(dir, wal)
      const ownerOf = (path: string, uid: number): number => (path === foreign ? uid + 1 : uid)
      const report = recorder()

      // when
      const outcome = purgeSpool(dir, dirname(dir), report, { ownerOf })

      // then
      expect(outcome).toBe("purged")
      expect(report.kinds).toEqual(["foreign_owner"])
      expect(spoolNames(dir)).toEqual([wal])
      expect(spoolNames(dir)).not.toContain(sealed)
    },
  )
})
