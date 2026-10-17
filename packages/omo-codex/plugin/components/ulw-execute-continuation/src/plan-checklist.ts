import { existsSync, readFileSync } from "node:fs";

export type PlanChecklist = {
	readonly completed: number;
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
};

const TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
const FINAL_VERIFICATION_HEADING_PATTERN = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
const SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/;
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX~]?)[ \t]*\][ \t]+(.+)$/;
const STRUCTURED_CHECKBOX_PATTERN = /^- \[([ xX~])\] (.+)$/;
const TODO_TASK_LABEL_PATTERN =
	/^([1-9]\d*|T[1-9]\d*(?:\.[1-9]\d*[a-z]?)?)(?:\.[ \t]+|[ \t]+(?:[-\u2014][ \t]+)?)(.+)$/i;
const FINAL_WAVE_TASK_LABEL_PATTERN =
	/^([FH][1-9]\d*(?:\.[1-9]\d*[a-z]?)?)(?:\.[ \t]+|[ \t]+(?:[-\u2014][ \t]+)?)(.+)$/i;

type ChecklistSection = "todo" | "final-wave" | "other";

// Mirrors @oh-my-opencode/boulder-state's plan grammar: `[~]` marks a blocked task that counts toward
// the total but is neither completed nor remaining work.
type CheckboxStatus = "open" | "done" | "in-progress";

type ParsedCheckbox = {
	readonly status: CheckboxStatus;
	readonly label: string;
};

type ChecklistCounter = {
	completed: number;
	remaining: number;
	total: number;
	nextTaskLabel: string | null;
};

type MarkdownFence = {
	readonly marker: "`" | "~";
	readonly length: number;
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

	const counter = emptyCounter();
	let hasUntrackedTopLevelCheckbox = false;
	let section: ChecklistSection = "other";
	let fence: MarkdownFence | null = null;

	for (const line of lines) {
		if (fence !== null) {
			if (isClosingFence(line, fence)) fence = null;
			continue;
		}
		const openingFence = parseOpeningFence(line);
		if (openingFence !== null) {
			fence = openingFence;
			continue;
		}

		if (SECTION_BOUNDARY_HEADING_PATTERN.test(line)) {
			section = parseStructuredSectionHeading(line);
			continue;
		}
		if (section === "other") {
			if (parseSimpleTopLevelCheckbox(line) !== null) hasUntrackedTopLevelCheckbox = true;
			continue;
		}

		const checkbox = parseStructuredCheckbox(line, section);
		if (checkbox !== null) countCheckbox(counter, checkbox);
	}

	// Canonical headings that hold only template text while the real rows live under another heading
	// would otherwise count nothing; fall back to every top-level checkbox in that case.
	if (counter.total === 0 && hasUntrackedTopLevelCheckbox) return parseSimpleChecklist(lines);
	return { ...counter };
}

function emptyCounter(): ChecklistCounter {
	return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null };
}

function countCheckbox(counter: ChecklistCounter, checkbox: ParsedCheckbox): void {
	counter.total += 1;
	if (checkbox.status === "done") counter.completed += 1;
	else if (checkbox.status === "open") {
		counter.remaining += 1;
		counter.nextTaskLabel = counter.nextTaskLabel ?? checkbox.label;
	}
}

function hasStructuredSection(lines: readonly string[]): boolean {
	let fence: MarkdownFence | null = null;
	for (const line of lines) {
		if (fence !== null) {
			if (isClosingFence(line, fence)) fence = null;
			continue;
		}
		const openingFence = parseOpeningFence(line);
		if (openingFence !== null) {
			fence = openingFence;
			continue;
		}
		if (parseStructuredSectionHeading(line) !== "other") return true;
	}
	return false;
}

function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
	const counter = emptyCounter();
	let fence: MarkdownFence | null = null;

	for (const line of lines) {
		if (fence !== null) {
			if (isClosingFence(line, fence)) fence = null;
			continue;
		}
		const openingFence = parseOpeningFence(line);
		if (openingFence !== null) {
			fence = openingFence;
			continue;
		}

		const checkbox = parseSimpleTopLevelCheckbox(line);
		if (checkbox !== null) countCheckbox(counter, checkbox);
	}

	return { ...counter };
}

function parseStructuredSectionHeading(line: string): ChecklistSection {
	if (TODO_HEADING_PATTERN.test(line)) return "todo";
	if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) return "final-wave";
	return "other";
}

function parseStructuredCheckbox(line: string, section: "todo" | "final-wave"): ParsedCheckbox | null {
	const match = line.match(STRUCTURED_CHECKBOX_PATTERN);
	const marker = match?.[1];
	const label = match?.[2];
	if (marker === undefined || label === undefined) return null;
	const labelPattern = section === "todo" ? TODO_TASK_LABEL_PATTERN : FINAL_WAVE_TASK_LABEL_PATTERN;
	if (!labelPattern.test(label)) return null;
	return { status: parseCheckboxStatus(marker), label };
}

function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
	const match = line.match(SIMPLE_CHECKBOX_PATTERN);
	const marker = match?.[1];
	const label = match?.[2];
	if (marker === undefined || label === undefined) return null;
	return { status: parseCheckboxStatus(marker), label };
}

function parseCheckboxStatus(marker: string): CheckboxStatus {
	if (marker.toLowerCase() === "x") return "done";
	return marker === "~" ? "in-progress" : "open";
}

function parseOpeningFence(line: string): MarkdownFence | null {
	const match = line.match(FENCE_PATTERN);
	const run = match?.[1];
	const info = match?.[2];
	const marker = run?.charAt(0);
	if (
		run === undefined ||
		info === undefined ||
		(marker !== "`" && marker !== "~") ||
		(marker === "`" && info.includes("`"))
	)
		return null;
	return { marker, length: run.length };
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
	const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
	return run?.charAt(0) === fence.marker && run.length >= fence.length;
}

function emptyChecklist(): PlanChecklist {
	return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null };
}
