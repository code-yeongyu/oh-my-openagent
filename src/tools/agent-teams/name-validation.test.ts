/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  validateAgentName,
  validateAgentNameOrLead,
  validateTaskId,
  validateTeamName,
} from "./name-validation"

describe("agent-teams name validation", () => {
  test("accepts valid team names", () => {
    //#given
    const validNames = ["team_1", "alpha-team", "A1"]

    //#when
    const result = validNames.map(validateTeamName)

    //#then
    expect(result).toEqual([null, null, null])
  })

  test("rejects invalid and empty team names", () => {
    //#given
    const blank = ""
    const invalid = "team space"
    const tooLong = "a".repeat(65)

    //#when
    const blankResult = validateTeamName(blank)
    const invalidResult = validateTeamName(invalid)
    const tooLongResult = validateTeamName(tooLong)

    //#then
    expect(blankResult).toBe("team_name_required")
    expect(invalidResult).toBe("team_name_invalid")
    expect(tooLongResult).toBe("team_name_too_long")
  })

  test("rejects reserved teammate name", () => {
    //#given
    const reservedName = "team-lead"

    //#when
    const result = validateAgentName(reservedName)

    //#then
    expect(result).toBe("agent_name_reserved")
  })

  test("validates regular agent names", () => {
    //#given
    const valid = "worker_1"
    const invalid = "worker one"

    //#when
    const validResult = validateAgentName(valid)
    const invalidResult = validateAgentName(invalid)

    //#then
    expect(validResult).toBeNull()
    expect(invalidResult).toBe("agent_name_invalid")
  })

  test("allows team-lead for inbox-compatible validation", () => {
    //#then
    expect(validateAgentNameOrLead("team-lead")).toBeNull()
    expect(validateAgentNameOrLead("worker_1")).toBeNull()
    expect(validateAgentNameOrLead("worker one")).toBe("agent_name_invalid")
  })

  test("validates task ids", () => {
    //#then
    expect(validateTaskId("T-123")).toBeNull()
    expect(validateTaskId("123")).toBe("task_id_invalid")
    expect(validateTaskId("")).toBe("task_id_required")
    expect(validateTaskId("../../etc/passwd")).toBe("task_id_invalid")
    expect(validateTaskId(`T-${"a".repeat(127)}`)).toBe("task_id_too_long")
  })
})
