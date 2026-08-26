import { spawn } from "node:child_process"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

const AGENT = "omo"
const SOURCE = "omo-senpi"

type HerdrState = "idle" | "working"

type CommandResult = {
  readonly code: number
  readonly stderr: string
}

type HerdrEnvironment = {
  readonly binPath: string
  readonly paneId: string
}

export interface HerdrAgentStateComponentOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly runCommand?: (command: string, args: readonly string[]) => Promise<CommandResult>
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

function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code) => {
      resolve({ code: code ?? 1, stderr: stderr.trim() })
    })
  })
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

      const invoke = async (action: "release-agent" | "report-agent", args: readonly string[]): Promise<void> => {
        try {
          const result = await execute(environment.binPath, ["pane", action, environment.paneId, ...args])
          if (result.code === 0) return
          ctx.logger.warn("omo-senpi Herdr lifecycle report failed", {
            action,
            code: result.code,
            stderr: result.stderr,
          })
        } catch (error) {
          ctx.logger.warn("omo-senpi Herdr lifecycle report failed", {
            action,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const report = (state: HerdrState): Promise<void> => invoke("report-agent", [
        "--source", SOURCE,
        "--agent", AGENT,
        "--state", state,
      ])

      pi.on("session_start", () => report("idle"))
      pi.on("agent_start", () => report("working"))
      pi.on("agent_settled", () => report("idle"))
      pi.on("session_shutdown", () => invoke("release-agent", ["--source", SOURCE, "--agent", AGENT]))
    },
  }
}
