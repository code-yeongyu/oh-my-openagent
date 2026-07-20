import { describe, expect, test } from "bun:test";

import { analyzeCuratedAgentRun } from "./curated-agents-e2e-analysis.mjs";

const expectedTools = [
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

const passingInput = {
	record: {
		agent_type: "explore",
		tool_allow: expectedTools,
		resolved_model: { source: "agent" },
	},
	childContexts: [
		{
			prompt: "You are a codebase search specialist.\nOMO_CURATED_EXPLORE_E2E_20260719",
			tools: expectedTools,
		},
	],
	taskEvents: [
		{ type: "tool_execution", payload: { tool: "lsp_diagnostics", is_error: false } },
		{ type: "tool_execution", payload: { tool: "bash", is_error: false } },
		{ type: "tool_execution", payload: { tool: "bash", is_error: true } },
		{ type: "tool_execution", payload: { tool: "edit", is_error: true } },
		{ type: "tool_execution", payload: { tool: "write", is_error: true } },
	],
	parentOutput:
		'Target "nonexistent" not found. Available agents: explore, librarian, metis, momus, oracle. Available categories: mockcat.',
};

const passingChecks = {
	record_agent_type: "PASS",
	record_tool_allow: "PASS",
	record_model_source: "PASS",
	explore_persona_prompt: "PASS",
	sentinel_prompt: "PASS",
	lsp_visible: "PASS",
	mutation_tools_hidden: "PASS",
	lsp_invoked: "PASS",
	bash_read_succeeded: "PASS",
	bash_mutation_rejected: "PASS",
	mutation_calls_rejected: "PASS",
	unknown_target_agents: "PASS",
	unknown_target_categories: "PASS",
};

describe("analyzeCuratedAgentRun", () => {
	test("#given complete live artifacts #when analyzed #then the exact curated-agent contract passes", () => {
		// given / when
		const result = analyzeCuratedAgentRun(passingInput);

		// then
		expect(result).toEqual({ result: "PASS", checks: passingChecks });
	});

	test("#given mutating tools exposed to the child #when analyzed #then the allowlist probe fails", () => {
		// given
		const input = {
			...passingInput,
			childContexts: [{ ...passingInput.childContexts[0], tools: [...expectedTools, "edit", "write"] }],
		};

		// when
		const result = analyzeCuratedAgentRun(input);

		// then
		expect(result.result).toBe("FAIL");
		expect(result.checks.mutation_tools_hidden).toBe("FAIL");
	});

	test("#given an incomplete unknown-target error #when analyzed #then both missing rosters are attributed", () => {
		// given
		const input = { ...passingInput, parentOutput: 'Target "nonexistent" not found.' };

		// when
		const result = analyzeCuratedAgentRun(input);

		// then
		expect(result.checks.unknown_target_agents).toBe("FAIL");
		expect(result.checks.unknown_target_categories).toBe("FAIL");
	});
});
