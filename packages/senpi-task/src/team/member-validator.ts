import type { TeamSpec } from "@oh-my-opencode/team-core/types"

import { CURATED_READONLY_AGENT_NAMES } from "../agents/builtin"
import { SenpiTeamSpecError } from "./errors"

/**
 * Senpi-local member vocabulary resolver ports. `isCategoryResolvable` is backed by the todo-4
 * category resolution; `isKnownAgent` is backed by the todo-5 agent loader. Kept as injectable
 * predicates so the registry does not couple to a full model registry just to validate a spec.
 */
export type SenpiTeamMemberPorts = {
  readonly isCategoryResolvable: (category: string) => boolean
  readonly isKnownAgent: (subagentType: string) => boolean
}

const ALLOWED_KINDS_HINT =
  "member kind must be 'category' (a resolvable delegate category), 'subagent_type' (a loaded agent definition), or the 'agent' alias for a subagent_type"

/**
 * Validates parsed team members against the ACTUAL senpi vocabulary. team-core `validateSpec` is
 * NOT used because it hard-calls the opencode-roster eligibility registry.
 */
export function validateSenpiTeamMembers(spec: TeamSpec, ports: SenpiTeamMemberPorts): void {
  for (const member of spec.members) {
    if (member.kind === "category") {
      if (!ports.isCategoryResolvable(member.category)) {
        throw new SenpiTeamSpecError(
          `Team '${spec.name}' member '${member.name}' references unknown category '${member.category}'. ${ALLOWED_KINDS_HINT}.`,
          "UNRESOLVABLE_CATEGORY",
          spec.name,
        )
      }
      continue
    }

    if (CURATED_READONLY_AGENT_NAMES.has(member.subagent_type)) {
      throw new SenpiTeamSpecError(
        `curated read-only agent "${member.subagent_type}" cannot be a team member; delegate via the task tool instead`,
        "UNKNOWN_SUBAGENT_TYPE",
        spec.name,
      )
    }

    if (!ports.isKnownAgent(member.subagent_type)) {
      throw new SenpiTeamSpecError(
        `Team '${spec.name}' member '${member.name}' references unknown subagent_type '${member.subagent_type}'. ${ALLOWED_KINDS_HINT}.`,
        "UNKNOWN_SUBAGENT_TYPE",
        spec.name,
      )
    }
  }
}
