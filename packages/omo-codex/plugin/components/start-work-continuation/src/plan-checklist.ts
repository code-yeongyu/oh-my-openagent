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
const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
const TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/;
const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i;

type ChecklistSection = "todo" | "final-wave" | "other";

type ParsedCheckbox = {
	readonly checked: boolean;
	readonly label: string;
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

	let completed = 0;
	let remaining = 0;
	let nextTaskLabel: string | null = null;
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
	let completed = 0;
	let remaining = 0;
	let nextTaskLabel: string | null = null;
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
