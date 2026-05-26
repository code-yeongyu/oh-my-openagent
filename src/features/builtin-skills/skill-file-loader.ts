import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"

type SkillFileReader = (path: string, encoding: "utf8") => string

export function createSharedSkillTemplateLoader(readFile: SkillFileReader = readFileSync): (skillName: string) => string {
	const cache = new Map<string, string>()

	return (skillName) => {
		const cached = cache.get(skillName)
		if (cached !== undefined) {
			return cached
		}

		const skillPath = join(import.meta.dir, "..", "..", "..", "packages", "shared-skills", "skills", skillName, "SKILL.md")
		const content = readFile(skillPath, "utf8")
		const { body } = parseFrontmatter(content)
		cache.set(skillName, body)
		return body
	}
}

const loadSharedSkillTemplateFromDisk = createSharedSkillTemplateLoader()

export function loadSharedSkillTemplate(skillName: string): string {
	return loadSharedSkillTemplateFromDisk(skillName)
}
