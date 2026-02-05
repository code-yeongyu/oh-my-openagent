/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import {
  buildCategorySkillsDelegationGuide,
  buildUltraworkSection,
  formatCustomSkillsBlock,
  type AvailableSkill,
  type AvailableCategory,
  type AvailableAgent,
} from "./dynamic-agent-prompt-builder"

describe("buildCategorySkillsDelegationGuide", () => {
  const categories: AvailableCategory[] = [
    { name: "visual-engineering", description: "Frontend, UI/UX" },
    { name: "quick", description: "Trivial tasks" },
  ]

  const builtinSkills: AvailableSkill[] = [
    { name: "playwright", description: "Browser automation via Playwright", location: "plugin" },
    { name: "frontend-ui-ux", description: "Designer-turned-developer", location: "plugin" },
  ]

  const customUserSkills: AvailableSkill[] = [
    { name: "react-19", description: "React 19 patterns and best practices", location: "user" },
    { name: "tailwind-4", description: "Tailwind CSS v4 utilities", location: "user" },
  ]

  const customProjectSkills: AvailableSkill[] = [
    { name: "our-design-system", description: "Internal design system components", location: "project" },
  ]

  it("should separate builtin and custom skills into distinct sections", () => {
    //#given: mix of builtin and custom skills
    const allSkills = [...builtinSkills, ...customUserSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: should have separate sections
    expect(result).toContain("Built-in Skills")
    expect(result).toContain("User-Installed Skills")
    expect(result).toContain("HIGH PRIORITY")
  })

  it("should include custom skill names in CRITICAL warning", () => {
    //#given: custom skills installed
    const allSkills = [...builtinSkills, ...customUserSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: should mention custom skills by name in the warning
    expect(result).toContain('"react-19"')
    expect(result).toContain('"tailwind-4"')
    expect(result).toContain("CRITICAL")
  })

  it("should show source column for custom skills (user vs project)", () => {
    //#given: both user and project custom skills
    const allSkills = [...builtinSkills, ...customUserSkills, ...customProjectSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: should show source for each custom skill
    expect(result).toContain("| user |")
    expect(result).toContain("| project |")
  })

  it("should not show custom skill section when only builtin skills exist", () => {
    //#given: only builtin skills
    const allSkills = [...builtinSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: should not contain custom skill emphasis
    expect(result).not.toContain("User-Installed Skills")
    expect(result).not.toContain("HIGH PRIORITY")
    expect(result).toContain("Available Skills")
  })

  it("should handle only custom skills (no builtins)", () => {
    //#given: only custom skills, no builtins
    const allSkills = [...customUserSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: should show custom skills with emphasis, no builtin section
    expect(result).toContain("User-Installed Skills")
    expect(result).toContain("HIGH PRIORITY")
    expect(result).not.toContain("Built-in Skills")
  })

  it("should include priority note for custom skills in evaluation step", () => {
    //#given: custom skills present
    const allSkills = [...builtinSkills, ...customUserSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: evaluation section should mention user-installed priority
    expect(result).toContain("User-installed skills get PRIORITY")
    expect(result).toContain("INCLUDE it rather than omit it")
  })

  it("should NOT include priority note when no custom skills", () => {
    //#given: only builtin skills
    const allSkills = [...builtinSkills]

    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide(categories, allSkills)

    //#then: no priority note for custom skills
    expect(result).not.toContain("User-installed skills get PRIORITY")
  })

  it("should return empty string when no categories and no skills", () => {
    //#given: no categories and no skills
    //#when: building the delegation guide
    const result = buildCategorySkillsDelegationGuide([], [])

    //#then: should return empty string
    expect(result).toBe("")
  })
})

describe("buildUltraworkSection", () => {
  const agents: AvailableAgent[] = []

  it("should separate builtin and custom skills", () => {
    //#given: mix of builtin and custom skills
    const skills: AvailableSkill[] = [
      { name: "playwright", description: "Browser automation", location: "plugin" },
      { name: "react-19", description: "React 19 patterns", location: "user" },
    ]

    //#when: building ultrawork section
    const result = buildUltraworkSection(agents, [], skills)

    //#then: should have separate sections
    expect(result).toContain("Built-in Skills")
    expect(result).toContain("User-Installed Skills")
    expect(result).toContain("HIGH PRIORITY")
  })

  it("should not separate when only builtin skills", () => {
    //#given: only builtin skills
    const skills: AvailableSkill[] = [
      { name: "playwright", description: "Browser automation", location: "plugin" },
    ]

    //#when: building ultrawork section
    const result = buildUltraworkSection(agents, [], skills)

    //#then: should have single section
    expect(result).toContain("Built-in Skills")
    expect(result).not.toContain("User-Installed Skills")
  })
})

describe("formatCustomSkillsBlock", () => {
  const customSkills: AvailableSkill[] = [
    { name: "react-19", description: "React 19 patterns", location: "user" },
    { name: "tailwind-4", description: "Tailwind v4", location: "project" },
  ]

  const customRows = customSkills.map((s) => {
    const source = s.location === "project" ? "project" : "user"
    return `| \`${s.name}\` | ${s.description} | ${source} |`
  })

  it("should produce consistent output used by both builders", () => {
    //#given: custom skills and rows
    //#when: formatting with default header level
    const result = formatCustomSkillsBlock(customRows, customSkills)

    //#then: contains all expected elements
    expect(result).toContain("User-Installed Skills (HIGH PRIORITY)")
    expect(result).toContain("CRITICAL")
    expect(result).toContain('"react-19"')
    expect(result).toContain('"tailwind-4"')
    expect(result).toContain("| user |")
    expect(result).toContain("| project |")
  })

  it("should use #### header by default", () => {
    //#given: default header level
    const result = formatCustomSkillsBlock(customRows, customSkills)

    //#then: uses markdown h4
    expect(result).toContain("#### User-Installed Skills")
  })

  it("should use bold header when specified", () => {
    //#given: bold header level (used by Atlas)
    const result = formatCustomSkillsBlock(customRows, customSkills, "**")

    //#then: uses bold instead of h4
    expect(result).toContain("**User-Installed Skills (HIGH PRIORITY):**")
    expect(result).not.toContain("#### User-Installed Skills")
  })
})
