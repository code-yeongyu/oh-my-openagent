/// <reference types="bun-types" />

import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

const isWin32 = process.platform === "win32"
const driverPath = fileURLToPath(new URL("./task-rpc-e2e.mjs", import.meta.url))
const DRIVER_TIMEOUT_MS = 180_000
const CLEANUP_TIMEOUT_MS = 10_000

type DriverExit = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

type DriverCheck = {
  readonly check: string
  readonly verdict: string
  readonly facts?: {
    readonly pid?: number
    readonly sessionJsonl?: boolean
    readonly leakedPids?: readonly number[]
  }
}

type DriverPayload = {
  readonly result: string
  readonly checks: readonly DriverCheck[]
  readonly realCredentialsUntouched: boolean
  readonly wholeDirDigestStable: boolean
  readonly leakedPids: number
  readonly wiringFixed: boolean
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

async function waitForClose(child: ChildProcess): Promise<DriverExit> {
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

function check(payload: DriverPayload, name: string): DriverCheck | undefined {
  return payload.checks.find((candidate) => candidate.check === name)
}

test.skipIf(!isWin32)(
  "#given the production task driver #when process mode runs on Windows #then it reaches a real RPC child",
  async () => {
    // given
    const driver = spawn(process.execPath, [driverPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SENPI_BIN: process.env.SENPI_BIN?.trim() || "senpi",
        SENPI_CODING_AGENT_DIR: join(tmpdir(), `omo-rpc-driver-caller-${process.pid}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let spawnError: Error | undefined
    driver.stdout?.setEncoding("utf8")
    driver.stderr?.setEncoding("utf8")
    driver.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    driver.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })
    driver.once("error", (error) => {
      spawnError = error
    })
    let closeObserved = false
    const close = waitForClose(driver).then((exit) => {
      closeObserved = true
      return exit
    })
    const deadline = createDeadline(DRIVER_TIMEOUT_MS, "Windows production RPC driver")

    // when
    let exit: DriverExit
    try {
      exit = await Promise.race([close, deadline.promise])
    } finally {
      deadline.cancel()
      if (!closeObserved) {
        await terminateProcessTree(driver)
        const cleanupDeadline = createDeadline(CLEANUP_TIMEOUT_MS, "Windows production RPC driver cleanup")
        try {
          await Promise.race([close, cleanupDeadline.promise])
        } finally {
          cleanupDeadline.cancel()
        }
      }
    }
    const diagnostic = { exit, error: spawnError === undefined ? undefined : String(spawnError), stdout, stderr }
    if (exit.code !== 0 || exit.signal !== null || stderr !== "" || spawnError !== undefined) {
      throw new Error(`WINDOWS_TASK_RPC_E2E ${JSON.stringify(diagnostic)}`)
    }
    const parsed: unknown = JSON.parse(stdout.trim())
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("checks" in parsed) ||
      !Array.isArray(parsed.checks) ||
      !("wiringFixed" in parsed) ||
      typeof parsed.wiringFixed !== "boolean"
    ) {
      throw new Error(`WINDOWS_TASK_RPC_E2E invalid payload ${JSON.stringify({ parsed, diagnostic })}`)
    }
    const payload = parsed as DriverPayload
    const route = check(payload, "process_mode_routes_to_rpc_runner")
    const spawnProof = check(payload, "spawn_process_pid_and_session_jsonl")
    const leakProof = check(payload, "no_leaked_rpc_child_pids")

    // then
    console.log(`WINDOWS_TASK_RPC_E2E ${JSON.stringify(payload)}`)
    expect(payload.wiringFixed).toBe(true)
    expect(route?.verdict).toBe("PASS")
    expect(route?.facts?.pid).toBeGreaterThan(0)
    expect(spawnProof?.verdict).toBe("PASS")
    expect(spawnProof?.facts?.sessionJsonl).toBe(true)
    expect(payload.realCredentialsUntouched).toBe(true)
    expect(payload.wholeDirDigestStable).toBe(true)
    expect(leakProof?.verdict).toBe("PASS")
    expect(leakProof?.facts?.leakedPids).toEqual([])
    expect(payload.leakedPids).toBe(0)
  },
  { timeout: DRIVER_TIMEOUT_MS + CLEANUP_TIMEOUT_MS + 10_000 },
)
