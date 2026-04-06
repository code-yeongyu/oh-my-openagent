import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "@opencode-ai/plugin";
import * as builtinCommands from "../features/builtin-commands";
import { createToolRegistry, trimToolsToCap } from "./tool-registry";
import type { ToolsRecord } from "./types";

const GIT_BIN = "/usr/bin/git";

const fakeTool = tool({
	description: "test tool",
	args: {},
	async execute(): Promise<string> {
		return "ok";
	},
});

const loadBuiltinCommandsSpy = spyOn(
	builtinCommands,
	"loadBuiltinCommands",
).mockReturnValue({});

const tempDirectories: string[] = [];

function createNonOckProjectRoot(): string {
	const projectRoot = mkdtempSync(join(tmpdir(), "tool-registry-non-ock-"));
	tempDirectories.push(projectRoot);
	execFileSync(GIT_BIN, ["init"], {
		cwd: projectRoot,
		stdio: ["ignore", "ignore", "ignore"],
	});
	return projectRoot;
}

afterEach(() => {
	loadBuiltinCommandsSpy.mockReset();
	loadBuiltinCommandsSpy.mockReturnValue({});
	for (const tempDirectory of tempDirectories.splice(0)) {
		rmSync(tempDirectory, { recursive: true, force: true });
	}
});

describe("#given tool trimming prioritization", () => {
	test("#when max_tools trims a hashline edit registration named edit #then edit is removed before higher-priority tools", () => {
		const filteredTools = {
			bash: fakeTool,
			edit: fakeTool,
			read: fakeTool,
		} satisfies ToolsRecord;

		trimToolsToCap(filteredTools, 2);

		expect(filteredTools).not.toHaveProperty("edit");
		expect(filteredTools).toHaveProperty("bash");
		expect(filteredTools).toHaveProperty("read");
	});
});

describe("#given task_system configuration", () => {
	test("#when task_system is omitted #then task tools are not registered by default", () => {
		const projectRoot = createNonOckProjectRoot();
		const result = createToolRegistry({
			ctx: { directory: projectRoot } as Parameters<
				typeof createToolRegistry
			>[0]["ctx"],
			pluginConfig: {},
			managers: {
				backgroundManager: {},
				tmuxSessionManager: {},
				skillMcpManager: {},
			} as Parameters<typeof createToolRegistry>[0]["managers"],
			skillContext: {
				mergedSkills: [],
				availableSkills: [],
				browserProvider: "playwright",
				disabledSkills: new Set(),
			},
			availableCategories: [],
		});

		expect(result.taskSystemEnabled).toBe(false);
		expect(result.filteredTools).not.toHaveProperty("task_create");
		expect(result.filteredTools).not.toHaveProperty("task_get");
		expect(result.filteredTools).not.toHaveProperty("task_list");
		expect(result.filteredTools).not.toHaveProperty("task_update");
	});

	test("#when task_system is enabled #then task tools are registered", () => {
		const projectRoot = createNonOckProjectRoot();
		const result = createToolRegistry({
			ctx: { directory: projectRoot } as Parameters<
				typeof createToolRegistry
			>[0]["ctx"],
			pluginConfig: {
				experimental: { task_system: true },
			},
			managers: {
				backgroundManager: {},
				tmuxSessionManager: {},
				skillMcpManager: {},
			} as Parameters<typeof createToolRegistry>[0]["managers"],
			skillContext: {
				mergedSkills: [],
				availableSkills: [],
				browserProvider: "playwright",
				disabledSkills: new Set(),
			},
			availableCategories: [],
		});

		expect(result.taskSystemEnabled).toBe(true);
		expect(result.filteredTools).toHaveProperty("task_create");
		expect(result.filteredTools).toHaveProperty("task_get");
		expect(result.filteredTools).toHaveProperty("task_list");
		expect(result.filteredTools).toHaveProperty("task_update");
	});
});

describe("#given tmux integration is disabled", () => {
	test("#when system tmux is available #then interactive_bash remains registered", () => {
		const projectRoot = createNonOckProjectRoot();
		const result = createToolRegistry({
			ctx: { directory: projectRoot } as Parameters<
				typeof createToolRegistry
			>[0]["ctx"],
			pluginConfig: {
				tmux: {
					enabled: false,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			},
			managers: {
				backgroundManager: {},
				tmuxSessionManager: {},
				skillMcpManager: {},
			} as Parameters<typeof createToolRegistry>[0]["managers"],
			skillContext: {
				mergedSkills: [],
				availableSkills: [],
				browserProvider: "playwright",
				disabledSkills: new Set(),
			},
			availableCategories: [],
			interactiveBashEnabled: true,
		});

		expect(result.filteredTools).toHaveProperty("interactive_bash");
	});

	test("#when system tmux is unavailable #then interactive_bash is not registered", () => {
		const projectRoot = createNonOckProjectRoot();
		const result = createToolRegistry({
			ctx: { directory: projectRoot } as Parameters<
				typeof createToolRegistry
			>[0]["ctx"],
			pluginConfig: {
				tmux: {
					enabled: false,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			},
			managers: {
				backgroundManager: {},
				tmuxSessionManager: {},
				skillMcpManager: {},
			} as Parameters<typeof createToolRegistry>[0]["managers"],
			skillContext: {
				mergedSkills: [],
				availableSkills: [],
				browserProvider: "playwright",
				disabledSkills: new Set(),
			},
			availableCategories: [],
			interactiveBashEnabled: false,
		});

		expect(result.filteredTools).not.toHaveProperty("interactive_bash");
	});
});
