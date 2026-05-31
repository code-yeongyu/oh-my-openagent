import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CodexPostToolUseInput } from "../src/codex-hook.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function makeTempProject(ruleCount: number): { root: string; pluginData: string; targetPath: string } {
	const root = fs.mkdtempSync(path.join(tmpdir(), "codex-rules-hook-perf-project-"));
	const pluginData = fs.mkdtempSync(path.join(tmpdir(), "codex-rules-hook-perf-data-"));
	tempDirectories.push(root, pluginData);

	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	fs.mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	fs.mkdirSync(path.join(root, "src"), { recursive: true });
	const targetPath = path.join(root, "src", "app.ts");
	fs.writeFileSync(targetPath, "export const app = true;\n");

	for (let index = 0; index < ruleCount; index += 1) {
		fs.writeFileSync(
			path.join(root, ".omo", "rules", `rule-${index}.md`),
			["---", 'globs: "**/*.ts"', "---", "", `Rule ${index}`].join("\n"),
		);
	}

	return { root, pluginData, targetPath };
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

function isProjectRuleRead(filePath: unknown): boolean {
	return String(filePath).includes(`${path.sep}.omo${path.sep}rules${path.sep}`);
}

describe("codex rules hook performance", () => {
	it("#given unchanged dynamic target #when PostToolUse repeats #then rule files are not reread for fingerprinting", async () => {
		// given
		const { root, pluginData, targetPath } = makeTempProject(3);
		let ruleFileReads = 0;
		const originalReadFileSync = fs.readFileSync;
		const wrappedReadFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
			if (isProjectRuleRead(args[0])) {
				ruleFileReads += 1;
			}

			return originalReadFileSync(...args);
		}) as typeof fs.readFileSync;
		fs.readFileSync = wrappedReadFileSync;
		syncBuiltinESMExports();
		const { runPostToolUseHook } = await import("../src/codex-hook.js");

		try {
			// when
			const firstOutput = await runPostToolUseHook(postToolUseInput(root, targetPath), {
				pluginDataRoot: pluginData,
				env: { CODEX_RULES_ENABLED_SOURCES: ".omo/rules" },
			});
			const firstRunRuleFileReads = ruleFileReads;
			ruleFileReads = 0;
			const secondOutput = await runPostToolUseHook(postToolUseInput(root, targetPath), {
				pluginDataRoot: pluginData,
				env: { CODEX_RULES_ENABLED_SOURCES: ".omo/rules" },
			});

			// then
			expect(firstOutput).toContain("Rule 0");
			expect(firstRunRuleFileReads).toBe(3);
			expect(secondOutput).toBe("");
			expect(ruleFileReads).toBe(0);
		} finally {
			fs.readFileSync = originalReadFileSync;
			syncBuiltinESMExports();
		}
	});
});
