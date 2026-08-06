/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import type { BuiltinSkill } from "./types"

declare const Bun: {
  file(path: string): { text(): Promise<string> }
}

const TARGET_SKILLS = ["remove-ai-slops", "review-work", "frontend", "init-deep", "debugging"] as const

type TargetSkill = (typeof TARGET_SKILLS)[number]

type SkillSource = {
  readonly name: TargetSkill
  readonly description: string
  readonly template: string
}

function getRequiredMatch(source: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = source.match(pattern)
  if (!match) {
    throw new Error(`missing ${label}`)
  }
  return match
}

async function readSkillSource(name: TargetSkill): Promise<SkillSource> {
  let skill: BuiltinSkill
  switch (name) {
    case "remove-ai-slops":
      skill = (await import("./skills/remove-ai-slops")).removeAiSlopsSkill
      break
    case "review-work":
      skill = (await import("./skills/review-work")).reviewWorkSkill
      break
		case "frontend":
			skill = (await import("./skills/frontend")).frontendSkill
			break
		case "init-deep":
			skill = (await import("./skills/init-deep")).initDeepSkill
			break
		case "debugging":
			skill = (await import("./skills/debugging")).debuggingSkill
			break
	}
  return { name, description: skill.description, template: skill.template }
}

async function readSharedSkill(name: TargetSkill): Promise<{ readonly frontmatter: string; readonly body: string }> {
  const content = await Bun.file(`packages/shared-skills/skills/${name}/SKILL.md`).text()
  const match = getRequiredMatch(content, /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/, `${name} frontmatter`)
  return { frontmatter: match[1], body: match[2] }
}

describe("shared builtin skill extraction", () => {
  test("#given extracted builtin skill markdown #when compared to TS sources #then bodies and metadata stay byte-equivalent", async () => {
    // given
    const sources = await Promise.all(TARGET_SKILLS.map(readSkillSource))

    // when
    const sharedSkills = await Promise.all(TARGET_SKILLS.map(readSharedSkill))

    // then
    for (const [index, source] of sources.entries()) {
      const sharedSkill = sharedSkills[index]
      expect(sharedSkill.frontmatter).toContain(`name: ${source.name}`)
      expect(sharedSkill.frontmatter).toContain(`description: ${JSON.stringify(source.description)}`)
      expect(sharedSkill.body).toBe(source.template)
    }
  })
})
