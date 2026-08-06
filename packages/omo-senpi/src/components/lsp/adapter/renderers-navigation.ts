import type { Theme } from "@code-yeongyu/senpi";

import { uriToPath } from "./render-format.js";
import { Text } from "./rendering.js";
import {
	COLLAPSED_HEAD,
	EXPANDED_HEAD,
	PATH_BUDGET,
	locText,
	type PositionArgs,
	type RenderResultOptions,
	type ResultLike,
	renderPositionCall,
	unique,
} from "./renderers-common.js";
import type { LspFindReferencesDetails, LspGotoDefinitionDetails } from "./descriptors.js";
import { shorten } from "./render-format.js";

export function renderGotoDefinitionCall(args: PositionArgs, theme: Theme): Text {
	return new Text(renderPositionCall("lsp_goto_definition", args, theme), 0, 0);
}

export function renderGotoDefinitionResult(
	result: ResultLike<LspGotoDefinitionDetails>,
	_options: RenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details?.error) {
		return new Text(theme.fg("warning", details.error.split("\n")[0] ?? "error"), 0, 0);
	}
	if (!details || details.locations.length === 0) {
		return new Text(theme.fg("dim", "No definition found"), 0, 0);
	}
	const [head] = details.locations;
	if (!head) {
		return new Text(theme.fg("dim", "No definition found"), 0, 0);
	}
	const more = details.locations.length - 1;
	const headStr = theme.fg("success", "→ ") + theme.fg("accent", locText(head));
	const tail = more > 0 ? theme.fg("dim", ` (+${more} more)`) : "";
	return new Text(headStr + tail, 0, 0);
}

export function renderFindReferencesCall(args: PositionArgs & { includeDeclaration?: boolean }, theme: Theme): Text {
	return new Text(renderPositionCall("lsp_find_references", args, theme), 0, 0);
}

export function renderFindReferencesResult(
	result: ResultLike<LspFindReferencesDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details?.error) {
		return new Text(theme.fg("warning", details.error.split("\n")[0] ?? "error"), 0, 0);
	}
	if (!details || details.totalReferences === 0) {
		return new Text(theme.fg("dim", "No references"), 0, 0);
	}
	const total = details.totalReferences;
	const fileCount = unique(details.references, (r) => r.uri).length;
	const summary =
		theme.fg("success", `${total} reference${total === 1 ? "" : "s"}`) +
		theme.fg("muted", ` • ${fileCount} file${fileCount === 1 ? "" : "s"}`) +
		(details.truncated ? theme.fg("warning", " (truncated)") : "");

	if (!options.expanded) {
		const head = unique(details.references, (r) => r.uri).slice(0, COLLAPSED_HEAD);
		const lines: string[] = [summary];
		for (const ref of head) {
			lines.push(theme.fg("muted", `  ${shorten(uriToPath(ref.uri), PATH_BUDGET)}`));
		}
		if (fileCount > COLLAPSED_HEAD) {
			lines.push(theme.fg("dim", `  … ${fileCount - COLLAPSED_HEAD} more files`));
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	const display = details.references.slice(0, EXPANDED_HEAD);
	const lines: string[] = [summary, ""];
	for (const ref of display) {
		lines.push(theme.fg("accent", locText(ref)));
	}
	if (total > EXPANDED_HEAD) {
		lines.push(theme.fg("dim", `… ${total - EXPANDED_HEAD} more references`));
	}
	return new Text(lines.join("\n"), 0, 0);
}
