export const EXPECTED_EXPLORE_TOOL_ALLOW = [
	"read",
	"find",
	"grep",
	"ls",
	"bash",
	"lsp_diagnostics",
	"lsp_goto_definition",
	"lsp_find_references",
	"lsp_symbols",
];

export const EXPLORE_PERSONA_SENTINEL = "You are a codebase search specialist.";
export const EXPLORE_TASK_SENTINEL = "OMO_CURATED_EXPLORE_E2E_20260719";

export function analyzeCuratedAgentRun(input) {
	const record = isRecord(input.record) ? input.record : {};
	const contexts = Array.isArray(input.childContexts)
		? input.childContexts.filter(isRecord)
		: [];
	const taskEvents = Array.isArray(input.taskEvents)
		? input.taskEvents.filter(isRecord)
		: [];
	const prompts = contexts
		.map((context) => context.prompt)
		.filter((prompt) => typeof prompt === "string");
	const visibleTools = contexts.flatMap((context) =>
		Array.isArray(context.tools)
			? context.tools.filter((tool) => typeof tool === "string")
			: [],
	);
	const parentOutput =
		typeof input.parentOutput === "string" ? input.parentOutput : "";
	const checks = {
		record_agent_type: verdict(record.agent_type === "explore"),
		record_tool_allow: verdict(
			equalStrings(record.tool_allow, EXPECTED_EXPLORE_TOOL_ALLOW),
		),
		record_model_source: verdict(
			isRecord(record.resolved_model) &&
				record.resolved_model.source === "agent",
		),
		explore_persona_prompt: verdict(
			prompts.some((prompt) => prompt.includes(EXPLORE_PERSONA_SENTINEL)),
		),
		sentinel_prompt: verdict(
			prompts.some((prompt) => prompt.includes(EXPLORE_TASK_SENTINEL)),
		),
		lsp_visible: verdict(visibleTools.includes("lsp_diagnostics")),
		mutation_tools_hidden: verdict(
			!visibleTools.includes("edit") && !visibleTools.includes("write"),
		),
		lsp_invoked: verdict(hasToolEvent(taskEvents, "lsp_diagnostics", false)),
		mutation_calls_rejected: verdict(
			hasToolEvent(taskEvents, "edit", true) &&
				hasToolEvent(taskEvents, "write", true),
		),
		unknown_target_agents: verdict(
			parentOutput.includes(
				"Available agents: explore, librarian, metis, momus, oracle.",
			),
		),
		unknown_target_categories: verdict(
			parentOutput.includes("Available categories:"),
		),
	};
	return {
		result: Object.values(checks).every((check) => check === "PASS")
			? "PASS"
			: "FAIL",
		checks,
	};
}

function hasToolEvent(events, name, isError) {
	return events.some(
		(event) =>
			event.type === "tool_execution" &&
			isRecord(event.payload) &&
			event.payload.tool === name &&
			event.payload.is_error === isError,
	);
}

function equalStrings(value, expected) {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, index) => entry === expected[index])
	);
}

function verdict(condition) {
	return condition ? "PASS" : "FAIL";
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
