import { seekSequenceWithFuzz } from "./seek-sequence.ts";
import { normalizePatchText } from "./text.ts";
import type { PatchChunk } from "./types.ts";

function splitFileLines(content: string): string[] {
	const lines = normalizePatchText(content).split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

export function replaceChunks(
	content: string,
	filePath: string,
	chunks: PatchChunk[],
): { content: string; fuzz: number } {
	const originalLines = splitFileLines(content);
	const replacements: { start: number; oldLength: number; newLines: string[] }[] = [];
	let lineIndex = 0;
	let fuzz = 0;

	for (const chunk of chunks) {
		for (const changeContext of chunk.changeContexts) {
			const contextIndex = seekSequenceWithFuzz(originalLines, [changeContext], lineIndex, false);
			if (contextIndex === undefined) throw new Error(`Failed to find context '${changeContext}' in ${filePath}`);
			fuzz += contextIndex.fuzz;
			lineIndex = contextIndex.index + 1;
		}

		if (chunk.oldLines.length === 0) {
			const insertionIndex =
				originalLines[originalLines.length - 1] === "" ? originalLines.length - 1 : originalLines.length;
			replacements.push({ start: insertionIndex, oldLength: 0, newLines: chunk.newLines });
			continue;
		}

		let pattern = chunk.oldLines;
		let newLines = chunk.newLines;
		let foundAt = seekSequenceWithFuzz(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		if (foundAt === undefined && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newLines[newLines.length - 1] === "") newLines = newLines.slice(0, -1);
			foundAt = seekSequenceWithFuzz(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}

		if (foundAt === undefined)
			throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
		fuzz += foundAt.fuzz;
		replacements.push({ start: foundAt.index, oldLength: pattern.length, newLines });
		lineIndex = foundAt.index + pattern.length;
	}

	const nextLines = [...originalLines];
	for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
		nextLines.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
	}
	nextLines.push("");
	return { content: nextLines.join("\n"), fuzz };
}
