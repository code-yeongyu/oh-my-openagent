import type { Rule, Ruleset } from "../permission-system/types.ts";
import { Wildcard } from "./wildcard.ts";

declare global {
	interface Array<T> {
		findLast<S extends T>(
			predicate: (value: T, index: number, array: T[]) => value is S,
			thisArg?: unknown,
		): S | undefined;
		findLast(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): T | undefined;
	}
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
	const matchedRule = rulesets.flat().findLast((rule) => {
		return Wildcard.match(permission, rule.permission) && matchesPattern(pattern, rule.pattern);
	});

	if (matchedRule) {
		return matchedRule;
	}

	return { action: "ask", permission, pattern: "*" };
}

function matchesPattern(value: string, pattern: string): boolean {
	return Wildcard.match(value, pattern) || (pattern.endsWith(" *") && Wildcard.match(value, pattern.slice(0, -2)));
}
