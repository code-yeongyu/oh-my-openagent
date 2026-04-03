import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import * as shared from "../../shared"
import * as slashcommand from "../../tools/slashcommand"
import { executeSlashCommand } from "./executor"

let resolveCommandsInTextSpy: { mockRestore: () => void } | undefined
let resolveFileReferencesInTextSpy: { mockRestore: () => void } | undefined
let discoverCommandsSyncSpy: { mockRestore: () => void } | undefined

function setupExecutorSpies(): void {
  resolveCommandsInTextSpy = spyOn(shared, "resolveCommandsInText")
    .mockImplementation(async (content: string) => content)
  resolveFileReferencesInTextSpy = spyOn(shared, "resolveFileReferencesInText")
    .mockImplementation(async (content: string) => content)
  discoverCommandsSyncSpy = spyOn(slashcommand, "discoverCommandsSync").mockReturnValue([
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
  ])
}

function restoreExecutorSpies(): void {
  resolveCommandsInTextSpy?.mockRestore()
  resolveFileReferencesInTextSpy?.mockRestore()
  discoverCommandsSyncSpy?.mockRestore()
  resolveCommandsInTextSpy = undefined
  resolveFileReferencesInTextSpy = undefined
  discoverCommandsSyncSpy = undefined
}

afterEach(restoreExecutorSpies)

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
    setupExecutorSpies()
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
    setupExecutorSpies()
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
    setupExecutorSpies()
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
