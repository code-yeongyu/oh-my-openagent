import { criteriaSummary } from "./evidence.js";
import { redactSnapshotText } from "./snapshot-redaction.js";
import type { RenderUlwLoopResumeSnapshotInput, SnapshotChangedFileSummary } from "./snapshot-types.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import {
	SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS,
	SNAPSHOT_MAX_CHANGED_FILES,
	SNAPSHOT_MAX_EVIDENCE_EXCERPT_CHARS,
	SNAPSHOT_MAX_EVIDENCE_ITEMS,
	SNAPSHOT_MAX_FILE_SIZE_BYTES,
	SNAPSHOT_MAX_PENDING_CRITERIA,
	ULW_LOOP_CRITERION_STATUSES,
	ULW_LOOP_STATUSES,
} from "./types.js";

function truncateText(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	if (maxBytes <= 1) return "";
	const suffix = "…";
	const budget = maxBytes - Buffer.byteLength(suffix, "utf8");
	let truncated = "";
	for (const character of value) {
		if (Buffer.byteLength(truncated + character, "utf8") > budget) break;
		truncated += character;
	}
	return `${truncated}${suffix}`;
}

function boundedRedacted(value: string, maxChars: number): string {
	return truncateText(redactSnapshotText(value).replace(/\s+/g, " ").trim(), maxChars);
}

function activeGoalOf(plan: UlwLoopPlan): UlwLoopItem | undefined {
	if (plan.activeGoalId !== undefined) return plan.goals.find((goal) => goal.id === plan.activeGoalId);
	return plan.goals.find((goal) => goal.status === "in_progress");
}

function goalStatusLines(plan: UlwLoopPlan): string[] {
	return ULW_LOOP_STATUSES.map((status) => ({
		status,
		count: plan.goals.filter((goal) => goal.status === status).length,
	}))
		.filter((entry) => entry.count > 0)
		.map((entry) => `- ${entry.status}: ${entry.count}`);
}

function criteriaStatusLines(plan: UlwLoopPlan): string[] {
	const summary = criteriaSummary(plan);
	return ULW_LOOP_CRITERION_STATUSES.map((status) => {
		switch (status) {
			case "pending":
				return `- pending: ${summary.pendingCount}`;
			case "pass":
				return `- pass: ${summary.passCount}`;
			case "fail":
				return `- fail: ${summary.failCount}`;
			case "blocked":
				return `- blocked: ${summary.blockedCount}`;
			default:
				return assertNeverStatus(status);
		}
	});
}

function assertNeverStatus(status: never): never {
	throw new Error(`Unhandled criterion status: ${String(status)}`);
}

function pendingCriteriaLines(plan: UlwLoopPlan): string[] {
	const source = plan.goals.flatMap((goal) =>
		goal.successCriteria
			.filter((criterion) => criterion.status === "pending")
			.map((criterion) => `- ${goal.id}/${criterion.id} [pending] ${boundedRedacted(criterion.scenario, 160)}`),
	);
	const lines = source.slice(0, SNAPSHOT_MAX_PENDING_CRITERIA);
	if (source.length > SNAPSHOT_MAX_PENDING_CRITERIA)
		lines.push(`- Showing first ${SNAPSHOT_MAX_PENDING_CRITERIA} pending criteria.`);
	return lines.length === 0 ? ["- None"] : lines;
}

function evidenceLines(items: readonly string[] | undefined): string[] {
	const source = items ?? [];
	if (source.length === 0) return ["- None"];
	const lines = source
		.slice(0, SNAPSHOT_MAX_EVIDENCE_ITEMS)
		.map((item) => `- ${boundedRedacted(item, SNAPSHOT_MAX_EVIDENCE_EXCERPT_CHARS)}`);
	if (source.length > SNAPSHOT_MAX_EVIDENCE_ITEMS)
		lines.push(`- Showing first ${SNAPSHOT_MAX_EVIDENCE_ITEMS} evidence items.`);
	return lines;
}

function changedFileLines(summary: SnapshotChangedFileSummary): string[] {
	if (summary.kind === "unavailable") return [`- Unavailable: ${boundedRedacted(summary.reason, 160)}`];
	if (summary.entries.length === 0) return ["- None"];
	const lines = summary.entries
		.slice(0, SNAPSHOT_MAX_CHANGED_FILES)
		.map((entry) => `- ${boundedRedacted(entry.line, SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS)}`);
	if (summary.truncated || summary.entries.length > SNAPSHOT_MAX_CHANGED_FILES)
		lines.push(`- Showing first ${SNAPSHOT_MAX_CHANGED_FILES} changed files.`);
	return lines;
}

function trimToMaxBytes(value: string, maxBytes: number): string {
	const suffix = "\n[Snapshot truncated]\n";
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	const suffixBytes = Buffer.byteLength(suffix, "utf8");
	return `${Buffer.from(value, "utf8")
		.subarray(0, Math.max(0, maxBytes - suffixBytes))
		.toString("utf8")
		.replace(/\uFFFD+$/g, "")}${suffix}`;
}

export function renderUlwLoopResumeSnapshot(input: RenderUlwLoopResumeSnapshotInput): string {
	const plan = input.plan;
	const activeGoal = activeGoalOf(plan);
	const activeGoalLine =
		activeGoal === undefined ? "None" : `${activeGoal.id}: ${activeGoal.title} (${activeGoal.status})`;
	const generatedAt = input.generatedAt ?? new Date().toISOString();
	const rendered = [
		"# ULW Loop Resume Snapshot",
		"",
		"## Metadata",
		`- Generated At: ${generatedAt}`,
		`- Plan Path: ${plan.goalsPath}`,
		`- Ledger Path: ${plan.ledgerPath}`,
		"",
		"## Current State",
		`- Active Goal: ${boundedRedacted(activeGoalLine, 220)}`,
		...goalStatusLines(plan),
		"",
		"## Criteria",
		...criteriaStatusLines(plan),
		"- Pending Criteria:",
		...pendingCriteriaLines(plan),
		"",
		"## Evidence Summary",
		...evidenceLines(input.evidenceItems),
		"",
		"## Changed Files",
		...changedFileLines(input.changedFiles),
		"",
		"## Next Action",
		`- ${boundedRedacted(input.nextAction, SNAPSHOT_MAX_EVIDENCE_EXCERPT_CHARS)}`,
		"",
		"## Safety Notes",
		"- Snapshot text is redacted and bounded before writing.",
		"- Raw ledger JSON, capturedEvidence fields, file contents, patches, and diffs are not included.",
		"",
	].join("\n");
	return trimToMaxBytes(redactSnapshotText(rendered), SNAPSHOT_MAX_FILE_SIZE_BYTES);
}
