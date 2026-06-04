import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostToolUseInput,
	type CodexSessionStartInput,
	runPostToolUseHook,
	runSessionStartHook,
} from "../src/codex-hook.js";

const REMOVED_AGENT_DOC_SOURCE_LISTS = ["AGENTS.md", "CLAUDE.md", "AGENTS.md,CLAUDE.md"] as const;

const tempDirectories: string[] = [];

type AgentDocProject = {
	readonly pluginData: string;
	readonly root: string;
	readonly nestedSourceFile: string;
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeAgentDocProject(): AgentDocProject {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-agent-docs-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-agent-docs-data-"));
	tempDirectories.push(root, pluginData);

	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), "Root AGENTS.md must remain Codex-native.");
	writeFileSync(path.join(root, "CLAUDE.md"), "Root CLAUDE.md must stay outside rules hook context.");
	writeFileSync(path.join(root, "CONTEXT.md"), "Context source must not leak through removed-only allowlists.");

	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		[
			"---",
			"description: TypeScript",
			'globs: ["**/*.ts"]',
			"---",
			"",
			"Dynamic .omo/rules context must not leak through removed-only allowlists.",
		].join("\n"),
	);

	const nestedDirectory = path.join(root, "child", "src");
	mkdirSync(nestedDirectory, { recursive: true });
	writeFileSync(path.join(root, "child", "AGENTS.md"), "Child AGENTS.md must remain Codex-native.");
	const nestedSourceFile = path.join(nestedDirectory, "app.ts");
	writeFileSync(nestedSourceFile, "export const app = true;\n");

	return { root, pluginData, nestedSourceFile };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function postToolUseInput(root: string, filePath: string): CodexPostToolUseInput {
	return {
		session_id: "session-1",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		tool_name: "mcp__filesystem__read_file",
		tool_input: { path: filePath },
		tool_response: { text: "file contents" },
		tool_use_id: "call-1",
	};
}

describe("agent doc sources", () => {
	for (const sourceList of REMOVED_AGENT_DOC_SOURCE_LISTS) {
		it(`#given ${sourceList} removed-only source allowlist #when SessionStart runs #then it emits no OMO rules context`, async () => {
			// given
			const { root, pluginData } = makeAgentDocProject();

			// when
			const output = await runSessionStartHook(sessionStartInput(root), {
				pluginDataRoot: pluginData,
				env: { CODEX_RULES_ENABLED_SOURCES: sourceList },
			});

			// then
			expect(output).toBe("");
		});
	}

	it("#given nested AGENTS.md and removed-only source allowlist #when PostToolUse targets a child file #then it emits no dynamic OMO rules context", async () => {
		// given
		const { root, pluginData, nestedSourceFile } = makeAgentDocProject();

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, nestedSourceFile), {
			pluginDataRoot: pluginData,
			env: { CODEX_RULES_ENABLED_SOURCES: "AGENTS.md,CLAUDE.md" },
		});

		// then
		expect(output).toBe("");
	});
});
