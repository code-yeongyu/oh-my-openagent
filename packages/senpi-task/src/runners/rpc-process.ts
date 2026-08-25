import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import { log } from "@oh-my-opencode/utils"

import type { RpcChildHandle, RpcRunnerSpec } from "./types"
import { RunnerError } from "./in-process/runner-error"
import { createRpcChildHandle } from "./rpc/handle"
import { createRpcModelAdmission, type RpcModelAdmission } from "./rpc/model-admission"
import { type MalformedLineHandler, RpcProtocolClient } from "./rpc/protocol-client"
import { type RpcSpawnDescriptor, buildRpcSpawn } from "./rpc/spawn"
import { discardUnstartedRpcHandle } from "./rpc/start-cleanup"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000

export type RpcProcessRunnerOptions = {
  readonly spawnChild?: (descriptor: RpcSpawnDescriptor) => ChildProcess
  readonly spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly heartbeatIntervalMs?: number
  readonly onMalformedLine?: MalformedLineHandler
  readonly now?: () => number
  readonly modelAdmission?: RpcModelAdmission
  // The parent's `-e` extension entries, forwarded to every child so a detached process reproduces the
  // parent's extensions. Applied only when a spec does not already carry its own extensions.
  readonly inheritedExtensions?: readonly string[]
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
    })
    const resume = spec.resumeSessionPath === undefined ? undefined : client.switchSession(spec.resumeSessionPath)
    try {
      if (resume === undefined) {
        await handle.startInitialPrompt(spec.prompt)
      } else {
        await resume
      }
    } catch (error) {
      try {
        await discardUnstartedRpcHandle(handle)
      } catch (cleanupError) {
        log("senpi-task rpc start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new RunnerError({
        kind: resume === undefined ? "child-prompt-failed" : "session_unavailable",
        message,
        cause: error,
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
