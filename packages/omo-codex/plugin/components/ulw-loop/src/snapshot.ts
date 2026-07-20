import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { repoRelative, type UlwLoopScope, ulwLoopSnapshotPath } from "./paths.js";
import { renderUlwLoopResumeSnapshot } from "./snapshot-renderer.js";
import type { SnapshotChangedFileEntry, SnapshotChangedFileSummary } from "./snapshot-types.js";
import type { UlwLoopPlan } from "./types.js";
import { SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS, SNAPSHOT_MAX_CHANGED_FILES, UlwLoopError } from "./types.js";

export { redactSnapshotText } from "./snapshot-redaction.js";
export { renderUlwLoopResumeSnapshot } from "./snapshot-renderer.js";
export type {
	RenderUlwLoopResumeSnapshotInput,
	SnapshotChangedFileEntry,
	SnapshotChangedFileSummary,
} from "./snapshot-types.js";

function truncateLine(value: string): string {
	if (value.length <= SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS) return value;
	return `${value.slice(0, SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS - 1)}…`;
}

function parsePorcelainPath(rawPath: string): string {
	const renameMarker = " -> ";
	const markerIndex = rawPath.lastIndexOf(renameMarker);
	if (markerIndex < 0) return rawPath;
	return rawPath.slice(markerIndex + renameMarker.length);
}

function parsePorcelainLine(line: string): SnapshotChangedFileEntry | null {
	if (line.length < 4 || line[2] !== " ") return null;
	const rawStatus = line.slice(0, 2);
	const rawPath = line.slice(3).trim();
	if (rawPath.length === 0) return null;
	const status = rawStatus.trim() || rawStatus;
	const path = parsePorcelainPath(rawPath);
	return { status, path, line: truncateLine(`${status} ${path}`) };
}

export function parseGitPorcelainChangedFiles(lines: readonly string[]): SnapshotChangedFileSummary {
	const entries = lines
		.map((line) => parsePorcelainLine(line))
		.filter((entry): entry is SnapshotChangedFileEntry => entry !== null);
	return {
		kind: "available",
		entries: entries.slice(0, SNAPSHOT_MAX_CHANGED_FILES),
		truncated: entries.length > SNAPSHOT_MAX_CHANGED_FILES,
	};
}

export async function summarizeChangedFiles(repoRoot: string): Promise<SnapshotChangedFileSummary> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["-C", repoRoot, "status", "--porcelain=v1"],
			{ encoding: "utf8", maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error !== null) {
					resolve({ kind: "unavailable", reason: "git status --porcelain=v1 unavailable" });
					return;
				}
				resolve(parseGitPorcelainChangedFiles(String(stdout).split(/\r?\n/)));
			},
		);
	});
}

function evidenceItemsOf(plan: UlwLoopPlan): string[] {
	const criteriaEvidence = plan.goals.flatMap((goal) =>
		goal.successCriteria.flatMap((criterion) =>
			criterion.capturedEvidence === null
				? []
				: [`${goal.id}/${criterion.id} [${criterion.status}] ${criterion.capturedEvidence}`],
		),
	);
	const goalEvidence = plan.goals.flatMap((goal) => {
		const items: string[] = [];
		if (goal.evidence !== undefined) items.push(`${goal.id} [${goal.status}] ${goal.evidence}`);
		if (goal.failureReason !== undefined) items.push(`${goal.id} failure: ${goal.failureReason}`);
		if (goal.blockedReason !== undefined) items.push(`${goal.id} blocker: ${goal.blockedReason}`);
		return items;
	});
	return [...criteriaEvidence, ...goalEvidence];
}

export async function refreshUlwLoopSnapshot(
	repoRoot: string,
	plan: UlwLoopPlan,
	nextAction: string,
	scope?: UlwLoopScope,
): Promise<void> {
	const path = ulwLoopSnapshotPath(repoRoot, scope);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true });
		const rendered = renderUlwLoopResumeSnapshot({
			plan,
			changedFiles: await summarizeChangedFiles(repoRoot),
			evidenceItems: evidenceItemsOf(plan),
			nextAction,
		});
		await writeFile(tmpPath, rendered, "utf8");
		await rename(tmpPath, path);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const warning = new UlwLoopError(
			`Failed to refresh ${repoRelative(path, repoRoot)} after ulw-loop mutation; previous latest snapshot was preserved.`,
			"ULW_LOOP_SNAPSHOT_WRITE_FAILED",
			{ cause: error },
		);
		process.stderr.write(`[ulw-loop] warning: ${warning.code}: ${warning.message}\n`);
	}
}
