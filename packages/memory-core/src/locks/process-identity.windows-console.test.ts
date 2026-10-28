import { afterEach, describe, expect, mock, test } from "bun:test"

// Namespace spies hide unused exports from Knip. Module mocks survive mock.restore(). Run the
// fallback probe in its own test process so neither source coverage nor later native probes change.
const CHILD_PROBE_ENV = "OMO_PROCESS_IDENTITY_CONSOLE_PROBE"
const POWERSHELL_INSTANT = "2026-09-19T15:04:05.0000000Z"

afterEach(() => {
  mock.restore()
})

interface CapturedExecFile {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Record<string, unknown>
}

async function probeConsoleFallback(): Promise<void> {
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
  mock.module("./process-start-time", () => ({
    readDarwinProcessStartSeconds: async () => null,
    readWin32ProcessCreationFiletime: async () => null,
  }))
  const realPlatform = process.platform
  try {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    const { getPidLiveness, getProcessStartIdentity } = await import("./process-identity")
    const livePid = process.ppid
    expect(getPidLiveness(livePid)).not.toBe("dead")
    const identity = await getProcessStartIdentity(livePid)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.command).toBe("powershell.exe")
    expect(captured[0]?.options.windowsHide).toBe(true)
    expect(identity).toBe(`win32-creation-date:${POWERSHELL_INSTANT}`)
  } finally {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
  }
}

describe("process start identity win32 console suppression", () => {
  describe("#given a win32 host whose in-process start-time reader cannot answer", () => {
    describe("#when the lock protocol probes a live pid", () => {
      test("#then the powershell fallback is spawned with windowsHide: true", async () => {
        if (process.env[CHILD_PROBE_ENV] === "1") {
          await probeConsoleFallback()
          return
        }
        const child = Bun.spawn([process.execPath, "test", import.meta.path], {
          env: { ...process.env, [CHILD_PROBE_ENV]: "1" },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" })
        expect(stderr).toContain("1 pass")
        expect(stderr).toContain("5 expect() calls")
      })
    })
  })
})
