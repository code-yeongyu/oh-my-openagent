import type { Theme } from "@code-yeongyu/senpi";

import { Text } from "./rendering.js";
import {
	COLLAPSED_HEAD,
	EXPANDED_HEAD,
	PATH_BUDGET,
	type PositionArgs,
	type RenderResultOptions,
	type ResultLike,
	renderPositionCall,
} from "./renderers-common.js";
import type { LspPrepareRenameDetails, LspRenameDetails } from "./descriptors.js";
import { shorten } from "./render-format.js";

interface RenameArgs extends PositionArgs {
	newName: string;
}

export function renderPrepareRenameCall(args: PositionArgs, theme: Theme): Text {
	return new Text(renderPositionCall("lsp_prepare_rename", args, theme), 0, 0);
}

export function renderPrepareRenameResult(
	result: ResultLike<LspPrepareRenameDetails>,
	_options: RenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details?.error) {
		return new Text(theme.fg("warning", details.error.split("\n")[0] ?? "error"), 0, 0);
	}
	const fallback = result.content[0]?.text ?? "";
	if (fallback.startsWith("Rename")) {
		return new Text(theme.fg("success", fallback), 0, 0);
	}
	return new Text(theme.fg("muted", fallback), 0, 0);
}

export function renderRenameCall(args: RenameArgs, theme: Theme): Text {
	const loc = renderPositionCall("lsp_rename", args, theme);
	const arrow = theme.fg("muted", " → ");
	const newName = theme.fg("accent", `"${args.newName}"`);
	return new Text(loc + arrow + newName, 0, 0);
}

export function renderRenameResult(
	result: ResultLike<LspRenameDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details?.error) {
		return new Text(theme.fg("warning", details.error.split("\n")[0] ?? "error"), 0, 0);
	}
	if (!details?.apply) {
		return new Text(theme.fg("dim", result.content[0]?.text ?? "No edit applied"), 0, 0);
	}
	const apply = details.apply;
	if (!apply.success) {
		const lines: string[] = [theme.fg("error", "Rename failed")];
		for (const err of apply.errors.slice(0, 5)) {
			lines.push(theme.fg("dim", `  ${err}`));
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	const summary =
		theme.fg("success", `Applied ${apply.totalEdits} edit${apply.totalEdits === 1 ? "" : "s"}`) +
		theme.fg("muted", ` to ${apply.filesModified.length} file${apply.filesModified.length === 1 ? "" : "s"}`);

	if (!options.expanded) {
		const head = apply.filesModified.slice(0, COLLAPSED_HEAD);
		const lines: string[] = [summary];
		for (const f of head) {
			lines.push(theme.fg("muted", `  ${shorten(f, PATH_BUDGET)}`));
		}
		if (apply.filesModified.length > COLLAPSED_HEAD) {
			lines.push(theme.fg("dim", `  … ${apply.filesModified.length - COLLAPSED_HEAD} more`));
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	const lines: string[] = [summary, ""];
	const display = apply.filesModified.slice(0, EXPANDED_HEAD);
	for (const f of display) {
		lines.push(theme.fg("accent", `  ${shorten(f, PATH_BUDGET)}`));
	}
	if (apply.filesModified.length > EXPANDED_HEAD) {
		lines.push(theme.fg("dim", `… ${apply.filesModified.length - EXPANDED_HEAD} more`));
	}
	return new Text(lines.join("\n"), 0, 0);
}
