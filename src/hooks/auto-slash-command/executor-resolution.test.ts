import { describe, expect, it, mock } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

mock.module("../../shared", () => ({
  resolveCommandsInText: async (content: string) => content,
  resolveFileReferencesInText: async (content: string) => content,
}))

mock.module("../../tools/slashcommand", () => ({
  discoverCommandsSync: () => [
    {
      name: "shadowed",
      metadata: { name: "shadowed", description: "builtin" },
      content: "builtin template",
      scope: "builtin",
    },
    {
      name: "shadowed",
      metadata: { name: "shadowed", description: "project" },
      content: "project template",
      scope: "project",
    },
  ],
}))

mock.module("../../features/opencode-skill-loader", () => ({
  discoverAllSkills: async (): Promise<LoadedSkill[]> => [],
}))

const { executeSlashCommand } = await import("./executor")

function createRestrictedSkill(): LoadedSkill {
  return {
    name: "restricted-skill",
    definition: {
      name: "restricted-skill",
      description: "restricted",
      template: "restricted template",
      agent: "hephaestus",
    },
    scope: "user",
  }
}

describe("executeSlashCommand resolution semantics", () => {
  it("returns project command when project and builtin names collide", async () => {
    //#given
    const parsed = {
      command: "shadowed",
      args: "",
      raw: "/shadowed",
    }

    //#when
    const result = await executeSlashCommand(parsed, { skills: [] })

    //#then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("**Scope**: project")
    expect(result.replacementText).toContain("project template")
    expect(result.replacementText).not.toContain("builtin template")
  })

  it("blocks slash skill invocation when invoking agent is missing", async () => {
    //#given
    const parsed = {
      command: "restricted-skill",
      args: "",
      raw: "/restricted-skill",
    }

    //#when
    const result = await executeSlashCommand(parsed, { skills: [createRestrictedSkill()] })

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe('Skill "restricted-skill" is restricted to agent "hephaestus"')
  })

  it("allows slash skill invocation when invoking agent matches restriction", async () => {
    //#given
    const parsed = {
      command: "restricted-skill",
      args: "",
      raw: "/restricted-skill",
    }

    //#when
    const result = await executeSlashCommand(parsed, {
      skills: [createRestrictedSkill()],
      agent: "hephaestus",
    })

    //#then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("restricted template")
  })
})
