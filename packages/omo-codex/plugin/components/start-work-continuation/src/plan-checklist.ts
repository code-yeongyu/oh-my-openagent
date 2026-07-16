import { existsSync, readFileSync } from "node:fs";

export type PlanChecklist = {
	readonly completed: number;
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
};

const TODO_HEADING_PATTERN = /^##[ \t]+TODOs[ \t]*$/i;
const FINAL_VERIFICATION_HEADING_PATTERN = /^##[ \t]+Final Verification Wave[ \t]*$/i;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}(?:[ \t]+|$)/;
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
const TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/;
const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i;

type ChecklistSection = "todo" | "final-wave" | "other";

type ParsedCheckbox = {
	readonly checked: boolean;
	readonly label: string;
};

export function getPlanChecklist(planPath: string): PlanChecklist {
	if (!existsSync(planPath)) return emptyChecklist();

	try {
		return parsePlanChecklist(readFileSync(planPath, "utf8"));
	} catch (error) {
		if (error instanceof Error) return emptyChecklist();
		throw error;
	}
}

export function parsePlanChecklist(markdown: string): PlanChecklist {
	const lines = markdown.split(/\r?\n/);
	if (!hasStructuredSection(lines)) return parseSimpleChecklist(lines);

	let completed = 0;
	let remaining = 0;
	let nextTaskLabel: string | null = null;
	let section: ChecklistSection = "other";
	let fence: "`" | "~" | null = null;

	for (const line of lines) {
		const fenceMarker = parseFenceMarker(line);
		if (fenceMarker !== null) {
			fence = fence === null ? fenceMarker : fence === fenceMarker ? null : fence;
			continue;
		}
		if (fence !== null) continue;

		if (MARKDOWN_HEADING_PATTERN.test(line)) {
			section = parseStructuredSectionHeading(line);
			continue;
		}
		if (section === "other") continue;

		const checkbox = parseStructuredCheckbox(line, section);
		if (checkbox === null) continue;
		if (checkbox.checked) completed += 1;
		else {
			remaining += 1;
			nextTaskLabel = nextTaskLabel ?? checkbox.label;
		}
	}

	return { completed, remaining, total: completed + remaining, nextTaskLabel };
}

function hasStructuredSection(lines: readonly string[]): boolean {
	let fence: "`" | "~" | null = null;
	for (const line of lines) {
		const fenceMarker = parseFenceMarker(line);
		if (fenceMarker !== null) {
			fence = fence === null ? fenceMarker : fence === fenceMarker ? null : fence;
			continue;
		}
		if (fence === null && parseStructuredSectionHeading(line) !== "other") return true;
	}
	return false;
}

function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
	let completed = 0;
	let remaining = 0;
	let nextTaskLabel: string | null = null;

	for (const line of lines) {
		const checkbox = parseSimpleTopLevelCheckbox(line);
		if (checkbox === null) continue;
		if (checkbox.checked) completed += 1;
		else {
			remaining += 1;
			nextTaskLabel = nextTaskLabel ?? checkbox.label;
		}
	}

	return { completed, remaining, total: completed + remaining, nextTaskLabel };
}

function parseStructuredSectionHeading(line: string): ChecklistSection {
	if (TODO_HEADING_PATTERN.test(line)) return "todo";
	if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) return "final-wave";
	return "other";
}

function parseStructuredCheckbox(line: string, section: "todo" | "final-wave"): ParsedCheckbox | null {
	const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN;
	const match = line.match(pattern);
	const marker = match?.[1];
	const label = match?.[2];
	if (marker === undefined || label === undefined) return null;
	return { checked: marker.toLowerCase() === "x", label };
}

function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
	const match = line.match(SIMPLE_CHECKBOX_PATTERN);
	const marker = match?.[1];
	const label = match?.[2];
	if (marker === undefined || label === undefined) return null;
	return { checked: marker.toLowerCase() === "x", label };
}

function parseFenceMarker(line: string): "`" | "~" | null {
	const marker = line.match(FENCE_PATTERN)?.[1]?.[0];
	return marker === "`" || marker === "~" ? marker : null;
}

function emptyChecklist(): PlanChecklist {
	return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null };
}
