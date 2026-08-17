/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type {
	AvailableAgent,
	AvailableCategory,
	AvailableSkill,
} from "../dynamic-agent-prompt-builder";
import { buildGpt55SisyphusPrompt } from "../sisyphus/gpt-5-5";
import { buildGpt55HephaestusPrompt } from "./gpt-5-5";
import { buildGpt56HephaestusPrompt } from "./gpt-5-6";

const AVAILABLE_AGENTS: AvailableAgent[] = [
	{
		name: "explore",
		description: "Contextual grep for codebases.",
		metadata: {
			category: "exploration",
			cost: "FREE",
			triggers: [
				{
					domain: "Codebase discovery",
					trigger: "Find local implementation patterns",
				},
			],
		},
	},
	{
		name: "librarian",
		description: "External documentation and open-source research.",
		metadata: {
			category: "exploration",
			cost: "CHEAP",
			triggers: [
				{
					domain: "External references",
					trigger: "Find official docs and OSS examples",
				},
			],
		},
	},
	{
		name: "oracle",
		description: "Read-only architecture and debugging consultant.",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			triggers: [
				{
					domain: "Architecture review",
					trigger: "Resolve cross-system tradeoffs",
				},
			],
			useWhen: ["SENTINEL_ORACLE_USE_CASE"],
			avoidWhen: ["SENTINEL_ORACLE_AVOID_CASE"],
		},
	},
	{
		name: "metis",
		description: "Pre-planning scope consultant.",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			triggers: [
				{
					domain: "Scope analysis",
					trigger: "Clarify ambiguous requirements before planning",
				},
			],
		},
	},
	{
		name: "momus",
		description: "Plan quality reviewer.",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			triggers: [
				{
					domain: "Plan audit",
					trigger: "Review plans for missing steps",
				},
			],
		},
	},
	{
		name: "critic",
		description: "A future non-direct review agent.",
		metadata: {
			category: "advisor",
			cost: "CHEAP",
			triggers: [
				{
					domain: "Implementation critique",
					trigger: "Review an implementation before delivery",
				},
			],
		},
	},
];

const AVAILABLE_SKILLS: AvailableSkill[] = [
	{
		name: "focused-testing",
		description: "Focused test patterns",
		location: "plugin",
	},
];

const AVAILABLE_CATEGORIES: AvailableCategory[] = [
	{
		name: "deep",
		description: "Autonomous implementation and verification",
	},
	{
		name: "quick",
		description: "Single-file changes",
	},
];

const HEPHAESTUS_DIRECT_AGENTS = new Set(["explore", "librarian", "oracle"]);

/**
 * Delegation rows are the machine-rendered `→ `agent`` tokens emitted by
 * buildDelegationTable; agent names are the keys task() dispatches on.
 * Extraction is scoped to the rendered `### Delegation Table:` section and
 * deliberately unfiltered: every routed name the table renders, cataloged or
 * not, must surface in the comparison set.
 */
function routedAgentNames(prompt: string): Set<string> {
	const sectionStart = prompt.indexOf("### Delegation Table:")
	if (sectionStart === -1) return new Set()
	const nextHeading = prompt.indexOf("\n### ", sectionStart + 1)
	const section =
		nextHeading === -1
			? prompt.slice(sectionStart)
			: prompt.slice(sectionStart, nextHeading)
	return new Set([...section.matchAll(/→ `([^`]+)`/g)].map((match) => match[1]));
}

const PROMPT_BUILDERS = [
	{
		name: "GPT-5.5",
		build: buildGpt55HephaestusPrompt,
	},
	{
		name: "GPT-5.6",
		build: buildGpt56HephaestusPrompt,
	},
] as const;

for (const { name, build } of PROMPT_BUILDERS) {
	describe(`${name} Hephaestus delegation routing`, () => {
		test("routes delegation rows to exactly the direct-agent allowlist", () => {
			// given: direct agents, planning agents, and an arbitrary future agent are available
			const prompt = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);

			// then: only the direct-agent set is routed, and no other name at all
			expect(routedAgentNames(prompt)).toEqual(HEPHAESTUS_DIRECT_AGENTS);
		});

		test("propagates Oracle routing inputs only while oracle is available", () => {
			// given: the same catalog with and without the oracle agent
			const withOracle = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);
			const withoutOracle = build(
				AVAILABLE_AGENTS.filter((agent) => agent.name !== "oracle"),
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);

			// then: dynamic oracle metadata is rendered exactly when oracle is in the catalog
			expect(withOracle).toContain("SENTINEL_ORACLE_USE_CASE");
			expect(withOracle).toContain("SENTINEL_ORACLE_AVOID_CASE");
			expect(withoutOracle).not.toContain("SENTINEL_ORACLE_USE_CASE");
			expect(withoutOracle).not.toContain("SENTINEL_ORACLE_AVOID_CASE");
		});

		test("preserves the selected tracking tool", () => {
			// given: the same generated prompt with each supported tracking mode
			const todoPrompt = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);
			const taskPrompt = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				true,
			);

			// then: each mode continues to advertise only its own tracking surface
			expect(todoPrompt).toContain("todowrite");
			expect(todoPrompt).not.toContain("task_create");
			expect(taskPrompt).toContain("task_create");
			expect(taskPrompt).toContain("task_update");
			expect(taskPrompt).not.toContain("todowrite");
		});
	});
}

describe("planner delegation contracts", () => {
	test("keeps every advisor route in Sisyphus", () => {
		// given: the same agent catalog used to build Hephaestus prompts
		const prompt = buildGpt55SisyphusPrompt(
			"openai/gpt-5.5",
			AVAILABLE_AGENTS,
			[],
			AVAILABLE_SKILLS,
			AVAILABLE_CATEGORIES,
			false,
		);

		// then: the orchestrator routes to exactly its full planning specialist set
		expect(routedAgentNames(prompt)).toEqual(
			new Set(AVAILABLE_AGENTS.map((agent) => agent.name)),
		);
	});
});
