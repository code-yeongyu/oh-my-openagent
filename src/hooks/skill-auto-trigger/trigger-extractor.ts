import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
import { hashDescription } from "./cache-checker";
import { mergeFallbackTriggers } from "./trigger-fallbacks";
import type { CachedSkillTrigger } from "./types";
import { SCOPE_PRIORITY } from "./types";

const BATCH_SIZE = 15;

export function buildExtractionPrompt(skills: LoadedSkill[]): string {
	const skillList = skills
		.map((skill, i) => {
			const desc = skill.definition?.description || "";
			return `${i + 1}. ${skill.name}: "${desc.slice(0, 200)}"`;
		})
		.join("\n");

	return `Extract trigger keywords. Return 3-8 keywords per skill.
Include both English and Simplified Chinese keywords when possible.
If the description already contains other languages (e.g. Japanese/Korean), keep 1-2 keywords in that language.
Output ONLY valid JSON: {"skill-name": ["keyword1", ...], ...}

Skills:
${skillList}`;
}

export function parseAIResponse(response: string): Record<string, string[]> {
	try {
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return {};
		const parsed = JSON.parse(jsonMatch[0]);
		if (typeof parsed !== "object" || parsed === null) return {};
		const result: Record<string, string[]> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
				const cleaned = (value as string[])
					.map((item) => item.trim())
					.filter((item) => item.length > 0);
				const unique = [...new Set(cleaned)];
				if (unique.length > 0) {
					result[key] = unique;
				}
			}
		}
		return result;
	} catch {
		return {};
	}
}

export function buildCachedTriggers(
	skills: LoadedSkill[],
	extractedTriggers: Record<string, string[]>,
): Record<string, CachedSkillTrigger> {
	const result: Record<string, CachedSkillTrigger> = {};
	for (const skill of skills) {
		const description = skill.definition?.description;
		if (!description) continue;
		const triggers = mergeFallbackTriggers(
			skill.name,
			extractedTriggers[skill.name] ?? [],
		);
		if (triggers.length === 0) continue;
		const scope = skill.scope as
			| "builtin"
			| "opencode-project"
			| "opencode"
			| "user"
			| "project"
			| "config";
		result[skill.name] = {
			hash: hashDescription(description),
			triggers,
			priority: SCOPE_PRIORITY[scope] ?? 0,
			scope,
		};
	}
	return result;
}

export function batchSkills(skills: LoadedSkill[]): LoadedSkill[][] {
	const batches: LoadedSkill[][] = [];
	for (let i = 0; i < skills.length; i += BATCH_SIZE) {
		batches.push(skills.slice(i, i + BATCH_SIZE));
	}
	return batches;
}

export { BATCH_SIZE };
