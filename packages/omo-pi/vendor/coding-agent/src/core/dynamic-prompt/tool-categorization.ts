import type { AvailableTool } from "./types.ts";

function getToolCategory(name: string): AvailableTool["category"] {
	if (name === "grep" || name === "glob") {
		return "search";
	}
	if (name.startsWith("session_")) {
		return "session";
	}
	if (name === "skill") {
		return "command";
	}
	return "other";
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
	return toolNames.map((name) => ({ name, category: getToolCategory(name) }));
}

export function getToolsPromptDisplay(tools: AvailableTool[]): string {
	const displayNames: string[] = [];

	if (tools.some((tool) => tool.category === "search" && tool.name === "grep")) {
		displayNames.push("`grep`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "glob")) {
		displayNames.push("`glob`");
	}

	return displayNames.join(", ");
}
