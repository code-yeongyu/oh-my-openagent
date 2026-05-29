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
		// Plugin-bundled rules ship as-is. The per-rule cap exists to guard against absurd
		// user-authored AGENTS.md files; bundled rules are author-controlled and silent
		// mid-section truncation would break the contract that the rule landed in full.
		// The overall maxResultChars budget still applies via truncateBudget below.
		body:
			rule.source === "plugin-bundled"
				? rule.body
				: truncateRule(rule.body, { maxChars: options.maxRuleChars, relativePath: rule.relativePath }).body,
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

	return `\n\n## Project Instructions\n${truncateRules(uniqueRulesByBody(rules), options).map(formatRule).join("\n\n")}`;
}

function uniqueRulesByBody(rules: ReadonlyArray<LoadedRule>): LoadedRule[] {
	const uniqueRules: LoadedRule[] = [];
	const seenBodies = new Set<string>();
	const userDescriptions = new Set<string>();
	for (const rule of rules) {
		const descriptionKey = rule.frontmatter.description?.trim();
		if (rule.source === "plugin-bundled" && descriptionKey !== undefined && userDescriptions.has(descriptionKey)) {
			continue;
		}

		const bodyKey = rule.body.trim();
		if (seenBodies.has(bodyKey)) {
			continue;
		}

		seenBodies.add(bodyKey);
		if (descriptionKey !== undefined && rule.source !== "plugin-bundled") {
			userDescriptions.add(descriptionKey);
		}
		uniqueRules.push(rule);
	}
	return uniqueRules;
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
