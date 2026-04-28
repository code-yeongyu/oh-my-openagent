import { AGENT_ELIGIBILITY_REGISTRY } from "../types"

import type { Member, TeamSpec } from "../types"

const MAX_TEAM_MEMBERS = 8
const UNKNOWN_SUBAGENT_MESSAGE =
  "Unknown subagent_type '<name>'. Available ELIGIBLE agents: sisyphus, atlas, sisyphus-junior, hephaestus (if D-36 applied). Use delegate-task for read-only agents like oracle, librarian, explore, metis, momus, multimodal-looker."

export class TeamSpecValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly field?: string,
    public readonly memberName?: string,
  ) {
    super(message)
    this.name = "TeamSpecValidationError"
  }
}

export function validateSpec(spec: TeamSpec): void {
  if (spec.members.length > MAX_TEAM_MEMBERS) {
    throw new TeamSpecValidationError(
      `Team '${spec.name}' exceeds max 8 members.`,
      "TEAM_MEMBER_LIMIT_EXCEEDED",
      "members",
    )
  }

  const seenMemberNames = new Set<string>()
  let leadMatchCount = 0

  for (const member of spec.members) {
    if (seenMemberNames.has(member.name)) {
      throw new TeamSpecValidationError(
        `Member name '${member.name}' is duplicated within team '${spec.name}'. Member names must be unique.`,
        "DUPLICATE_MEMBER_NAME",
        "members",
        member.name,
      )
    }

    seenMemberNames.add(member.name)
    validateMemberEligibility(member)
    validateDualSupport(member)

    if (member.name === spec.leadAgentId) {
      leadMatchCount += 1
    }
  }

  if (leadMatchCount !== 1) {
    throw new TeamSpecValidationError(
      `Team '${spec.name}' leadAgentId '${spec.leadAgentId}' must match exactly one member.name.`,
      "INVALID_LEAD_AGENT_ID",
      "leadAgentId",
    )
  }
}

export function validateMemberEligibility(member: Member): void {
  if (member.kind !== "subagent_type") {
    return
  }

  const eligibility = AGENT_ELIGIBILITY_REGISTRY[member.subagent_type]
  if (!eligibility) {
    throw new TeamSpecValidationError(
      UNKNOWN_SUBAGENT_MESSAGE.replace("<name>", member.subagent_type),
      "UNKNOWN_SUBAGENT_TYPE",
      "subagent_type",
      member.name,
    )
  }

  if (eligibility.verdict === "hard-reject") {
    throw new TeamSpecValidationError(
      eligibility.rejectionMessage ?? `Agent '${member.subagent_type}' is not eligible as a team member.`,
      "INELIGIBLE_AGENT",
      "subagent_type",
      member.name,
    )
  }
}

export function validateDualSupport(member: Member): void {
  const trimmedPrompt = member.prompt?.trim()

  if (trimmedPrompt === "") {
    throw new TeamSpecValidationError(
      `Member '${member.name}' prompt must not be empty after trimming whitespace.`,
      "EMPTY_PROMPT",
      "prompt",
      member.name,
    )
  }

  if (member.kind === "category" && member.prompt.trim().length < 8) {
    throw new TeamSpecValidationError(
      `Member '${member.name}' category prompt must be at least 8 characters long.`,
      "CATEGORY_PROMPT_TOO_SHORT",
      "prompt",
      member.name,
    )
  }
}
