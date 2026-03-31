import type { OhMyOpenCodeConfig } from "../config";
import { getAgentDisplayName } from "../shared/agent-display-names";

type AgentWithPermission = { permission?: Record<string, unknown> };

function updateAgentPermissions(
	agentResult: Record<string, unknown>,
	key: string,
	permissionUpdate: Record<string, unknown>,
): void {
	const aliases = new Set([key, getAgentDisplayName(key)]);

	for (const alias of aliases) {
		const agent = agentResult[alias] as AgentWithPermission | undefined;
		if (!agent) continue;
		agent.permission = { ...agent.permission, ...permissionUpdate };
	}
}

function getConfigQuestionPermission(): string | null {
	const configContent = process.env.OPENCODE_CONFIG_CONTENT;
	if (!configContent) return null;
	try {
		const parsed = JSON.parse(configContent);
		return parsed?.permission?.question ?? null;
	} catch {
		return null;
	}
}

function agentByKey(
	agentResult: Record<string, unknown>,
	key: string,
): AgentWithPermission | undefined {
	return (agentResult[key] ?? agentResult[getAgentDisplayName(key)]) as
		| AgentWithPermission
		| undefined;
}

export function applyToolConfig(params: {
	config: Record<string, unknown>;
	pluginConfig: OhMyOpenCodeConfig;
	agentResult: Record<string, unknown>;
}): void {
	const denyTodoTools = params.pluginConfig.experimental?.task_system
		? { todowrite: "deny", todoread: "deny" }
		: {};

	const existingPermission = params.config.permission as
		| Record<string, unknown>
		| undefined;
	const skillDeniedByHost = existingPermission?.skill === "deny";

	params.config.tools = {
		...(params.config.tools as Record<string, unknown>),
		"grep_app_*": false,
		LspHover: false,
		LspCodeActions: false,
		LspCodeActionResolve: false,
		"task_*": false,
		teammate: false,
		...(params.pluginConfig.experimental?.task_system
			? { todowrite: false, todoread: false }
			: {}),
		...(skillDeniedByHost ? { skill: false, skill_mcp: false } : {}),
	};

	const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
	const configQuestionPermission = getConfigQuestionPermission();
	const isQuestionDisabledByPlugin =
		params.pluginConfig.disabled_tools?.includes("question") ?? false;
	const questionPermission = isQuestionDisabledByPlugin
		? "deny"
		: configQuestionPermission === "deny"
			? "deny"
			: isCliRunMode
				? "deny"
				: "allow";

	const librarian = agentByKey(params.agentResult, "librarian");
	if (librarian) {
		updateAgentPermissions(params.agentResult, "librarian", {
			"grep_app_*": "allow",
		});
	}
	const looker = agentByKey(params.agentResult, "multimodal-looker");
	if (looker) {
		updateAgentPermissions(params.agentResult, "multimodal-looker", {
			task: "deny",
			look_at: "deny",
		});
	}
	const atlas = agentByKey(params.agentResult, "atlas");
	if (atlas) {
		updateAgentPermissions(params.agentResult, "atlas", {
			task: "allow",
			call_omo_agent: "deny",
			"task_*": "allow",
			teammate: "allow",
			...denyTodoTools,
		});
	}
	const sisyphus = agentByKey(params.agentResult, "sisyphus");
	if (sisyphus) {
		updateAgentPermissions(params.agentResult, "sisyphus", {
			call_omo_agent: "deny",
			task: "allow",
			question: questionPermission,
			"task_*": "allow",
			teammate: "allow",
			...denyTodoTools,
		});
	}
	const hephaestus = agentByKey(params.agentResult, "hephaestus");
	if (hephaestus) {
		updateAgentPermissions(params.agentResult, "hephaestus", {
			call_omo_agent: "deny",
			task: "allow",
			question: questionPermission,
			...denyTodoTools,
		});
	}
	const prometheus = agentByKey(params.agentResult, "prometheus");
	if (prometheus) {
		updateAgentPermissions(params.agentResult, "prometheus", {
			call_omo_agent: "deny",
			task: "allow",
			question: questionPermission,
			"task_*": "allow",
			teammate: "allow",
			...denyTodoTools,
		});
	}
	const junior = agentByKey(params.agentResult, "sisyphus-junior");
	if (junior) {
		updateAgentPermissions(params.agentResult, "sisyphus-junior", {
			task: "allow",
			"task_*": "allow",
			teammate: "allow",
			...denyTodoTools,
		});
	}

	params.config.permission = {
		webfetch: "allow",
		external_directory: "allow",
		...(params.config.permission as Record<string, unknown>),
		task: "deny",
	};
}
