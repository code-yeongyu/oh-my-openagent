import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { removeTestRootBestEffort, skippedTestRoots } from "./held-test-root.mjs"

describe("recorded best-effort root removal", () => {
  const root = "/synthetic/held-test-root"
  afterEach(() => skippedTestRoots.delete(root))

  for (const code of ["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]) {
    test(`#given a root held with ${code} #when removed #then it is skipped once and recorded`, () => {
      const reports = []
      let attempts = 0
      const diagnostic = { holders: [{ pid: 42, image: "node.exe", parentPid: 41 }], diagnosticErrors: [] }
      const removed = removeTestRootBestEffort(root, {
        remove: () => { attempts++; throw Object.assign(new Error(code), { code }) },
        diagnose: () => diagnostic,
        report: (kind, record) => reports.push({ kind, ...JSON.parse(record) }),
      })
      expect(removed).toBe(false)
      expect(attempts).toBe(1)
      expect(skippedTestRoots.get(root)).toEqual({ root, code, ...diagnostic })
      expect(reports).toEqual([{ kind: "SKIPPED_TEST_TEMP_ROOT", root, code, ...diagnostic }])
    })
  }

  test("#given an I/O error #when removed #then the same error fails cleanup without a skip", () => {
    const error = Object.assign(new Error("device error"), { code: "EIO" })
    let caught
    try {
      removeTestRootBestEffort(root, { remove: () => { throw error } })
    } catch (failure) {
      caught = failure
    }
    expect(caught).toBe(error)
    expect(skippedTestRoots.has(root)).toBe(false)
  })

  test("#given a recorded root #when a later sweep removes it #then its record is cleared", () => {
    skippedTestRoots.set(root, { root, code: "EBUSY", holders: [], diagnosticErrors: [] })
    const removed = removeTestRootBestEffort(root, {
      remove: () => {},
      diagnose: () => { throw new Error("diagnostic should not run") },
    })
    expect(removed).toBe(true)
    expect(skippedTestRoots.has(root)).toBe(false)
  })

  test("#given a diagnostic failure #when a held root is skipped #then the diagnostic error is recorded without failing cleanup", () => {
    const reports = []
    expect(() => removeTestRootBestEffort(root, {
      remove: () => { throw Object.assign(new Error("held"), { code: "EBUSY" }) },
      diagnose: () => { throw new Error("query unavailable") },
      report: (kind, record) => reports.push({ kind, ...JSON.parse(record) }),
    })).not.toThrow()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ root, code: "EBUSY", holders: [] })
    expect(reports[0].diagnosticErrors).toHaveLength(1)
  })

  for (const unrelatedLeak of [false, true]) {
    test(`#given a recorded held root and unrelated leak ${unrelatedLeak} #when the suite tears down #then only unrecorded leaks fail`, () => {
      const cleanupUrl = new URL("./held-test-root.mjs", import.meta.url).href
      const teardownUrl = new URL("../test-temp-root.ts", import.meta.url).href
      const result = spawnSync(process.execPath, ["-e", `
        const { mkdtempSync } = await import("node:fs")
        const { tmpdir } = await import("node:os")
        const { join } = await import("node:path")
        const { runTestTempRootTeardown } = await import(${JSON.stringify(teardownUrl)})
        const { removeTestRootBestEffort } = await import(${JSON.stringify(cleanupUrl)})
        const held = mkdtempSync(join(tmpdir(), "omo-held-cleanup-"))
        removeTestRootBestEffort(held, {
          remove() { throw Object.assign(new Error("held"), { code: "EBUSY" }) },
          diagnose() { return { holders: [], diagnosticErrors: [] } },
        })
        if (${unrelatedLeak}) mkdtempSync(join(tmpdir(), "omo-unexpected-cleanup-"))
        runTestTempRootTeardown()
      `], { encoding: "utf8" })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(unrelatedLeak ? 1 : 0)
      const report = result.stderr.split("\n").find((line) => line.startsWith("SKIPPED_TEST_TEMP_ROOT "))
      expect(report).toBeDefined()
      expect(JSON.parse(report.slice("SKIPPED_TEST_TEMP_ROOT ".length)).code).toBe("EBUSY")
    })
  }
})
