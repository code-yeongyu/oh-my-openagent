import { describe, expect, test } from "bun:test"

import {
  AGENT_INTERACTION_POLICIES,
  ONE_SHOT_AGENT_NAMES,
  interactionPolicyForAgent,
} from "./interaction-policy"

describe("AGENT_INTERACTION_POLICIES", () => {
  test("#given the registry #when inspected #then momus is the sole one-shot entry with the plan-review contract", () => {
    // given / when
    const policy = AGENT_INTERACTION_POLICIES.momus

    // then
    expect(policy).toBeDefined()
    expect(policy.oneShot).toBe(true)
    expect(policy.promptContract).toBe("plan-review")
  })

  test("#given the registry #when inspected #then only momus is present and metis is absent", () => {
    // given / when
    const keys = Object.keys(AGENT_INTERACTION_POLICIES)

    // then
    expect(keys).toEqual(["momus"])
    expect("metis" in AGENT_INTERACTION_POLICIES).toBe(false)
  })
})

describe("ONE_SHOT_AGENT_NAMES", () => {
  test("#given the one-shot set #when inspected #then it contains exactly momus", () => {
    // given / when / then
    expect(ONE_SHOT_AGENT_NAMES.has("momus")).toBe(true)
    expect(ONE_SHOT_AGENT_NAMES.has("metis")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.has("explore")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.has("librarian")).toBe(false)
    expect(ONE_SHOT_AGENT_NAMES.size).toBe(1)
  })
})

describe("interactionPolicyForAgent", () => {
  test("#given momus #when looked up #then its policy is returned", () => {
    // given / when
    const policy = interactionPolicyForAgent("momus")

    // then
    expect(policy).toBeDefined()
    expect(policy?.oneShot).toBe(true)
    expect(policy?.promptContract).toBe("plan-review")
    expect(policy?.sendDenialReminder.length).toBeGreaterThan(0)
  })

  test("#given an unknown agent #when looked up #then undefined is returned", () => {
    // given / when / then
    expect(interactionPolicyForAgent("explore")).toBeUndefined()
    expect(interactionPolicyForAgent("sisyphus")).toBeUndefined()
  })

  test("#given metis #when looked up #then undefined is returned (metis is not one-shot)", () => {
    // given / when / then
    expect(interactionPolicyForAgent("metis")).toBeUndefined()
  })
})

describe("sendDenialReminder structure", () => {
  test("#given the momus denial reminder #when inspected #then it is non-empty and wrapped in system-reminder sentinel tags", () => {
    // given
    const reminder = AGENT_INTERACTION_POLICIES.momus.sendDenialReminder

    // when / then
    expect(reminder.length).toBeGreaterThan(0)
    expect(reminder.startsWith("<system-reminder>")).toBe(true)
    expect(reminder.endsWith("</system-reminder>")).toBe(true)
  })
})
