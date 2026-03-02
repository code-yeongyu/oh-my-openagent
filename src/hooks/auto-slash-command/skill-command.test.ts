import { describe, expect, it, mock, beforeEach } from "bun:test"
import { handleSkillCommand } from "./skill-command"

const mockSkills = [
  {
    name: "git-master",
    scope: "builtin",
    definition: { description: "Use this for git operations, commits, rebases" },
  },
  {
    name: "playwright",
    scope: "builtin",
    definition: { description: "Use this for browser automation and testing" },
  },
  {
    name: "docker-deploy",
    scope: "user",
    definition: { description: "Use this to deploy Docker containers" },
  },
  {
    name: "my-project-skill",
    scope: "project",
    definition: { description: "Project-specific workflow helper" },
  },
]

mock.module("../../features/opencode-skill-loader", () => ({
  discoverAllSkills: async () => mockSkills,
}))

describe("#given no query", () => {
  describe("#when /skill is called with no arguments", () => {
    it("#then lists all available skills grouped by scope", async () => {
      const result = await handleSkillCommand("")
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("# Available Skills")
      expect(result.replacementText).toContain("git-master")
      expect(result.replacementText).toContain("playwright")
      expect(result.replacementText).toContain("docker-deploy")
      expect(result.replacementText).toContain("my-project-skill")
    })

    it("#then shows scope labels", async () => {
      const result = await handleSkillCommand("")
      expect(result.replacementText).toContain("## builtin")
      expect(result.replacementText).toContain("## user")
      expect(result.replacementText).toContain("## project")
    })

    it("#then includes activation hint", async () => {
      const result = await handleSkillCommand("")
      expect(result.replacementText).toContain("skill(name=")
    })
  })
})

describe("#given a matching query", () => {
  describe("#when /skill git is called", () => {
    it("#then returns skills matching by name", async () => {
      const result = await handleSkillCommand("git")
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("git-master")
      expect(result.replacementText).not.toContain("playwright")
      expect(result.replacementText).not.toContain("docker-deploy")
    })
  })

  describe("#when /skill browser is called", () => {
    it("#then returns skills matching by description", async () => {
      const result = await handleSkillCommand("browser")
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("playwright")
      expect(result.replacementText).not.toContain("git-master")
    })
  })

  describe("#when query is case-insensitive", () => {
    it("#then matches regardless of case", async () => {
      const result = await handleSkillCommand("DOCKER")
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("docker-deploy")
    })
  })
})

describe("#given a non-matching query", () => {
  describe("#when /skill unknownxyz is called", () => {
    it("#then returns no-match message", async () => {
      const result = await handleSkillCommand("unknownxyz")
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("No skills found matching")
      expect(result.replacementText).toContain("unknownxyz")
    })
  })
})

describe("#given project scope priority", () => {
  describe("#when listing all skills", () => {
    it("#then project skills appear before user and builtin", async () => {
      const result = await handleSkillCommand("")
      const projectIdx = result.replacementText!.indexOf("## project")
      const userIdx = result.replacementText!.indexOf("## user")
      const builtinIdx = result.replacementText!.indexOf("## builtin")
      expect(projectIdx).toBeLessThan(userIdx)
      expect(userIdx).toBeLessThan(builtinIdx)
    })
  })
})
