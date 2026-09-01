import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

const isWin32 = process.platform === "win32"
const probePath = fileURLToPath(
  new URL("./rpc/__fixtures__/windows-console-probe.ts", import.meta.url),
)
const PROBE_TIMEOUT_MS = 90_000
const CLEANUP_TIMEOUT_MS = 10_000

type ProbeExit = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

function createDeadline(timeoutMs: number, label: string): {
  readonly promise: Promise<never>
  readonly cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
  })
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

async function waitForClose(child: ChildProcess): Promise<ProbeExit> {
  const [code, signal] = await once(child, "close")
  return {
    code: typeof code === "number" ? code : null,
    signal: typeof signal === "string" ? signal as NodeJS.Signals : null,
  }
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  if (pid === undefined) {
    child.kill("SIGKILL")
    return
  }
  const killer = spawn("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  })
  await Promise.race([once(killer, "close"), once(killer, "error")])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
  }
}

test.skipIf(!isWin32)(
  "#given a console-less parent #when the default RPC child starts #then windowsHide suppresses its console",
  async () => {
    // given
    const probe = spawn(process.execPath, [probePath], {
      cwd: dirname(probePath),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let spawnError: Error | undefined
    probe.stdout?.setEncoding("utf8")
    probe.stderr?.setEncoding("utf8")
    probe.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    probe.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })
    probe.once("error", (error) => {
      spawnError = error
    })
    let closeObserved = false
    const close = waitForClose(probe).then((exit) => {
      closeObserved = true
      return exit
    })
    const deadline = createDeadline(PROBE_TIMEOUT_MS, "Windows console probe")

    // when
    let exit: ProbeExit
    try {
      exit = await Promise.race([close, deadline.promise])
    } finally {
      deadline.cancel()
      if (!closeObserved) {
        await terminateProcessTree(probe)
        const cleanupDeadline = createDeadline(CLEANUP_TIMEOUT_MS, "Windows console probe cleanup")
        try {
          await Promise.race([close, cleanupDeadline.promise])
        } finally {
          cleanupDeadline.cancel()
        }
      }
    }
    const diagnostic = {
      exit,
      error: spawnError === undefined ? undefined : String(spawnError),
      stdout,
      stderr,
    }
    if (exit.code !== 0 || exit.signal !== null || stderr !== "" || spawnError !== undefined) {
      throw new Error(`WINDOWS_CONSOLE_PROBE ${JSON.stringify(diagnostic)}`)
    }
    const payload = JSON.parse(stdout.trim()) as {
      readonly result: string
      readonly visible: {
        readonly consoleAttached: boolean
        readonly consoleWindowHandle: number
        readonly consoleWindowVisible: boolean
        readonly mainWindowHandle: number
        readonly stdioRoundTrip: boolean
        readonly childExited: boolean
        readonly parentConsoleDetached: boolean
      }
      readonly hidden: {
        readonly consoleAttached: boolean
        readonly consoleWindowHandle: number
        readonly consoleWindowVisible: boolean
        readonly mainWindowHandle: number
        readonly stdioRoundTrip: boolean
        readonly childExited: boolean
        readonly parentConsoleDetached: boolean
      }
      readonly isolation: {
        readonly credentialsUntouched: boolean
      }
      readonly cleanup: {
        readonly tempRootRemoved: boolean
      }
    }

    // then
    process.stdout.write(`WINDOWS_CONSOLE_PROBE ${JSON.stringify(payload)}\n`)
    expect(payload.result).toBe("PASS")
    expect(payload.visible.consoleAttached).toBe(true)
    expect(payload.visible.consoleWindowHandle).not.toBe(0)
    expect(payload.visible.consoleWindowVisible).toBe(true)
    expect(payload.hidden.consoleWindowVisible).toBe(false)
    expect(payload.hidden.mainWindowHandle).toBe(0)
    expect(payload.visible.parentConsoleDetached).toBe(true)
    expect(payload.hidden.parentConsoleDetached).toBe(true)
    expect(payload.visible.stdioRoundTrip).toBe(true)
    expect(payload.hidden.stdioRoundTrip).toBe(true)
    expect(payload.visible.childExited).toBe(true)
    expect(payload.hidden.childExited).toBe(true)
    expect(payload.isolation.credentialsUntouched).toBe(true)
    expect(payload.cleanup.tempRootRemoved).toBe(true)
  },
  { timeout: PROBE_TIMEOUT_MS + CLEANUP_TIMEOUT_MS + 10_000 },
)
