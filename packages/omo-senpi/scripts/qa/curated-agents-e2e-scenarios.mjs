import { EXPLORE_TASK_SENTINEL } from "./curated-agents-e2e-analysis.mjs";

export const CURATED_AGENT_OMO_CONFIG = {
	categories: {
		mockcat: {
			description: "Local category used to prove unknown-target roster output.",
			model: "omo-mock/mock-1",
		},
	},
};

export const CURATED_AGENT_SCRIPT = {
	childSteps: [
		{
			type: "tool_call",
			name: "lsp_diagnostics",
			arguments: { filePath: "qa-probe.ts", severity: "all" },
		},
		{
			type: "tool_call",
			name: "edit",
			arguments: { path: "qa-probe.ts", oldText: "probe", newText: "changed" },
		},
		{
			type: "tool_call",
			name: "write",
			arguments: { path: "forbidden.txt", content: "must not be written\n" },
		},
		{ type: "text", text: "curated explore child complete" },
	],
	parentSteps: [
		{
			type: "tool_call",
			name: "task",
			arguments: {
				subagent_type: "explore",
				prompt: EXPLORE_TASK_SENTINEL,
				run_in_background: false,
				name: "curated-explore",
			},
		},
		{
			type: "tool_call",
			name: "task",
			arguments: {
				subagent_type: "nonexistent",
				prompt: "prove the unknown target error",
				run_in_background: true,
				name: "curated-missing",
			},
		},
		{ type: "text", text: "curated agent e2e parent complete" },
	],
};
