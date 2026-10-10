import { describe, expect, test } from "bun:test"

import { AGENT_INTERACTION_POLICIES } from "../agents"
import { toContinueResult } from "./continue-result"
import { CONTINUE_SUGGESTION } from "./manager-helpers"

describe("toContinueResult", () => {
  for (const kind of ["cwd_unavailable", "config_generation_mismatch", "admission_refused", "capacity_deferred"] as const) {
    test(`#given ${kind} #when adapted #then continuation remains refused with the original task and diagnostic`, () => {
      const outcome = { kind, task_id: "st_00000001", reason: "FAILURE_SENTINEL" }
      expect(toContinueResult(outcome)).toMatchObject({ kind: "not_continuable", task_id: "st_00000001", reason: "FAILURE_SENTINEL" })
    })
  }

  test("#given a one_shot_agent send outcome #when adapted #then it is not_continuable with the registry reminder as the reason", () => {
    // given
    const outcome = {
      kind: "one_shot_agent",
      task_id: "st_00000001",
      agent: "plan-reviewer",
      message: AGENT_INTERACTION_POLICIES["plan-reviewer"].sendDenialReminder,
    } as const

    // when
    const result = toContinueResult(outcome)

    // then (registry-to-output equality: the reason IS the registry reminder, not a paraphrase)
    expect(result).toEqual({
      kind: "not_continuable",
      task_id: "st_00000001",
      reason: AGENT_INTERACTION_POLICIES["plan-reviewer"].sendDenialReminder,
      suggestion: CONTINUE_SUGGESTION,
    })
  })
})
