/// <reference types="bun-types" />

import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import * as shared from "../../shared"
import * as slashcommand from "../../tools/slashcommand/command-discovery"

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

async function executeSlashCommand(...args: Parameters<typeof import("./executor").executeSlashCommand>): ReturnType<typeof import("./executor").executeSlashCommand> {
  const module = await import(`./executor?test=${Date.now()}-${Math.random()}`)
  return module.executeSlashCommand(...args)
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

  // regression: issue #4183 — short-name resolution for namespaced skills
  it("resolves a namespaced skill via its short name", async () => {
    //#given
    setupExecutorSpies()
    const namespacedSkill: LoadedSkill = {
      name: "superpowers/systematic-debugging",
      definition: {
        name: "superpowers/systematic-debugging",
        description: "debug skill",
        template: "debug template body",
      },
      scope: "user",
    }
    const parsed = {
      command: "systematic-debugging",
      args: "",
      raw: "/systematic-debugging",
    }

    //#when: caller invokes the short name
    const result = await executeSlashCommand(parsed, { skills: [namespacedSkill] })

    //#then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("debug template body")
    expect(result.replacementText).toContain("**Scope**: skill")
  })

  it("does not resolve an ambiguous short name across namespaces", async () => {
    //#given
    setupExecutorSpies()
    const skillA: LoadedSkill = {
      name: "ns-a/shared",
      definition: { name: "ns-a/shared", description: "a", template: "A" },
      scope: "user",
    }
    const skillB: LoadedSkill = {
      name: "ns-b/shared",
      definition: { name: "ns-b/shared", description: "b", template: "B" },
      scope: "user",
    }
    const parsed = { command: "shared", args: "", raw: "/shared" }

    //#when: caller invokes the ambiguous short name
    const result = await executeSlashCommand(parsed, { skills: [skillA, skillB] })

    //#then: refuses to pick — better than guessing wrong
    expect(result.success).toBe(false)
    expect(result.error).toContain('Command "/shared" not found')
  })

  it("prefers exact full-name match over short-name match", async () => {
    //#given
    setupExecutorSpies()
    const exactSkill: LoadedSkill = {
      name: "debug",
      definition: { name: "debug", description: "exact", template: "EXACT template" },
      scope: "user",
    }
    const namespacedSkill: LoadedSkill = {
      name: "superpowers/debug",
      definition: { name: "superpowers/debug", description: "ns", template: "NS template" },
      scope: "user",
    }
    const parsed = { command: "debug", args: "", raw: "/debug" }

    //#when
    const result = await executeSlashCommand(parsed, { skills: [namespacedSkill, exactSkill] })

    //#then: exact wins
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("EXACT template")
    expect(result.replacementText).not.toContain("NS template")
  })
})
