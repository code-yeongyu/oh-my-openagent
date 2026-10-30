import { afterEach, describe, expect, mock, test } from "bun:test"

// The lock protocol re-probes process start identity on every memory write and on every recorded
// run pid it revalidates. On win32 the in-process kernel32 reader answers first, but it reaches
// kernel32 through bun:ffi - under a Node runtime that import throws, the reader caches null and
// the PowerShell fallback below becomes the STEADY-STATE path. powershell.exe is a console
// binary, so without windowsHide each of those probes flashes a console and steals focus (#8501).

interface CapturedExecFile {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Record<string, unknown>
}

const POWERSHELL_INSTANT = "2026-09-19T15:04:05.0000000Z"

function captureExecFile(): CapturedExecFile[] {
  const captured: CapturedExecFile[] = []
  mock.module("node:child_process", () => ({
    execFile: (
      command: string,
      args: readonly string[],
      options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      captured.push({ command, args, options })
      queueMicrotask(() => callback(null, `${POWERSHELL_INSTANT}\n`, ""))
      return {}
    },
  }))
  return captured
}

function forceStartTimeFastPathUnavailable(): void {
  mock.module("./process-start-time", () => ({
    readDarwinProcessStartSeconds: async () => null,
    readWin32ProcessCreationFiletime: async () => null,
  }))
}

describe("process start identity win32 console suppression", () => {
  const realPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
    mock.restore()
  })

  describe("#given a win32 host whose in-process start-time reader cannot answer", () => {
    describe("#when the lock protocol probes a live pid", () => {
      test("#then the powershell fallback is spawned with windowsHide: true", async () => {
        const captured = captureExecFile()
        forceStartTimeFastPathUnavailable()
        Object.defineProperty(process, "platform", { value: "win32", configurable: true })
        const { getPidLiveness, getProcessStartIdentity } = await import("./process-identity")
        const livePid = process.ppid
        expect(getPidLiveness(livePid)).not.toBe("dead")

        const identity = await getProcessStartIdentity(livePid)

        expect(captured).toHaveLength(1)
        expect(captured[0]?.command).toBe("powershell.exe")
        expect(captured[0]?.options.windowsHide).toBe(true)
        expect(identity).toBe(`win32-creation-date:${POWERSHELL_INSTANT}`)
      })
    })
  })
})
