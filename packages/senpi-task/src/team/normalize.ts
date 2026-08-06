import { normalizeTeamSpecInput } from "@oh-my-opencode/team-core/team-registry"
import { TeamSpecSchema, type TeamSpec } from "@oh-my-opencode/team-core/types"
import { isPlainRecord } from "@oh-my-opencode/utils"

import { clampTaskSummary } from "../task-summary"
import { SenpiTeamSpecError } from "./errors"

/**
 * Sentinel identity for the current senpi session acting as the team lead. It is written as
 * `leadAgentId` and is NEVER a spawnable member. team-core's `validateSpec` would try to match it
 * to a member and reject; we deliberately parse with `TeamSpecSchema` and validate members locally
 * instead.
 */
export const TEAM_LEAD_SENTINEL = "lead"

export type NormalizeSenpiTeamSpecOptions = {
  readonly callerTeamLead?: unknown
}

function assertNoCallerTeamLead(options: NormalizeSenpiTeamSpecOptions | undefined, teamName: string): void {
  if (options?.callerTeamLead !== undefined) {
    throw new SenpiTeamSpecError(
      `Team '${teamName}' passed a callerTeamLead option, which is not supported: the current senpi session is always the '${TEAM_LEAD_SENTINEL}' sentinel and team-core would otherwise insert a spawnable lead member.`,
      "RESERVED_CALLER_TEAM_LEAD",
      teamName,
    )
  }
}

function coerceStringSpec(rawSpec: unknown, teamName: string): unknown {
  if (typeof rawSpec !== "string") return rawSpec
  try {
    return JSON.parse(rawSpec)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SenpiTeamSpecError(
      `Team '${teamName}' spec is a string that is not valid JSON (${detail}). Pass the spec as an object like { name?, members: [{ name, category|subagent_type, prompt? }] }, or as a valid JSON string of that object.`,
      "INVALID_SPEC",
      teamName,
    )
  }
}

function wrapSingleMember(rawSpec: unknown): unknown {
  if (isPlainRecord(rawSpec) && isPlainRecord(rawSpec.members)) {
    return { ...rawSpec, members: [rawSpec.members] }
  }
  return rawSpec
}

function describeReceived(rawSpec: unknown): string {
  if (rawSpec === null) return "null"
  if (Array.isArray(rawSpec)) return "an array"
  if (typeof rawSpec === "object") return "an object"
  return `a ${typeof rawSpec}`
}

function assertNoRawLeadField(rawSpec: unknown, teamName: string): void {
  if (isPlainRecord(rawSpec) && rawSpec.lead !== undefined && rawSpec.lead !== null) {
    throw new SenpiTeamSpecError(
      `Team '${teamName}' declares a 'lead' field. '${TEAM_LEAD_SENTINEL}' is reserved for the current-session sentinel; declare workers under 'members' only.`,
      "RESERVED_LEAD_FIELD",
      teamName,
    )
  }
}

function remapAgentAliasKind(members: readonly unknown[]): unknown[] {
  return members.map((member) => {
    if (isPlainRecord(member) && member.kind === "agent") {
      return { ...member, kind: "subagent_type" }
    }
    return member
  })
}

// Harness-side length enforcement mirroring the task tool: an over-limit member task_summary is
// clamped BEFORE TeamSpecSchema.parse so it truncates instead of rejecting the whole spec.
function clampMemberTaskSummaries(members: readonly unknown[]): unknown[] {
  return members.map((member) => {
    if (!isPlainRecord(member) || typeof member.task_summary !== "string") return member
    const clamped = clampTaskSummary(member.task_summary)
    if (clamped === undefined) {
      const { task_summary: _dropped, ...rest } = member
      return rest
    }
    return { ...member, task_summary: clamped }
  })
}

function assertNoReservedMemberName(members: readonly unknown[], teamName: string): void {
  for (const member of members) {
    if (isPlainRecord(member) && member.name === TEAM_LEAD_SENTINEL) {
      throw new SenpiTeamSpecError(
        `Team '${teamName}' has a member named '${TEAM_LEAD_SENTINEL}', which is reserved for the current-session sentinel. Rename the member.`,
        "RESERVED_LEAD_MEMBER",
        teamName,
      )
    }
  }
}

/**
 * Normalizes a raw senpi team spec (from an `omo.json` `teams` value or an `.omo/teams/<name>`
 * `config.json`) into a parsed team-core `TeamSpec`.
 *
 * Pipeline: reject the three reserved-name paths, run team-core `normalizeTeamSpecInput` WITHOUT the
 * `callerTeamLead` option, apply the senpi pre-normalizer (map the `agent` alias to `subagent_type`,
 * inject the record key as `name`, always set the `lead` sentinel), then parse with `TeamSpecSchema`.
 * team-core `validateSpec` / `loadTeamSpec` are never called: both hard-call the opencode-roster
 * eligibility check.
 */
export function normalizeSenpiTeamSpec(
  rawSpec: unknown,
  teamName: string,
  options?: NormalizeSenpiTeamSpecOptions,
): TeamSpec {
  assertNoCallerTeamLead(options, teamName)
  const coerced = wrapSingleMember(coerceStringSpec(rawSpec, teamName))
  assertNoRawLeadField(coerced, teamName)

  const normalized = normalizeTeamSpecInput(coerced)
  if (!isPlainRecord(normalized)) {
    throw new SenpiTeamSpecError(
      `Team '${teamName}' spec must be an object like { name?, members: [...] }; received ${describeReceived(rawSpec)}. Pass the spec as a nested object, or as a valid JSON string of that object.`,
      "INVALID_SPEC",
      teamName,
    )
  }

  const preNormalized: Record<string, unknown> = { ...normalized }
  if (Array.isArray(preNormalized.members)) {
    const members = clampMemberTaskSummaries(remapAgentAliasKind(preNormalized.members))
    assertNoReservedMemberName(members, teamName)
    preNormalized.members = members
  }
  preNormalized.name ??= teamName
  preNormalized.leadAgentId = TEAM_LEAD_SENTINEL

  const parsed = TeamSpecSchema.safeParse(preNormalized)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue ? `${firstIssue.path.join(".") || "spec"}: ${firstIssue.message}` : parsed.error.message
    throw new SenpiTeamSpecError(`Invalid team '${teamName}' spec (${detail}).`, "INVALID_SPEC", teamName)
  }

  return parsed.data
}
