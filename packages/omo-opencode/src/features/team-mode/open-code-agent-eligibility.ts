import type { TeamMemberEligibilityPolicy } from "@oh-my-opencode/team-core/team-registry/validator"

export const DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY = {
  isAdditionalSubagentEligible: () => true,
} satisfies TeamMemberEligibilityPolicy
