import { describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

function makeSkill(name: string, description: string, scope: LoadedSkill["scope"] = "project"): LoadedSkill {
  return {
    name,
    scope,
    definition: { description },
    allowedTools: [],
  } as unknown as LoadedSkill
}

describe("createSystemTransformHandler", () => {
  describe("#given no skills", () => {
    test("#when called, #then injects empty skill index message", async () => {
      //#given
      const handler = createSystemTransformHandler([])
      const output: { system: string[] } = { system: [] }

      //#when
      await handler({ sessionID: "ses_test" }, output)

      //#then
      expect(output.system).toHaveLength(1)
      expect(output.system[0]).toContain("SKILL INDEX")
      expect(output.system[0]).toContain("No skills are currently available")
    })
  })

  describe("#given skills are present", () => {
    test("#when called, #then injects skill index with enforcement text", async () => {
      //#given
      const skills = [
        makeSkill("git-master", "Git operations"),
        makeSkill("playwright", "Browser automation", "builtin"),
      ]
      const handler = createSystemTransformHandler(skills)
      const output: { system: string[] } = { system: [] }

      //#when
      await handler({ sessionID: "ses_test" }, output)

      //#then
      expect(output.system).toHaveLength(1)
      const injected = output.system[0]
      expect(injected).toContain("SKILL INDEX")
      expect(injected).toContain("git-master")
      expect(injected).toContain("playwright")
      expect(injected).toContain("1% RULE")
    })

    test("#when called multiple times, #then appends to existing system entries", async () => {
      //#given
      const handler = createSystemTransformHandler([makeSkill("git-master", "Git ops")])
      const output: { system: string[] } = { system: ["existing-entry"] }

      //#when
      await handler({ sessionID: "ses_test" }, output)

      //#then
      expect(output.system).toHaveLength(2)
      expect(output.system[0]).toBe("existing-entry")
      expect(output.system[1]).toContain("SKILL INDEX")
    })

    test("#when skill has scope prefix in description, #then strips it", async () => {
      //#given
      const skill = makeSkill("writing-skills", "(project - Skill) Write high-quality skills")
      const handler = createSystemTransformHandler([skill])
      const output: { system: string[] } = { system: [] }

      //#when
      await handler({ sessionID: "ses_test" }, output)

      //#then
      expect(output.system[0]).toContain("Write high-quality skills")
      expect(output.system[0]).not.toContain("(project - Skill)")
    })
  })
})
