import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OhMyOpenCodeConfig } from "../config";
import * as builtinCommands from "../features/builtin-commands";
import { applyCommandConfig } from "./command-config-handler";
import type { PluginComponents } from "./plugin-components-loader";

const GIT_BIN = "/usr/bin/git";

function createPluginComponents(): PluginComponents {
	return {
		commands: {},
		skills: {},
		agents: {},
		mcpServers: {},
		hooksConfigs: [],
		plugins: [],
		errors: [],
	};
}

function createPluginConfig(): OhMyOpenCodeConfig {
	return {};
}

function createOckProjectRoot(): string {
	const projectRoot = mkdtempSync(
		join(tmpdir(), "command-config-handler-ock-"),
	);
	execFileSync(GIT_BIN, ["init"], {
		cwd: projectRoot,
		stdio: ["ignore", "ignore", "ignore"],
	});
	mkdirSync(join(projectRoot, ".beads"), { recursive: true });
	const commandDirectory = join(projectRoot, ".opencode", "command");
	mkdirSync(commandDirectory, { recursive: true });

	for (const commandName of ["create", "research", "start", "plan"]) {
		writeFileSync(
			join(commandDirectory, `${commandName}.md`),
			`# ${commandName}\n`,
			"utf-8",
		);
	}

	return projectRoot;
}

describe("applyCommandConfig in OCK repos", () => {
	const builtinCommandDefinitions = {
		"start-work": {
			name: "start-work",
			description: "builtin",
			template: "template",
		},
		"ralph-loop": {
			name: "ralph-loop",
			description: "builtin",
			template: "template",
		},
		"ulw-loop": {
			name: "ulw-loop",
			description: "builtin",
			template: "template",
		},
		"cancel-ralph": {
			name: "cancel-ralph",
			description: "builtin",
			template: "template",
		},
		"stop-continuation": {
			name: "stop-continuation",
			description: "builtin",
			template: "template",
		},
		refactor: {
			name: "refactor",
			description: "builtin",
			template: "template",
		},
	};

	let loadBuiltinCommandsSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		loadBuiltinCommandsSpy = spyOn(
			builtinCommands,
			"loadBuiltinCommands",
		).mockReturnValue({});
	});

	afterEach(() => {
		loadBuiltinCommandsSpy.mockRestore();
	});

	test("omits conflicting builtin workflow commands in OCK bead-first repos", async () => {
		const projectRoot = createOckProjectRoot();
		loadBuiltinCommandsSpy.mockReturnValue(builtinCommandDefinitions);

		try {
			const config: Record<string, unknown> = { command: {} };

			await applyCommandConfig({
				config,
				pluginConfig: createPluginConfig(),
				ctx: { directory: projectRoot },
				pluginComponents: createPluginComponents(),
			});

			const commandConfig = config.command as Record<string, unknown>;
			expect(commandConfig["start-work"]).toBeUndefined();
			expect(commandConfig["ralph-loop"]).toBeUndefined();
			expect(commandConfig["ulw-loop"]).toBeUndefined();
			expect(commandConfig["cancel-ralph"]).toBeUndefined();
			expect(commandConfig["stop-continuation"]).toBeUndefined();
			expect(commandConfig.refactor).toBeDefined();
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	test("keeps builtin workflow commands in non-OCK repos", async () => {
		const projectRoot = mkdtempSync(
			join(tmpdir(), "command-config-handler-non-ock-"),
		);
		execFileSync(GIT_BIN, ["init"], {
			cwd: projectRoot,
			stdio: ["ignore", "ignore", "ignore"],
		});
		loadBuiltinCommandsSpy.mockReturnValue(builtinCommandDefinitions);

		try {
			const config: Record<string, unknown> = { command: {} };

			await applyCommandConfig({
				config,
				pluginConfig: createPluginConfig(),
				ctx: { directory: projectRoot },
				pluginComponents: createPluginComponents(),
			});

			const commandConfig = config.command as Record<string, unknown>;
			expect(commandConfig["start-work"]).toBeDefined();
			expect(commandConfig["ralph-loop"]).toBeDefined();
			expect(commandConfig["ulw-loop"]).toBeDefined();
			expect(commandConfig["cancel-ralph"]).toBeDefined();
			expect(commandConfig["stop-continuation"]).toBeDefined();
			expect(commandConfig.refactor).toBeDefined();
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	test("keeps project-provided workflow commands even when builtin conflicts are filtered in OCK repos", async () => {
		const projectRoot = createOckProjectRoot();
		loadBuiltinCommandsSpy.mockReturnValue(builtinCommandDefinitions);

		try {
			const config: Record<string, unknown> = { command: {} };
			const pluginComponents = createPluginComponents();

			pluginComponents.commands = {
				"start-work": {
					name: "start-work",
					description: "project command",
					template: "project-template",
				},
			};

			await applyCommandConfig({
				config,
				pluginConfig: createPluginConfig(),
				ctx: { directory: projectRoot },
				pluginComponents,
			});

			const commandConfig = config.command as Record<
				string,
				{ description?: string; template?: string }
			>;
			expect(commandConfig["start-work"]?.description).toBe("project command");
			expect(commandConfig["start-work"]?.template).toBe("project-template");
			expect(commandConfig["ralph-loop"]).toBeUndefined();
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});
