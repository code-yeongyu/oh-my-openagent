/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createSkillAutoTriggerHook, extractKeywordsFromDescription, findMatchingTriggers } from "./index"
import * as skillLoader from "../../features/opencode-skill-loader/skill-content"
import type { SkillTrigger } from "./types"

describe("extractKeywordsFromDescription", () => {
  test("returns null for empty description", () => {
    //#given
    const description = ""

    //#when
    const regex = extractKeywordsFromDescription(description)

    //#then
    expect(regex).toBeNull()
  })

  test("extracts keywords and returns a RegExp", () => {
    //#given
    const description = "(opencode - Skill) Use when debugging errors"

    //#when
    const regex = extractKeywordsFromDescription(description)

    //#then
    expect(regex).toBeInstanceOf(RegExp)
    expect(regex!.test("Debugging errors happened")).toBe(true)
    expect(regex!.test("No match here")).toBe(false)
  })
})

describe("findMatchingTriggers", () => {
  test("filters triggers by keyword match", () => {
    //#given
    const triggers: SkillTrigger[] = [
      {
        skillName: "debug-skill",
        description: "Use when debugging errors",
        keywords: extractKeywordsFromDescription("Use when debugging errors")!,
        priority: 10,
        scope: "user",
      },
      {
        skillName: "lint-skill",
        description: "Use when linting",
        keywords: extractKeywordsFromDescription("Use when linting")!,
        priority: 5,
        scope: "user",
      },
    ]

    //#when
    const matches = findMatchingTriggers("debugging errors occurred", triggers)

    //#then
    expect(matches).toHaveLength(1)
    expect(matches[0].skillName).toBe("debug-skill")
  })

  test("returns empty array for empty text", () => {
    //#given
    const triggers: SkillTrigger[] = [
      {
        skillName: "debug-skill",
        description: "Use when debugging errors",
        keywords: extractKeywordsFromDescription("Use when debugging errors")!,
        priority: 10,
        scope: "user",
      },
    ]

    //#when
    const matches = findMatchingTriggers("", triggers)

    //#then
    expect(matches).toHaveLength(0)
  })
})

describe("createSkillAutoTriggerHook", () => {
  let getAllSkillsSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    getAllSkillsSpy = spyOn(skillLoader, "getAllSkills").mockResolvedValue([
      {
        name: "builtin-audit",
        scope: "builtin",
        definition: {
          description: "Use when audit security issues",
        },
      },
      {
        name: "user-audit",
        scope: "user",
        definition: {
          description: "Use when audit performance metrics",
        },
      },
    ] as any)
  })

  afterEach(() => {
    getAllSkillsSpy?.mockRestore()
  })

  test("injects top matching skill suggestion into output parts", async () => {
    //#given
    const hook = createSkillAutoTriggerHook({} as any)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "Please audit the system" }],
    }

    //#when
    await hook["chat.message"]({ sessionID: "test-session" }, output)

    //#then
    const textPart = output.parts[0]
    expect(textPart.text).toContain("[skill-available]")
    expect(textPart.text).toContain("`builtin-audit`")
    expect(textPart.text).toContain("skill(\"builtin-audit\")")
    expect(textPart.text).toContain("Please audit the system")
  })
})
