import { runDshAcpAgent } from "./acp-client"
import { runDshHeadless } from "./headless-runner"
import { runVerificationGate } from "./verify"
import { resolveDshAuth } from "./auth"

export type DshRunnerOptions = {
  // Command to spawn per run (default "npx")
  readonly command?: string
  // Base args for the dsh CLI (default ["-y", "@deepseek-ai/dsh"])
  readonly args?: readonly string[]
  // Execution mode: "headless" (default) | "acp"
  readonly mode?: "headless" | "acp"
  // Auto-answer policy for the ACP child's permission requests (ACP mode only; default "allow_once")
  readonly permission?: "reject" | "allow_once"
  // Hard timeout for one run in ms (default 300000)
  readonly timeoutMs?: number
  // Optional working-directory override (defaults to the caller-provided cwd)
  readonly cwd?: string
  // Auth accessor: engine credential resolver, passed through to resolveDshAuth (optional)
  readonly getApiKeyForProvider?: (provider: string) => string | undefined | Promise<string | undefined>
  // DI ports for tests: default env is process.env; default readFile is readFileSync
  readonly env?: NodeJS.ProcessEnv
  readonly authPath?: string
  readonly readFile?: (path: string) => string
}

export type DshRunRequest = {
  readonly prompt: string
  readonly cwd?: string
  readonly verify?: string
  readonly abort?: AbortSignal
}

export type DshRunOutcome = {
  readonly output: string
  readonly stopReason: string // "completed" | "end_turn" | "refusal" | actual ACP stop reason
  readonly exitCode: number | null
  readonly verified: boolean // false when no verify gate requested
  readonly verify?: string // the gate command when one was requested
  readonly evidence?: string // verification evidence when verify failed (truncated to 1500 chars)
}

const DEFAULT_COMMAND = "npx"
const DEFAULT_ARGS = ["-y", "@deepseek-ai/dsh"]
const DEFAULT_TIMEOUT_MS = 300_000
const EVIDENCE_LIMIT = 1500

/**
 * Standalone one-shot DeepSeek Harness spawner, faithful to the opencode
 * createDshAgentTool semantics: spawn a fresh dsh child per run, optionally
 * run a deterministic verification gate, and settle on the outcome. It does
 * not touch the task state machine.
 */
export class DshRunner {
  private readonly command: string
  private readonly args: readonly string[]
  private readonly mode: "headless" | "acp"
  private readonly permission: "reject" | "allow_once"
  private readonly timeoutMs: number
  private readonly cwd: string | undefined
  private readonly getApiKeyForProvider:
    | ((provider: string) => string | undefined | Promise<string | undefined>)
    | undefined
  private readonly env: NodeJS.ProcessEnv | undefined
  private readonly authPath: string | undefined
  private readonly readFile: ((path: string) => string) | undefined

  constructor(options: DshRunnerOptions = {}) {
    this.command = options.command ?? DEFAULT_COMMAND
    this.args = options.args ?? DEFAULT_ARGS
    this.mode = options.mode ?? "headless"
    this.permission = options.permission ?? "allow_once"
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cwd = options.cwd
    this.getApiKeyForProvider = options.getApiKeyForProvider
    this.env = options.env
    this.authPath = options.authPath
    this.readFile = options.readFile
  }

  async run(request: DshRunRequest): Promise<DshRunOutcome> {
    const cwd = request.cwd ?? this.cwd ?? process.cwd()
    const abort = request.abort ?? new AbortController().signal

    const auth = await resolveDshAuth(this.env ?? process.env, {
      getApiKeyForProvider: this.getApiKeyForProvider,
      authPath: this.authPath,
      readFile: this.readFile,
    })
    const childEnv: Record<string, string | undefined> = {
      ...(auth.apiKey === undefined ? {} : { DEEPSEEK_API_KEY: auth.apiKey }),
      ...(auth.baseUrl === undefined ? {} : { DEEPSEEK_BASE_URL: auth.baseUrl }),
      ...(auth.model === undefined ? {} : { DSH_MODEL: auth.model }),
    }

    let output: string
    let stopReason: string
    let exitCode: number | null

    if (this.mode === "acp") {
      const result = await runDshAcpAgent({
        command: this.command,
        args: [...this.args, "acp"],
        cwd,
        prompt: request.prompt,
        permission: this.permission,
        timeoutMs: this.timeoutMs,
        abort,
        env: childEnv,
      })
      output = result.output
      stopReason = result.stopReason
      exitCode = null
    } else {
      const result = await runDshHeadless({
        command: this.command,
        args: [...this.args],
        cwd,
        prompt: request.prompt,
        timeoutMs: this.timeoutMs,
        abort,
        env: childEnv,
      })
      output = result.output
      stopReason = "completed"
      exitCode = result.exitCode
    }

    if (request.verify === undefined) {
      return { output, stopReason, exitCode, verified: false }
    }

    const gate = await runVerificationGate({
      cwd,
      command: request.verify,
      timeoutMs: this.timeoutMs,
      abort,
    })
    if (gate.verified) {
      return { output, stopReason, exitCode, verified: true, verify: request.verify }
    }
    const evidence = gate.evidence.slice(0, EVIDENCE_LIMIT)
    return {
      output: `${output}\n\n--- VERIFICATION FAILED ---\n${evidence}\n--- END VERIFICATION ---`,
      stopReason,
      exitCode,
      verified: false,
      verify: request.verify,
      evidence,
    }
  }
}