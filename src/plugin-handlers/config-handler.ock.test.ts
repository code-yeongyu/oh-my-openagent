import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as agents from "../agents";
import type { OhMyOpenCodeConfig } from "../config";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as mcpLoader from "../features/claude-code-mcp-loader";
import * as pluginLoader from "../features/claude-code-plugin-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import * as mcpModule from "../mcp";
import * as shared from "../shared";
import { createConfigHandler } from "./config-handler";

function createPluginConfig(
	overrides: Partial<OhMyOpenCodeConfig> = {},
): OhMyOpenCodeConfig {
	return {
		git_master: {
			commit_footer: true,
			include_co_authored_by: true,
			git_env_prefix: "GIT_MASTER=1",
		},
		...overrides,
	};
}

function createOckProjectRoot(): string {
	const projectRoot = mkdtempSync(join(tmpdir(), "config-handler-ock-"));
	mkdirSync(join(projectRoot, ".git"), { recursive: true });
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

describe("createConfigHandler in OCK repos", () => {
	beforeEach(() => {
		spyOn(agents, "createBuiltinAgents" as any).mockResolvedValue({
			atlas: { name: "atlas", prompt: "test", mode: "primary" },
			sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
			hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
			prometheus: { name: "prometheus", prompt: "test", mode: "all" },
			"sisyphus-junior": {
				name: "sisyphus-junior",
				prompt: "test",
				mode: "subagent",
			},
		});
		spyOn(commandLoader, "loadUserCommands" as any).mockResolvedValue({});
		spyOn(commandLoader, "loadProjectCommands" as any).mockResolvedValue({});
		spyOn(commandLoader, "loadOpencodeGlobalCommands" as any).mockResolvedValue(
			{},
		);
		spyOn(
			commandLoader,
			"loadOpencodeProjectCommands" as any,
		).mockResolvedValue({});
		spyOn(builtinCommands, "loadBuiltinCommands" as any).mockReturnValue({
			"start-work": {
				name: "start-work",
				description: "builtin",
				template: "builtin-template",
			},
			refactor: {
				name: "refactor",
				description: "builtin",
				template: "builtin-template",
			},
		});
		spyOn(skillLoader, "loadUserSkills" as any).mockResolvedValue({});
		spyOn(skillLoader, "loadProjectSkills" as any).mockResolvedValue({});
		spyOn(skillLoader, "loadOpencodeGlobalSkills" as any).mockResolvedValue({});
		spyOn(skillLoader, "loadOpencodeProjectSkills" as any).mockResolvedValue(
			{},
		);
		spyOn(skillLoader, "loadProjectAgentsSkills" as any).mockResolvedValue({});
		spyOn(skillLoader, "loadGlobalAgentsSkills" as any).mockResolvedValue({});
		spyOn(skillLoader, "discoverConfigSourceSkills" as any).mockResolvedValue(
			[],
		);
		spyOn(pluginLoader, "loadAllPluginComponents" as any).mockResolvedValue({
			commands: {},
			skills: {},
			agents: {},
			mcpServers: {},
			hooksConfigs: [],
			plugins: [],
			errors: [],
		});
		spyOn(mcpLoader, "loadMcpConfigs" as any).mockResolvedValue({
			servers: {},
		});
		spyOn(mcpLoader, "setAdditionalAllowedMcpEnvVars").mockImplementation(
			() => {},
		);
		spyOn(mcpModule, "createBuiltinMcps" as any).mockReturnValue({});
		spyOn(shared, "log" as any).mockImplementation(() => {});
	});

	afterEach(() => {
		(agents.createBuiltinAgents as any)?.mockRestore?.();
		(commandLoader.loadUserCommands as any)?.mockRestore?.();
		(commandLoader.loadProjectCommands as any)?.mockRestore?.();
		(commandLoader.loadOpencodeGlobalCommands as any)?.mockRestore?.();
		(commandLoader.loadOpencodeProjectCommands as any)?.mockRestore?.();
		(builtinCommands.loadBuiltinCommands as any)?.mockRestore?.();
		(skillLoader.loadUserSkills as any)?.mockRestore?.();
		(skillLoader.loadProjectSkills as any)?.mockRestore?.();
		(skillLoader.loadOpencodeGlobalSkills as any)?.mockRestore?.();
		(skillLoader.loadOpencodeProjectSkills as any)?.mockRestore?.();
		(skillLoader.loadProjectAgentsSkills as any)?.mockRestore?.();
		(skillLoader.loadGlobalAgentsSkills as any)?.mockRestore?.();
		(skillLoader.discoverConfigSourceSkills as any)?.mockRestore?.();
		(pluginLoader.loadAllPluginComponents as any)?.mockRestore?.();
		(mcpLoader.loadMcpConfigs as any)?.mockRestore?.();
		(mcpLoader.setAdditionalAllowedMcpEnvVars as any)?.mockRestore?.();
		(mcpModule.createBuiltinMcps as any)?.mockRestore?.();
		(shared.log as any)?.mockRestore?.();
	});

	test("suppresses conflicting builtins and task-system ownership together in OCK repos", async () => {
		const projectRoot = createOckProjectRoot();

		try {
			const pluginConfig = createPluginConfig({
				experimental: { task_system: true },
			});
			const config: Record<string, unknown> = {
				model: "anthropic/claude-opus-4-6",
				agent: {},
				tools: {},
				permission: {},
				command: {},
			};
			const handler = createConfigHandler({
				ctx: { directory: projectRoot },
				pluginConfig,
				modelCacheState: {
					anthropicContext1MEnabled: false,
					modelContextLimitsCache: new Map(),
				},
			});

			await handler(config);

			const commandConfig = config.command as Record<string, unknown>;
			expect(commandConfig["start-work"]).toBeUndefined();
			expect(commandConfig.refactor).toBeDefined();

			const tools = config.tools as Record<string, unknown>;
			expect(tools.todowrite).toBeUndefined();
			expect(tools.todoread).toBeUndefined();

			const agentConfig = config.agent as Record<
				string,
				{ permission?: Record<string, unknown> }
			>;
			const lastCreateBuiltinAgentsCall = (agents.createBuiltinAgents as any)
				.mock.calls[(agents.createBuiltinAgents as any).mock.calls.length - 1];
			expect(lastCreateBuiltinAgentsCall?.[11]).toBe(false);
			expect(agentConfig.atlas?.permission?.todowrite).toBeUndefined();
			expect(agentConfig.sisyphus?.permission?.todowrite).toBeUndefined();
			expect(agentConfig.prometheus?.permission?.todowrite).toBeUndefined();
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});
