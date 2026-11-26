import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import { log } from "@oh-my-opencode/utils"

import type { RpcChildHandle, RpcRunnerSpec } from "./types"
import { RunnerError } from "./in-process/runner-error"
import { DesignatedChainNotHeldError, type DesignatedChainNotHeldReason } from "./designated-chain-error"
import { designatedChainText } from "./designated-fallback-profile"
import { childRetryFallbackProfile } from "./retry-fallback-profile"
import { createRpcChildHandle, type CreateRpcChildHandleOptions } from "./rpc/handle"
import { createRpcModelAdmission, type RpcModelAdmission } from "./rpc/model-admission"
import { type MalformedLineHandler, RpcProtocolClient } from "./rpc/protocol-client"
import { type RpcSpawnDescriptor, buildRpcSpawn } from "./rpc/spawn"
import { discardUnstartedRpcHandle } from "./rpc/start-cleanup"
import { readProcessTreeCpuSeconds } from "../platform/process-tree-cpu"
import { createTaskRecordStore } from "../store"
import { InputUncertainError } from "./input-effects"
import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import { ChildParentLink, type ParentPermissionMode } from "./parent-link"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000
/** senpi capability: a single-session `--mode rpc` process accepts `set_retry_fallback` before its first turn. */
const RETRY_FALLBACK_COMMAND_CAPABILITY = "retry_fallback_command"
/** How long a child's start waits for the engine to answer its fallback chain before the start fails. */
const DEFAULT_FALLBACK_CHAIN_DEADLINE_MS = 10_000
// #13165: the engine's cold start (spawn until it answers get_protocol_info) is bounded by its CPU progress, not by
// the chain deadline: a slow runner stretches the boot's wall time, not the CPU it needs. A boot that makes no CPU
// progress for the stall window, or burns past the CPU cap, is stuck; the outer bound holds even when the CPU cannot
// be read (another runtime, a refused handle).
const DEFAULT_STARTUP_STALL_MS = 10_000
const DEFAULT_STARTUP_CPU_CAP_S = 120
const DEFAULT_STARTUP_OUTER_BOUND_MS = 10 * 60_000
const STARTUP_SAMPLE_MS = 250
const STARTUP_PROGRESS_EPSILON_S = 0.02

export type RpcProcessRunnerOptions = {
  readonly terminateChild?: CreateRpcChildHandleOptions["terminateChild"]
  readonly spawnChild?: (descriptor: RpcSpawnDescriptor) => ChildProcess
  readonly spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly heartbeatIntervalMs?: number
  readonly fallbackChainDeadlineMs?: number
  readonly startupStallMs?: number
  readonly startupCpuCapS?: number
  readonly startupOuterBoundMs?: number
  readonly readCpuSeconds?: (pid: number) => number | null
  readonly onMalformedLine?: MalformedLineHandler
  readonly now?: () => number
  readonly modelAdmission?: RpcModelAdmission
  // The parent's `-e` extension entries, forwarded to every child so a detached process reproduces the
  // parent's extensions. Applied only when a spec does not already carry its own extensions.
  readonly inheritedExtensions?: readonly string[]
  // Where a child that did not follow its parent's approval mode is reported (#6189 F2e), under a per-task token.
  readonly onWarning?: (message: string, token?: string) => void | (() => void)
  // The parent session's UI a child's dialogs are answered on, and the approval mode it opens with and follows
  // (#6189 F2c-F2e). Absent: dialogs get the safe deny/cancel default and the child keeps its own mode.
  readonly dialogs?: ChildDialogForwarder
  readonly parentPermission?: ParentPermissionMode
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
  private readonly onWarning: (message: string, token?: string) => void | (() => void)
  private readonly fallbackChainDeadlineMs: number
  private readonly startupBounds: StartupBounds
  private readonly pendingTeardowns = new Set<Promise<void>>()
  private readonly terminateChild: CreateRpcChildHandleOptions["terminateChild"]
  private readonly options: RpcProcessRunnerOptions

  constructor(options: RpcProcessRunnerOptions = {}) {
    this.options = options
    this.onWarning = options.onWarning ?? ((message) => log("senpi-task process runner", { message }))
    this.terminateChild = options.terminateChild
    this.spawnChild =
      options.spawnChild ?? ((descriptor) => defaultSpawnChild(descriptor, options.spawnProcess ?? spawn))
    this.buildSpawn = options.buildSpawn ?? ((spec) => buildRpcSpawn(spec))
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.onMalformedLine = options.onMalformedLine
    this.now = options.now ?? Date.now
    this.modelAdmission = options.modelAdmission ?? createRpcModelAdmission()
    this.inheritedExtensions = options.inheritedExtensions ?? []
    this.fallbackChainDeadlineMs = options.fallbackChainDeadlineMs ?? DEFAULT_FALLBACK_CHAIN_DEADLINE_MS
    this.startupBounds = {
      stallMs: options.startupStallMs ?? DEFAULT_STARTUP_STALL_MS,
      cpuCapS: options.startupCpuCapS ?? DEFAULT_STARTUP_CPU_CAP_S,
      outerBoundMs: options.startupOuterBoundMs ?? DEFAULT_STARTUP_OUTER_BOUND_MS,
      readCpuSeconds: options.readCpuSeconds ?? readProcessTreeCpuSeconds,
    }
  }

  async start(specInput: RpcRunnerSpec): Promise<RpcChildHandle> {
    const spec =
      specInput.extensions === undefined && this.inheritedExtensions.length > 0
        ? { ...specInput, extensions: this.inheritedExtensions }
        : specInput
    await this.modelAdmission(spec)
    const parent = new ChildParentLink(
      spec.task_id,
      this.options.dialogs,
      this.options.parentPermission,
      (message, token) => this.onWarning(message, token),
    )
    const descriptor = this.buildSpawn(parent.named(spec))
    const child = this.spawnChild(descriptor)
    const client = new RpcProtocolClient({ child, onMalformedLine: this.onMalformedLine, parent })
    const handle = createRpcChildHandle({
      client,
      child,
      taskId: spec.task_id,
      ...(spec.taskStoreDir === undefined
        ? {}
        : {
            inputStore: createTaskRecordStore({ project_dir: spec.cwd, task: { state_dir: spec.taskStoreDir } }),
          }),
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      now: this.now,
      childEnv: descriptor.env,
      terminateChild: this.terminateChild,
    })
    let resume: ReturnType<RpcProtocolClient["switchSession"]> | undefined
    try {
      // The chain is a launch-time setting: senpi refuses it once the session has a turn, so it goes before
      // the resumed session is switched in and before the first prompt.
      await this.applyFallbackChain(client, spec, child.pid)
      resume = spec.resumeSessionPath === undefined ? undefined : client.switchSession(spec.resumeSessionPath)
      if (resume === undefined) {
        await handle.startInitialPrompt(spec.prompt)
      } else {
        await resume
        await handle.reconcileInputs?.()
      }
    } catch (error) {
      if (error instanceof InputUncertainError) error = error.cause
      // Capture this BEFORE cleanup: a rejected prompt can leave the child alive, and the cleanup
      // termination must never be recorded as the cause of the rejection.
      const exitOutcome = handle.exitOutcome()
      try {
        const onFailure = (cleanupError: unknown): void => {
          log("senpi-task rpc start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
        }
        if (spec.resumeSessionPath === undefined) {
          void discardUnstartedRpcHandle(handle, { pending: this.pendingTeardowns, onFailure })
        } else {
          await discardUnstartedRpcHandle(handle)
        }
      } catch (cleanupError) {
        log("senpi-task rpc start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
      }
      const message = error instanceof Error ? error.message : String(error)
      // The child's own model resolution is the authority admission defers to (#10863): a child that
      // exited because it could not resolve its `--model` fails typed, carrying its own error.
      const unresolvedModel =
        exitOutcome?.kind === "crashed" ? childUnresolvedModelError(exitOutcome.facts.stderrTail) : undefined
      // A child that died before its first prompt leaves its cause ONLY here: the classified exit is
      // otherwise folded into `message`, which is stderr-derived and gets sanitized away downstream.
      throw new RunnerError({
        kind:
          unresolvedModel !== undefined
            ? "model_unavailable"
            : spec.resumeSessionPath === undefined
              ? "child-prompt-failed"
              : "session_unavailable",
        message: unresolvedModel === undefined ? message : `the child could not resolve its model: ${unresolvedModel}`,
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
        sessionPath === spec.resumeSessionPath && resume !== undefined ? resume : client.switchSession(sessionPath),
      getEntries: (since?: string) => client.getEntries(since),
    })
  }

  async settleTeardowns(): Promise<void> {
    await Promise.all(this.pendingTeardowns)
  }

  // The child's own chain reaches its process as `set_retry_fallback`, held in memory there and never
  // written to a settings file (#9582). Without it the engine would walk its own fallback settings (the
  // user's chains, senpi's shipped chains) to models outside the child's designated chain, so a chain the
  // engine does not hold fails the start before the first prompt: no model runs for that child (#12006).
  private async applyFallbackChain(
    client: RpcProtocolClient,
    spec: RpcRunnerSpec,
    pid: number | undefined,
  ): Promise<void> {
    const retryFallback = childRetryFallbackProfile(spec)
    if (retryFallback === undefined || spec.model === undefined) return
    // Past a bound the start fails, so an answer that arrives late must not send the chain after it.
    const expired = new AbortController()
    const ready = await withStartupProgress(engineAcceptsFallbackChain(client), pid, this.startupBounds, expired)
    const outcome =
      typeof ready === "object"
        ? ready
        : ready
          ? await withDeadline(
              this.sendFallbackChain(client, retryFallback, expired.signal),
              this.fallbackChainDeadlineMs,
              expired,
            )
          : "unsupported"
    if (outcome === "applied") return
    const chain = designatedChainText(spec.model, spec.fallbackModels ?? [])
    // A child that died or whose pipe failed is a transport failure: the start keeps its exit/transport
    // classification instead of reading as an engine that refused the chain.
    if (client.exited) {
      throw new Error(
        `task ${spec.task_id}: its designated model chain (${chain}) was not applied because the child exited while it was being sent`,
      )
    }
    const [kind, reason]: readonly [DesignatedChainNotHeldReason, string] =
      outcome === "unsupported"
        ? [
            "unsupported",
            "this senpi engine cannot take a task child's model chain (no retry_fallback_command); upgrade it",
          ]
        : outcome === "timeout"
          ? ["timeout", `no answer within ${this.fallbackChainDeadlineMs} ms`]
          : "startup" in outcome
            ? ["timeout", outcome.startup]
            : ["refused", outcome.refused]
    throw new DesignatedChainNotHeldError({
      reason: kind,
      models: [spec.model, ...(spec.fallbackModels ?? [])],
      message:
        `task ${spec.task_id}: its designated model chain (${chain}) ` +
        `was not applied (${reason}), and a child never runs outside its designated models, so it was not started`,
    })
  }

  private async sendFallbackChain(
    client: RpcProtocolClient,
    retryFallback: NonNullable<ReturnType<typeof childRetryFallbackProfile>>,
    expired: AbortSignal,
  ): Promise<"applied" | { readonly refused: string }> {
    try {
      if (expired.aborted) return { refused: "deadline passed" }
      const response = await client.send({ type: "set_retry_fallback", retryFallback })
      return response.success ? "applied" : { refused: `refused: ${response.error}` }
    } catch (error) {
      return { refused: `refused: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}

interface StartupBounds {
  readonly stallMs: number
  readonly cpuCapS: number
  readonly outerBoundMs: number
  readonly readCpuSeconds: (pid: number) => number | null
}

// Races the engine's first answer against its boot's progress. Resolves with the answer, or with a startup failure
// that names the bound that ended the wait.
async function withStartupProgress<T>(
  work: Promise<T>,
  pid: number | undefined,
  bounds: StartupBounds,
  expired: AbortController,
): Promise<T | { readonly startup: string }> {
  let sampler: ReturnType<typeof setInterval> | undefined
  let outer: ReturnType<typeof setTimeout> | undefined
  const bounded = new Promise<{ readonly startup: string }>((resolve) => {
    const fail = (startup: string) => {
      expired.abort()
      resolve({ startup })
    }
    outer = setTimeout(
      () => fail(`no answer within the ${bounds.outerBoundMs} ms startup outer bound`),
      bounds.outerBoundMs,
    )
    if (pid === undefined) return
    let lastCpu = -1
    let lastAdvance = Date.now()
    sampler = setInterval(() => {
      const cpu = bounds.readCpuSeconds(pid)
      if (cpu === null) return
      if (cpu > bounds.cpuCapS) {
        fail(
          `the engine used ${cpu.toFixed(1)} s of CPU starting up without answering, over the ${bounds.cpuCapS} s cap`,
        )
      } else if (cpu >= lastCpu + STARTUP_PROGRESS_EPSILON_S) {
        lastCpu = cpu
        lastAdvance = Date.now()
      } else if (Date.now() - lastAdvance >= bounds.stallMs) {
        fail(`the engine made no CPU progress for ${Math.round((Date.now() - lastAdvance) / 1000)} s before answering`)
      }
    }, STARTUP_SAMPLE_MS)
  })
  try {
    return await Promise.race([work, bounded])
  } finally {
    clearInterval(sampler)
    clearTimeout(outer)
  }
}

async function withDeadline<T>(work: Promise<T>, ms: number, expired: AbortController): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      expired.abort()
      resolve("timeout")
    }, ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function engineAcceptsFallbackChain(client: RpcProtocolClient): Promise<boolean> {
  const response = await client.send({ type: "get_protocol_info" })
  if (!response.success || response.command !== "get_protocol_info") return false
  const data: unknown = response.data
  const capabilities: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, "capabilities") : undefined
  return Array.isArray(capabilities) && capabilities.includes(RETRY_FALLBACK_COMMAND_CAPABILITY)
}

const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g
// senpi's two `model_unresolved` startup diagnostics, printed before it exits 1 (core/model-resolver):
// an unknown model, and an unknown provider in a `provider/model` pin. Both mean the child can't serve
// the requested model, so both fail typed and let the start fallback chain move on.
const SENPI_UNRESOLVED_MODEL =
  /Model "[^"\n]+" not found\. Use --list-models to see available models\.|Unknown provider "[^"\n]+"\. Use --list-models to see available providers\/models\./

function childUnresolvedModelError(stderrTail: string): string | undefined {
  return SENPI_UNRESOLVED_MODEL.exec(stderrTail.replace(ANSI_ESCAPE, ""))?.[0]
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
