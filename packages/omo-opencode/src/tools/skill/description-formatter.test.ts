import { describe, expect, it } from "bun:test"
import { deduplicatePathAliasedSkills, formatCombinedDescription } from "./description-formatter"
import { loadedSkillToInfo } from "./native-skills"
import type { CommandInfo } from "../slashcommand/types"
import type { SkillInfo } from "./types"

function makeSkill(name: string, description = "desc", overrides: Partial<SkillInfo> = {}): SkillInfo {
  return { name, description, scope: "builtin", ...overrides }
}

function sharedSkill(name: string, description = "shared desc"): SkillInfo {
  return makeSkill(`shared/${name}`, description, {
    scope: "shared",
    location: `/repo/packages/shared-skills/skills/${name}/SKILL.md`,
  })
}

function builtinSharedSkill(name: string, description = "builtin desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "builtin",
    location: `/repo/packages/shared-skills/skills/${name}`,
  })
}

function localSkill(name: string, description = "local desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "project",
    location: `/repo/.agents/skills/${name}/SKILL.md`,
  })
}

function userSkill(name: string, description = "user desc"): SkillInfo {
  return makeSkill(name, description, {
    scope: "user",
    location: `/home/.agents/skills/${name}/SKILL.md`,
  })
}

function opencodeNativeSkill(
  name: string,
  description = "opencode native desc",
  location = "<built-in>",
): SkillInfo {
  return makeSkill(name, description, {
    scope: "config",
    location,
  })
}

function makeCommand(
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

describe("deduplicatePathAliasedSkills", () => {
  it("keeps all skills when there are no path-alias duplicates", () => {
    const skills = [makeSkill("debugging"), makeSkill("review-work"), makeSkill("git-master")]
    expect(deduplicatePathAliasedSkills(skills).map((s) => s.name)).toEqual([
      "debugging",
      "review-work",
      "git-master",
    ])
  })

  it("suppresses the bare short name when a qualified variant exists", () => {
    const skills = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["shared/debugging", "review-work"])
  })

  it("handles multiple short-name duplicates in one pass", () => {
    const skills = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      sharedSkill("remove-ai-slops"),
      builtinSharedSkill("remove-ai-slops"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual([
      "shared/debugging",
      "shared/remove-ai-slops",
      "review-work",
    ])
  })

  it("keeps the qualified name even when descriptions differ", () => {
    const skills = [
      sharedSkill("debugging", "canonical description"),
      builtinSharedSkill("debugging", "slightly different description"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("shared/debugging")
    expect(result[0]?.description).toBe("canonical description")
  })

  it("does not suppress a bare name that has no qualified counterpart", () => {
    const skills = [
      sharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["shared/debugging", "review-work"])
  })

  it("handles deeply nested paths correctly", () => {
    const skills = [
      makeSkill("org/team/debugging", "org", { location: "/repo/skills/org/team/debugging/SKILL.md" }),
      makeSkill("debugging", "org", { location: "/repo/skills/org/team/debugging" }),
      makeSkill("team/debugging", "team", { location: "/repo/skills/team/debugging/SKILL.md" }),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["org/team/debugging", "team/debugging"])
  })

  it("keeps a distinct local bare skill when a shared skill has the same short name", () => {
    const skills = [
      sharedSkill("debugging", "shared debugging"),
      localSkill("debugging", "local debugging"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "shared/debugging:shared debugging",
      "debugging:local debugging",
    ])
  })

  it("keeps at least the qualified shared entry for same-source ast-grep aliases", () => {
    const skills = [
      sharedSkill("ast-grep", "full ast-grep instructions"),
      builtinSharedSkill("ast-grep", "short ast-grep wrapper"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["shared/ast-grep"])
    expect(result[0]?.description).toBe("full ast-grep instructions")
  })

  it("removes shorter builtin aliases for shared-derived refactor skills", () => {
    const skills = [
      sharedSkill("refactor", "full refactor instructions"),
      builtinSharedSkill("refactor", "short refactor wrapper"),
      sharedSkill("remove-ai-slops", "full cleanup instructions"),
      builtinSharedSkill("remove-ai-slops", "short cleanup wrapper"),
      sharedSkill("start-work", "full start-work instructions"),
      builtinSharedSkill("start-work", "short start-work wrapper"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "shared/refactor:full refactor instructions",
      "shared/remove-ai-slops:full cleanup instructions",
      "shared/start-work:full start-work instructions",
    ])
  })

  it("uses builtin resolvedPath to prove shared-derived aliases have the same source", () => {
    const shared = sharedSkill("refactor", "full refactor instructions")
    const builtin = loadedSkillToInfo({
      name: "refactor",
      definition: {
        name: "refactor",
        description: "short refactor wrapper",
        template: "",
      },
      scope: "builtin",
      resolvedPath: "/repo/packages/shared-skills/skills/refactor",
    })
    const result = deduplicatePathAliasedSkills([shared, builtin])
    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "shared/refactor:full refactor instructions",
    ])
  })

  it("suppresses known shared-derived opencode bare skills even when the wrapper has no location", () => {
    const skills = [
      sharedSkill("remove-ai-slops", "full cleanup instructions"),
      makeSkill("remove-ai-slops", "short cleanup wrapper", { scope: "opencode", location: undefined }),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "shared/remove-ai-slops:full cleanup instructions",
    ])
  })

  it("keeps distinct user bare skills when a shared skill has the same short name", () => {
    const skills = [
      sharedSkill("start-work", "full start-work instructions"),
      userSkill("start-work", "local start-work workflow"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "shared/start-work:full start-work instructions",
      "start-work:local start-work workflow",
    ])
  })

  it("keeps OpenCode native bare skills exposed with built-in sentinel locations", () => {
    const skills = [
      opencodeNativeSkill("opencode/customize-opencode", "Qualified OpenCode customize entry"),
      opencodeNativeSkill("customize-opencode", "Customize OpenCode"),
    ]

    const result = deduplicatePathAliasedSkills(skills)

    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "opencode/customize-opencode:Qualified OpenCode customize entry",
      "customize-opencode:Customize OpenCode",
    ])
  })

  it("keeps OpenCode native bare skills exposed with legacy /opencode locations", () => {
    const skills = [
      opencodeNativeSkill(
        "opencode/customize-opencode",
        "Qualified OpenCode customize entry",
        "/opencode/customize-opencode.md",
      ),
      opencodeNativeSkill("customize-opencode", "Customize OpenCode", "/opencode/customize-opencode.md"),
    ]

    const result = deduplicatePathAliasedSkills(skills)

    expect(result.map((s) => `${s.name}:${s.description}`)).toEqual([
      "opencode/customize-opencode:Qualified OpenCode customize entry",
      "customize-opencode:Customize OpenCode",
    ])
  })
})

describe("formatCombinedDescription with path-alias deduplication", () => {
  it("omits the bare alias from the injected description", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/shared/debugging")
    expect(result).not.toContain("\n    <name>/debugging</name>")
    expect(result).toContain("/review-work")
  })

  it("omits shorter shared-derived builtin commands when the shared skill is listed", () => {
    const skills: SkillInfo[] = [
      sharedSkill("refactor", "full refactor skill"),
      sharedSkill("remove-ai-slops", "full cleanup skill"),
      sharedSkill("start-work", "full start-work skill"),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "short refactor command"),
      makeCommand("remove-ai-slops", "short cleanup command"),
      makeCommand("start-work", "short start-work command"),
      makeCommand("handoff", "handoff command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/shared/refactor</name>")
    expect(result).toContain("<name>/shared/remove-ai-slops</name>")
    expect(result).toContain("<name>/shared/start-work</name>")
    expect(result).not.toContain("\n    <name>/refactor</name>")
    expect(result).not.toContain("\n    <name>/remove-ai-slops</name>")
    expect(result).not.toContain("\n    <name>/start-work</name>")
    expect(result).not.toContain("short refactor command")
    expect(result).not.toContain("short cleanup command")
    expect(result).not.toContain("short start-work command")
    expect(result).toContain("handoff command")
  })

  it("keeps distinct project commands even when a shared skill has the same short name", () => {
    const skills: SkillInfo[] = [sharedSkill("refactor", "full refactor skill")]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "project refactor command", { scope: "project" }),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/shared/refactor</name>")
    expect(result).toContain("\n    <name>/refactor</name>")
    expect(result).toContain("full refactor skill")
    expect(result).toContain("project refactor command")
  })

  it("keeps builtin commands when the matching qualified skill is not shared-derived", () => {
    const skills: SkillInfo[] = [
      makeSkill("project/refactor", "project refactor skill", {
        scope: "project",
        location: "/repo/.agents/skills/project/refactor/SKILL.md",
      }),
    ]
    const commands: CommandInfo[] = [
      makeCommand("refactor", "builtin refactor command"),
    ]

    const result = formatCombinedDescription(skills, commands, { includeSkills: true })

    expect(result).toContain("<name>/project/refactor</name>")
    expect(result).toContain("\n    <name>/refactor</name>")
    expect(result).toContain("project refactor skill")
    expect(result).toContain("builtin refactor command")
  })

  it("keeps OpenCode-injected native skills while suppressing shared path aliases", () => {
    const skills: SkillInfo[] = [
      sharedSkill("debugging", "full shared debugging"),
      builtinSharedSkill("debugging", "short debugging wrapper"),
      opencodeNativeSkill("opencode/customize-opencode", "Qualified OpenCode customize entry"),
      opencodeNativeSkill("customize-opencode", "Customize OpenCode"),
    ]

    const result = formatCombinedDescription(skills, [], { includeSkills: true })

    expect(result).toContain("<name>/shared/debugging</name>")
    expect(result).not.toContain("\n    <name>/debugging</name>")
    expect(result).toContain("<name>/customize-opencode</name>")
    expect(result).toContain("Customize OpenCode")
  })
})
