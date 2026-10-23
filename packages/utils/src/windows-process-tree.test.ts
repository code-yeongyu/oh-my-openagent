import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { createDefaultProcessKiller } from "./process-sweep/exec"
import { parseWindowsProcessTreeRows, windowsTreeKillArgs, type WindowsProcessRow } from "./windows-process-tree"

const SELF = 5000
function row(pid: number, parentPid: number, createdAt: number, name = "node.exe"): WindowsProcessRow {
  return { pid, parentPid, createdAt: BigInt(createdAt), name }
}
const host = [row(896, 776, 100, "wininit.exe"), row(1008, 896, 110, "services.exe"), row(SELF, 1008, 500)]

afterEach(() => mock.restore())

describe("guarded Windows termination (omo#11006)", () => {
  test("#given a root reusing a dead parent's pid #when planned #then older unrelated processes and their descendants stay out", () => {
    const rows = [...host, row(776, SELF, 600), row(7010, 776, 610), row(7200, 776, 450), row(7210, 7200, 460)]
    expect(windowsTreeKillArgs(776, rows, SELF)).toEqual(["/F", "/PID", "776", "/PID", "7010"])
  })

  test("#given unknown creation times #when planned #then no unverified ancestry edge is followed", () => {
    expect(windowsTreeKillArgs(7000, [row(7000, SELF, 0), row(7010, 7000, 100)], SELF)).toEqual(["/F", "/PID", "7000"])
    expect(windowsTreeKillArgs(7000, [row(7000, SELF, 100), row(7010, 7000, 0)], SELF)).toEqual(["/F", "/PID", "7000"])
  })

  test("#given no CIM listing #when forced or graceful termination is planned #then only the owned root is targeted", () => {
    expect(windowsTreeKillArgs(7000, undefined, SELF)).toEqual(["/F", "/PID", "7000"])
    expect(windowsTreeKillArgs(7000, undefined, SELF, false)).toEqual(["/PID", "7000"])
  })

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, SELF])(
    "#given invalid or self root %s #when listing failed #then nothing is targeted",
    (pid) => expect(windowsTreeKillArgs(pid, undefined, SELF)).toEqual([]),
  )

  test("#given a missing root or an ancestor of self #when planned #then nothing is targeted", () => {
    expect(windowsTreeKillArgs(7000, host, SELF)).toEqual([])
    expect(windowsTreeKillArgs(1008, host, SELF)).toEqual([])
  })

  test("#given a protected image under the root #when planned #then only the root is targeted", () => {
    expect(windowsTreeKillArgs(7000, [...host, row(7000, SELF, 600), row(7010, 7000, 610, "svchost.exe")], SELF))
      .toEqual(["/F", "/PID", "7000"])
  })

  test("#given same-tick children and a cycle above self #when planned #then the walk ends and accepts known creation times", () => {
    const rows = [row(10, 11, 50), row(11, 10, 50), row(SELF, 10, 60), row(7000, SELF, 70), row(7010, 7000, 70)]
    expect(windowsTreeKillArgs(7000, rows, SELF)).toEqual(["/F", "/PID", "7000", "/PID", "7010"])
  })

  test("#given CRLF and FILETIMEs beyond safe integers #when parsed #then creation time stays exact", () => {
    expect(parseWindowsProcessTreeRows("896 776 134046261411081720 spaced name.exe\r\n0 0 0 idle\r\ninvalid\r\n"))
      .toEqual([{ pid: 896, parentPid: 776, createdAt: 134046261411081720n, name: "spaced name.exe" }])
  })

  // This runs the real sweep caller and planner; only the external executable boundary is replaced.
  test.each([false, true])("#given a reused parent pid and CIM failure=%s #when a sweep stops a process #then taskkill never expands an unchecked tree", async (listingFailed) => {
    const rootPid = process.pid + 100_000
    const calls: { file: string; args: readonly string[] }[] = []
    spyOn(childProcess, "execFile").mockImplementation(unsafeTestValue<typeof childProcess.execFile>(
      (file: string, args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        if (file === "powershell.exe") {
          callback(listingFailed ? new Error("CIM unavailable") : null,
            `${rootPid} 1 600 shell.exe\n${rootPid + 4} ${rootPid} 610 child.exe\n${rootPid + 8} ${rootPid} 450 unrelated.exe\n${rootPid + 12} ${rootPid + 8} 460 older-child.exe\n`, "")
        } else {
          calls.push({ file, args: [...args] })
          callback(null, "", "")
        }
        return new childProcess.ChildProcess()
      },
    ))
    const killer = createDefaultProcessKiller("win32")
    await killer.terminate(rootPid)
    await killer.kill(rootPid)
    const targets = listingFailed ? ["/PID", String(rootPid)] : ["/PID", String(rootPid), "/PID", String(rootPid + 4)]
    expect(calls).toEqual([
      { file: "taskkill.exe", args: targets },
      { file: "taskkill.exe", args: ["/F", ...targets] },
    ])
  })
})
