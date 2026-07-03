import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../types.ts";
import { redactHookTokenValues } from "./output-bounds.ts";
import { createHookTrustEntry, type HookTrustRecord, hookTrustStorageScope, listHookTrustRecords } from "./trust.ts";
import type { HookStateStorage } from "./trust-storage.ts";
import type {
	ExecutableHookHandler,
	HookDiagnostic,
	HookRuntimeState,
	HookTrustEntry,
	ParsedHookConfig,
	SupportedHookEvent,
} from "./types.ts";

const HOOKS_USAGE = "Usage: /hooks [list|diagnostics|trust <id>|disable <id>|enable <id>|reload]";
const HOOK_SUBCOMMANDS = ["list", "diagnostics", "trust", "disable", "enable", "reload"] as const;
const DIAGNOSTIC_DISPLAY_LIMIT = 50;

type HookCommandRuntimeState = HookRuntimeState & {
	readonly storage: HookStateStorage;
};

type HookRecordPair = {
	readonly handler: ExecutableHookHandler;
	readonly record: HookTrustRecord;
};

type HookCommand =
	| { readonly kind: "list" }
	| { readonly kind: "diagnostics" }
	| { readonly kind: "reload" }
	| { readonly kind: "trust" | "disable" | "enable"; readonly id: string }
	| { readonly kind: "usage" };

export function registerHooksCommand(
	pi: ExtensionAPI,
	refreshState: (ctx: ExtensionContext) => HookCommandRuntimeState,
): void {
	pi.registerCommand("hooks", {
		description: "Inspect loaded builtin hook sources and diagnostics.",
		getArgumentCompletions: async (prefix) => hookArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			const command = parseHooksCommand(args);
			if (command.kind === "usage") {
				ctx.ui.notify(HOOKS_USAGE, "error");
				return;
			}

			if (command.kind === "reload") {
				await ctx.reload();
				ctx.ui.notify(`Reloaded hooks.\n${formatHookStatus(refreshState(ctx))}`);
				return;
			}

			const state = refreshState(ctx);
			switch (command.kind) {
				case "list":
					ctx.ui.notify(formatHookStatus(state));
					return;
				case "diagnostics":
					ctx.ui.notify(
						formatHookDiagnostics(state.parsed.diagnostics),
						state.parsed.diagnostics.length > 0 ? "warning" : "info",
					);
					return;
				case "trust":
				case "disable":
				case "enable":
					mutateHookTrust(command.kind, command.id, state, ctx);
					return;
			}
		},
	});
}

function hookArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null {
	if (/\s/.test(prefix)) {
		return [];
	}
	const completions = HOOK_SUBCOMMANDS.filter((subcommand) => subcommand.startsWith(prefix)).map((subcommand) => ({
		value: subcommand,
		label: subcommand,
	}));
	return completions.length > 0 ? completions : null;
}

function parseHooksCommand(args: string): HookCommand {
	const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
	const subcommand = tokens[0] ?? "";
	if (subcommand === "" || subcommand === "list") {
		return tokens.length <= 1 ? { kind: "list" } : { kind: "usage" };
	}
	if (subcommand === "diagnostics" || subcommand === "reload") {
		return tokens.length === 1 ? { kind: subcommand } : { kind: "usage" };
	}
	if (subcommand === "trust" || subcommand === "disable" || subcommand === "enable") {
		const id = tokens[1];
		return tokens.length === 2 && id !== undefined ? { kind: subcommand, id } : { kind: "usage" };
	}
	return { kind: "usage" };
}

function mutateHookTrust(
	action: "trust" | "disable" | "enable",
	id: string,
	state: HookCommandRuntimeState,
	ctx: ExtensionCommandContext,
): void {
	const pair = findHookRecordPair(state, id);
	if (pair === undefined) {
		ctx.ui.notify(`Hook not found: ${id}`, "error");
		return;
	}

	const scope = hookTrustStorageScope(pair.handler, { projectTrusted: ctx.isProjectTrusted() });
	if (scope === undefined) {
		ctx.ui.notify(`Hook not found: ${id}`, "error");
		return;
	}

	const entry = entryForAction(action, pair);
	state.storage.update(scope, (current) => ({
		version: 1,
		hooks: {
			...current.hooks,
			[id]: entry,
		},
	}));
	ctx.ui.notify(`${pastTenseAction(action)} hook: ${id}`);
}

function findHookRecordPair(state: HookCommandRuntimeState, id: string): HookRecordPair | undefined {
	const records = listHookTrustRecords(state.parsed.executableHandlers, state.trust, { platform: process.platform });
	const index = records.findIndex((record) => record.id === id);
	if (index < 0) return undefined;
	const handler = state.parsed.executableHandlers[index];
	const record = records[index];
	if (handler === undefined || record === undefined) return undefined;
	return { handler, record };
}

function entryForAction(action: "trust" | "disable" | "enable", pair: HookRecordPair): HookTrustEntry {
	if (action === "trust") {
		return createHookTrustEntry(pair.handler, { platform: process.platform });
	}
	return {
		enabled: action === "enable",
		...(pair.record.entry?.trustedHash === undefined ? {} : { trustedHash: pair.record.entry.trustedHash }),
		scope: pair.record.scope,
		sourcePath: pair.record.sourcePath,
		...(pair.record.matcher === undefined ? {} : { matcher: pair.record.matcher }),
		commandPreview: pair.record.commandPreview,
		updatedAt: new Date().toISOString(),
	};
}

function pastTenseAction(action: "trust" | "disable" | "enable"): string {
	switch (action) {
		case "trust":
			return "Trusted";
		case "disable":
			return "Disabled";
		case "enable":
			return "Enabled";
	}
}

export function formatHookStatus(state: HookCommandRuntimeState): string {
	const parsed = state.parsed;
	const counts = eventCounts(parsed);
	const summary =
		counts.size === 0
			? "hooks: no executable hooks"
			: `hooks: ${parsed.executableHandlers.length} executable hooks (${Array.from(counts.entries())
					.map(([event, count]) => `${event}:${count}`)
					.join(", ")})`;
	const records = listHookTrustRecords(parsed.executableHandlers, state.trust, { platform: process.platform });
	if (records.length === 0) {
		return summary;
	}
	return [summary, ...records.map((record, index) => formatHookRecord(parsed.executableHandlers[index], record))]
		.filter((line) => line.length > 0)
		.join("\n");
}

function eventCounts(parsed: ParsedHookConfig): Map<SupportedHookEvent, number> {
	const counts = new Map<SupportedHookEvent, number>();
	for (const handler of parsed.executableHandlers) {
		counts.set(handler.event, (counts.get(handler.event) ?? 0) + 1);
	}
	return counts;
}

function formatHookRecord(handler: ExecutableHookHandler | undefined, record: HookTrustRecord): string {
	if (handler === undefined) return "";
	const parts = [
		`- ${record.id}`,
		handler.event,
		`source:${record.scope}`,
		`status:${record.trusted ? "trusted" : "untrusted"}`,
		`disabled:${record.enabled ? "false" : "true"}`,
	];
	if (record.matcher !== undefined) {
		parts.push(`matcher:${sanitizeDisplayText(record.matcher)}`);
	}
	if (handler.config.statusMessage !== undefined) {
		parts.push(`statusMessage:${sanitizeDisplayText(handler.config.statusMessage)}`);
	}
	parts.push(`command:${sanitizeDisplayText(record.commandPreview)}`);
	return parts.join(" ");
}

export function formatHookDiagnostics(diagnostics: readonly HookDiagnostic[]): string {
	if (diagnostics.length === 0) {
		return "hooks diagnostics: none";
	}
	const visible = diagnostics.slice(0, DIAGNOSTIC_DISPLAY_LIMIT);
	const lines = visible.map(
		(diagnostic) =>
			`${diagnostic.severity}: ${diagnostic.code} ${sanitizeDisplayText(diagnostic.source.sourcePath)} ${sanitizeDisplayText(
				diagnostic.path,
			)} ${sanitizeDisplayText(diagnostic.message)}`,
	);
	const remaining = diagnostics.length - visible.length;
	if (remaining > 0) {
		lines.push(`... ${remaining} more diagnostics`);
	}
	return [`hooks diagnostics: ${diagnostics.length} diagnostics`, ...lines].join("\n");
}

function sanitizeDisplayText(value: string): string {
	return redactHookTokenValues(
		value
			.replace(
				/(--(?:api-key|apikey|auth|authorization|password|secret|token)=)(?:"[^"]*"|'[^']*'|\S+)/gi,
				"$1[redacted]",
			)
			.replace(
				/(--(?:api-key|apikey|auth|authorization|password|secret|token)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi,
				"$1[redacted]",
			)
			.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
			.replace(/\b(?:sk|pk|rk|glpat)-[A-Za-z0-9._-]+/g, "[redacted]"),
		"[redacted]",
	);
}
