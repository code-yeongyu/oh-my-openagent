import type { Theme } from "@code-yeongyu/senpi";
import type { Diagnostic } from "@oh-my-opencode/lsp-core";

import { Text, truncateToWidth } from "./rendering.js";
import {
	COLLAPSED_HEAD,
	EXPANDED_HEAD,
	PATH_BUDGET,
	type RenderResultOptions,
	type ResultLike,
	unique,
} from "./renderers-common.js";
import type { LspDiagnosticsDetails } from "./descriptors.js";
import { shorten } from "./render-format.js";

interface DiagnosticsArgs {
	filePath: string;
	severity?: string;
}

function diagSeverityKey(severity?: number): "error" | "warning" | "muted" | "dim" {
	switch (severity) {
		case 1:
			return "error";
		case 2:
			return "warning";
		case 3:
			return "muted";
		case 4:
			return "dim";
		default:
			return "muted";
	}
}

function diagSeverityChar(severity?: number): string {
	switch (severity) {
		case 1:
			return "E";
		case 2:
			return "W";
		case 3:
			return "I";
		case 4:
			return "H";
		default:
			return "?";
	}
}

export function renderDiagnosticsCall(args: DiagnosticsArgs, theme: Theme): Text {
	const head = theme.fg("toolTitle", theme.bold("lsp_diagnostics "));
	const file = theme.fg("accent", shorten(args.filePath, PATH_BUDGET));
	const sev = args.severity ? theme.fg("muted", ` [${args.severity}]`) : "";
	return new Text(head + file + sev, 0, 0);
}

export function renderDiagnosticsResult(
	result: ResultLike<LspDiagnosticsDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Text {
	if (options.isPartial) return new Text(theme.fg("warning", "Checking..."), 0, 0);

	const details = result.details;
	if (!details) return new Text(theme.fg("muted", result.content[0]?.text ?? ""), 0, 0);

	if (details.error) {
		const lines: string[] = [
			theme.fg(
				details.errorKind === "missing_dependency" ? "warning" : "error",
				details.error.split("\n")[0] ?? "error",
			),
			...details.error
				.split("\n")
				.slice(1)
				.map((l) => theme.fg("dim", `  ${l}`)),
		];
		return new Text(lines.join("\n"), 0, 0);
	}

	const total = details.totalDiagnostics;
	if (total === 0) {
		return new Text(theme.fg("success", "No diagnostics"), 0, 0);
	}

	const counts = { error: 0, warning: 0, info: 0, hint: 0 };
	for (const d of details.diagnostics) {
		switch (d.diagnostic.severity) {
			case 1:
				counts.error++;
				break;
			case 2:
				counts.warning++;
				break;
			case 3:
				counts.info++;
				break;
			case 4:
				counts.hint++;
				break;
		}
	}
	const badges: string[] = [];
	if (counts.error > 0) badges.push(theme.fg("error", `E:${counts.error}`));
	if (counts.warning > 0) badges.push(theme.fg("warning", `W:${counts.warning}`));
	if (counts.info > 0) badges.push(theme.fg("muted", `I:${counts.info}`));
	if (counts.hint > 0) badges.push(theme.fg("dim", `H:${counts.hint}`));

	const uniqueDiagnosticFiles = unique(details.diagnostics, (d) => d.file);
	const fileCount = uniqueDiagnosticFiles.length;
	const summary =
		badges.join(" ") +
		theme.fg("muted", ` • ${fileCount} file${fileCount === 1 ? "" : "s"}`) +
		(details.truncated ? theme.fg("warning", " (truncated)") : "");

	if (!options.expanded) {
		const files = uniqueDiagnosticFiles.slice(0, COLLAPSED_HEAD);
		const lines: string[] = [summary];
		for (const f of files) {
			lines.push(theme.fg("muted", `  ${shorten(f.file, PATH_BUDGET)}`));
		}
		if (uniqueDiagnosticFiles.length > COLLAPSED_HEAD) {
			lines.push(theme.fg("dim", `  … ${uniqueDiagnosticFiles.length - COLLAPSED_HEAD} more files`));
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	const grouped = new Map<string, Diagnostic[]>();
	for (const { file, diagnostic } of details.diagnostics) {
		const arr = grouped.get(file) ?? [];
		arr.push(diagnostic);
		grouped.set(file, arr);
	}

	const lines: string[] = [summary, ""];
	let renderedRows = 0;
	for (const [file, diagnostics] of grouped) {
		if (renderedRows >= EXPANDED_HEAD) break;
		lines.push(theme.fg("accent", shorten(file, PATH_BUDGET)));
		for (const d of diagnostics) {
			if (renderedRows >= EXPANDED_HEAD) break;
			const sevKey = diagSeverityKey(d.severity);
			const sev = theme.fg(sevKey, diagSeverityChar(d.severity));
			const at = theme.fg("muted", `${d.range.start.line + 1}:${d.range.start.character}`);
			const msg = theme.fg("toolOutput", truncateToWidth(d.message, 160));
			lines.push(`  ${sev} ${at}  ${msg}`);
			renderedRows++;
		}
	}
	if (total > EXPANDED_HEAD) {
		lines.push(theme.fg("dim", `… ${total - EXPANDED_HEAD} more diagnostics not shown`));
	}
	return new Text(lines.join("\n"), 0, 0);
}
