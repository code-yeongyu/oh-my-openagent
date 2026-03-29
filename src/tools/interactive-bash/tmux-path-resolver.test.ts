import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyCmuxEndpoint,
  isConnectionRefusedText,
  probeCmuxNotificationCapability,
  probeCmuxReachability,
  probeTmuxRuntime,
  resetMultiplexerPathCacheForTesting,
  supportsCmuxNotifyFlagModel,
} from "./tmux-path-resolver"

describe("tmux-path-resolver probe environment", () => {
  beforeEach(() => {
    resetMultiplexerPathCacheForTesting()
  })

  test("probeTmuxRuntime resolves tmux using provided PATH", async () => {
    const whichSpy = spyOn(Bun, "which").mockImplementation(() => null)

    try {
      await probeTmuxRuntime({
        environment: {
          PATH: "/tmp/custom-tmux-bin",
          TMUX: "/tmp/tmux-501/default,1,0",
          TMUX_PANE: "%1",
        },
      })

      expect(whichSpy).toHaveBeenCalledTimes(1)
      expect(whichSpy.mock.calls[0]).toEqual([
        "tmux",
        { PATH: "/tmp/custom-tmux-bin" },
      ])
    } finally {
      whichSpy.mockRestore()
    }
  })

  test("probeCmuxReachability resolves cmux using provided PATH", async () => {
    const whichSpy = spyOn(Bun, "which").mockImplementation(() => null)

    try {
      await probeCmuxReachability({
        environment: {
          PATH: "/tmp/custom-cmux-bin",
          CMUX_SOCKET_PATH: "/tmp/cmux.sock",
        },
      })

      expect(whichSpy).toHaveBeenCalledTimes(1)
      expect(whichSpy.mock.calls[0]).toEqual([
        "cmux",
        { PATH: "/tmp/custom-cmux-bin" },
      ])
    } finally {
      whichSpy.mockRestore()
    }
  })

  test("probeTmuxRuntime honors explicit PATH removal in custom environment", async () => {
    const whichSpy = spyOn(Bun, "which").mockImplementation(() => null)

    try {
      await probeTmuxRuntime({
        environment: {
          PATH: undefined,
          TMUX: "/tmp/tmux-501/default,1,0",
          TMUX_PANE: "%1",
        },
      })

      expect(whichSpy).toHaveBeenCalledTimes(1)
      expect(whichSpy.mock.calls[0]).toEqual([
        "tmux",
        { PATH: "" },
      ])
    } finally {
      whichSpy.mockRestore()
    }
  })

  test("probeCmuxNotificationCapability returns promptly after probe timeout", async () => {
    if (process.platform === "win32") {
      return
    }

    const tempDirectory = mkdtempSync(join(tmpdir(), "tmux-path-resolver-timeout-"))
    const fakeCmuxPath = join(tempDirectory, "cmux")
    const slowCmuxScript = `#!/bin/sh
if [ "$1" = "notify" ]; then
  trap '' TERM
  /bin/sleep 1
  exit 0
fi

exit 1
`

    writeFileSync(fakeCmuxPath, slowCmuxScript)
    chmodSync(fakeCmuxPath, 0o755)

    try {
      const startedAt = Date.now()
      const probe = await probeCmuxNotificationCapability({
        cmuxPath: fakeCmuxPath,
        environment: {
          PATH: tempDirectory,
        },
        timeoutMs: 40,
      })
      const elapsedMs = Date.now() - startedAt

      expect(probe.failureKind).toBe("timeout")
      expect(elapsedMs).toBeLessThan(500)
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})

describe("tmux-path-resolver cmux endpoint helpers", () => {
  test("classifies relay host:port endpoint as relay", () => {
    expect(classifyCmuxEndpoint("127.0.0.1:7788")).toBe("relay")
  })

  test("classifies unix socket path as unix", () => {
    expect(classifyCmuxEndpoint("/tmp/cmux.sock")).toBe("unix")
  })

  test("classifies empty endpoint as missing", () => {
    expect(classifyCmuxEndpoint("   ")).toBe("missing")
  })

  test("detects connection refused text", () => {
    expect(isConnectionRefusedText("connect: connection refused")).toBe(true)
    expect(isConnectionRefusedText("ECONNREFUSED while connecting")).toBe(true)
    expect(isConnectionRefusedText("permission denied")).toBe(false)
  })

  test("accepts cmux notify help output with title/body model", () => {
    const help = `
cmux notify

Flags:
  --title <text>
  --body <text>
`

    expect(supportsCmuxNotifyFlagModel(help)).toBe(true)
  })

  test("rejects legacy message-based notify flag model", () => {
    const legacyHelp = `
cmux notify

Flags:
  --title <text>
  --message <text>
`

    expect(supportsCmuxNotifyFlagModel(legacyHelp)).toBe(false)
  })
})
