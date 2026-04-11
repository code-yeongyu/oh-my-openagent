import type { ToolDefinition } from "@opencode-ai/plugin";

import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import { isInteractiveBashEnabled } from "../create-runtime-tmux-config";
import { log } from "../shared";
import { filterDisabledTools } from "../shared/disabled-tools";
import {
	builtinTools,
	createAstGrepTools,
	createBackgroundTools,
	createCallOmoAgent,
	createDelegateTask,
	createGlobTools,
	createGrepTools,
	createSessionManagerTools,
} from "../tools";
import { createBeadsRuntimeToolRecord } from "./beads-runtime-tool-record";
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas";
import {
	createHashlineEditToolRecord,
	createInteractiveBashToolRecord,
	createLookAtToolRecord,
} from "./optional-tool-records";
import type { SkillContext } from "./skill-context";
import { createSkillToolRecord } from "./skill-tool-record";
import { createTaskSystemToolRecord } from "./task-system-tool-record";
import type { PluginContext, ToolsRecord } from "./types";

export type ToolRegistryResult = {
	filteredTools: ToolsRecord;
	taskSystemEnabled: boolean;
};

const LOW_PRIORITY_TOOL_ORDER = [
	"session_list",
	"session_read",
	"session_search",
	"session_info",
	"interactive_bash",
	"look_at",
	"call_omo_agent",
	"task_create",
	"task_get",
	"task_list",
	"task_update",
	"background_output",
	"background_cancel",
	"beads_runtime_status",
	"beads_runtime_attach",
	"edit",
	"ast_grep_replace",
	"ast_grep_search",
	"glob",
	"grep",
	"skill_mcp",
	"skill",
	"task",
	"lsp_rename",
	"lsp_prepare_rename",
	"lsp_find_references",
	"lsp_goto_definition",
	"lsp_symbols",
	"lsp_diagnostics",
] as const;

export function trimToolsToCap(
	filteredTools: ToolsRecord,
	maxTools: number,
): void {
	const toolNames = Object.keys(filteredTools);
	if (toolNames.length <= maxTools) return;

	const removableToolNames = [
		...LOW_PRIORITY_TOOL_ORDER.filter((toolName) =>
			toolNames.includes(toolName),
		),
		...toolNames
			.filter(
				(toolName) =>
					!LOW_PRIORITY_TOOL_ORDER.includes(
						toolName as (typeof LOW_PRIORITY_TOOL_ORDER)[number],
					),
			)
			.sort(),
	];

	let currentCount = toolNames.length;
	let removed = 0;

	for (const toolName of removableToolNames) {
		if (currentCount <= maxTools) break;
		if (!filteredTools[toolName]) continue;
		delete filteredTools[toolName];
		currentCount -= 1;
		removed += 1;
	}

	log(
		`[tool-registry] Trimmed ${removed} tools to satisfy max_tools=${maxTools}. Final plugin tool count=${currentCount}.`,
	);
}

export function createToolRegistry(args: {
	ctx: PluginContext;
	pluginConfig: OhMyOpenCodeConfig;
	managers: Pick<
		Managers,
		| "backgroundManager"
		| "tmuxSessionManager"
		| "skillMcpManager"
		| "beadsRuntime"
	>;
	skillContext: SkillContext;
	availableCategories: AvailableCategory[];
	interactiveBashEnabled?: boolean;
}): ToolRegistryResult {
	const {
		ctx,
		pluginConfig,
		managers,
		skillContext,
		availableCategories,
		interactiveBashEnabled = isInteractiveBashEnabled(),
	} = args;
	const { taskSystemEnabled, taskToolsRecord } = createTaskSystemToolRecord(
		pluginConfig,
		ctx,
	);
	const backgroundTools = createBackgroundTools(
		managers.backgroundManager,
		ctx.client,
	);
	const callOmoAgent = createCallOmoAgent(
		ctx,
		managers.backgroundManager,
		pluginConfig.disabled_agents ?? [],
		pluginConfig.agents,
		pluginConfig.categories,
	);
	const lookAtToolsRecord = createLookAtToolRecord(pluginConfig, ctx);
	const interactiveBashToolsRecord = createInteractiveBashToolRecord(
		interactiveBashEnabled,
	);
	const hashlineToolsRecord = createHashlineEditToolRecord(pluginConfig, ctx);

	const delegateTask = createDelegateTask({
		manager: managers.backgroundManager,
		client: ctx.client,
		directory: ctx.directory,
		userCategories: pluginConfig.categories,
		agentOverrides: pluginConfig.agents,
		gitMasterConfig: pluginConfig.git_master,
		sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
		browserProvider: skillContext.browserProvider,
		disabledSkills: skillContext.disabledSkills,
		availableCategories,
		availableSkills: skillContext.availableSkills,
		sisyphusAgentConfig: pluginConfig.sisyphus_agent,
		syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
		onSyncSessionCreated: async (event) => {
			log("[index] onSyncSessionCreated callback", {
				sessionID: event.sessionID,
				parentID: event.parentID,
				title: event.title,
			});
			await managers.tmuxSessionManager.onSessionCreated({
				type: "session.created",
				properties: {
					info: {
						id: event.sessionID,
						parentID: event.parentID,
						title: event.title,
					},
				},
			});
		},
	});
	const skillToolsRecord = createSkillToolRecord({
		ctx,
		pluginConfig,
		managers,
		skillContext,
	});

	const sessionTools = createSessionManagerTools(ctx);

	const allTools: Record<string, ToolDefinition> = {
		...builtinTools,
		...createGrepTools(ctx),
		...createGlobTools(ctx),
		...createAstGrepTools(ctx),
		...sessionTools,
		...backgroundTools,
		call_omo_agent: callOmoAgent,
		...lookAtToolsRecord,
		...createBeadsRuntimeToolRecord(managers.beadsRuntime, ctx.directory),
		task: delegateTask,
		...skillToolsRecord,
		...interactiveBashToolsRecord,
		...taskToolsRecord,
		...hashlineToolsRecord,
	};

	for (const toolDefinition of Object.values(allTools)) {
		normalizeToolArgSchemas(toolDefinition);
	}

	const filteredTools: ToolsRecord = filterDisabledTools(
		allTools,
		pluginConfig.disabled_tools,
	);

	const maxTools = pluginConfig.experimental?.max_tools;
	if (maxTools) {
		trimToolsToCap(filteredTools, maxTools);
	}

	return {
		filteredTools,
		taskSystemEnabled,
	};
}
