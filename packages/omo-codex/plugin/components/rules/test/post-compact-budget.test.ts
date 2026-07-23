import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withPostCompactBudget } from "../src/post-compact-budget.js";
import type { PiRulesConfig } from "@oh-my-opencode/rules-engine/engine";

const tempDirectories: string[] = [];
const CONFIG: PiRulesConfig = {
	disabled: false,
	mode: "both",
	maxRuleChars: 30_000,
	maxResultChars: 50_000,
	postCompactMaxRuleChars: 12_000,
	postCompactMaxResultChars: 20_000,
	dynamicMaxRuleChars: 4_000,
	dynamicMaxResultChars: 10_000,
	promptMaxRuleChars: 6_000,
	promptMaxResultChars: 16_000,
	enabledSources: "auto",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("post-compact context budget", () => {
	it("#given known model near its context window #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(760_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given unknown model near its context window #when resolving post-compact budget #then shrinks projected rule injection conservatively", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(760_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "unknown-model", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given known roomy model #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "openai.gpt-5.5", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given pure GPT-5.4 model near the fallback context window #when resolving post-compact budget #then treats it as non-preset metadata", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(600_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.4", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given gpt-5.6-sol within its 372k window #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(541_500));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.6-sol", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given gpt-5.6-terra within its 372k window #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(541_500));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.6-terra", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given gpt-5.6-luna within its 372k window #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(541_500));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.6-luna", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given provider-prefixed gpt-5.6 variant within its 372k window #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(541_500));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "openai/gpt-5.6-sol", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given unknown model with the same transcript #when resolving post-compact budget #then keeps the 200k fallback floor", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(541_500));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "unknown-model", transcriptPath });

		// then
		expect(budget.maxResultChars).toBe(500);
		expect(budget.maxRuleChars).toBe(500);
	});

	it("#given context pressure marker after compaction #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedPressureTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given Codex canonical context-window marker after compaction #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedCodexContextWindowTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});
});

function writeCompactedTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
	writeFileSync(
		transcriptPath,
		`${JSON.stringify({
			type: "compacted",
			payload: {
				message: "summary",
				replacement_history: [{ type: "message", role: "user", content: retainedText }],
			},
		})}\n`,
	);
	return transcriptPath;
}

function writeCompactedPressureTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript-pressure.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "summary",
					replacement_history: [{ type: "message", role: "user", content: retainedText }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_too_large",
							message:
								"Your input exceeds the context window of this model. Please adjust your input and try again.",
						},
					},
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

function writeCompactedCodexContextWindowTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript-codex-context-window.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "summary",
					replacement_history: [{ type: "message", role: "user", content: retainedText }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_length_exceeded",
						},
					},
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content:
						"Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}
