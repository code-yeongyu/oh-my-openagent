import { describe, expect, it } from "bun:test"
import {
  clearSessionLoadedSkills,
  getSessionLoadedSkills,
  recordLoadedSkill,
  _resetLoadedSkillsForTesting,
} from "./session-loaded-skills"

describe("session-loaded-skills", () => {
  _resetLoadedSkillsForTesting()

  it("#given a fresh session #when a skill load is recorded #then it is returned with name and body", () => {
    // given
    const sessionID = "ses_store_basic"

    // when
    recordLoadedSkill(sessionID, "team-ops", "use team_list before team_delete")

    // then
    const recorded = getSessionLoadedSkills(sessionID)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.name).toBe("team-ops")
    expect(recorded[0]?.body).toBe("use team_list before team_delete")
  })

  it("#given the same skill recorded twice #when the session store is read #then the latest body wins without duplicates", () => {
    // given
    const sessionID = "ses_store_dedupe"
    recordLoadedSkill(sessionID, "review-work", "old body")

    // when
    recordLoadedSkill(sessionID, "review-work", "new body")

    // then
    const recorded = getSessionLoadedSkills(sessionID)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.body).toBe("new body")
  })

  it("#given multiple skills recorded #when the session store is read #then insertion order is preserved", () => {
    // given
    const sessionID = "ses_store_order"
    recordLoadedSkill(sessionID, "alpha", "alpha body")
    recordLoadedSkill(sessionID, "beta", "beta body")

    // when
    const recorded = getSessionLoadedSkills(sessionID)

    // then
    expect(recorded.map((skill) => skill.name)).toEqual(["alpha", "beta"])
  })

  it("#given skills recorded in two sessions #when one session is cleared #then the other session is untouched", () => {
    // given
    recordLoadedSkill("ses_store_clear_a", "shared", "a body")
    recordLoadedSkill("ses_store_clear_b", "shared", "b body")

    // when
    clearSessionLoadedSkills("ses_store_clear_a")

    // then
    expect(getSessionLoadedSkills("ses_store_clear_a")).toEqual([])
    expect(getSessionLoadedSkills("ses_store_clear_b")).toHaveLength(1)
  })

  it("#given an unknown session #when the store is read #then an empty array is returned", () => {
    // given / when
    const recorded = getSessionLoadedSkills("ses_store_unknown")

    // then
    expect(recorded).toEqual([])
  })

  it("#given state across sessions #when reset for testing is invoked #then all sessions are cleared", () => {
    // given
    recordLoadedSkill("ses_store_reset_a", "skill-a", "body a")
    recordLoadedSkill("ses_store_reset_b", "skill-b", "body b")

    // when
    _resetLoadedSkillsForTesting()

    // then
    expect(getSessionLoadedSkills("ses_store_reset_a")).toEqual([])
    expect(getSessionLoadedSkills("ses_store_reset_b")).toEqual([])
  })
})
