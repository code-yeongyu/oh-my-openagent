import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fingerprintDynamicTargets } from "../src/dynamic-target-fingerprints.js";
import { defaultConfig } from "@oh-my-opencode/rules-engine/engine";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules dynamic target fingerprints", () => {
	it("#given auto source mode #when an excluded source file changes #then cache key stays stable", () => {
		// given
		const { cwd, targetPath } = makeProjectWithDefaultSources();
		const config = defaultConfig();

		// when
		const initial = fingerprintDynamicTargets(cwd, [targetPath], config);
		writeFileSync(
			path.join(cwd, "AGENTS.md"),
			[
				"Always use the exact code style.",
				"Updated guidance.",
				"",
				"This file should be excluded from auto mode.",
			].join("\n"),
		);
		const afterChange = fingerprintDynamicTargets(cwd, [targetPath], config);
		writeFileSync(
			path.join(cwd, ".github", "instructions", "workflow.md"),
			["---", "description: Workflow rules", 'globs: ["**/*.ts"]', "---", "Prefer explicit return types."].join(
				"\n",
			),
		);
		const afterEnabledChange = fingerprintDynamicTargets(cwd, [targetPath], config);
		const initialFingerprint = initial[0]?.fingerprint;

		// then
		expect(afterChange).toHaveLength(1);
		expect(afterEnabledChange).toHaveLength(1);
		expect(initialFingerprint).toBeDefined();
		expect(afterChange[0]?.fingerprint).toBe(initialFingerprint);
		expect(afterEnabledChange[0]?.fingerprint).not.toBe(initialFingerprint);
	});
});

function makeProjectWithDefaultSources(): { cwd: string; targetPath: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-fingerprint-"));
	const projectRoot = path.join(root, "repo");
	const instructionPath = path.join(projectRoot, ".github", "instructions");
	const targetPath = path.join(projectRoot, "src", "app.ts");
	tempDirectories.push(root);

	mkdirSync(instructionPath, { recursive: true });
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(path.join(projectRoot, "package.json"), "{}");
	writeFileSync(path.join(projectRoot, "AGENTS.md"), "Default project AGENTS file.");
	writeFileSync(path.join(projectRoot, ".github", "copilot-instructions.md"), "Legacy copilot instruction");
	writeFileSync(
		path.join(instructionPath, "workflow.md"),
		["---", "description: Workflow rules", 'globs: ["**/*.ts"]', "---", "Keep async/await explicit."].join("\n"),
	);
	writeFileSync(targetPath, "export const answer = 42;\n");
	return { cwd: projectRoot, targetPath };
}
