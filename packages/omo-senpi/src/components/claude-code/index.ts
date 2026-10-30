import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { acquireClaudeCode, cachedExecutablePath, type ClaudeCodeDownloadProgress, type ClaudeCodePin } from "./acquire"
import { findOnPath } from "./find-on-path"

export const CLAUDE_CODE_PROVIDER = "anthropic-subscription"
export const CLAUDE_CODE_PIN_FILE = "claude-code-pin.json"
export const CLAUDE_CODE_STATUS_KEY = "omo-claude-code"

type TurnContext = {
  readonly model?: { readonly provider?: string }
  readonly ui?: {
    notify?(message: string, level: "info" | "warning" | "error"): void
    setStatus?(key: string, text: string | undefined): void
  }
}

export type ClaudeCodeComponentOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly execPath?: string
  readonly fetch?: typeof globalThis.fetch
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | null
}

// A standalone binary carries the pin beside its provisioned runtime; an npm install has none and
// keeps the Claude Code executable its own install placed.
export function readClaudeCodePin(runtimeDir: string): ClaudeCodePin | undefined {
  const path = join(runtimeDir, CLAUDE_CODE_PIN_FILE)
  if (!existsSync(path)) return undefined
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { name, version, integrity, claudeCodeVersion } = parsed as Record<string, unknown>
  if (typeof name !== "string" || typeof version !== "string" || typeof integrity !== "string") return undefined
  return { name, version, integrity, ...(typeof claudeCodeVersion === "string" ? { claudeCodeVersion } : {}) }
}

// The compiled launcher pins OMO_PACKAGE_DIR to the provisioned runtime. process.execPath can still be
// the downloaded binary when provisioning finished without a re-exec (always on Windows), and the pin
// is only beside the runtime.
export function claudeCodeRuntimeDir(env: NodeJS.ProcessEnv, execPath: string = process.execPath): string {
  return env.OMO_PACKAGE_DIR || dirname(execPath)
}

export function applyCachedClaudeCode(
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
  which: (command: string) => string | null = (command) => findOnPath(command, env),
): void {
  if (env.CLAUDE_CODE_EXECUTABLE) return
  const pin = readClaudeCodePin(runtimeDir)
  if (pin === undefined || which("claude") !== null) return
  const cached = cachedExecutablePath(join(runtimeDir, "claude-code"), pin, platform)
  if (existsSync(cached) && statSync(cached).size > 0) env.CLAUDE_CODE_EXECUTABLE = cached
}

const megabytes = (bytes: number): string => `${Math.round(bytes / 1_048_576)} MB`

export function claudeCodeProgressLine(pin: ClaudeCodePin, progress: ClaudeCodeDownloadProgress): string {
  const amount = progress.totalBytes === undefined
    ? megabytes(progress.receivedBytes)
    : `${Math.floor((progress.receivedBytes / progress.totalBytes) * 100)}% of ${megabytes(progress.totalBytes)}`
  return `Downloading Claude Code ${pin.claudeCodeVersion ?? pin.version}: ${amount}`
}

function isPreview(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && Reflect.get(payload, "preview") === true
}

export function createClaudeCodeComponent(options: ClaudeCodeComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "claude-code",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const env = options.env ?? process.env
      const runtimeDir = claudeCodeRuntimeDir(env, options.execPath)
      const pin = readClaudeCodePin(runtimeDir)
      if (pin === undefined) return
      let settled: Promise<void> | undefined
      const ensure = (turn: TurnContext | undefined): Promise<void> => {
        if (env.CLAUDE_CODE_EXECUTABLE || (options.which ?? ((command: string) => findOnPath(command, env)))("claude") !== null) return Promise.resolve()
        let shownStep = -1
        settled ??= acquireClaudeCode({
          pin,
          cacheRoot: join(runtimeDir, "claude-code"),
          platform: options.platform,
          fetch: options.fetch,
          onDownloadStart: (message) => turn?.ui?.notify?.(message, "info"),
          onProgress: (progress) => {
            const step = progress.totalBytes === undefined ? Math.floor(progress.receivedBytes / 10_485_760) : Math.floor((progress.receivedBytes / progress.totalBytes) * 10)
            if (step === shownStep) return
            shownStep = step
            turn?.ui?.setStatus?.(CLAUDE_CODE_STATUS_KEY, claudeCodeProgressLine(pin, progress))
          },
        }).then((acquired) => {
          turn?.ui?.setStatus?.(CLAUDE_CODE_STATUS_KEY, undefined)
          if (acquired.path === null) {
            settled = undefined
            turn?.ui?.notify?.(acquired.error, "error")
            ctx.logger.warn(acquired.error)
            return
          }
          env.CLAUDE_CODE_EXECUTABLE = acquired.path
        })
        return settled
      }
      const onTurn = async (payload: unknown, eventCtx: unknown): Promise<undefined> => {
        const turn = eventCtx as TurnContext | undefined
        if (turn?.model?.provider !== CLAUDE_CODE_PROVIDER || isPreview(payload)) return undefined
        await ensure(turn)
        return undefined
      }
      // A user prompt runs `input` before senpi's auth check (agent-session prompt(): emitInput, then
      // checkAuth, then before_agent_start), so a `claude login`-only user needs the executable there.
      // A turn an extension starts (sendMessage triggerTurn) skips `input` and reaches before_agent_start.
      pi.on("input", onTurn)
      pi.on("before_agent_start", onTurn, { previewSafe: true })
    },
  }
}
