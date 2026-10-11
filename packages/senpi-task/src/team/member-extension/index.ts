import { fileURLToPath } from "node:url"

import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { log } from "@oh-my-opencode/utils/logger"

import { createTaskRecordStore } from "../../store"
import { MEMBER_EXTENSION_BUNDLE_NAME, WORKPOOL_STATE_DIR_ENV, WORKPOOL_TASK_ID_ENV } from "./identity"
import { createMemberWakeSource, resolveMemberExtensionConfig, type MemberWakeSource } from "./member-session"
import { createMemberSelfPoller, type MemberSelfPoller } from "./self-poller"
import { createQaAfterInjectHold } from "./qa-inject-hold"
import { createMemberTaskSendTool } from "./tools"

export {
  MemberExtensionConfigError,
  parseMemberExtensionEnv,
} from "./parse-env"
export type { MemberExtensionConfigErrorCode, ParsedMemberExtensionEnv } from "./parse-env"
export {
  MEMBER_EXTENSION_BUNDLE_NAME,
  MEMBER_IDENTITY_ENV,
  MEMBER_PROCESS_ENV_NAMES,
  MEMBER_TASK_ID_ENV,
  MEMBER_TEAM_CONFIG_ENV,
  isTeamMemberProcess,
} from "./identity"

const MEMBER_POLL_INTERVAL_MS = 1_000
const ACK_POLL_INTERVAL_MS = 100

type ActiveRuntime = {
  readonly poller: MemberSelfPoller
  readonly wake: MemberWakeSource
  started: boolean
  pollTimer?: ReturnType<typeof setInterval>
  ackTimer?: ReturnType<typeof setInterval>
}

const activeRuntimes = new WeakMap<ExtensionAPI, ActiveRuntime>()

export function resolveMemberExtensionEntryPath(extensionUrl = import.meta.url): string {
  return fileURLToPath(new URL(`./${MEMBER_EXTENSION_BUNDLE_NAME}`, extensionUrl))
}

export default async function registerMemberExtension(pi: ExtensionAPI): Promise<void> {
  // The shared extension boots before RPC switch_session can acknowledge. Ordinary team
  // members must not evaluate the workpool host-policy graph just to reject absent identity.
  if (process.env[WORKPOOL_STATE_DIR_ENV] !== undefined || process.env[WORKPOOL_TASK_ID_ENV] !== undefined) {
    const { registerProcessWorkpoolWorker } = await import("../../workpool/process-worker")
    if (registerProcessWorkpoolWorker(pi)) return
  }
  if (activeRuntimes.has(pi)) return
  // Not a member session: on the shared daemon this same bundle is loaded for every session, so an
  // absent member identity is the normal case and never an error.
  const parsed = resolveMemberExtensionConfig(pi, process.env)
  if (parsed === undefined) return
  const store = createTaskRecordStore({ project_dir: parsed.stateDir, task: { state_dir: parsed.stateDir } })
  const afterInject = createQaAfterInjectHold(process.env)
  const appendEvent = (event: Parameters<typeof store.appendEvent>[1]): void => {
    store.appendEvent(parsed.taskId, event)
  }
  const poller = createMemberSelfPoller({
    teamRunId: parsed.teamRunId,
    memberName: parsed.memberName,
    config: parsed.config,
    sessionDir: parsed.sessionDir,
    inject: (content) =>
      pi.sendMessage(
        {
          customType: "senpi-task:team-message",
          content,
          display: false,
        },
        { triggerTurn: true, deliverAs: "steer" },
      ),
    appendEvent,
    ...(afterInject !== undefined ? { afterInject } : {}),
  })
  const runtime: ActiveRuntime = {
    poller,
    wake: createMemberWakeSource(pi, { teamRunId: parsed.teamRunId, memberName: parsed.memberName }),
    started: false,
  }
  activeRuntimes.set(pi, runtime)

  pi.registerTool(createMemberTaskSendTool({
    teamRunId: parsed.teamRunId,
    memberName: parsed.memberName,
    taskId: parsed.taskId,
    config: parsed.config,
    members: parsed.members,
    appendEvent: (taskId, event) => store.appendEvent(taskId, event),
  }))
  pi.on("session_start", () => startRuntime(runtime))
  pi.on("session_shutdown", () => stopRuntime(pi, runtime))
}

async function startRuntime(runtime: ActiveRuntime): Promise<void> {
  if (runtime.started) return
  runtime.started = true
  // On duty: while the team run holds this member, the host must not park the session out from
  // under an inbound message it has not answered yet.
  runtime.wake.publishActive()
  try {
    await runtime.poller.recoverReservations()
    if (!runtime.started) return
    await runtime.poller.pollOnce()
    if (!runtime.started) return
    runtime.pollTimer = setInterval(() => runSafely("poll", runtime.poller.pollOnce()), MEMBER_POLL_INTERVAL_MS)
    runtime.ackTimer = setInterval(() => runSafely("ack", runtime.poller.checkPendingAcks()), ACK_POLL_INTERVAL_MS)
  } catch (error) {
    runtime.started = false
    runtime.wake.publishIdle()
    throw error
  }
}

function stopRuntime(pi: ExtensionAPI, runtime: ActiveRuntime): void {
  runtime.started = false
  runtime.wake.publishIdle()
  if (runtime.pollTimer !== undefined) clearInterval(runtime.pollTimer)
  if (runtime.ackTimer !== undefined) clearInterval(runtime.ackTimer)
  delete runtime.pollTimer
  delete runtime.ackTimer
  runtime.poller.shutdown()
  activeRuntimes.delete(pi)
}

function runSafely(operation: string, promise: Promise<void>): void {
  promise.catch((error: unknown) => {
    log("senpi-task member extension poll failed", { operation, error: String(error) })
  })
}

