import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

import type { LspClient } from "./client.js";
import type { FormattingOptions, TextEdit } from "./types.js";
import { normalizeTextEdits } from "./workspace-edit-text.js";

export const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = {
	tabSize: 4,
	insertSpaces: false,
	trimTrailingWhitespace: true,
	insertFinalNewline: true,
	trimFinalNewlines: true,
};

export type FormatDocumentResult =
	| { readonly status: "formatted"; readonly linesAdded: number; readonly linesRemoved: number }
	| { readonly status: "unchanged"; readonly linesAdded: 0; readonly linesRemoved: 0 }
	| { readonly status: "unavailable"; readonly reason: "capability_not_advertised" };

export interface FormatDocumentOptions {
	readonly formattingOptions?: FormattingOptions;
	readonly signal?: AbortSignal;
}

const UNCHANGED: FormatDocumentResult = { status: "unchanged", linesAdded: 0, linesRemoved: 0 };

/**
 * Formats one document through the resident language server and commits the result to disk.
 *
 * The server is asked for whole-document edits rather than formatted text, so the edits are
 * validated and applied with the same normalization the workspace-edit path uses. Nothing is
 * written when the server declines the capability or when the edits reproduce the current bytes,
 * which keeps a no-op format from touching file mtimes that downstream tooling watches.
 */
export async function formatDocumentWithClient(
	client: LspClient,
	filePath: string,
	options: FormatDocumentOptions = {},
): Promise<FormatDocumentResult> {
	const edits = await client.formatDocument(
		filePath,
		options.formattingOptions ?? DEFAULT_FORMATTING_OPTIONS,
		options.signal,
	);
	if (edits === null) return { status: "unavailable", reason: "capability_not_advertised" };
	if (edits.length === 0) return UNCHANGED;

	const before = readFileSync(filePath, "utf-8");
	const normalized = normalizeTextEdits(before, edits, 0);
	if (normalized.text === before) return UNCHANGED;

	writeAtomically(filePath, normalized.text);
	await client.openFile(filePath);

	return {
		status: "formatted",
		...lineDelta(normalized.edits),
	};
}

/**
 * Counts the lines each edit removes from the document and adds back in its place.
 *
 * Counting from the edits instead of diffing the whole file keeps the report proportional to what
 * the server actually rewrote, so an unrelated line never shows up as churn.
 */
function lineDelta(edits: readonly TextEdit[]): { readonly linesAdded: number; readonly linesRemoved: number } {
	let linesAdded = 0;
	let linesRemoved = 0;
	for (const edit of edits) {
		linesRemoved += edit.range.end.line - edit.range.start.line + 1;
		linesAdded += edit.newText.split("\n").length;
	}
	return { linesAdded, linesRemoved };
}

function writeAtomically(filePath: string, content: string): void {
	const tempPath = `${filePath}.omo-format.tmp`;
	writeFileSync(tempPath, content, "utf-8");
	try {
		renameSync(tempPath, filePath);
	} catch (error) {
		try {
			unlinkSync(tempPath);
		} catch {
			// The rename failure is the actionable error; a leftover temp file must not mask it.
		}
		throw error;
	}
}
