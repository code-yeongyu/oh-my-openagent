import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"

import { OmoTaskWaitSchema } from "@oh-my-opencode/omo-config-core"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import type { Message } from "@oh-my-opencode/team-core/types"
import { log } from "@oh-my-opencode/utils"

import { parseTaskId, type TaskId } from "../../state"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import { resolveChildSessionDir } from "../../runners/rpc/spawn"
import type { WaitBounds } from "../../tools/control/clamp"
import { readMemberTaskMap } from "../member-map"
import { WaitRegistry } from "../messaging/wait-registry"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "../storage"
import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
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
  | "identity_unverified"
  | "identity_pending"

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

type MemberExtensionApi = {
  on(event: "session_start" | "session_shutdown", handler: () => unknown | Promise<unknown>): void
  registerTool(tool: ReturnType<typeof createMemberTaskSendTool> | ReturnType<typeof createMemberTeamWaitTool>): void
  sendUserMessage(content: string, options: { readonly deliverAs: "followUp" }): void
}

const activeRuntimes = new WeakMap<MemberExtensionApi, ActiveRuntime>()
const registeredApis = new WeakSet<MemberExtensionApi>()

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

export default async function registerMemberExtension(pi: MemberExtensionApi): Promise<void> {
  if (registeredApis.has(pi)) return
  registeredApis.add(pi)
  const parsed = parseMemberExtensionEnv(process.env)
  const store = createTaskRecordStore({ project_dir: parsed.stateDir, task: { state_dir: parsed.stateDir } })
  pi.on("session_start", async () => {
    if (activeRuntimes.has(pi)) return
    const validated = await waitForValidatedIdentity(parsed, store)
    const registry = new WaitRegistry<Message>()
    const afterInject = createQaAfterInjectHold(process.env)
    const poller = createMemberSelfPoller({
      teamRunId: validated.teamRunId,
      memberName: validated.memberName,
      config: validated.config,
      sessionDir: validated.sessionDir,
      waitRegistry: registry,
      sendUserMessage: (content) => pi.sendUserMessage(content, { deliverAs: "followUp" }),
      appendEvent: (event) => store.appendEvent(validated.taskId, event),
      ...(afterInject !== undefined ? { afterInject } : {}),
    })
    const runtime: ActiveRuntime = { poller, registry, started: false }
    activeRuntimes.set(pi, runtime)
    pi.registerTool(createMemberTaskSendTool({
      teamRunId: validated.teamRunId,
      memberName: validated.memberName,
      taskId: validated.taskId,
      config: validated.config,
      members: validated.members,
      appendEvent: (taskId, event) => store.appendEvent(taskId, event),
    }))
    pi.registerTool(createMemberTeamWaitTool({ poller, waitRegistry: registry, waitBounds: validated.waitBounds }))
    await startRuntime(runtime)
  })
  pi.on("session_shutdown", () => {
    const runtime = activeRuntimes.get(pi)
    if (runtime !== undefined) stopRuntime(pi, runtime)
  })
}

export async function validateMemberExtensionIdentity(
  parsed: ParsedMemberExtensionEnv,
  store: TaskRecordStore,
): Promise<ParsedMemberExtensionEnv> {
  const expectedBaseDir = teamStorageBaseDir({ project_dir: parsed.stateDir, task: { state_dir: parsed.stateDir } })
  const expectedSessionDir = resolveChildSessionDir(join(parsed.stateDir, "children", parsed.taskId), parsed.taskId)
  if (resolve(parsed.config.base_dir) !== resolve(expectedBaseDir) || resolve(parsed.sessionDir) !== resolve(expectedSessionDir)) {
    throw unverifiedIdentity()
  }

  let runtime
  try {
    runtime = await loadRuntimeState(parsed.teamRunId, parsed.config)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw unverifiedIdentity()
  }
  if (runtime.status === "creating") {
    throw new MemberExtensionConfigError("member identity is not active yet", "identity_pending")
  }
  if (runtime.status !== "active" && runtime.status !== "shutdown_requested") throw unverifiedIdentity()
  const member = runtime.members.find((candidate) => candidate.name === parsed.memberName)
  if (member === undefined || runtime.leadSessionId === undefined) throw unverifiedIdentity()

  const map = await readMemberTaskMap(resolveTeamRuntimeDirs(
    { project_dir: parsed.stateDir, task: { state_dir: parsed.stateDir } },
    parsed.teamRunId,
  ).runtimeDir)
  const mappedTaskId = map[parsed.memberName]
  if (mappedTaskId === undefined) {
    throw new MemberExtensionConfigError("member identity map is not ready", "identity_pending")
  }
  if (mappedTaskId !== parsed.taskId) throw unverifiedIdentity()

  const record = store.load(parsed.taskId)
  if (
    record === null
    || record.spawn_role !== "team_member"
    || record.parent_session_id !== runtime.leadSessionId
    || (member.sessionId !== undefined && record.child_session_id !== undefined && member.sessionId !== record.child_session_id)
  ) throw unverifiedIdentity()
  if (record.pid === undefined) {
    throw new MemberExtensionConfigError("member identity is not active yet", "identity_pending")
  }
  if (record.pid !== process.pid && record.pid !== process.ppid) throw unverifiedIdentity()

  return { ...parsed, members: runtime.members.map((candidate) => candidate.name) }
}

async function waitForValidatedIdentity(
  parsed: ParsedMemberExtensionEnv,
  store: TaskRecordStore,
): Promise<ParsedMemberExtensionEnv> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await validateMemberExtensionIdentity(parsed, store)
    } catch (error) {
      if (!(error instanceof MemberExtensionConfigError) || error.code !== "identity_pending" || attempt === 79) throw error
      await new Promise((done) => setTimeout(done, 25))
    }
  }
  throw unverifiedIdentity()
}

function unverifiedIdentity(): MemberExtensionConfigError {
  return new MemberExtensionConfigError("member identity could not be verified", "identity_unverified")
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

function stopRuntime(pi: MemberExtensionApi, runtime: ActiveRuntime): void {
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
