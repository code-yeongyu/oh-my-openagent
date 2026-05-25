import { truncateBudget, truncateRule } from "./truncator.js";
import type { LoadedRule } from "./types.js";

export interface FormatOptions {
	maxRuleChars: number;
	maxResultChars: number;
}

type TruncatedRule = {
	path: string;
	relativePath: string;
	body: string;
};

function formatRule(rule: TruncatedRule): string {
	return `Instructions from: ${rule.path}\n${rule.body}`;
}

function truncateRules(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): TruncatedRule[] {
	const perRuleTruncated = rules.map((rule) => ({
		path: rule.path,
		relativePath: rule.relativePath,
		body: truncateRule(rule.body, { maxChars: options.maxRuleChars, relativePath: rule.relativePath }).body,
	}));
	const budgetedRules = truncateBudget({
		rules: perRuleTruncated.map((rule) => ({ body: rule.body, relativePath: rule.relativePath })),
		maxResultChars: options.maxResultChars,
	});
	const truncatedRules: TruncatedRule[] = [];

	for (let index = 0; index < budgetedRules.length; index += 1) {
		const sourceRule = perRuleTruncated[index];
		const budgetedRule = budgetedRules[index];
		if (sourceRule === undefined || budgetedRule === undefined) {
			continue;
		}

		truncatedRules.push({
			path: sourceRule.path,
			relativePath: budgetedRule.relativePath,
			body: budgetedRule.body,
		});
	}

	return truncatedRules;
}

export function formatStaticBlock(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): string {
	if (rules.length === 0) {
		return "";
	}

	return `\n\n## Project Instructions\n${truncateRules(rules, options).map(formatRule).join("\n\n")}`;
}

export function formatDynamicBlock(
	rules: ReadonlyArray<LoadedRule>,
	targetRelativePath: string,
	options: FormatOptions,
): string {
	if (rules.length === 0) {
		return "";
	}

	return `\n\nAdditional project instructions matched for ${targetRelativePath}:\n\n${truncateRules(rules, options)
		.map(formatRule)
		.join("\n\n")}`;
}
