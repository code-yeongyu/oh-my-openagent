import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { diagnoseHeldTestRoot } from "./windows-held-root.mjs"
import { removeTestRootBestEffort, skippedTestRoots } from "./held-test-root.mjs"

describe("Windows held-root diagnostic", () => {
  test("#given another platform #when diagnosed #then no process is launched", () => {
    const result = diagnoseHeldTestRoot("/synthetic/root", {
      platform: "darwin",
      run: () => { throw new Error("must not spawn") },
    })
    expect(result).toEqual({ holders: [], diagnosticErrors: [] })
  })

  test("#given Windows holders #when queried #then pid image and parent pid are retained", () => {
    const root = "C:\\temp\\held root"
    const expected = { holders: [{ pid: 31, image: "node.exe", parentPid: 30 }], diagnosticErrors: [] }
    const calls = []
    const result = diagnoseHeldTestRoot(root, {
      platform: "win32",
      run: (command, args, options) => {
        calls.push({ command, args, options })
        return { status: 0, stdout: JSON.stringify(expected), stderr: "" }
      },
    })
    expect(result).toEqual(expected)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toMatch(/powershell\.exe$/)
    expect(calls[0].args.slice(-2)).toEqual(["-Root", root])
    expect(calls[0].args).toContain("-NonInteractive")
    expect(calls[0].args).toContain("-File")
    expect(calls[0].options).toEqual({ encoding: "utf8", windowsHide: true, timeout: 30_000 })
  })

  for (const [name, run] of [
    ["spawn error", () => ({ error: new Error("not available") })],
    ["nonzero exit", () => ({ status: 1, stdout: "", stderr: "query failed" })],
    ["invalid JSON", () => ({ status: 0, stdout: "not JSON" })],
    ["invalid holder", () => ({ status: 0, stdout: JSON.stringify({ holders: [{ pid: "31" }], diagnosticErrors: [] }) })],
    ["thrown error", () => { throw new Error("spawn threw") }],
  ]) {
    test(`#given ${name} #when diagnosed #then it records the failure without throwing`, () => {
      const result = diagnoseHeldTestRoot("C:\\temp\\held", { platform: "win32", run })
      expect(result.holders).toEqual([])
      expect(result.diagnosticErrors).toHaveLength(1)
    })
  }

  test("#given a partial diagnostic #when a holder is found but parent lookup fails #then both results are recorded", () => {
    const expected = {
      holders: [{ pid: 31, image: "node.exe", parentPid: null }],
      diagnosticErrors: ["process exited before parent lookup"],
    }
    expect(diagnoseHeldTestRoot("C:\\temp\\held", {
      platform: "win32",
      run: () => ({ status: 0, stdout: JSON.stringify(expected) }),
    })).toEqual(expected)
  })

  test("#given a diagnostic child that never exits #when its deadline expires #then cleanup records the timeout and completes", () => {
    const root = "C:\\synthetic\\timeout-root"
    let deadline
    let timeoutError
    const reports = []
    try {
      const removed = removeTestRootBestEffort(root, {
        remove: () => { throw Object.assign(new Error("held"), { code: "EBUSY" }) },
        diagnose: (path) => diagnoseHeldTestRoot(path, {
          platform: "win32",
          run: (_command, _args, options) => {
            deadline = options.timeout
            // Fail RED without launching an unbounded child; only a configured deadline can run the fixture.
            if (deadline !== 30_000) throw new Error("diagnostic deadline missing")
            // Exercise the real timeout behavior with a shorter fixture deadline, not a mocked exit.
            const stalled = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 2147483647)"], {
              ...options, timeout: 25,
            })
            timeoutError = stalled.error
            return stalled
          },
        }),
        report: (kind, record) => reports.push({ kind, ...JSON.parse(record) }),
      })
      expect(deadline).toBe(30_000)
      expect(timeoutError?.code).toBe("ETIMEDOUT")
      expect(removed).toBe(false)
      expect(reports).toEqual([{
        kind: "SKIPPED_TEST_TEMP_ROOT", root, code: "EBUSY",
        holders: [], diagnosticErrors: [String(timeoutError)],
      }])
      expect(skippedTestRoots.get(root)?.diagnosticErrors).toEqual([String(timeoutError)])
    } finally {
      skippedTestRoots.delete(root)
    }
  })

  test("#given a holder without an image or parent lookup #when decoded #then its pid survives with an unknown image", () => {
    const diagnosticErrors = ["parent lookup failed"]
    expect(diagnoseHeldTestRoot("C:\\temp\\held", {
      platform: "win32",
      run: () => ({ status: 0, stdout: JSON.stringify({
        holders: [{ pid: 31, image: null, parentPid: null }], diagnosticErrors,
      }) }),
    })).toEqual({
      holders: [{ pid: 31, image: "unknown", parentPid: null }], diagnosticErrors,
    })
  })
})
