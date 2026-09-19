import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { additionalContextOutput } from "../protocol/index.ts";
import { resolveProjectRoot } from "./paths.ts";

/**
 * SessionStart context injection.
 *
 * CodeBuddy loads `CODEBUDDY.md` and `.codebuddy/rules/*.md` on its own, so
 * this hook does NOT duplicate them. It contributes the two things CodeBuddy
 * cannot know: where omo keeps its durable memory for this project, and which
 * omo workflows are installed, so the model reaches for them by name.
 */
export interface SessionStartOptions {
	readonly env?: Record<string, string | undefined>;
	readonly memoryFileName?: string;
}

export const OMO_MEMORY_RELATIVE_PATH = ".codebuddy/omo-memory.md";

export function runSessionStartHook(
	payload: Record<string, unknown>,
	options: SessionStartOptions = {},
): string {
	if (payload["hook_event_name"] !== "SessionStart") return "";

	const cwd = resolveProjectRoot(
		typeof payload["cwd"] === "string" ? payload["cwd"] : undefined,
		{ env: options.env },
	);

	const sections: string[] = [];

	const memory = readMemoryBlock(cwd, options.memoryFileName ?? OMO_MEMORY_RELATIVE_PATH);
	if (memory !== null) sections.push(memory);

	const workflows = listWorkflowHints(cwd, options);
	if (workflows.length > 0) sections.push(renderWorkflowHint(workflows));

	if (sections.length === 0) return "";
	return additionalContextOutput("SessionStart", sections.join("\n\n"));
}

/**
 * The project memory file is a plain markdown file the agent owns. It is
 * injected verbatim (bounded by the protocol layer) so a fresh session starts
 * with what earlier sessions learned.
 */
export function readMemoryBlock(cwd: string, relativePath: string): string | null {
	const absolute = join(cwd, relativePath);
	if (!existsSync(absolute)) return null;
	try {
		const content = readFileSync(absolute, "utf8").trim();
		if (content.length === 0) return null;
		return ["<omo-memory>", `Project memory (${relativePath}) — update it with \`/omo:remember\` when you learn something durable.`, "", content, "</omo-memory>"].join("\n");
	} catch {
		return null;
	}
}

/** Workflows offered by this plugin, filtered to the skills actually installed. */
export function listWorkflowHints(
	cwd: string,
	options: SessionStartOptions = {},
): string[] {
	void cwd;
	void options;
	return ["ulw-plan", "ulw-execute", "ulw-loop", "ulw-research", "init-deep", "review-work"];
}

function renderWorkflowHint(workflows: readonly string[]): string {
	return [
		"<omo-workflows>",
		`The omo CodeBuddy plugin is installed. Its workflows are available as skills: ${workflows.join(", ")}.`,
		"Use them by name when the user asks for the matching workflow (for example \"ulw-plan this change\" or \"init-deep this repo\"), or through `/omo:<workflow>`.",
		"Installing the plugin also enables automatic behaviors: ultrawork mode on an `ultrawork`/`ulw` prompt, skill pointers on workflow mentions, continuation of unfinished omo work plans when a turn ends early, and comment checking after edits.",
		"</omo-workflows>",
	].join("\n");
}
