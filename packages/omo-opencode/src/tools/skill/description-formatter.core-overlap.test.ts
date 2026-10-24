import { describe, expect, it } from "bun:test"
import {
  formatCombinedDescription,
  isDiscoverableByOpenCodeCore,
} from "./description-formatter"
import {
  builtinSharedSkill,
  localSkill,
  makeCommand,
  makeSkill,
  opencodeNativeSkill,
  sharedSkill,
  userSkill,
} from "./description-formatter.test-support"
import type { SkillInfo } from "./types"

function opencodeProjectSkill(name: string, description = "project opencode desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "opencode-project",
    location: `/repo/.opencode/skills/${name}/SKILL.md`,
  })
}

function opencodeGlobalSkill(name: string, description = "global opencode desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "opencode",
    location: `/home/user/.config/opencode/skills/${name}/SKILL.md`,
  })
}

function claudeUserSkill(name: string, description = "claude user desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "user",
    location: `/home/user/.claude/skills/${name}/SKILL.md`,
  })
}

function bundledDistSkill(name: string, description = "omo bundled desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "builtin",
    location: `/opt/oh-my-openagent/dist/skills/${name}/SKILL.md`,
  })
}

describe("isDiscoverableByOpenCodeCore", () => {
  it("treats OpenCode-scanned user, project, and config-dir skills as core-listed", () => {
    expect(isDiscoverableByOpenCodeCore(claudeUserSkill("playwright"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(userSkill("frontend"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(localSkill("review-work"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(opencodeProjectSkill("debugging"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(opencodeGlobalSkill("refactor"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(opencodeNativeSkill("customize-opencode"))).toBe(true)
    expect(isDiscoverableByOpenCodeCore(makeSkill("windows-claude", "desc", {
      scope: "user",
      location: "C:\\Users\\me\\.claude\\skills\\windows-claude\\SKILL.md",
    }))).toBe(true)
  })

  it("keeps OMO-bundled builtin and shared skills that core discovery cannot see", () => {
    expect(isDiscoverableByOpenCodeCore(makeSkill("git-master"))).toBe(false)
    expect(isDiscoverableByOpenCodeCore(builtinSharedSkill("debugging"))).toBe(false)
    expect(isDiscoverableByOpenCodeCore(sharedSkill("review-work"))).toBe(false)
    expect(isDiscoverableByOpenCodeCore(bundledDistSkill("frontend"))).toBe(false)
    expect(isDiscoverableByOpenCodeCore(makeSkill("security-review", "desc", {
      location: "<builtin>/security-review/SKILL.md",
    }))).toBe(false)
  })
})

describe("formatCombinedDescription core overlap", () => {
  it("omits core-listed skill descriptions from available_items while keeping OMO-bundled skills", () => {
    const skills: SkillInfo[] = [
      claudeUserSkill("playwright", "long playwright description payload"),
      opencodeProjectSkill("local-debug", "long local debug description payload"),
      bundledDistSkill("git-master", "bundled git-master description"),
      makeSkill("review-work", "bundled review-work description"),
    ]

    const result = formatCombinedDescription(skills, [], { includeSkills: true })

    expect(result).toContain("<available_items>")
    expect(result).toContain("/git-master")
    expect(result).toContain("bundled git-master description")
    expect(result).toContain("/review-work")
    expect(result).not.toContain("long playwright description payload")
    expect(result).not.toContain("long local debug description payload")
    expect(result).not.toContain("/playwright")
    expect(result).not.toContain("/local-debug")
  })

  it("still lists slash commands when every skill is already covered by core", () => {
    const skills: SkillInfo[] = [
      claudeUserSkill("playwright"),
      opencodeProjectSkill("local-debug"),
    ]
    const commands = [makeCommand("handoff", "handoff command")]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<available_items>")
    expect(result).toContain("/handoff")
    expect(result).not.toContain("/playwright")
    expect(result).not.toContain("/local-debug")
  })

  it("suppresses builtin command aliases using the full skill list, not only the OMO-private remainder", () => {
    const skills: SkillInfo[] = [
      opencodeProjectSkill("refactor", "full refactor skill"),
      makeSkill("ulw-execute", "full ulw-execute skill"),
    ]
    const commands = [
      makeCommand("refactor", "short refactor command"),
      makeCommand("ulw-execute", "short ulw-execute command"),
      makeCommand("handoff", "handoff command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("/ulw-execute")
    expect(result).toContain("/handoff")
    expect(result).not.toContain("/refactor")
    expect(result).not.toContain("short refactor command")
    expect(result).not.toContain("short ulw-execute command")
  })
})
