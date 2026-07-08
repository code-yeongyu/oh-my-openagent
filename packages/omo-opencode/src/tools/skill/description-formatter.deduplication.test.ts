import { describe, expect, it } from "bun:test"
import { deduplicatePathAliasedSkills } from "./description-formatter"
import { loadedSkillToInfo } from "./native-skills"
import {
  builtinSharedSkill,
  localSkill,
  makeSkill,
  opencodeNativeSkill,
  sharedSkill,
  userSkill,
} from "./description-formatter.test-support"

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
