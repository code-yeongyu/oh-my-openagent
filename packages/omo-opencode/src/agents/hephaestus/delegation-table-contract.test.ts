/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type {
	AvailableAgent,
	AvailableCategory,
	AvailableSkill,
} from "../dynamic-agent-prompt-builder";
import { buildGpt55SisyphusPrompt } from "../sisyphus/gpt-5-5";
import { buildHephaestusPrompt as buildGptHephaestusPrompt } from "./gpt";
import { buildHephaestusPrompt as buildGpt54HephaestusPrompt } from "./gpt-5-4";
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
			useWhen: ["Complex architecture design"],
			avoidWhen: ["Simple file operations"],
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

const PROMPT_BUILDERS = [
  {
    name: "GPT",
    build: buildGptHephaestusPrompt,
  },
  {
    name: "GPT-5.4",
    build: buildGpt54HephaestusPrompt,
  },
  {
		name: "GPT-5.5",
		build: buildGpt55HephaestusPrompt,
	},
	{
		name: "GPT-5.6",
		build: buildGpt56HephaestusPrompt,
	},
] as const;

function extractDelegationAgentNames(prompt: string): Set<string> {
	const tableRows = prompt.match(
		/### Delegation Table:\n\n(?<rows>(?:- .+\n?)*)/,
	)?.groups?.rows;
	return new Set(
		[...(tableRows ?? "").matchAll(/→ `(?<agent>[^`]+)`/g)].flatMap(
			(match) => (match.groups?.agent ? [match.groups.agent] : []),
		),
	);
}

for (const { name, build } of PROMPT_BUILDERS) {
  describe(`${name} Hephaestus generated prompt`, () => {
    test("does not advertise direct-agent delegation", () => {
      // given: direct agents are available to the prompt builder
      const prompt = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);

      // then: worker admission remains authoritative
      expect(extractDelegationAgentNames(prompt)).toEqual(new Set());
    });

    test("does not advertise category or Oracle delegation", () => {
      // given: category and Oracle inputs are available to the prompt builder
      const todoPrompt = build(
				AVAILABLE_AGENTS,
				[],
				AVAILABLE_SKILLS,
				AVAILABLE_CATEGORIES,
				false,
			);

      // then: no delegation surface is rendered for a worker
      expect(todoPrompt).not.toContain("### Category + Skills Delegation System");
      expect(todoPrompt).not.toContain("<Oracle_Usage>");
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
	test("keeps Metis and Momus routes in Sisyphus", () => {
		// given: the same agent catalog used to build Hephaestus prompts
		const prompt = buildGpt55SisyphusPrompt(
			"openai/gpt-5.5",
			AVAILABLE_AGENTS,
			[],
			AVAILABLE_SKILLS,
			AVAILABLE_CATEGORIES,
			false,
		);

		// then: the orchestrator still advertises its planning specialists
		expect(extractDelegationAgentNames(prompt)).toEqual(
			new Set(["explore", "librarian", "oracle", "metis", "momus", "critic"]),
		);
	});
});
