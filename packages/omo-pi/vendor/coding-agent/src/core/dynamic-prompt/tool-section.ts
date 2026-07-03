import type { AvailableTool } from "./types.ts";

const CATEGORY_ORDER = ["search", "other", "session", "command"] as const;

const CATEGORY_LABELS: Record<AvailableTool["category"], string> = {
	search: "Search",
	other: "Core Tools",
	session: "Session",
	command: "Commands",
};

export function buildToolSection(options: {
	tools: AvailableTool[];
	toolSnippets: Record<string, string>;
	promptGuidelines?: string[];
}): string {
	const groupedTools = new Map<AvailableTool["category"], Array<{ name: string; snippet: string }>>();

	for (const tool of options.tools) {
		const snippet = options.toolSnippets[tool.name]?.trim();
		if (!snippet) {
			continue;
		}

		const existingTools = groupedTools.get(tool.category) ?? [];
		existingTools.push({ name: tool.name, snippet });
		groupedTools.set(tool.category, existingTools);
	}

	const lines = ["## Available Tools", ""];
	let hasVisibleTools = false;

	for (const category of CATEGORY_ORDER) {
		const categoryTools = groupedTools.get(category);
		if (!categoryTools || categoryTools.length === 0) {
			continue;
		}

		hasVisibleTools = true;
		lines.push(`### ${CATEGORY_LABELS[category]}`);
		for (const tool of categoryTools) {
			lines.push(`- ${tool.name}: ${tool.snippet}`);
		}
		lines.push("");
	}

	if (!hasVisibleTools) {
		lines.push("(none)", "");
	}

	const guidelines = options.promptGuidelines?.map((guideline) => guideline.trim()).filter((guideline) => guideline);
	if (guidelines && guidelines.length > 0) {
		lines.push("## Tool Guidelines", "");
		for (const guideline of guidelines) {
			lines.push(`- ${guideline}`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}
