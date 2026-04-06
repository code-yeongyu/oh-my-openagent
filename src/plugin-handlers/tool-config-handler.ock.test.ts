import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OhMyOpenCodeConfig } from "../config";
import { applyToolConfig } from "./tool-config-handler";

const GIT_BIN = "/usr/bin/git";

function createOckProjectRoot(): string {
	const projectRoot = mkdtempSync(join(tmpdir(), "tool-config-handler-ock-"));
	execFileSync(GIT_BIN, ["init"], {
		cwd: projectRoot,
		stdio: ["ignore", "ignore", "ignore"],
	});
	mkdirSync(join(projectRoot, ".beads"), { recursive: true });
	const commandDirectory = join(projectRoot, ".opencode", "command");

	for (const commandName of ["create", "research", "start", "plan"]) {
		mkdirSync(commandDirectory, { recursive: true });
		writeFileSync(
			join(commandDirectory, `${commandName}.md`),
			`# ${commandName}\n`,
			"utf-8",
		);
	}

	return projectRoot;
}

function createParams(directory: string) {
	const agentResult: Record<string, { permission?: Record<string, unknown> }> =
		{};
	for (const agent of [
		"atlas",
		"sisyphus",
		"hephaestus",
		"prometheus",
		"sisyphus-junior",
	]) {
		agentResult[agent] = { permission: {} };
	}

	return {
		config: { tools: {}, permission: {} } as Record<string, unknown>,
		pluginConfig: {
			experimental: { task_system: true },
		} as OhMyOpenCodeConfig,
		agentResult: agentResult as Record<string, unknown>,
		directory,
	};
}

describe("applyToolConfig in OCK repos", () => {
	it("does not deny todo tools in OCK repos even when task_system is enabled", () => {
		const projectRoot = createOckProjectRoot();

		try {
			const params = createParams(projectRoot);

			applyToolConfig(params);

			const tools = params.config.tools as Record<string, unknown>;
			expect(tools.todowrite).toBeUndefined();
			expect(tools.todoread).toBeUndefined();

			for (const agentName of [
				"atlas",
				"sisyphus",
				"hephaestus",
				"prometheus",
				"sisyphus-junior",
			]) {
				const agent = params.agentResult[agentName] as {
					permission: Record<string, unknown>;
				};
				expect(agent.permission.todowrite).toBeUndefined();
				expect(agent.permission.todoread).toBeUndefined();
			}
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});
