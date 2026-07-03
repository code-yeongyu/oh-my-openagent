import type { Skill } from "../skills.ts";
import { formatSkillsForPrompt } from "../skills.ts";
import { buildExplorationSection } from "./exploration.ts";
import { buildIdentitySection } from "./identity.ts";
import { buildIntentGate } from "./intent-gate.ts";
import { buildParallelToolsSection } from "./parallel-tools.ts";
import { buildPoliciesSection } from "./policies.ts";
import { buildStyleSection } from "./style.ts";
import { categorizeTools } from "./tool-categorization.ts";
import { buildToolSection } from "./tool-section.ts";
import { buildVerificationSection } from "./verification.ts";

export interface BuildDynamicSystemPromptOptions {
	cwd: string;
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	promptGuidelines: string[];
	contextFiles: Array<{ path: string; content: string }>;
	skills: Skill[];
	tuningSection?: string;
}

function buildContextFilesSection(contextFiles: Array<{ path: string; content: string }>): string {
	if (contextFiles.length === 0) {
		return "";
	}

	const lines = ["## Project Context", ""];
	for (const contextFile of contextFiles) {
		lines.push(`### ${contextFile.path}`, "", contextFile.content.trimEnd(), "");
	}
	return lines.join("\n").trimEnd();
}

export function buildDynamicSystemPrompt(options: BuildDynamicSystemPromptOptions): string {
	const promptCwd = options.cwd.replace(/\\/g, "/");
	const tools = categorizeTools(options.selectedTools);
	const date = new Date().toISOString().slice(0, 10);

	const sections = [
		buildIdentitySection(),
		"",
		buildIntentGate({ tools }),
		"",
		buildParallelToolsSection(),
		"",
		buildExplorationSection(),
		"",
		buildVerificationSection(),
		"",
		buildToolSection({
			tools,
			toolSnippets: options.toolSnippets,
			promptGuidelines: options.promptGuidelines,
		}),
		"",
		buildPoliciesSection(),
		"",
		buildStyleSection(),
	];

	const tuning = options.tuningSection?.trim();
	if (tuning) {
		sections.push("", tuning);
	}

	const contextFilesSection = buildContextFilesSection(options.contextFiles);
	if (contextFilesSection) {
		sections.push("", contextFilesSection);
	}

	const skillsSection = formatSkillsForPrompt(options.skills);
	if (skillsSection) {
		sections.push(skillsSection);
	}

	sections.push("", `Current date: ${date}`, `Current working directory: ${promptCwd}`);

	return sections.join("\n");
}
