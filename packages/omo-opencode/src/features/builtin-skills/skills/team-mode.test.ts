import { describe, expect, test } from "bun:test"

import { createBuiltinSkills } from "../skills"
import { teamModeSkill } from "./team-mode"

describe("teamModeSkill gating", () => {
  test("team-mode hidden when disabled", () => {
    // given
    const options = {
      teamModeEnabled: false,
      disabledSkills: new Set<string>(),
    }

    // when
    const skills = createBuiltinSkills(options)

    // then
    expect(skills.some((skill) => skill.name === "team-mode")).toBe(false)
  })

  test("team-mode visible when enabled", () => {
    // given
    const options = {
      teamModeEnabled: true,
      disabledSkills: new Set<string>(),
    }

    // when
    const skills = createBuiltinSkills(options)

    // then
    const skill = skills.find((candidateSkill) => candidateSkill.name === "team-mode")
    expect(skill).toBeDefined()
    expect(skill?.name).toBe("team-mode")
    expect(skill?.description).toBe(teamModeSkill.description)
  })

  test("team-mode skill has no mcpConfig", () => {
    // given

    // when
    const skill = teamModeSkill

    // then
    expect(skill.mcpConfig).toBeUndefined()
  })

  test("team-mode skill exposes runtime tool markers", () => {
    // given
    const body = teamModeSkill.template

    // when
    const toolNames = [
      "team_create",
      "team_delete",
      "team_shutdown_request",
      "team_approve_shutdown",
      "team_reject_shutdown",
      "team_send_message",
      "team_task_create",
      "team_task_list",
      "team_task_update",
      "team_task_get",
      "team_status",
      "team_list",
    ]

    // then
    for (const toolName of toolNames) {
      expect(body).toContain(toolName)
    }
  })
})
