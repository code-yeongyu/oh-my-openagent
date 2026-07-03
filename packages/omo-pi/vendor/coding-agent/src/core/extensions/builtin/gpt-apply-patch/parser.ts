import { normalizePatchText, stripHeredoc } from "./text.ts";
import type { ParsedPatch, PatchChunk } from "./types.ts";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";

function parseAddHunk(lines: string[], index: number, endIndex: number): [ParsedPatch, number] {
	const filePath = (lines[index] ?? "").slice(ADD_FILE_MARKER.length);
	const contentLines: string[] = [];
	let nextIndex = index + 1;
	while (nextIndex < endIndex) {
		const nextLine = lines[nextIndex] ?? "";
		if (nextLine.startsWith("*** ")) break;
		if (!nextLine.startsWith("+")) throw new Error("Invalid patch format: Add File lines must start with '+'");
		contentLines.push(nextLine.slice(1));
		nextIndex++;
	}
	const content = contentLines.length === 0 ? "" : `${contentLines.join("\n")}\n`;
	return [{ type: "add", filePath, content }, nextIndex];
}

function collectChangeContexts(lines: string[], index: number, endIndex: number): [string[], number] {
	const changeContexts: string[] = [];
	let nextIndex = index;
	while (nextIndex < endIndex) {
		const contextLine = lines[nextIndex] ?? "";
		if (contextLine === "@@") {
			nextIndex++;
			continue;
		}
		if (contextLine.startsWith("@@ ")) {
			changeContexts.push(contextLine.slice("@@ ".length));
			nextIndex++;
			continue;
		}
		break;
	}
	return [changeContexts, nextIndex];
}

function parseChunkLines(
	lines: string[],
	index: number,
	endIndex: number,
): [Omit<PatchChunk, "changeContexts">, number] {
	const oldLines: string[] = [];
	const newLines: string[] = [];
	let isEndOfFile = false;
	let parsedLines = 0;
	let nextIndex = index;
	while (nextIndex < endIndex) {
		const hunkLine = lines[nextIndex] ?? "";
		if (hunkLine === EOF_MARKER) {
			if (parsedLines === 0) throw new Error("Update hunk does not contain any lines");
			isEndOfFile = true;
			nextIndex++;
			break;
		}
		if (hunkLine.startsWith("@@") || hunkLine.startsWith("*** ")) break;
		const prefix = hunkLine[0];
		const value = hunkLine.slice(1);
		if (prefix === undefined) {
			oldLines.push("");
			newLines.push("");
		} else if (prefix === " ") {
			oldLines.push(value);
			newLines.push(value);
		} else if (prefix === "-") {
			oldLines.push(value);
		} else if (prefix === "+") {
			newLines.push(value);
		} else if (parsedLines > 0) {
			break;
		} else {
			throw new Error(
				`Unexpected line found in update hunk: '${hunkLine}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
			);
		}
		parsedLines++;
		nextIndex++;
	}
	if (parsedLines === 0) throw new Error("Update hunk does not contain any lines");
	return [{ oldLines, newLines, isEndOfFile }, nextIndex];
}

function parseUpdateHunk(lines: string[], index: number, endIndex: number): [ParsedPatch, number] {
	const filePath = (lines[index] ?? "").slice(UPDATE_FILE_MARKER.length);
	let nextIndex = index + 1;
	let movePath: string | undefined;
	if ((lines[nextIndex] ?? "").startsWith(MOVE_TO_MARKER)) {
		movePath = (lines[nextIndex] ?? "").slice(MOVE_TO_MARKER.length);
		nextIndex++;
	}
	const chunks: PatchChunk[] = [];
	while (nextIndex < endIndex) {
		const nextLine = lines[nextIndex] ?? "";
		if (nextLine.trim() === "") {
			nextIndex++;
			continue;
		}
		if (nextLine.startsWith("*** ")) break;
		if (!nextLine.startsWith("@@") && chunks.length > 0) {
			throw new Error(`Expected update hunk to start with a @@ context marker, got: '${nextLine}'`);
		}
		const contextResult = nextLine.startsWith("@@")
			? collectChangeContexts(lines, nextIndex, endIndex)
			: [[], nextIndex];
		const [changeContexts, afterContexts] = contextResult as [string[], number];
		const [chunk, afterChunk] = parseChunkLines(lines, afterContexts, endIndex);
		chunks.push({ changeContexts, ...chunk });
		nextIndex = afterChunk;
	}
	if (chunks.length === 0 && !movePath) throw new Error(`Update file hunk for path '${filePath}' is empty`);
	return [{ type: "update", filePath, movePath, chunks }, nextIndex];
}

export function parsePatch(patchText: string): ParsedPatch[] {
	const normalized = stripHeredoc(normalizePatchText(patchText).trim()).trim();
	const lines = normalized.split("\n");
	const endIndex = lines[lines.length - 1]?.trim() === END_PATCH_MARKER ? lines.length - 1 : -1;
	if (lines[0]?.trim() !== BEGIN_PATCH_MARKER || endIndex < 0) {
		throw new Error("Invalid patch format: expected *** Begin Patch ... *** End Patch envelope");
	}

	const hunks: ParsedPatch[] = [];
	let index = 1;
	while (index < endIndex) {
		const line = lines[index] ?? "";
		if (!line.startsWith("*** ")) {
			index++;
			continue;
		}
		if (line.startsWith(ADD_FILE_MARKER)) {
			const [hunk, nextIndex] = parseAddHunk(lines, index, endIndex);
			hunks.push(hunk);
			index = nextIndex;
			continue;
		}
		if (line.startsWith(DELETE_FILE_MARKER)) {
			hunks.push({ type: "delete", filePath: line.slice(DELETE_FILE_MARKER.length) });
			index++;
			continue;
		}
		if (line.startsWith(UPDATE_FILE_MARKER)) {
			const [hunk, nextIndex] = parseUpdateHunk(lines, index, endIndex);
			hunks.push(hunk);
			index = nextIndex;
			continue;
		}
		throw new Error(
			`'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
		);
	}
	return hunks;
}
