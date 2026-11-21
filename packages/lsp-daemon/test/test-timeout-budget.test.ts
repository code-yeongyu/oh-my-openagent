import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_IN_TEST_BUDGET_MS, TEST_TIMEOUT_MS } from "../vitest.config.js";

const testDirectory = fileURLToPath(new URL(".", import.meta.url));

/**
 * Numeric literals a test hands to a subprocess or a timed promise guard:
 * `timeout: 10_000` option bags, and `setTimeout(..., 10_000)` deadlines.
 * Underscore digit separators are preserved so `10_000` is read as 10000.
 */
const budgetPatterns = [/\btimeout:\s*([\d_]+)\b/g, /\bsetTimeout\([\s\S]*?,\s*([\d_]+)\s*\)/g] as const;

interface Budget {
	readonly file: string;
	readonly milliseconds: number;
}

function declaredBudgets(): readonly Budget[] {
	const budgets: Budget[] = [];
	for (const file of readdirSync(testDirectory).filter((name) => name.endsWith(".test.ts"))) {
		// This guard's own patterns would otherwise match themselves.
		if (file === "test-timeout-budget.test.ts") continue;
		const source = readFileSync(join(testDirectory, file), "utf8");
		for (const pattern of budgetPatterns) {
			for (const match of source.matchAll(pattern)) {
				const raw = match[1];
				if (raw === undefined) continue;
				const milliseconds = Number.parseInt(raw.replaceAll("_", ""), 10);
				// Sub-second values are intra-test sequencing waits, not process budgets.
				if (Number.isNaN(milliseconds) || milliseconds < 1_000) continue;
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
