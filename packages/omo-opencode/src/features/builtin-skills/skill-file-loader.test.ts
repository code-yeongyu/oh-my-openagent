/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { normalize } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { createBuiltinSkills } from "./skills"
import { createSharedSkillTemplateLoader, loadSharedSkillTemplate } from "./skill-file-loader"

declare const Bun: {
  file(path: string): { text(): Promise<string> }
}

const SHARED_BUILTIN_SKILLS = ["remove-ai-slops", "review-work", "frontend", "init-deep", "debugging"] as const

describe("shared builtin skill file loader", () => {
  test("#given extracted shared skill files #when builtin skills are created #then templates load from SKILL.md bodies", async () => {
    // given
    const skills = createBuiltinSkills()

    // when
    const skillTemplates = new Map(skills.map((skill) => [skill.name, skill.template]))

    // then
    for (const skillName of SHARED_BUILTIN_SKILLS) {
      const content = await Bun.file(`packages/shared-skills/skills/${skillName}/SKILL.md`).text()
      const { body } = parseFrontmatter(content)
      expect(skillTemplates.get(skillName)).toBe(body)
      expect(loadSharedSkillTemplate(skillName)).toBe(body)
    }
  })

  test("#given repeated loads #when using the same loader #then it reads each shared skill file once", () => {
    // given
    const reads: string[] = []
    const loader = createSharedSkillTemplateLoader((path) => {
      reads.push(path)
      return "---\nname: cached\n---\nCached body"
    })

    // when
    const first = loader("cached-skill")
    const second = loader("cached-skill")

    // then
    expect(first).toBe("Cached body")
    expect(second).toBe("Cached body")
    expect(reads).toHaveLength(1)
  })

  test("#given shared skills root #when loading shared skill templates #then the package root path resolves", () => {
    // given
    const expectedContent = "---\nname: layout\n---\nLayout body"
    const createMissingFileError = (): Error => {
      const error = new Error("ENOENT missing SKILL.md")
      Object.defineProperty(error, "code", { value: "ENOENT" })
      return error
    }
    const readFile = (path: string): string => {
      if (normalize(path).endsWith(normalize("/shared-skills/skills/layout/SKILL.md"))) {
        return expectedContent
      }
      throw createMissingFileError()
    }

    // when
    const loader = createSharedSkillTemplateLoader(readFile, "/workspace/packages/shared-skills/skills")

    // then
    expect(loader("layout")).toBe("Layout body")
  })

  test("#given a missing shared skill file #when loading the template #then the loader fails fast", () => {
    // given
    const loader = createSharedSkillTemplateLoader(() => {
      throw new Error("ENOENT missing SKILL.md")
    })

    expect(() => loader("__missing__")).toThrow("ENOENT missing SKILL.md")
  })
})
