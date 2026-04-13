import { homedir } from "os"
import { isAbsolute, join } from "path"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { deduplicateSkillsByName } from "./skill-deduplication"
import type { LoadedSkill } from "./types"

let storedSkillPaths: string[] = []

export function setOpencodeConfigSkillPaths(paths: string[]): void {
	storedSkillPaths = [...paths]
}

export function getOpencodeConfigSkillPaths(): string[] {
	return storedSkillPaths
}

function expandPath(raw: string, directory: string): string {
	if (raw.startsWith("~/")) {
		return join(homedir(), raw.slice(2))
	}
	if (raw === "~") {
		return homedir()
	}
	if (isAbsolute(raw)) {
		return raw
	}
	return join(directory, raw)
}

export async function discoverOpencodeConfigSkillPaths(directory?: string): Promise<LoadedSkill[]> {
	const paths = storedSkillPaths
	if (paths.length === 0) return []

	const baseDir = directory ?? process.cwd()
	const allSkills = await Promise.all(
		paths.map(async (raw) => {
			const expanded = expandPath(raw, baseDir)
			return loadSkillsFromDir({ skillsDir: expanded, scope: "config" })
		}),
	)

	return deduplicateSkillsByName(allSkills.flat())
}
