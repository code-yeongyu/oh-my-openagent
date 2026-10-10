import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import { log } from "@oh-my-opencode/utils"

import type { RpcChildHandle, RpcRunnerSpec } from "./types"
import { RunnerError } from "./in-process/runner-error"
import { childRetryFallbackProfile } from "./retry-fallback-profile"
import { createRpcChildHandle } from "./rpc/handle"
import { createRpcModelAdmission, type RpcModelAdmission } from "./rpc/model-admission"
import { type MalformedLineHandler, RpcProtocolClient } from "./rpc/protocol-client"
import { type RpcSpawnDescriptor, buildRpcSpawn } from "./rpc/spawn"
import { discardUnstartedRpcHandle } from "./rpc/start-cleanup"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000
/** senpi capability: a single-session `--mode rpc` process accepts `set_retry_fallback` before its first turn. */
const RETRY_FALLBACK_COMMAND_CAPABILITY = "retry_fallback_command"
/** How long a child's start waits for the engine to answer its fallback chain before prompting without it. */
const DEFAULT_FALLBACK_CHAIN_DEADLINE_MS = 10_000

export type RpcProcessRunnerOptions = {
  readonly spawnChild?: (descriptor: RpcSpawnDescriptor) => ChildProcess
  readonly spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly heartbeatIntervalMs?: number
  readonly fallbackChainDeadlineMs?: number
  readonly onMalformedLine?: MalformedLineHandler
  readonly now?: () => number
  readonly modelAdmission?: RpcModelAdmission
  // The parent's `-e` extension entries, forwarded to every child so a detached process reproduces the
  // parent's extensions. Applied only when a spec does not already carry its own extensions.
  readonly inheritedExtensions?: readonly string[]
  // Told once when a child's fallback models cannot reach its process: an engine without
  // `retry_fallback_command` (#9582).
  readonly onWarning?: (message: string) => void | (() => void)
}

/**
 * Spawns a senpi RPC child (never shell:true) with an isolated session dir and
 * returns a steerable RpcChildHandle. The initial work is driven as a tracked
 * async prompt so callers can steer WHILE the turn is in flight. Process
 * destruction is exclusively via the single-writer terminate port (todo 12).
 */
export class RpcProcessRunner {
  private readonly spawnChild: (descriptor: RpcSpawnDescriptor) => ChildProcess
  private readonly buildSpawn: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  private readonly heartbeatIntervalMs: number
  private readonly onMalformedLine: MalformedLineHandler | undefined
  private readonly now: () => number
  private readonly modelAdmission: RpcModelAdmission
  private readonly inheritedExtensions: readonly string[]
  private readonly onWarning: (message: string) => void | (() => void)
  private readonly fallbackChainDeadlineMs: number
  private fallbackChainUnsupportedNoticed = false

  constructor(options: RpcProcessRunnerOptions = {}) {
    this.spawnChild =
      options.spawnChild ??
      ((descriptor) => defaultSpawnChild(descriptor, options.spawnProcess ?? spawn))
    this.buildSpawn = options.buildSpawn ?? ((spec) => buildRpcSpawn(spec))
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.onMalformedLine = options.onMalformedLine
    this.now = options.now ?? Date.now
    this.modelAdmission = options.modelAdmission ?? createRpcModelAdmission()
    this.inheritedExtensions = options.inheritedExtensions ?? []
    this.onWarning = options.onWarning ?? ((message) => log("senpi-task process runner", { message }))
    this.fallbackChainDeadlineMs = options.fallbackChainDeadlineMs ?? DEFAULT_FALLBACK_CHAIN_DEADLINE_MS
  }

  async start(specInput: RpcRunnerSpec): Promise<RpcChildHandle> {
    const spec =
      specInput.extensions === undefined && this.inheritedExtensions.length > 0
        ? { ...specInput, extensions: this.inheritedExtensions }
        : specInput
    await this.modelAdmission(spec)
    const descriptor = this.buildSpawn(spec)
    const child = this.spawnChild(descriptor)
    const client = new RpcProtocolClient({ child, onMalformedLine: this.onMalformedLine })
    const handle = createRpcChildHandle({
      client,
      child,
      taskId: spec.task_id,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      now: this.now,
      childEnv: descriptor.env,
    })
    let resume: ReturnType<RpcProtocolClient["switchSession"]> | undefined
    try {
      // The chain is a launch-time setting: senpi refuses it once the session has a turn, so it goes before
      // the resumed session is switched in and before the first prompt.
      await this.applyFallbackChain(client, spec)
      resume = spec.resumeSessionPath === undefined ? undefined : client.switchSession(spec.resumeSessionPath)
      if (resume === undefined) {
        await handle.startInitialPrompt(spec.prompt)
      } else {
        await resume
      }
    } catch (error) {
      // Capture this BEFORE cleanup: a rejected prompt can leave the child alive, and the cleanup
      // termination must never be recorded as the cause of the rejection.
      const exitOutcome = handle.exitOutcome()
      try {
        await discardUnstartedRpcHandle(handle)
      } catch (cleanupError) {
        log("senpi-task rpc start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
      }
      const message = error instanceof Error ? error.message : String(error)
      // A child that died before its first prompt leaves its cause ONLY here: the classified exit is
      // otherwise folded into `message`, which is stderr-derived and gets sanitized away downstream.
      throw new RunnerError({
        kind: spec.resumeSessionPath === undefined ? "child-prompt-failed" : "session_unavailable",
        message,
        cause: error,
        rejected_while: exitOutcome === undefined ? "alive" : "exited",
        ...(exitOutcome === undefined
          ? {}
          : { exit: { kind: exitOutcome.kind, code: exitOutcome.facts.code, signal: exitOutcome.facts.signal } }),
      })
    }
    return Object.assign(handle, {
      spawnSpec: {
        cwd: spec.cwd,
        ...(spec.extensions === undefined ? {} : { extensions: spec.extensions }),
        ...(spec.memberEnv === undefined ? {} : { memberEnv: spec.memberEnv }),
      },
      switchSession: (sessionPath: string) =>
        sessionPath === spec.resumeSessionPath && resume !== undefined
          ? resume
          : client.switchSession(sessionPath),
      getEntries: (since?: string) => client.getEntries(since),
    })
  }

  // The child's own chain reaches its process as `set_retry_fallback`, held in memory there and never
  // written to a settings file (#9582). An engine without the command keeps the manager's fallback before
  // any tool call; the in-session switch after a tool call is what it loses, so say so once.
  // The chain only improves a turn that hits a limit later; it never holds the start up. A refusal or a
  // missing answer leaves the child on the manager's fallback (the same as an older engine), the task id is
  // named, and the first prompt goes out. A child that died meanwhile fails on that prompt as before.
  private async applyFallbackChain(client: RpcProtocolClient, spec: RpcRunnerSpec): Promise<void> {
    const retryFallback = childRetryFallbackProfile(spec)
    if (retryFallback === undefined) return
    const outcome = await this.sendFallbackChain(client, retryFallback)
    if (outcome === "applied") return
    if (outcome === "unsupported") {
      this.noticeFallbackChainUnsupported()
      return
    }
    // A child that died meanwhile fails on its first prompt next; the warning must not blame the engine.
    if (client.exited) {
      this.onWarning(`task ${spec.task_id}: its fallback chain was not applied because the child exited while it was being sent`)
      return
    }
    const reason = outcome === "timeout" ? `no answer within ${this.fallbackChainDeadlineMs} ms` : outcome.refused
    this.onWarning(
      `task ${spec.task_id}: its fallback chain was not applied (${reason}), so it switches to a fallback model ` +
        "only when a turn fails before any tool call",
    )
  }

  private async sendFallbackChain(
    client: RpcProtocolClient,
    retryFallback: NonNullable<ReturnType<typeof childRetryFallbackProfile>>,
  ): Promise<"applied" | "unsupported" | "timeout" | { readonly refused: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.fallbackChainDeadlineMs)
    })
    try {
      // A late probe answer must not dispatch launch-time settings after the first prompt or resume.
      const acceptsChain = await Promise.race([engineAcceptsFallbackChain(client), deadline])
      if (acceptsChain === "timeout") return "timeout"
      if (!acceptsChain) return "unsupported"
      // send enqueues the write synchronously; Writable keeps a later prompt behind it under backpressure.
      // Only the response wait may outlive setup, using the same total deadline as the capability probe.
      const response = await Promise.race([client.send({ type: "set_retry_fallback", retryFallback }), deadline])
      if (response === "timeout") return "timeout"
      return response.success ? "applied" : { refused: `refused: ${response.error}` }
    } catch (error) {
      return { refused: `refused: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      clearTimeout(timer)
    }
  }

  private noticeFallbackChainUnsupported(): void {
    if (this.fallbackChainUnsupportedNoticed) return
    this.fallbackChainUnsupportedNoticed = true
    this.onWarning(
      "this senpi engine cannot take a task child's fallback chain (no retry_fallback_command), so children " +
        "started as their own process switch to their fallback models only when a turn fails before any tool call",
    )
  }
}

async function engineAcceptsFallbackChain(client: RpcProtocolClient): Promise<boolean> {
  const response = await client.send({ type: "get_protocol_info" })
  if (!response.success || response.command !== "get_protocol_info") return false
  const capabilities = (response.data as { readonly capabilities?: unknown }).capabilities
  return Array.isArray(capabilities) && capabilities.includes(RETRY_FALLBACK_COMMAND_CAPABILITY)
}

function defaultSpawnChild(
  descriptor: RpcSpawnDescriptor,
  spawnProcess: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess,
): ChildProcess {
  return spawnProcess(descriptor.command, [...descriptor.args], {
    cwd: descriptor.cwd,
    env: descriptor.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  })
}
