/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import {
  TeamSpecValidationError,
  validateMemberEligibility,
} from "@oh-my-opencode/team-core/team-registry/validator"

import { getAgentDisplayName } from "../../shared/agent-display-names"
import type { Member } from "./types"
import { DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY } from "./open-code-agent-eligibility"

function createMember(subagentType: string): Extract<Member, { kind: "subagent_type" }> {
  return {
    backendType: "in-process",
    isActive: true,
    kind: "subagent_type",
    name: "reviewer",
    subagent_type: subagentType,
  }
}

test("rejects a hard-reject built-in display alias before dynamic admission", () => {
  // given
  const member = createMember(getAgentDisplayName("prometheus"))

  // when
  const validate = () => validateMemberEligibility(member, DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY)

  // then
  expect(validate).toThrow(TeamSpecValidationError)
  try {
    validate()
  } catch (error) {
    if (!(error instanceof TeamSpecValidationError)) throw error
    expect(error).toBeInstanceOf(TeamSpecValidationError)
    expect(error.code).toBe("INELIGIBLE_AGENT")
  }
})
