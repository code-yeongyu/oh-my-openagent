import type { ExtensionAPI, ExtensionCommandContext } from "../../types.ts";

import type { Engine } from "./rules/engine.ts";
import type { LoadedRule, MatchReason, RuleDiagnostic } from "./rules/types.ts";

const RULE_SUBCOMMANDS = ["list", "show", "paths", "status"] as const;

export function registerSlashCommands(pi: ExtensionAPI, engine: Engine): void {
	pi.registerCommand("rules", {
		description: "Inspect loaded pi-rules.",
		getArgumentCompletions: (prefix) => {
			const completions = RULE_SUBCOMMANDS.filter((subcommand) => subcommand.startsWith(prefix)).map(
				(subcommand) => ({
					value: subcommand,
					label: subcommand,
				}),
			);
			return completions.length > 0 ? completions : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
			const subcommand = tokens[0] ?? "";
			const loaded = engine.loadStaticRules(ctx.cwd);

			if (subcommand === "" || subcommand === "status") {
				notify(ctx, buildSummaryText(loaded.rules, loaded.diagnostics));
				return;
			}

			if (subcommand === "list") {
				notify(ctx, formatRuleList(loaded.rules));
				return;
			}

			if (subcommand === "show") {
				const id = tokens[1] ?? "";
				const rule = findRuleById(loaded.rules, id);
				if (rule === null) {
					notify(ctx, `Rule not found: ${id}`, "error");
					return;
				}

				notify(ctx, rule.body);
				return;
			}

			if (subcommand === "paths") {
				notify(ctx, loaded.rules.map((rule) => rule.path).join("\n"));
				return;
			}

			notify(ctx, `Unknown /rules subcommand: ${subcommand}`, "error");
		},
	});

	pi.registerCommand("reload-rules", {
		description: "Reload pi-rules for the current session.",
		handler: async (_args, ctx) => {
			engine.resetSession(ctx.cwd);
			const loaded = engine.loadStaticRules(ctx.cwd);
			notify(ctx, buildReloadText(loaded.rules, loaded.diagnostics));
		},
	});
}

function notify(ctx: ExtensionCommandContext, message: string, severity: "info" | "warning" | "error" = "info"): void {
	ctx.ui.notify(message, severity);
}

function buildSummaryText(rules: ReadonlyArray<LoadedRule>, diagnostics: ReadonlyArray<RuleDiagnostic>): string {
	return appendDiagnostics(`pi-rules: ${rules.length} rules from ${countSources(rules)} sources`, diagnostics);
}

function buildReloadText(rules: ReadonlyArray<LoadedRule>, diagnostics: ReadonlyArray<RuleDiagnostic>): string {
	return appendDiagnostics(`Reloaded ${rules.length} rules from ${countSources(rules)} sources`, diagnostics);
}

function appendDiagnostics(text: string, diagnostics: ReadonlyArray<RuleDiagnostic>): string {
	return diagnostics.length === 0 ? text : `${text}, ${diagnostics.length} diagnostics`;
}

function countSources(rules: ReadonlyArray<LoadedRule>): number {
	return new Set(rules.map((rule) => rule.source)).size;
}

function formatRuleList(rules: ReadonlyArray<LoadedRule>): string {
	return rules
		.map((rule) => `${rule.relativePath} [${rule.source}, ${formatMatchReason(rule.matchReason)}]`)
		.join("\n");
}

function formatMatchReason(matchReason: MatchReason): string {
	if (typeof matchReason === "string") {
		return matchReason;
	}
	if (matchReason.kind === "no-match") {
		return matchReason.kind;
	}

	return `${matchReason.kind}:${matchReason.pattern}`;
}

function findRuleById(rules: ReadonlyArray<LoadedRule>, id: string): LoadedRule | null {
	const exactMatch = rules.find((rule) => rule.relativePath === id);
	if (exactMatch !== undefined) {
		return exactMatch;
	}

	const suffixMatches = rules.filter((rule) => rule.relativePath.endsWith(id));
	return suffixMatches.length === 1 ? (suffixMatches[0] ?? null) : null;
}
