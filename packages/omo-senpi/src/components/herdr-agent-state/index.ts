import { spawn, spawnSync } from "node:child_process"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

const AGENT = "omo"
const SOURCE = "omo-senpi"
const REPORT_TIMEOUT_MS = 2000
const EXIT_TIMEOUT_MS = 1000

type HerdrState = "idle" | "working"

type HerdrAction = "release-agent" | "report-agent"

type CommandFailureReason = "nonzero" | "signal" | "spawn-error" | "timeout"

type CommandOutcome = {
  readonly ok: boolean
  readonly code: number | null
  readonly reason?: CommandFailureReason
  readonly stderrBytes: number
}

type HerdrEnvironment = {
  readonly binPath: string
  readonly paneId: string
}

export interface HerdrAgentStateComponentOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly registerProcessExit?: (handler: () => void) => () => void
  readonly runCommand?: (command: string, args: readonly string[], timeoutMs: number) => Promise<CommandOutcome>
  readonly runCommandSync?: (command: string, args: readonly string[], timeoutMs: number) => CommandOutcome
}

function resolveHerdrEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HerdrEnvironment | undefined {
  const binPath = environment["HERDR_BIN_PATH"]
  const paneId = environment["HERDR_PANE_ID"]
  if (environment["HERDR_ENV"] !== "1" || binPath === undefined || paneId === undefined) return undefined
  if (binPath.length === 0 || paneId.length === 0) return undefined
  return { binPath, paneId }
}

function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code)
  }
  return ""
}

export function safeErrorName(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "unknown"
    const name = error.name
    return typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "unknown"
  } catch {
    return "unknown"
  }
}

export function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let stderrBytes = 0
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] })
    const detach = (): void => {
      child.stderr?.removeAllListeners()
      child.stderr?.destroy()
      child.removeAllListeners()
      child.unref()
    }
    const settle = (outcome: CommandOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      detach()
      settle({ ok: false, code: null, reason: "timeout", stderrBytes })
    }, timeoutMs)
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length
    })
    child.once("error", () => settle({ ok: false, code: null, reason: "spawn-error", stderrBytes }))
    child.once("close", (code, signal) => {
      if (code === 0) return settle({ ok: true, code: 0, stderrBytes })
      if (signal !== null) return settle({ ok: false, code: null, reason: "signal", stderrBytes })
      settle({ ok: false, code: code ?? 1, reason: "nonzero", stderrBytes })
    })
  })
}

export function runCommandSync(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): CommandOutcome {
  const result = spawnSync(command, [...args], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  })
  const stderrBytes = result.stderr === null ? 0 : result.stderr.length
  if (result.error !== undefined && result.error !== null) {
    if (errorCode(result.error) === "ETIMEDOUT") return { ok: false, code: null, reason: "timeout", stderrBytes }
    return { ok: false, code: null, reason: "spawn-error", stderrBytes }
  }
  if (result.signal !== null) return { ok: false, code: null, reason: "signal", stderrBytes }
  const status = result.status ?? 1
  if (status === 0) return { ok: true, code: status, stderrBytes }
  return { ok: false, code: status, reason: "nonzero", stderrBytes }
}

function registerProcessExit(handler: () => void): () => void {
  process.once("exit", handler)
  return () => process.off("exit", handler)
}

export function createHerdrAgentStateComponent(
  options: HerdrAgentStateComponentOptions = {},
): OmoSenpiComponent {
  return {
    name: "herdr-agent-state",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const environment = resolveHerdrEnvironment(options.environment ?? process.env)
      if (environment === undefined) return
      const execute = options.runCommand ?? runCommand
      const executeSync = options.runCommandSync ?? runCommandSync

      const warnFailure = (action: HerdrAction, outcome: CommandOutcome): void => {
        ctx.logger.warn("omo-senpi Herdr lifecycle report failed", {
          action,
          reason: outcome.reason ?? "nonzero",
          code: outcome.code,
          stderrBytes: outcome.stderrBytes,
        })
      }
      const warnException = (action: HerdrAction, error: unknown): void => {
        ctx.logger.warn("omo-senpi Herdr lifecycle report failed", {
          action,
          reason: "exception",
          errorName: safeErrorName(error),
        })
      }

      const command = (action: HerdrAction, args: readonly string[]): readonly string[] => [
        "pane",
        action,
        environment.paneId,
        ...args,
      ]
      const invoke = async (action: HerdrAction, args: readonly string[]): Promise<void> => {
        try {
          const outcome = await execute(environment.binPath, command(action, args), REPORT_TIMEOUT_MS)
          if (!outcome.ok) warnFailure(action, outcome)
        } catch (error) {
          warnException(action, error)
        }
      }
      const invokeSync = (action: HerdrAction, args: readonly string[]): void => {
        try {
          const outcome = executeSync(environment.binPath, command(action, args), EXIT_TIMEOUT_MS)
          if (!outcome.ok) warnFailure(action, outcome)
        } catch (error) {
          warnException(action, error)
        }
      }

      const reportArgs = (state: HerdrState): readonly string[] => [
        "--source",
        SOURCE,
        "--agent",
        AGENT,
        "--state",
        state,
      ]
      const releaseArgs: readonly string[] = ["--source", SOURCE, "--agent", AGENT]
      const report = (state: HerdrState): Promise<void> => invoke("report-agent", reportArgs(state))
      const releaseSync = (): void => {
        invokeSync("report-agent", reportArgs("idle"))
        invokeSync("release-agent", releaseArgs)
      }
      const unregisterProcessExit = (options.registerProcessExit ?? registerProcessExit)(releaseSync)

      pi.on("session_start", () => report("idle"))
      pi.on("agent_start", () => report("working"))
      pi.on("agent_settled", () => report("idle"))
      pi.on("session_shutdown", () => {
        unregisterProcessExit()
        releaseSync()
      })
    },
  }
}
