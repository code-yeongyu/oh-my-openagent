import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_IN_TEST_BUDGET_MS, TEST_TIMEOUT_MS } from "../vitest.config.js";

const testDirectory = fileURLToPath(new URL(".", import.meta.url));

/**
 * Budgets a test or test helper hands to a subprocess or a timed promise guard:
 * `timeout: 10_000` option bags and `setTimeout(..., 10_000)` deadlines, as a
 * numeric literal (underscore separators kept, so `10_000` reads as 10000) or as
 * a named `*_MS` constant. Lower-case arguments are forwarded parameters whose
 * literal is counted where the caller writes it.
 */
const budgetPatterns = [/\btimeout:\s*([\w]+)\b/g, /\bsetTimeout\([\s\S]*?,\s*([\w]+)\s*\)/g] as const;

/** The named budgets the guard can read; any other `*_MS` constant is an unresolved budget and fails it. */
const namedBudgets: Readonly<Record<string, number>> = { MAX_IN_TEST_BUDGET_MS, TEST_TIMEOUT_MS };

interface Budget {
	readonly file: string;
	readonly milliseconds: number;
}

function budgetValue(raw: string, file: string): number | undefined {
	if (/^[\d_]+$/.test(raw)) return Number.parseInt(raw.replaceAll("_", ""), 10);
	if (!/^[A-Z][A-Z0-9_]*_MS$/.test(raw)) return undefined;
	const value = namedBudgets[raw];
	if (value === undefined)
		throw new Error(`${file}: budget ${raw} is not one the guard can read; add it to namedBudgets`);
	return value;
}

function declaredBudgets(): readonly Budget[] {
	const budgets: Budget[] = [];
	// Helpers count too: `bun-child.ts` arms the ceiling every `runBunChild` call gets.
	for (const file of readdirSync(testDirectory).filter((name) => name.endsWith(".ts"))) {
		// This guard's own patterns would otherwise match themselves.
		if (file === "test-timeout-budget.test.ts") continue;
		const source = readFileSync(join(testDirectory, file), "utf8");
		for (const pattern of budgetPatterns) {
			for (const match of source.matchAll(pattern)) {
				const raw = match[1];
				if (raw === undefined) continue;
				const milliseconds = budgetValue(raw, file);
				// Sub-second values are intra-test sequencing waits, not process budgets.
				if (milliseconds === undefined || Number.isNaN(milliseconds) || milliseconds < 1_000) continue;
				budgets.push({ file, milliseconds });
			}
		}
	}
	return budgets;
}

describe("per-test timeout budget", () => {
	it("#given the vitest config #when tests grant a subprocess budget #then the harness budget strictly exceeds every one of them", () => {
		const budgets = declaredBudgets();

		// Guards against the patterns silently matching nothing after a refactor.
		expect(budgets.length).toBeGreaterThan(0);

		const offenders = budgets.filter((budget) => budget.milliseconds >= TEST_TIMEOUT_MS);
		expect(offenders).toEqual([]);
	});

	it("#given the documented ceiling #when compared to the real budgets #then it matches the largest one the suite grants", () => {
		const largest = Math.max(...declaredBudgets().map((budget) => budget.milliseconds));

		expect(largest).toBe(MAX_IN_TEST_BUDGET_MS);
		expect(TEST_TIMEOUT_MS).toBeGreaterThan(MAX_IN_TEST_BUDGET_MS);
	});
});
