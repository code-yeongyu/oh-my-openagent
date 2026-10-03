import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { log } from "@oh-my-opencode/utils"

import { RunnerError } from "../in-process/runner-error"
import type { CreateHostSessionChannel } from "../rpc-host"
import type { RpcChildHandle, RpcRunnerSpec, RpcSwitchSessionResult } from "../types"
import { openHostSessionWithAdmission } from "./admission"
import type { ChildEndpointPorts } from "./child-endpoint"
import { createHostSessionHandle } from "./handle"
import type { LiveHostChildren } from "./live-children"
import { openTaskHostSession } from "./open-session"
import { createReattachPort } from "./reattach-port"
import type { OpenedHostSession } from "./session-client"
import type { TransportRecoveryOptions } from "./transport-recovery"
import { discardUnstartedRpcHandle } from "../rpc/start-cleanup"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000
const DEFAULT_CLOSE_GRACE_MS = 5_000

export interface HostSessionOpenerInput {
  readonly createClient: CreateHostSessionChannel
  readonly endpoint: ChildEndpointPorts
  readonly liveChildren: LiveHostChildren
  readonly heartbeatIntervalMs?: number
  readonly closeGraceMs?: number
  readonly now: () => number
  readonly reattachDelaysMs: readonly number[]
  readonly transportRecovery?: TransportRecoveryOptions
  readonly admissionWaitMs: number
  readonly sleep: (ms: number) => Promise<void>
  readonly onWarning: (message: string) => void | (() => void)
}

export interface HostSessionOpener {
  openChild(spec: RpcRunnerSpec, socket: string, sessionPath: string): Promise<RpcChildHandle>
}

/** Open a daemon session, wire its recoverable handle, and deliver only a fresh child's first turn. */
export function createHostSessionOpener(input: HostSessionOpenerInput): HostSessionOpener {
  const openAdmitted = (
    client: ReturnType<CreateHostSessionChannel>,
    spec: RpcRunnerSpec,
    sessionPath: string,
  ): Promise<OpenedHostSession> =>
    openHostSessionWithAdmission({
      open: () => openTaskHostSession({ client, spec, sessionPath }),
      now: input.now,
      sleep: input.sleep,
      admissionWaitMs: input.admissionWaitMs,
      onWarning: input.onWarning,
    })

  const startTurn = async (handle: ReturnType<typeof createHostSessionHandle>, spec: RpcRunnerSpec): Promise<void> => {
    try {
      await handle.startInitialPrompt(spec.prompt)
    } catch (error) {
      const exitOutcome = handle.exitOutcome()
      try {
        await discardUnstartedRpcHandle(handle)
      } catch (cleanupError) {
        log("senpi-task host session start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
      }
      throw new RunnerError({
        kind: "child-prompt-failed",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        rejected_while: exitOutcome === undefined ? "alive" : "exited",
        ...(exitOutcome === undefined
          ? {}
          : { exit: { kind: exitOutcome.kind, code: exitOutcome.facts.code, signal: exitOutcome.facts.signal } }),
      })
    }
  }

  return {
    openChild: async (spec, socket, sessionPath) => {
      const client = input.createClient(socket)
      if (spec.resumeSessionPath === undefined) await mkdir(dirname(sessionPath), { recursive: true })
      const opened = await openAdmitted(client, spec, sessionPath)
      const handle = createHostSessionHandle({
        client,
        session: { routingId: opened.sessionId, sessionPath, instanceId: opened.instanceId },
        taskId: spec.task_id,
        heartbeatIntervalMs: input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        now: input.now,
        closeGraceMs: input.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
        openDisposition: opened.attached ? "attached" : "reopened",
        shardEvents: input.liveChildren.events,
        ...(input.transportRecovery === undefined ? {} : { transportRecovery: input.transportRecovery }),
        reattach: createReattachPort({
          endpoint: input.endpoint,
          spec,
          delaysMs: input.reattachDelaysMs,
          sleep: input.sleep,
          createClient: input.createClient,
          open: (port, path) => openAdmitted(port, spec, path),
        }),
      })
      input.liveChildren.add(handle)
      const switchOnPort = handle.switchSession
      if (spec.resumeSessionPath === undefined) await startTurn(handle, spec)
      return Object.assign(handle, {
        spawnSpec: {
          cwd: spec.cwd,
          ...(spec.extensions === undefined ? {} : { extensions: spec.extensions }),
          ...(spec.memberEnv === undefined ? {} : { memberEnv: spec.memberEnv }),
        },
        switchSession: (target: string): Promise<RpcSwitchSessionResult> =>
          target === sessionPath ? Promise.resolve({ cancelled: false }) : switchOnPort(target),
      })
    },
  }
}
