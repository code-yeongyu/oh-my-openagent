import { describe, expect, test } from "bun:test";

import {
	analyzeCuratedAgentRun,
	EXPECTED_EXPLORE_TOOL_ALLOW,
	EXPLORE_PERSONA_SENTINEL,
	EXPLORE_TASK_SENTINEL,
} from "./curated-agents-e2e-analysis.mjs";

const passingInput = {
	record: {
		agent_type: "explore",
		tool_allow: EXPECTED_EXPLORE_TOOL_ALLOW,
		resolved_model: { source: "agent" },
	},
	childContexts: [
		{
			prompt: `${EXPLORE_PERSONA_SENTINEL}\n${EXPLORE_TASK_SENTINEL}`,
			tools: EXPECTED_EXPLORE_TOOL_ALLOW,
		},
	],
	taskEvents: [
		{
			type: "tool_execution",
			payload: { tool: "lsp_diagnostics", is_error: false },
		},
		{ type: "tool_execution", payload: { tool: "edit", is_error: true } },
		{ type: "tool_execution", payload: { tool: "write", is_error: true } },
	],
	parentOutput:
		'Target "nonexistent" not found. Available agents: explore, librarian, metis, momus, oracle. Available categories: mockcat.',
};

describe("analyzeCuratedAgentRun", () => {
	test("#given complete live artifacts #when analyzed #then every curated-agent contract passes", () => {
		// #given
		const input = passingInput;

		// #when
		const result = analyzeCuratedAgentRun(input);

		// #then
		expect(result.result).toBe("PASS");
		expect(Object.values(result.checks)).toEqual(
			Array(Object.keys(result.checks).length).fill("PASS"),
		);
	});

	test("#given mutating tools exposed to the child #when analyzed #then the allowlist probe fails", () => {
		// #given
		const input = {
			...passingInput,
			childContexts: [
				{
					...passingInput.childContexts[0],
					tools: [...EXPECTED_EXPLORE_TOOL_ALLOW, "edit", "write"],
				},
			],
		};

		// #when
		const result = analyzeCuratedAgentRun(input);

		// #then
		expect(result.result).toBe("FAIL");
		expect(result.checks.mutation_tools_hidden).toBe("FAIL");
	});

	test("#given an incomplete unknown-target error #when analyzed #then both missing rosters are attributed", () => {
		// #given
		const input = {
			...passingInput,
			parentOutput: 'Target "nonexistent" not found.',
		};

		// #when
		const result = analyzeCuratedAgentRun(input);

		// #then
		expect(result.checks.unknown_target_agents).toBe("FAIL");
		expect(result.checks.unknown_target_categories).toBe("FAIL");
	});
});
