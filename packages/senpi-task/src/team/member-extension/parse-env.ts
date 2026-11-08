import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"

import { parseTaskId, type TaskId } from "../../state"
import { MEMBER_IDENTITY_ENV } from "./identity"

/**
 * The member identity a launch carries, parsed ONCE at the boundary. Both launches speak this same
 * shape: a per-child process passes it as environment variables, and a daemon session passes the
 * same values as session context (see member-session.ts), so everything downstream of this parse
 * receives typed values and never asks where they came from.
 */

const MEMBER_NAME_PATTERN = /^[a-z0-9-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ParsedMemberExtensionEnv = {
  readonly teamRunId: string
  readonly memberName: string
  readonly taskId: TaskId
  readonly stateDir: string
  readonly sessionDir: string
  readonly config: TeamModeConfig & { readonly base_dir: string }
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

export function parseMemberExtensionEnv(env: NodeJS.ProcessEnv): ParsedMemberExtensionEnv {
  const identity = requiredEnv(env, MEMBER_IDENTITY_ENV)
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
      `${MEMBER_IDENTITY_ENV} must be '<teamRunId>::<memberName>'`,
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
  if (
    typeof stateDir !== "string"
    || stateDir.length === 0
    || !configResult.success
    || configResult.data.base_dir === undefined
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
    members,
  }
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
