import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFrontmatter } from "../../shared/frontmatter"
type SkillFileReader = (path: string, encoding: "utf8") => string
const SHARED_SKILL_PATHS = [
	["..", "packages", "shared-skills", "skills"],
	["..", "..", "..", "packages", "shared-skills", "skills"],
] as const
const moduleDir = typeof import.meta.dir === "string" ? import.meta.dir : dirname(fileURLToPath(import.meta.url))
export function createSharedSkillTemplateLoader(
	readFile: SkillFileReader = readFileSync,
	baseDir: string = moduleDir,
): (skillName: string) => string {
	const cache = new Map<string, string>()
	return (skillName) => {
		const cached = cache.get(skillName)
		if (cached !== undefined) return cached
		let missingFileError: unknown
		for (const segments of SHARED_SKILL_PATHS) {
			try {
				const { body } = parseFrontmatter(readFile(join(baseDir, ...segments, skillName, "SKILL.md"), "utf8"))
				cache.set(skillName, body)
				return body
			} catch (error) {
				if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) {
					throw error
				}
				missingFileError ??= error
			}
		}
		throw missingFileError ?? new Error(`missing shared skill template: ${skillName}`)
	}
}
const loadSharedSkillTemplateFromDisk = createSharedSkillTemplateLoader()
export function loadSharedSkillTemplate(skillName: string): string {
	return loadSharedSkillTemplateFromDisk(skillName)
}
