import type { Theme } from "@code-yeongyu/senpi";
import type { DocumentSymbol, SymbolInfo } from "@oh-my-opencode/lsp-core";

import { Text } from "./rendering.js";
import {
	COLLAPSED_HEAD,
	EXPANDED_HEAD,
	PATH_BUDGET,
	locText,
	type RenderResultOptions,
	type ResultLike,
	symbolKindName,
} from "./renderers-common.js";
import type { LspSymbolsDetails } from "./descriptors.js";
import { shorten } from "./render-format.js";

interface SymbolsArgs {
	filePath: string;
	scope: "document" | "workspace";
	query?: string;
}

function isDocumentSymbol(symbol: DocumentSymbol | SymbolInfo): symbol is DocumentSymbol {
	return "range" in symbol;
}

function renderDocumentSymbol(s: DocumentSymbol, indent: number, theme: Theme): string {
	const prefix = "  ".repeat(indent);
	const kind = theme.fg("muted", `(${symbolKindName(s.kind)})`);
	const name = theme.fg("accent", s.name);
	const at = theme.fg("dim", `L${s.range.start.line + 1}`);
	const lines: string[] = [`${prefix}${name} ${kind} ${at}`];
	if (s.children) {
		for (const child of s.children) {
			lines.push(renderDocumentSymbol(child, indent + 1, theme));
		}
	}
	return lines.join("\n");
}

export function renderSymbolsCall(args: SymbolsArgs, theme: Theme): Text {
	const head = theme.fg("toolTitle", theme.bold("lsp_symbols "));
	const scope = theme.fg("muted", `[${args.scope}]`);
	if (args.scope === "workspace") {
		const q = theme.fg("accent", ` "${shorten(args.query ?? "", 40)}"`);
		return new Text(head + scope + q, 0, 0);
	}
	const file = theme.fg("accent", ` ${shorten(args.filePath, PATH_BUDGET)}`);
	return new Text(head + scope + file, 0, 0);
}

export function renderSymbolsResult(
	result: ResultLike<LspSymbolsDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details?.error) {
		return new Text(theme.fg("warning", details.error.split("\n")[0] ?? "error"), 0, 0);
	}
	if (!details || details.totalSymbols === 0) {
		return new Text(theme.fg("dim", "No symbols"), 0, 0);
	}

	const total = details.totalSymbols;
	const summary =
		theme.fg("success", `${total} symbol${total === 1 ? "" : "s"}`) +
		theme.fg("muted", ` • ${details.scope}`) +
		(details.truncated ? theme.fg("warning", " (truncated)") : "");

	if (!options.expanded) {
		const head = details.symbols.slice(0, COLLAPSED_HEAD);
		const lines: string[] = [summary];
		for (const s of head) {
			lines.push(theme.fg("muted", `  ${s.name}`));
		}
		if (total > COLLAPSED_HEAD) {
			lines.push(theme.fg("dim", `  … ${total - COLLAPSED_HEAD} more`));
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	const lines: string[] = [summary, ""];
	let rendered = 0;
	for (const s of details.symbols) {
		if (rendered >= EXPANDED_HEAD) break;
		if (isDocumentSymbol(s)) {
			lines.push(renderDocumentSymbol(s, 0, theme));
		} else {
			const kind = theme.fg("muted", `(${symbolKindName(s.kind)})`);
			const name = theme.fg("accent", s.name);
			const loc = theme.fg("dim", locText(s.location));
			lines.push(`${name} ${kind}  ${loc}`);
		}
		rendered++;
	}
	if (total > rendered) {
		lines.push(theme.fg("dim", `… ${total - rendered} more`));
	}
	return new Text(lines.join("\n"), 0, 0);
}
