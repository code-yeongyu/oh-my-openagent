import type { TeamMemberEligibilityPolicy } from "@oh-my-opencode/team-core/team-registry/validator"

import { getAgentConfigKey } from "../../shared/agent-display-names"

export const DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY = {
  canonicalizeSubagentType: getAgentConfigKey,
  isAdditionalSubagentEligible: () => true,
} satisfies TeamMemberEligibilityPolicy
