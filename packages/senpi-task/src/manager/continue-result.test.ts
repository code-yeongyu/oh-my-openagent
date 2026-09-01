import { describe, expect, test } from "bun:test"

import { AGENT_INTERACTION_POLICIES } from "../agents"
import { toContinueResult } from "./continue-result"
import { CONTINUE_SUGGESTION } from "./manager-helpers"

describe("toContinueResult", () => {
  test("#given a one_shot_agent send outcome #when adapted #then it is not_continuable with the registry reminder as the reason", () => {
    // given
    const outcome = {
      kind: "one_shot_agent",
      task_id: "st_00000001",
      agent: "momus",
      message: AGENT_INTERACTION_POLICIES.momus.sendDenialReminder,
    } as const

    // when
    const result = toContinueResult(outcome)

    // then (registry-to-output equality: the reason IS the registry reminder, not a paraphrase)
    expect(result).toEqual({
      kind: "not_continuable",
      task_id: "st_00000001",
      reason: AGENT_INTERACTION_POLICIES.momus.sendDenialReminder,
      suggestion: CONTINUE_SUGGESTION,
    })
  })
})
