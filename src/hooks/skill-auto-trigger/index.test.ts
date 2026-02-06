/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createSkillAutoTriggerHook, extractKeywordsFromDescription, findMatchingTriggers } from "./index"
import * as skillLoader from "../../features/opencode-skill-loader/skill-content"
import type { SkillTrigger } from "./types"
import { checkForUpdates, hashDescription } from "./cache-checker"
import { buildExtractionPrompt, parseAIResponse, buildCachedTriggers, batchSkills } from "./trigger-extractor"
import { EMPTY_CACHE, type SkillTriggerCache, type CachedSkillTrigger } from "./types"
import { triggerBackgroundExtraction } from "./ai-extractor"

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

describe("hashDescription", () => {
  test("returns consistent hash for same input", () => {
    //#given
    const description = "test description"

    //#when
    const hash1 = hashDescription(description)
    const hash2 = hashDescription(description)

    //#then
    expect(hash1).toBe(hash2)
  })

  test("returns different hash for different input", () => {
    //#given
    const desc1 = "description one"
    const desc2 = "description two"

    //#when
    const hash1 = hashDescription(desc1)
    const hash2 = hashDescription(desc2)

    //#then
    expect(hash1).not.toBe(hash2)
  })

  test("returns string hash", () => {
    //#given
    const description = "any description"

    //#when
    const hash = hashDescription(description)

    //#then
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
  })
})

describe("checkForUpdates", () => {
  test("detects new skills", () => {
    //#given
    const cache: SkillTriggerCache = { ...EMPTY_CACHE }
    const skills = [{ name: "new-skill", scope: "user", definition: { description: "New skill" } }]

    //#when
    const result = checkForUpdates(cache, skills as any)

    //#then
    expect(result.newSkills).toHaveLength(1)
    expect(result.hasUpdates).toBe(true)
  })

  test("detects changed skills", () => {
    //#given
    const cache: SkillTriggerCache = {
      version: "1.0",
      generatedAt: "",
      skills: { "test-skill": { hash: "oldhash", triggers: ["test"], priority: 10, scope: "user" } }
    }
    const skills = [{ name: "test-skill", scope: "user", definition: { description: "Changed description" } }]

    //#when
    const result = checkForUpdates(cache, skills as any)

    //#then
    expect(result.changedSkills).toHaveLength(1)
    expect(result.hasUpdates).toBe(true)
  })

  test("returns no updates when cache matches", () => {
    //#given
    const description = "Same description"
    const hash = hashDescription(description)
    const cache: SkillTriggerCache = {
      version: "1.0",
      generatedAt: "",
      skills: { "test-skill": { hash, triggers: ["test"], priority: 10, scope: "user" } }
    }
    const skills = [{ name: "test-skill", scope: "user", definition: { description } }]

    //#when
    const result = checkForUpdates(cache, skills as any)

    //#then
    expect(result.hasUpdates).toBe(false)
  })

  test("detects deleted skills", () => {
    //#given
    const cache: SkillTriggerCache = {
      version: "1.0",
      generatedAt: "",
      skills: { "deleted-skill": { hash: "somehash", triggers: ["delete"], priority: 10, scope: "user" } }
    }
    const skills: any[] = []

    //#when
    const result = checkForUpdates(cache, skills)

    //#then
    expect(result.deletedSkills).toHaveLength(1)
    expect(result.deletedSkills[0]).toBe("deleted-skill")
    expect(result.hasUpdates).toBe(true)
  })

  test("skips skills without description", () => {
    //#given
    const cache: SkillTriggerCache = { ...EMPTY_CACHE }
    const skills = [{ name: "no-desc-skill", scope: "user", definition: {} }]

    //#when
    const result = checkForUpdates(cache, skills as any)

    //#then
    expect(result.newSkills).toHaveLength(0)
    expect(result.hasUpdates).toBe(false)
  })
})

describe("parseAIResponse", () => {
  test("parses valid JSON response", () => {
    //#given
    const response = '{"skill-a": ["debug", "error"], "skill-b": ["test"]}'

    //#when
    const result = parseAIResponse(response)

    //#then
    expect(result["skill-a"]).toEqual(["debug", "error"])
    expect(result["skill-b"]).toEqual(["test"])
  })

  test("extracts JSON from markdown code block", () => {
    //#given
    const response = '```json\n{"skill-a": ["debug"]}\n```'

    //#when
    const result = parseAIResponse(response)

    //#then
    expect(result["skill-a"]).toEqual(["debug"])
  })

  test("returns empty object for invalid JSON", () => {
    //#given
    const response = "not json at all"

    //#when
    const result = parseAIResponse(response)

    //#then
    expect(result).toEqual({})
  })

  test("handles JSON with surrounding text", () => {
    //#given
    const response = 'Here is the result: {"skill-x": ["keyword"]} hope it helps!'

    //#when
    const result = parseAIResponse(response)

    //#then
    expect(result["skill-x"]).toEqual(["keyword"])
  })

  test("filters out non-array values", () => {
    //#given
    const response = '{"valid": ["a", "b"], "invalid": "string", "also-invalid": 123}'

    //#when
    const result = parseAIResponse(response)

    //#then
    expect(result["valid"]).toEqual(["a", "b"])
    expect(result["invalid"]).toBeUndefined()
    expect(result["also-invalid"]).toBeUndefined()
  })
})

describe("batchSkills", () => {
  test("batches skills into groups of 15", () => {
    //#given
    const skills = Array.from({ length: 32 }, (_, i) => ({ name: `skill-${i}` }))

    //#when
    const batches = batchSkills(skills as any)

    //#then
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(15)
    expect(batches[1]).toHaveLength(15)
    expect(batches[2]).toHaveLength(2)
  })

  test("returns single batch for small skill count", () => {
    //#given
    const skills = Array.from({ length: 5 }, (_, i) => ({ name: `skill-${i}` }))

    //#when
    const batches = batchSkills(skills as any)

    //#then
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(5)
  })

  test("returns empty array for empty input", () => {
    //#given
    const skills: any[] = []

    //#when
    const batches = batchSkills(skills)

    //#then
    expect(batches).toHaveLength(0)
  })

  test("handles exactly 15 skills", () => {
    //#given
    const skills = Array.from({ length: 15 }, (_, i) => ({ name: `skill-${i}` }))

    //#when
    const batches = batchSkills(skills as any)

    //#then
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(15)
  })
})

describe("buildExtractionPrompt", () => {
  test("builds prompt with skill list", () => {
    //#given
    const skills = [
      { name: "debug-skill", definition: { description: "Use for debugging" } },
      { name: "test-skill", definition: { description: "Use for testing" } }
    ]

    //#when
    const prompt = buildExtractionPrompt(skills as any)

    //#then
    expect(prompt).toContain("debug-skill")
    expect(prompt).toContain("test-skill")
    expect(prompt).toContain("Use for debugging")
    expect(prompt).toContain("Use for testing")
    expect(prompt).toContain("Extract trigger keywords")
  })

  test("truncates long descriptions to 200 chars", () => {
    //#given
    const longDesc = "x".repeat(300)
    const skills = [{ name: "long-skill", definition: { description: longDesc } }]

    //#when
    const prompt = buildExtractionPrompt(skills as any)

    //#then
    expect(prompt).not.toContain("x".repeat(300))
    expect(prompt).toContain("x".repeat(200))
  })

  test("handles skills without description", () => {
    //#given
    const skills = [{ name: "no-desc", definition: {} }]

    //#when
    const prompt = buildExtractionPrompt(skills as any)

    //#then
    expect(prompt).toContain("no-desc")
  })
})

describe("buildCachedTriggers", () => {
  test("builds cached triggers from skills and extracted data", () => {
    //#given
    const skills = [
      { name: "skill-a", scope: "user", definition: { description: "Skill A description" } },
      { name: "skill-b", scope: "builtin", definition: { description: "Skill B description" } }
    ]
    const extractedTriggers = {
      "skill-a": ["debug", "error"],
      "skill-b": ["build", "compile"]
    }

    //#when
    const result = buildCachedTriggers(skills as any, extractedTriggers)

    //#then
    expect(result["skill-a"]).toBeDefined()
    expect(result["skill-a"].triggers).toEqual(["debug", "error"])
    expect(result["skill-a"].scope).toBe("user")
    expect(result["skill-b"]).toBeDefined()
    expect(result["skill-b"].triggers).toEqual(["build", "compile"])
    expect(result["skill-b"].scope).toBe("builtin")
  })

  test("skips skills without description", () => {
    //#given
    const skills = [{ name: "no-desc", scope: "user", definition: {} }]
    const extractedTriggers = { "no-desc": ["trigger"] }

    //#when
    const result = buildCachedTriggers(skills as any, extractedTriggers)

    //#then
    expect(result["no-desc"]).toBeUndefined()
  })

  test("skips skills without extracted triggers", () => {
    //#given
    const skills = [{ name: "no-triggers", scope: "user", definition: { description: "Has description" } }]
    const extractedTriggers = {}

    //#when
    const result = buildCachedTriggers(skills as any, extractedTriggers)

    //#then
    expect(result["no-triggers"]).toBeUndefined()
  })

  test("includes hash for change detection", () => {
    //#given
    const description = "Test description"
    const skills = [{ name: "test", scope: "user", definition: { description } }]
    const extractedTriggers = { "test": ["keyword"] }

    //#when
    const result = buildCachedTriggers(skills as any, extractedTriggers)

    //#then
    expect(result["test"].hash).toBe(hashDescription(description))
  })
})

describe("ai-extractor", () => {
  test("triggerBackgroundExtraction is exported", () => {
    //#given
    //#when
    //#then
    expect(typeof triggerBackgroundExtraction).toBe("function")
  })
})
