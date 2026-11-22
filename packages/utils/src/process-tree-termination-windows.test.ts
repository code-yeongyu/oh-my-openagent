import { afterEach, expect, spyOn, test, mock } from "bun:test"
import * as childProcess from "node:child_process"
import { terminateProcessTree } from "./process-tree-termination"

// #11006: Windows never rewrites ParentProcessId, so taskkill /T also ends an older unrelated process that names a
// recycled parent PID. The tree is read once and only descendants created after their parent are signalled.
const ROOT = 2_147_480_001 // not a live PID here, so the forced pass is skipped and nothing real is signalled
const PROCESS_ROWS = [`${ROOT} 4 200 node.exe`, `5001 ${ROOT} 300 bash.exe`, `5002 ${ROOT} 100 older-unrelated.exe`].join("\r\n")

afterEach(() => mock.restore())

test("#given a recycled parent PID #when a Windows tree is terminated #then only creation-checked PIDs are signalled", async () => {
  // given
  const taskkillCalls: string[][] = []
  spyOn(childProcess, "spawnSync").mockImplementation(((command: string) => {
    if (command !== "powershell.exe") throw new Error(`unexpected spawnSync ${command}`)
    return { status: 0, stdout: PROCESS_ROWS, stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof childProcess.spawnSync)
  spyOn(childProcess, "execFile").mockImplementation(((command: string, args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    if (command !== "taskkill.exe") throw new Error(`unexpected execFile ${command}`)
    taskkillCalls.push(args)
    callback(null)
  }) as unknown as typeof childProcess.execFile)

  // when
  await terminateProcessTree(ROOT, { childClosed: Promise.resolve(), graceMs: 0, platform: "win32", waitMs: 0 })

  // then
  expect(taskkillCalls).toEqual([["/PID", String(ROOT), "/PID", "5001"]])
})
