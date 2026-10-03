/// <reference types="bun-types" />

import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

const isWin32 = process.platform === "win32"
const driverPath = fileURLToPath(new URL("./task-rpc-e2e.mjs", import.meta.url))
// The kill and reconcile checks can each wait their full parent + child budget (120 s + 40 s,
// task-rpc-e2e-scenarios.mjs) and tear down (15 s); the other checks take about a minute. The driver
// must outlast all of that, so a slow cold start reports its diagnostic facts instead of being killed.
const DRIVER_TIMEOUT_MS = 420_000
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

function assertDriverChecks(payload: DriverPayload): void {
  const failed = payload.checks.filter((candidate) => candidate.verdict !== "PASS")
  if (payload.result !== "PASS" || failed.length > 0) {
    throw new Error(`WINDOWS_TASK_RPC_E2E result=${payload.result}; failing checks: ${failed.map((candidate) => candidate.check).join(", ") || "none reported"}`)
  }
}

test("#given a failing driver check #when asserting the payload #then the check name appears in the failure", () => {
  const payload = {
    result: "FAIL",
    checks: [{ check: "kill_marks_error_killed_true", verdict: "FAIL" }],
  } as DriverPayload
  expect(() => assertDriverChecks(payload)).toThrow("kill_marks_error_killed_true")
})

test("#given the driver reports FAIL #when individual checks look green #then the wrapper still fails", () => {
  const payload = {
    result: "FAIL",
    checks: [{ check: "kill_marks_error_killed_true", verdict: "PASS" }],
  } as DriverPayload
  expect(() => assertDriverChecks(payload)).toThrow("WINDOWS_TASK_RPC_E2E result=FAIL")
})

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
    // Windows cannot attribute an external TerminateProcess to a kill, so its check proves the honest
    // outcome: status=error, killed=false, an unexpected-exit message (#9471).
    const killProof = check(payload, "external_termination_reports_unexpected_exit")
    const leakProof = check(payload, "no_leaked_rpc_child_pids")

    // then
    console.log(`WINDOWS_TASK_RPC_E2E ${JSON.stringify(payload)}`)
    if (killProof?.verdict !== "PASS") {
      console.log(`WINDOWS_TASK_RPC_E2E_KILL_FACTS ${JSON.stringify(killProof?.facts ?? null)}`)
    }
    assertDriverChecks(payload)
    expect(payload.wiringFixed).toBe(true)
    expect(route?.verdict).toBe("PASS")
    expect(route?.facts?.pid).toBeGreaterThan(0)
    expect(spawnProof?.verdict).toBe("PASS")
    expect(spawnProof?.facts?.sessionJsonl).toBe(true)
    expect(killProof?.verdict).toBe("PASS")
    expect(payload.realCredentialsUntouched).toBe(true)
    expect(payload.wholeDirDigestStable).toBe(true)
    expect(leakProof?.verdict).toBe("PASS")
    expect(leakProof?.facts?.leakedPids).toEqual([])
    expect(payload.leakedPids).toBe(0)
  },
  { timeout: DRIVER_TIMEOUT_MS + CLEANUP_TIMEOUT_MS + 10_000 },
)
