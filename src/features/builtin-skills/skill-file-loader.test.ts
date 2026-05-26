import { describe, expect, test } from "bun:test"
import { parseFrontmatter } from "../../shared/frontmatter"
import { createBuiltinSkills } from "./skills"
import { createSharedSkillTemplateLoader, loadSharedSkillTemplate } from "./skill-file-loader"

const SHARED_BUILTIN_SKILLS = ["ai-slop-remover", "review-work", "frontend-ui-ux"] as const

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

  test("#given a missing shared skill file #when loading the template #then the loader fails fast", () => {
    // given
    const loader = createSharedSkillTemplateLoader(() => {
      throw new Error("ENOENT missing SKILL.md")
    })

    expect(() => loader("__missing__")).toThrow("ENOENT missing SKILL.md")
  })
})
