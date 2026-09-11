import { describe, expect, test } from "bun:test"

import {
  AGENT_INTERACTION_POLICIES,
  ONE_SHOT_AGENT_NAMES,
  interactionPolicyForAgent,
} from "./interaction-policy"

describe("AGENT_INTERACTION_POLICIES", () => {
  test("#given the registry #when inspected #then plan-reviewer is the sole one-shot entry with the plan-review contract", () => {
    // given / when
    const policy = AGENT_INTERACTION_POLICIES["plan-reviewer"]

    // then
    expect(policy).toBeDefined()
    expect(policy.oneShot).toBe(true)
    expect(policy.promptContract).toBe("plan-review")
  })

  test("#given the registry #when inspected #then only plan-reviewer is present and plan-consultant is absent", () => {
    // given / when
    const keys = Object.keys(AGENT_INTERACTION_POLICIES)

    // then
    expect(keys).toEqual(["plan-reviewer"])
    expect("plan-consultant" in AGENT_INTERACTION_POLICIES).toBe(false)
  })
})

describe("ONE_SHOT_AGENT_NAMES", () => {
  test("#given the one-shot set #when inspected #then it contains exactly plan-reviewer", () => {
    // given / when / then
    expect(ONE_SHOT_AGENT_NAMES.has("plan-reviewer")).toBe(true)
    expect(ONE_SHOT_AGENT_NAMES.has("plan-consultant")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.has("explore")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.has("librarian")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.size).toBe(1)
  })
})

describe("interactionPolicyForAgent", () => {
  test("#given plan-reviewer #when looked up #then its policy is returned", () => {
    // given / when
    const policy = interactionPolicyForAgent("plan-reviewer")

    // then
    expect(policy).toBeDefined()
    expect(policy?.oneShot).toBe(true)
    expect(policy?.promptContract).toBe("plan-review")
    expect(policy?.sendDenialReminder.length).toBeGreaterThan(0)
  })

  test("#given an unknown agent #when looked up #then undefined is returned", () => {
    // given / when / then
    expect(interactionPolicyForAgent("explore")).toBeUndefined()
    expect(interactionPolicyForAgent("scribe")).toBeUndefined()
  })

  test("#given plan-consultant #when looked up #then undefined is returned (plan-consultant is not one-shot)", () => {
    // given / when / then
    expect(interactionPolicyForAgent("plan-consultant")).toBeUndefined()
  })

  test("#given the legacy momus id #when looked up #then it resolves onto the plan-reviewer policy", () => {
    // given / when / then
    // A task record persisted before the rename still carries agent_type "momus"; the alias keeps
    // its task_send refusal alive for the deprecation window instead of silently loosening the gate.
    expect(interactionPolicyForAgent("momus")).toBe(AGENT_INTERACTION_POLICIES["plan-reviewer"])
    expect(interactionPolicyForAgent("metis")).toBeUndefined()
  })
})

describe("sendDenialReminder structure", () => {
  test("#given the plan-reviewer denial reminder #when inspected #then it is non-empty and wrapped in system-reminder sentinel tags", () => {
    // given
    const reminder = AGENT_INTERACTION_POLICIES["plan-reviewer"].sendDenialReminder

    // when / then
    expect(reminder.length).toBeGreaterThan(0)
    expect(reminder.startsWith("<system-reminder>")).toBe(true)
    expect(reminder.endsWith("</system-reminder>")).toBe(true)
  })
})
