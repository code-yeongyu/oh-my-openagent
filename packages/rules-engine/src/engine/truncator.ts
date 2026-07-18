import { TRUNCATION_NOTICE } from "./constants.js";
import type { TruncationResult } from "./types.js";

type BudgetRule = {
	body: string;
	relativePath: string;
};

type BudgetResult = BudgetRule & {
	truncated: boolean;
};

const NEVER_TRUNCATED_RULE_PATHS = new Set([
	"bundled-rules/hephaestus.md",
	"bundled-rules/hephaestus/gpt-5.5.md",
	"bundled-rules/hephaestus/gpt-5.6.md",
]);

function truncationNotice(relativePath: string): string {
	return TRUNCATION_NOTICE.replace("{path}", relativePath);
}

export function isNeverTruncatedRule(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
	return NEVER_TRUNCATED_RULE_PATHS.has(normalized);
}

function safeSliceEnd(body: string, end: number): number {
	if (end <= 0) {
		return 0;
	}

	const lastCodeUnit = body.charCodeAt(end - 1);
	if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
		return end - 1;
	}

	return end;
}

export function truncateRule(body: string, options: { maxChars: number; relativePath: string }): TruncationResult {
	if (isNeverTruncatedRule(options.relativePath)) {
		return { body, truncated: false, originalLength: body.length };
	}

	if (body.length <= options.maxChars) {
		return { body, truncated: false, originalLength: body.length };
	}

	const notice = truncationNotice(options.relativePath);
	if (options.maxChars < notice.length) {
		return { body: notice, truncated: true, originalLength: body.length };
	}

	const sliceEnd = safeSliceEnd(body, options.maxChars - notice.length);
	return { body: `${body.slice(0, sliceEnd)}${notice}`, truncated: true, originalLength: body.length };
}

export function truncateBudget(input: { rules: ReadonlyArray<BudgetRule>; maxResultChars: number }): BudgetResult[] {
	const results: BudgetResult[] = [];
	let remainingBudget = input.maxResultChars;

	for (const rule of input.rules) {
		if (isNeverTruncatedRule(rule.relativePath)) {
			results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
			remainingBudget -= rule.body.length;
			continue;
		}

		if (remainingBudget >= rule.body.length) {
			results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
			remainingBudget -= rule.body.length;
			continue;
		}

		const notice = truncationNotice(rule.relativePath);
		if (remainingBudget <= notice.length) {
			break;
		}

		const sliceEnd = safeSliceEnd(rule.body, remainingBudget - notice.length);
		const body = `${rule.body.slice(0, sliceEnd)}${notice}`;
		results.push({ body, truncated: true, relativePath: rule.relativePath });
		remainingBudget -= body.length;
	}

	return results;
}
