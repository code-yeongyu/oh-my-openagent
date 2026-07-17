import { fileURLToPath } from "node:url"

import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { OmoTaskWaitSchema } from "@oh-my-opencode/omo-config-core"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import type { Message } from "@oh-my-opencode/team-core/types"
import { log } from "@oh-my-opencode/utils"

import { parseTaskId, type TaskId } from "../../state"
import { createTaskRecordStore } from "../../store"
import type { WaitBounds } from "../../tools/control/clamp"
import { WaitRegistry } from "../messaging/wait-registry"
import { createMemberSelfPoller, type MemberSelfPoller } from "./self-poller"
import { createQaAfterInjectHold } from "./qa-inject-hold"
import { createMemberTaskSendTool, createMemberTeamWaitTool } from "./tools"

const MEMBER_POLL_INTERVAL_MS = 1_000
const ACK_POLL_INTERVAL_MS = 100
const MEMBER_NAME_PATTERN = /^[a-z0-9-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const MEMBER_EXTENSION_BUNDLE_NAME = "omo-member.js"

export type ParsedMemberExtensionEnv = {
  readonly teamRunId: string
  readonly memberName: string
  readonly taskId: TaskId
  readonly stateDir: string
  readonly sessionDir: string
  readonly config: TeamModeConfig & { readonly base_dir: string }
  readonly waitBounds: WaitBounds
  readonly members: readonly string[]
}

export type MemberExtensionConfigErrorCode =
  | "missing_env"
  | "invalid_identity"
  | "invalid_task_id"
  | "invalid_team_config"

export class MemberExtensionConfigError extends Error {
  readonly code: MemberExtensionConfigErrorCode

  constructor(message: string, code: MemberExtensionConfigErrorCode) {
    super(message)
    this.name = "MemberExtensionConfigError"
    this.code = code
  }
}

export class MemberExtensionShutdownError extends Error {
  constructor() {
    super("member extension session shut down")
    this.name = "MemberExtensionShutdownError"
  }
}

type ActiveRuntime = {
  readonly poller: MemberSelfPoller
  readonly registry: WaitRegistry<Message>
  started: boolean
  pollTimer?: ReturnType<typeof setInterval>
  ackTimer?: ReturnType<typeof setInterval>
}

const activeRuntimes = new WeakMap<ExtensionAPI, ActiveRuntime>()

export function resolveMemberExtensionEntryPath(extensionUrl = import.meta.url): string {
  return fileURLToPath(new URL(`./${MEMBER_EXTENSION_BUNDLE_NAME}`, extensionUrl))
}

export function parseMemberExtensionEnv(env: NodeJS.ProcessEnv): ParsedMemberExtensionEnv {
  const identity = requiredEnv(env, "SENPI_TASK_MEMBER")
  const taskIdRaw = requiredEnv(env, "SENPI_TASK_MEMBER_TASK_ID")
  const teamConfigRaw = requiredEnv(env, "SENPI_TASK_TEAM_CONFIG")
  const sessionDir = requiredEnv(env, "SENPI_CODING_AGENT_SESSION_DIR")
  const identityParts = identity.split("::")
  const teamRunId = identityParts[0]
  const memberName = identityParts[1]
  if (
    identityParts.length !== 2
    || teamRunId === undefined
    || memberName === undefined
    || !UUID_PATTERN.test(teamRunId)
    || !MEMBER_NAME_PATTERN.test(memberName)
  ) {
    throw new MemberExtensionConfigError(
      "SENPI_TASK_MEMBER must be '<teamRunId>::<memberName>'",
      "invalid_identity",
    )
  }

  let taskId: TaskId
  try {
    taskId = parseTaskId(taskIdRaw)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new MemberExtensionConfigError("SENPI_TASK_MEMBER_TASK_ID must be a valid st_ task id", "invalid_task_id")
  }

  const rawConfig = parseJsonRecord(teamConfigRaw)
  const stateDir = rawConfig.stateDir
  const members = parseMembers(rawConfig.members)
  const configResult = TeamModeConfigSchema.safeParse(rawConfig)
  const waitResult = OmoTaskWaitSchema.safeParse(rawConfig.wait)
  if (
    typeof stateDir !== "string"
    || stateDir.length === 0
    || !configResult.success
    || configResult.data.base_dir === undefined
    || !waitResult.success
    || waitResult.data.min_ms > waitResult.data.default_ms
    || waitResult.data.default_ms > waitResult.data.max_ms
    || !members.includes(memberName)
  ) {
    throw new MemberExtensionConfigError("SENPI_TASK_TEAM_CONFIG is malformed", "invalid_team_config")
  }

  return {
    teamRunId,
    memberName,
    taskId,
    stateDir,
    sessionDir,
    config: { ...configResult.data, base_dir: configResult.data.base_dir },
    waitBounds: waitResult.data,
    members,
  }
}

export default async function registerMemberExtension(pi: ExtensionAPI): Promise<void> {
  if (activeRuntimes.has(pi)) return
  const parsed = parseMemberExtensionEnv(process.env)
  const store = createTaskRecordStore({ project_dir: parsed.stateDir, task: { state_dir: parsed.stateDir } })
  const registry = new WaitRegistry<Message>()
  const afterInject = createQaAfterInjectHold(process.env)
  const appendEvent = (event: Parameters<typeof store.appendEvent>[1]): void => {
    store.appendEvent(parsed.taskId, event)
  }
  const poller = createMemberSelfPoller({
    teamRunId: parsed.teamRunId,
    memberName: parsed.memberName,
    config: parsed.config,
    sessionDir: parsed.sessionDir,
    waitRegistry: registry,
    sendUserMessage: (content) => pi.sendUserMessage(content, { deliverAs: "followUp" }),
    appendEvent,
    ...(afterInject !== undefined ? { afterInject } : {}),
  })
  const runtime: ActiveRuntime = { poller, registry, started: false }
  activeRuntimes.set(pi, runtime)

  pi.registerTool(createMemberTaskSendTool({
    teamRunId: parsed.teamRunId,
    memberName: parsed.memberName,
    taskId: parsed.taskId,
    config: parsed.config,
    members: parsed.members,
    appendEvent: (taskId, event) => store.appendEvent(taskId, event),
  }))
  pi.registerTool(createMemberTeamWaitTool({ poller, waitRegistry: registry, waitBounds: parsed.waitBounds }))
  pi.on("session_start", () => startRuntime(runtime))
  pi.on("session_shutdown", () => stopRuntime(pi, runtime))
}

async function startRuntime(runtime: ActiveRuntime): Promise<void> {
  if (runtime.started) return
  runtime.started = true
  try {
    await runtime.poller.recoverReservations()
    if (!runtime.started) return
    runtime.pollTimer = setInterval(() => runSafely("poll", runtime.poller.pollOnce()), MEMBER_POLL_INTERVAL_MS)
    runtime.ackTimer = setInterval(() => runSafely("ack", runtime.poller.checkPendingAcks()), ACK_POLL_INTERVAL_MS)
  } catch (error) {
    runtime.started = false
    throw error
  }
}

function stopRuntime(pi: ExtensionAPI, runtime: ActiveRuntime): void {
  runtime.started = false
  if (runtime.pollTimer !== undefined) clearInterval(runtime.pollTimer)
  if (runtime.ackTimer !== undefined) clearInterval(runtime.ackTimer)
  delete runtime.pollTimer
  delete runtime.ackTimer
  runtime.poller.shutdown()
  runtime.registry.cancelAll(new MemberExtensionShutdownError())
  activeRuntimes.delete(pi)
}

function runSafely(operation: string, promise: Promise<void>): void {
  promise.catch((error: unknown) => {
    log("senpi-task member extension poll failed", { operation, error: String(error) })
  })
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new MemberExtensionConfigError(`Missing ${name}`, "missing_env")
  }
  return value
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    if (isRecord(value)) return value
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    // Normalized below as the typed config error.
  }
  throw new MemberExtensionConfigError("SENPI_TASK_TEAM_CONFIG must be a JSON object", "invalid_team_config")
}

function parseMembers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((member) => typeof member === "string" && MEMBER_NAME_PATTERN.test(member))) {
    throw new MemberExtensionConfigError("SENPI_TASK_TEAM_CONFIG.members is malformed", "invalid_team_config")
  }
  return [...new Set(value)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
