import { afterEach, describe, expect, mock, test } from "bun:test"

// The darwin/freebsd fallback in readProcessStartIdentity runs `ps -o lstart=`,
// which prints local time. Two processes with different TZ settings read the same
// pid as different identities, and startIdentitiesConflict counts that as a
// conflict, so a live owner reads as dead (#12108). The fix pins the spawned ps
// to TZ=UTC; this test pins that wiring with a ps stand-in that renders local
// time from the TZ it receives, exactly like the real ps does.

interface CapturedExecFile {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Record<string, unknown>
}

// One pid, one start instant, three renderings a real ps would produce.
const RENDERED_BY_TZ: Record<string, string> = {
  UTC: "Mon Nov  2 10:00:00 2026",
  "America/New_York": "Mon Nov  2 05:00:00 2026",
  "Pacific/Kiritimati": "Tue Nov  3 00:00:00 2026",
}

function capturePs(): CapturedExecFile[] {
  const captured: CapturedExecFile[] = []
  mock.module("node:child_process", () => ({
    execFile: (
      command: string,
      args: readonly string[],
      options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      captured.push({ command, args, options })
      const env = options.env as NodeJS.ProcessEnv | undefined
      const effectiveTz = env?.TZ ?? process.env.TZ ?? "UTC"
      const rendered = RENDERED_BY_TZ[effectiveTz] ?? RENDERED_BY_TZ.UTC
      queueMicrotask(() => callback(null, `${rendered}\n`, ""))
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

describe("process start identity ps-lstart timezone", () => {
  const realPlatform = process.platform
  const realTz = process.env.TZ

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
    if (realTz === undefined) delete process.env.TZ
    else process.env.TZ = realTz
    mock.restore()
  })

  test("#given a darwin host whose in-process start-time reader cannot answer #when the same pid is probed under two TZ values #then the identities are equal", async () => {
    // given
    const captured = capturePs()
    forceStartTimeFastPathUnavailable()
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
    const { getProcessStartIdentity, startIdentitiesConflict } = await import("./process-identity")
    const livePid = process.ppid

    // when: first read under New York time, second under Kiritimati time
    process.env.TZ = "America/New_York"
    const first = await getProcessStartIdentity(livePid)
    process.env.TZ = "Pacific/Kiritimati"
    const second = await getProcessStartIdentity(livePid)

    // then: the spawned ps was pinned to UTC, so both reads render the same instant
    expect(captured).toHaveLength(2)
    for (const call of captured) {
      expect(call.command).toBe("/bin/ps")
      expect((call.options.env as NodeJS.ProcessEnv).TZ).toBe("UTC")
    }
    expect(first).toBe("ps-lstart:Mon Nov 2 10:00:00 2026")
    expect(second).toBe(first)
    expect(startIdentitiesConflict(first ?? "", second ?? "")).toBe(false)
  })
})
