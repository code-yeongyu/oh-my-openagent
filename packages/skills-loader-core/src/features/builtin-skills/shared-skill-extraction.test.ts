/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import type { BuiltinSkill } from "./types"

declare const Bun: {
  file(path: string): { text(): Promise<string> }
}

const TARGET_SKILLS = ["remove-ai-slops", "review-work", "frontend", "init-deep", "debugging", "visual-qa"] as const
const CODEX_SKILL_DESCRIPTION_MAX_LENGTH = 1024

type TargetSkill = (typeof TARGET_SKILLS)[number]

type SkillSource = {
  readonly name: TargetSkill
  readonly description: string
  readonly template: string
}

type SkillFrontmatter = {
  readonly name?: unknown
  readonly description?: unknown
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
		case "visual-qa":
			skill = (await import("./skills/visual-qa")).visualQaSkill
			break
	}
  return { name, description: skill.description, template: skill.template }
}

function findSkillFiles(directory = "packages/shared-skills/skills"): string[] {
	const skillFiles: string[] = []
	for (const name of readdirSync(directory)) {
		const path = join(directory, name)
		if (statSync(path).isDirectory()) {
			skillFiles.push(...findSkillFiles(path))
		} else if (name === "SKILL.md") {
			skillFiles.push(path)
		}
	}
	return skillFiles
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

  test("#given checked-in frontend builtin skill artifact #when compared to shared source #then it stays byte-equivalent", async () => {
    const sharedSkill = await Bun.file("packages/shared-skills/skills/frontend/SKILL.md").text()
    const checkedInArtifact = await Bun.file("packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md").text()

    expect(checkedInArtifact).toBe(sharedSkill)
  })

	test("#given shared skill frontmatter #when parsed for Codex #then metadata is valid and budgeted", async () => {
		const failures: string[] = []

		for (const path of findSkillFiles()) {
			const content = await Bun.file(path).text()
			const parsed = parseFrontmatter<SkillFrontmatter>(content)
			if (!parsed.hadFrontmatter || parsed.parseError) {
				failures.push(`${path}: invalid frontmatter`)
				continue
			}
			if (typeof parsed.data.name !== "string" || parsed.data.name.length === 0) {
				failures.push(`${path}: missing name`)
			}
			if (typeof parsed.data.description !== "string" || parsed.data.description.length === 0) {
				failures.push(`${path}: missing description`)
				continue
			}
			if (parsed.data.description.length > CODEX_SKILL_DESCRIPTION_MAX_LENGTH) {
				failures.push(`${path}: description length ${parsed.data.description.length}`)
			}
		}

		expect(failures).toEqual([])
	})
})
