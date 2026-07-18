import { type ChildProcess, spawn } from "node:child_process"
import { log } from "@oh-my-opencode/utils"

import type { RpcChildHandle, RpcRunnerSpec } from "./types"
import { createRpcChildHandle } from "./rpc/handle"
import { type MalformedLineHandler, RpcProtocolClient } from "./rpc/protocol-client"
import { type RpcSpawnDescriptor, buildRpcSpawn } from "./rpc/spawn"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000

export type RpcProcessRunnerOptions = {
  readonly spawnChild?: (descriptor: RpcSpawnDescriptor) => ChildProcess
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly heartbeatIntervalMs?: number
  readonly onMalformedLine?: MalformedLineHandler
  readonly now?: () => number
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
  private readonly inheritedExtensions: readonly string[]

  constructor(options: RpcProcessRunnerOptions = {}) {
    this.spawnChild = options.spawnChild ?? defaultSpawnChild
    this.buildSpawn = options.buildSpawn ?? ((spec) => buildRpcSpawn(spec))
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.onMalformedLine = options.onMalformedLine
    this.now = options.now ?? Date.now
    this.inheritedExtensions = options.inheritedExtensions ?? []
  }

  start(specInput: RpcRunnerSpec): RpcChildHandle {
    const spec =
      specInput.extensions === undefined && this.inheritedExtensions.length > 0
        ? { ...specInput, extensions: this.inheritedExtensions }
        : specInput
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
    if (resume === undefined) {
      client.send({ type: "prompt", message: spec.prompt }).catch((error: unknown) => {
        log("senpi-task rpc initial prompt failed", { taskId: spec.task_id, error: String(error) })
      })
    } else {
      void resume.catch((error: unknown) => {
        log("senpi-task rpc switch_session failed", { taskId: spec.task_id, error: String(error) })
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

function defaultSpawnChild(descriptor: RpcSpawnDescriptor): ChildProcess {
  return spawn(descriptor.command, [...descriptor.args], {
    cwd: descriptor.cwd,
    env: descriptor.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  })
}
