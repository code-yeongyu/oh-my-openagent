import { describe, expect, test } from "bun:test"
import type { ChildProcess, spawnSync } from "node:child_process"

import { killProcessTree } from "./daemon-test-runner"
import { WIN32_PROCESS_LISTING, childTreeCpuSeconds } from "./process-tree-cpu"

// #14780 review M2: Windows has neither ps nor process groups. These cases drive the win32 branches on any host by
// injecting the platform and the process runner, so the Windows reading and the Windows kill are pinned everywhere.
type Call = { readonly command: string; readonly args: readonly string[] }
function fakeRun(reply: { status: number | null; stdout?: string; stderr?: string }, calls: Call[]): typeof spawnSync {
  return ((command: string, args: readonly string[]) => {
    calls.push({ command, args })
    return {
      pid: 0,
      output: [],
      stdout: reply.stdout ?? "",
      stderr: reply.stderr ?? "",
      status: reply.status,
      signal: null,
    }
  }) as unknown as typeof spawnSync
}

describe("win32 process tree", () => {
  test("#given a CIM listing #when the tree CPU is read on win32 #then it sums the root and every live descendant", () => {
    // given: 100 ns units; 900 is an unrelated process, 7 is the root's grandchild
    const listing = "100 4 20000000\r\n5 100 5000000\r\n7 5 2500000\r\n900 4 99990000\r\n"
    const calls: Call[] = []

    // when
    const cpu = childTreeCpuSeconds(100, "win32", fakeRun({ status: 0, stdout: listing }, calls))

    // then
    expect(cpu).toBeCloseTo(2.75, 6)
    expect(calls).toEqual([{ command: WIN32_PROCESS_LISTING[0], args: [...WIN32_PROCESS_LISTING[1]] }])
  })

  test("#given the CIM listing fails #when the tree CPU is read on win32 #then it reports -1, the unmeasurable reading", () => {
    expect(childTreeCpuSeconds(100, "win32", fakeRun({ status: 1 }, []))).toBe(-1)
  })

  test("#given a bounded child on win32 #when its tree is killed #then taskkill ends the tree and no group signal is sent", () => {
    // given
    const calls: Call[] = []
    const child = { pid: 4242 } as ChildProcess

    // when
    killProcessTree(child, "win32", fakeRun({ status: 0 }, calls))
    killProcessTree(child, "win32", fakeRun({ status: 128 }, calls))

    // then
    expect(calls).toEqual([
      { command: "taskkill", args: ["/T", "/F", "/PID", "4242"] },
      { command: "taskkill", args: ["/T", "/F", "/PID", "4242"] },
    ])
  })

  test("#given taskkill fails on win32 #when the tree is killed #then it throws instead of waiting on a child that never exits", () => {
    const child = { pid: 4242 } as ChildProcess
    expect(() => killProcessTree(child, "win32", fakeRun({ status: 1, stderr: "Access is denied." }, []))).toThrow(
      /taskkill \/T \/F \/PID 4242 failed \(status 1\)/,
    )
  })
})
