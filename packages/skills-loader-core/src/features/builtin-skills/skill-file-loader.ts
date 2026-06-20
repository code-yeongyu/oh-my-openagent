import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { parseFrontmatter } from "@oh-my-opencode/utils"

type SkillFileReader = (path: string, encoding: "utf8") => string

export function getSharedSkillSourceDir(skillName: string): string {
	return join(sharedSkillsRootPath(), skillName)
}

export function getBuiltinSkillSourceDir(skillName: string): string {
	const moduleDir = dirname(fileURLToPath(import.meta.url))
	const sourceDir = join(moduleDir, skillName)
	if (moduleDir.endsWith(join("src", "features", "builtin-skills")) || existsSync(sourceDir)) return sourceDir
	return join(dirname(sharedSkillsRootPath()), "builtin-skills", skillName)
}

export function createSharedSkillTemplateLoader(
	readFile: SkillFileReader = readFileSync,
	skillsRootPath: string = sharedSkillsRootPath(),
): (skillName: string) => string {
	const cache = new Map<string, string>()
	return (skillName) => {
		const cached = cache.get(skillName)
		if (cached !== undefined) return cached
		try {
			const { body } = parseFrontmatter(readFile(join(skillsRootPath, skillName, "SKILL.md"), "utf8"))
			cache.set(skillName, body)
			return body
		} catch (error) {
			if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) {
				throw error
			}
			throw error
		}
	}
}
const loadSharedSkillTemplateFromDisk = createSharedSkillTemplateLoader()
export function loadSharedSkillTemplate(skillName: string): string {
	return loadSharedSkillTemplateFromDisk(skillName)
}
