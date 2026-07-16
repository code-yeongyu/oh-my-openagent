import type { Position, Range, TextEdit } from "./types.js";
import { type NormalizedTextEditResult, WorkspaceEditValidationError } from "./workspace-edit-types.js";

interface IndexedTextEdit {
	readonly edit: TextEdit;
	readonly index: number;
}

interface PositionValidationContext {
	readonly lines: readonly string[];
	readonly changeIndex: number;
}

function comparePosition(left: Position, right: Position): number {
	return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function positionsEqual(left: Position, right: Position): boolean {
	return left.line === right.line && left.character === right.character;
}

function rangesEqual(left: Range, right: Range): boolean {
	return positionsEqual(left.start, right.start) && positionsEqual(left.end, right.end);
}

function isEmptyRange(range: Range): boolean {
	return positionsEqual(range.start, range.end);
}

function formatRange(range: Range): string {
	return `${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`;
}

function validatePosition(position: Position, label: string, context: PositionValidationContext): void {
	const { lines, changeIndex } = context;
	if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
		throw new WorkspaceEditValidationError(changeIndex, `${label} position must use integer line and character`);
	}
	if (position.line < 0 || position.character < 0) {
		throw new WorkspaceEditValidationError(changeIndex, `${label} position cannot be negative`);
	}
	const line = lines[position.line];
	if (line === undefined) {
		throw new WorkspaceEditValidationError(changeIndex, `${label} line ${position.line} is outside the document`);
	}
	if (position.character > line.length) {
		throw new WorkspaceEditValidationError(
			changeIndex,
			`${label} character ${position.character} is outside line ${position.line}`,
		);
	}
}

function validateRange(range: Range, lines: readonly string[], changeIndex: number): void {
	const context: PositionValidationContext = { lines, changeIndex };
	validatePosition(range.start, "start", context);
	validatePosition(range.end, "end", context);
	if (comparePosition(range.start, range.end) > 0) {
		throw new WorkspaceEditValidationError(changeIndex, `range ${formatRange(range)} ends before it starts`);
	}
}

function sortAndDeduplicate(edits: readonly TextEdit[]): readonly TextEdit[] {
	const sorted = edits
		.map<IndexedTextEdit>((edit, index) => ({ edit, index }))
		.sort((left, right) => {
			const positionOrder = comparePosition(right.edit.range.start, left.edit.range.start);
			return positionOrder === 0 ? right.index - left.index : positionOrder;
		});
	const unique: TextEdit[] = [];
	for (const entry of sorted) {
		const previous = unique.at(-1);
		if (
			previous !== undefined &&
			!isEmptyRange(entry.edit.range) &&
			rangesEqual(previous.range, entry.edit.range) &&
			previous.newText === entry.edit.newText
		) {
			continue;
		}
		unique.push(entry.edit);
	}
	return unique;
}

function validateNoOverlap(edits: readonly TextEdit[], changeIndex: number): void {
	for (let index = 0; index < edits.length - 1; index += 1) {
		const later = edits[index];
		const earlier = edits[index + 1];
		if (later === undefined || earlier === undefined) continue;
		if (comparePosition(earlier.range.end, later.range.start) > 0) {
			throw new WorkspaceEditValidationError(
				changeIndex,
				`overlapping edits ${formatRange(earlier.range)} and ${formatRange(later.range)}`,
			);
		}
	}
}

function applyNormalizedTextEdits(content: string, edits: readonly TextEdit[]): string {
	const lines = content.split("\n");
	for (const edit of edits) {
		const { start, end } = edit.range;
		const startLine = lines[start.line];
		const endLine = lines[end.line];
		if (startLine === undefined || endLine === undefined) continue;
		const replacement = startLine.slice(0, start.character) + edit.newText + endLine.slice(end.character);
		lines.splice(start.line, end.line - start.line + 1, ...replacement.split("\n"));
	}
	return lines.join("\n");
}

export function normalizeTextEdits(
	content: string,
	edits: readonly TextEdit[],
	changeIndex: number,
): NormalizedTextEditResult {
	const lines = content.split("\n");
	for (const edit of edits) {
		validateRange(edit.range, lines, changeIndex);
	}
	const normalized = sortAndDeduplicate(edits);
	validateNoOverlap(normalized, changeIndex);
	return { edits: normalized, text: applyNormalizedTextEdits(content, normalized) };
}
