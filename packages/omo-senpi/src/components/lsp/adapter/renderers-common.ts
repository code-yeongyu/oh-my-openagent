import type { Theme } from "@code-yeongyu/senpi";

import type { Location, LocationLink } from "@oh-my-opencode/lsp-core"

import { shorten, uriToPath } from "./render-format.js";
import { SYMBOL_KIND_MAP } from "./language-mappings.js";

export const COLLAPSED_HEAD = 3;
export const EXPANDED_HEAD = 20;
export const PATH_BUDGET = 80;

export interface ResultLike<TDetails> {
	content: ReadonlyArray<{ type: string; text?: string }>;
	details?: TDetails;
}

export interface RenderResultOptions {
	expanded?: boolean;
	isPartial?: boolean;
}

export interface PositionArgs {
	filePath: string;
	line: number;
	character: number;
}

export function locText(loc: Location | LocationLink): string {
	if ("targetUri" in loc) {
		return `${shorten(uriToPath(loc.targetUri), PATH_BUDGET)}:${loc.targetRange.start.line + 1}:${loc.targetRange.start.character}`;
	}
	return `${shorten(uriToPath(loc.uri), PATH_BUDGET)}:${loc.range.start.line + 1}:${loc.range.start.character}`;
}

export function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const k = key(item);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(item);
	}
	return out;
}

export function symbolKindName(kind: number): string {
	return SYMBOL_KIND_MAP[kind] ?? `Kind(${kind})`;
}

export function renderPositionCall(toolName: string, args: PositionArgs, theme: Theme): string {
	const head = theme.fg("toolTitle", theme.bold(`${toolName} `));
	const loc = theme.fg("accent", `${shorten(args.filePath, PATH_BUDGET)}:${args.line}:${args.character}`);
	return head + loc;
}
