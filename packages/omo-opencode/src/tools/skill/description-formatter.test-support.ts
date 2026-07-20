import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"

export function makeSkill(
  name: string,
  description = "desc",
  overrides: Partial<SkillInfo> = {},
): SkillInfo {
  return { name, description, scope: "builtin", ...overrides }
}

export function sharedSkill(name: string, description = "shared desc"): SkillInfo {
  return makeSkill(`shared/${name}`, description, {
    scope: "shared",
    location: `/repo/packages/shared-skills/skills/${name}/SKILL.md`,
  })
}

export function builtinSharedSkill(name: string, description = "builtin desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "builtin",
    location: `/repo/packages/shared-skills/skills/${name}`,
  })
}

export function localSkill(name: string, description = "local desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "project",
    location: `/repo/.agents/skills/${name}/SKILL.md`,
  })
}

export function userSkill(name: string, description = "user desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "user",
    location: `/home/.agents/skills/${name}/SKILL.md`,
  })
}

export function opencodeNativeSkill(
  name: string,
  description = "opencode native desc",
  location = "<built-in>",
): SkillInfo {
  return makeSkill(name, description, {
    scope: "config",
    location,
  })
}

export function makeCommand(
  name: string,
  description = "command desc",
  overrides: Partial<CommandInfo> = {},
): CommandInfo {
  return {
    name,
    metadata: { name, description },
    content: "",
    scope: "builtin",
    ...overrides,
  }
}
