import { isAbsolute, join, relative, resolve } from "node:path";

import { hasGlobalReviewDebugGatePass } from "./gate-ledger.js";
import type { ReadonlyFileSystem } from "./types.js";

const CHECKBOX_PATTERN = /^- \[[ xX]\] /;
const UNCHECKED_PATTERN = /^- \[ \] /;
const TODO_HEADING = "TODOs";
const FINAL_VERIFICATION_HEADING = "Final Verification Wave";

type WorkStatus = "active" | "completed" | "paused" | "abandoned";

type BoulderWork = {
	readonly workId: string;
	readonly activePlan: string;
	readonly planName: string;
	readonly status: WorkStatus;
	readonly startedAt: string | null;
	readonly sessionIds: readonly string[];
	readonly worktreePath: string | null;
};

export type PlanChecklist = {
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
};

export type ContinuationState = {
	readonly workId: string;
	readonly planName: string;
	readonly planPath: string;
	readonly boulderPath: string;
	readonly ledgerPath: string;
	readonly worktreePath: string | null;
	readonly checklist: PlanChecklist;
	readonly finalGateOnly: boolean;
};

export function parsePlanChecklist(markdown: string): PlanChecklist {
	const lines = markdown.split(/\r?\n/);
	const hasCountedSections = lines.some(hasCountedSectionHeading);
	let remaining = 0;
	let total = 0;
	let nextTaskLabel: string | null = null;
	let isCountedSection = !hasCountedSections;
	for (const line of lines) {
		const heading = parseLevelTwoHeading(line);
		if (heading !== null) isCountedSection = isCountedHeading(heading);
		if (!isCountedSection) continue;
		if (!CHECKBOX_PATTERN.test(line)) continue;
		total += 1;
		if (!UNCHECKED_PATTERN.test(line)) continue;
		remaining += 1;
		if (nextTaskLabel === null) nextTaskLabel = line.slice("- [ ] ".length);
	}
	return { remaining, total, nextTaskLabel };
}

function hasCountedSectionHeading(line: string): boolean {
	const heading = parseLevelTwoHeading(line);
	return heading !== null && isCountedHeading(heading);
}

export function readContinuationState(
	cwd: string,
	sessionId: string,
	fs: ReadonlyFileSystem,
): ContinuationState | null {
	const boulderPath = join(cwd, ".omo", "boulder.json");
	const boulderText = readTextFile(fs, boulderPath);
	if (boulderText === null) return null;
	const parsed = parseJsonObject(boulderText);
	if (parsed === null) return null;
	const prefixedSessionId = `codex:${sessionId}`;
	const work = findMatchingWork(parsed, prefixedSessionId);
	if (work === null) return null;
	const planPath = resolvePlanPath(cwd, work.activePlan, fs);
	if (planPath === null) return null;
	const planText = readTextFile(fs, planPath);
	if (planText === null) return null;
	const checklist = parsePlanChecklist(planText);
	const ledgerPath = join(cwd, ".omo", "start-work", "ledger.jsonl");
	if (
		checklist.remaining === 0 &&
		hasGlobalReviewDebugGatePass(
			readTextFile(fs, ledgerPath),
			{
				workId: work.workId,
				planName: work.planName,
				planPath,
				prefixedSessionId,
				startedAt: work.startedAt,
			},
			parseJsonObject,
		)
	) {
		return null;
	}
	return {
		workId: work.workId,
		planName: work.planName,
		planPath,
		boulderPath,
		ledgerPath,
		worktreePath: work.worktreePath,
		checklist,
		finalGateOnly: checklist.remaining === 0,
	};
}

function findMatchingWork(state: Record<string, unknown>, prefixedSessionId: string): BoulderWork | null {
	const candidates = getWorkCandidates(state);
	for (const candidate of candidates) {
		const work = parseBoulderWork(candidate.value, candidate.allowLegacyWorkId);
		if (work === null) continue;
		if (!isContinuableStatus(work.status)) continue;
		if (work.sessionIds.includes(prefixedSessionId)) return work;
	}
	return null;
}

type BoulderWorkCandidate = {
	readonly value: unknown;
	readonly allowLegacyWorkId: boolean;
};

function getWorkCandidates(state: Record<string, unknown>): readonly BoulderWorkCandidate[] {
	const worksValue = state["works"];
	if (!isRecord(worksValue)) return [{ value: state, allowLegacyWorkId: true }];
	const values = Object.values(worksValue);
	const activeWork = findActiveWorkValue(worksValue, state["active_work_id"]);
	const orderedValues =
		activeWork === undefined ? values : [activeWork, ...values.filter((value) => value !== activeWork)];
	return orderedValues.map((value) => ({ value, allowLegacyWorkId: false }));
}

function findActiveWorkValue(works: Record<string, unknown>, activeWorkId: unknown): unknown | undefined {
	if (typeof activeWorkId !== "string") return undefined;
	const direct = works[activeWorkId];
	if (direct !== undefined) return direct;
	return Object.values(works).find((value) => isRecord(value) && value["work_id"] === activeWorkId);
}

function parseBoulderWork(value: unknown, allowLegacyWorkId: boolean): BoulderWork | null {
	if (!isRecord(value)) return null;
	const activePlan = value["active_plan"];
	const planName = value["plan_name"];
	const status = parseWorkStatus(value["status"]);
	const startedAt = value["started_at"];
	const sessionIds = value["session_ids"];
	const worktreePath = value["worktree_path"];
	if (typeof activePlan !== "string") return null;
	if (typeof planName !== "string") return null;
	const workId = parseWorkId(value["work_id"], planName, allowLegacyWorkId);
	if (workId === null) return null;
	if (status === null) return null;
	if (!isStringArray(sessionIds)) return null;
	return {
		workId,
		activePlan,
		planName,
		status,
		startedAt: typeof startedAt === "string" ? startedAt : null,
		sessionIds,
		worktreePath: typeof worktreePath === "string" ? worktreePath : null,
	};
}

function parseWorkId(value: unknown, planName: string, allowLegacyWorkId: boolean): string | null {
	if (typeof value === "string") return value;
	if (allowLegacyWorkId) return `${planName}-legacy`;
	return null;
}

function parseWorkStatus(value: unknown): WorkStatus | null {
	if (value === undefined) return "active";
	if (value === "active" || value === "completed" || value === "paused" || value === "abandoned") return value;
	return null;
}

function isContinuableStatus(status: WorkStatus): boolean {
	return status === "active" || status === "paused";
}

function parseLevelTwoHeading(line: string): string | null {
	if (!line.startsWith("## ")) return null;
	if (line.startsWith("### ")) return null;
	return line.slice("## ".length).trim();
}

function isCountedHeading(heading: string): boolean {
	return heading === TODO_HEADING || heading === FINAL_VERIFICATION_HEADING;
}

function resolvePlanPath(cwd: string, activePlan: string, fs: ReadonlyFileSystem): string | null {
	const planPath = isAbsolute(activePlan) ? activePlan : resolve(cwd, activePlan);
	if (!isContainedPath(cwd, planPath)) return null;
	const realCwd = realPath(fs, cwd);
	const realPlanPath = realPath(fs, planPath);
	if (realCwd === null || realPlanPath === null) return null;
	if (isContainedPath(realCwd, realPlanPath)) return planPath;
	return null;
}

function isContainedPath(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function realPath(fs: ReadonlyFileSystem, path: string): string | null {
	try {
		return fs.realpathSync(path);
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function readTextFile(fs: ReadonlyFileSystem, path: string): string | null {
	try {
		return fs.readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function parseJsonObject(json: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(json);
		return isRecord(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
