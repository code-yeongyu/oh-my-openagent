import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type PlanChecklist = {
	readonly completed: number;
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
};

type BoulderWorkStatus = "active" | "paused" | "completed" | "abandoned";

type BoulderWork = {
	readonly activePlan: string;
	readonly planName: string;
	readonly status?: BoulderWorkStatus;
	readonly startedAt?: string;
	readonly updatedAt?: string;
	readonly sessionIds: readonly string[];
	readonly worktreePath?: string;
};

type BoulderState = {
	readonly works: readonly BoulderWork[];
	readonly mirrorWork: BoulderWork | null;
	readonly hasWorksMap: boolean;
};

export type ContinuationState = {
	readonly planName: string;
	readonly planPath: string;
	readonly boulderPath: string;
	readonly ledgerPath: string;
	readonly worktreePath: string | null;
	readonly checklist: PlanChecklist;
};

const TODO_HEADING = "TODOs";
const FINAL_VERIFICATION_HEADING = "Final Verification Wave";
const CHECKBOX_PREFIX_LENGTH = "- [ ] ".length;
const SESSION_ID_PREFIX_PATTERN = /^(codex|opencode):/;

export function readContinuationState(cwd: string, sessionId: string): ContinuationState | null {
	const boulderPath = getBoulderFilePath(cwd);
	const boulderState = readBoulderState(boulderPath);
	if (boulderState === null) return null;

	const work = getWorkForSession(boulderState, normalizeSessionId(sessionId, "codex"));
	if (work === null || !isContinuableStatus(work.status)) return null;

	const planPath = resolveBoulderPlanPathForWork(cwd, work);
	const checklist = getPlanChecklist(planPath);
	if (checklist.total === 0) return null;

	return {
		planName: work.planName,
		planPath,
		boulderPath,
		ledgerPath: join(cwd, ".omo", "start-work", "ledger.jsonl"),
		worktreePath: work.worktreePath ?? null,
		checklist,
	};
}

export function getPlanChecklist(planPath: string): PlanChecklist {
	if (!existsSync(planPath)) return emptyChecklist();

	try {
		return parsePlanChecklist(readFileSync(planPath, "utf8"));
	} catch (error) {
		if (error instanceof Error) return emptyChecklist();
		throw error;
	}
}

function parsePlanChecklist(markdown: string): PlanChecklist {
	const lines = markdown.split(/\r?\n/);
	const hasCountedSections = lines.some((line) => isCountedHeading(parseLevelTwoHeading(line)));
	let completed = 0;
	let remaining = 0;
	let nextTaskLabel: string | null = null;
	let isCountedSection = !hasCountedSections;

	for (const line of lines) {
		const heading = parseLevelTwoHeading(line);
		if (heading !== null) {
			isCountedSection = isCountedHeading(heading);
			continue;
		}
		if (!isCountedSection) continue;

		const checkbox = parseTopLevelCheckbox(line);
		if (checkbox === null) continue;

		if (checkbox.checked) {
			completed += 1;
		} else {
			remaining += 1;
			nextTaskLabel = nextTaskLabel ?? checkbox.label;
		}
	}

	return { completed, remaining, total: completed + remaining, nextTaskLabel };
}

function readBoulderState(path: string): BoulderState | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parseBoulderState(parsed);
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function parseBoulderState(value: unknown): BoulderState | null {
	if (!isRecord(value)) return null;

	const works: BoulderWork[] = [];
	const worksValue = value["works"];
	const hasWorksMap = isRecord(worksValue);
	if (hasWorksMap) {
		for (const workValue of Object.values(worksValue)) {
			const work = parseBoulderWork(workValue);
			if (work !== null) works.push(work);
		}
	}

	const mirrorWork = parseBoulderWork(value);
	if (works.length === 0 && mirrorWork === null) return null;
	return { works, mirrorWork, hasWorksMap };
}

function parseBoulderWork(value: unknown): BoulderWork | null {
	if (!isRecord(value)) return null;

	const activePlan = value["active_plan"];
	const planName = value["plan_name"];
	if (typeof activePlan !== "string") return null;

	const status = parseBoulderWorkStatus(value["status"]);
	const sessionIds = parseSessionIds(value["session_ids"]);
	const worktreePath = value["worktree_path"];
	const startedAt = value["started_at"];
	const updatedAt = value["updated_at"];

	return {
		activePlan,
		planName: typeof planName === "string" ? planName : activePlan,
		sessionIds,
		...(status === undefined ? {} : { status }),
		...(typeof startedAt === "string" ? { startedAt } : {}),
		...(typeof updatedAt === "string" ? { updatedAt } : {}),
		...(typeof worktreePath === "string" ? { worktreePath } : {}),
	};
}

function getWorkForSession(state: BoulderState, normalizedSessionId: string): BoulderWork | null {
	let newestWork: BoulderWork | null = null;
	let newestWorkMs = 0;

	for (const work of state.works) {
		if (!work.sessionIds.includes(normalizedSessionId)) continue;

		const workMs = parseIsoToMs(work.updatedAt ?? work.startedAt) ?? 0;
		if (newestWork === null || workMs > newestWorkMs) {
			newestWork = work;
			newestWorkMs = workMs;
		}
	}

	if (newestWork !== null) return newestWork;
	if (state.hasWorksMap) return null;
	if (state.mirrorWork?.sessionIds.includes(normalizedSessionId) === true) return state.mirrorWork;
	return null;
}

function resolveBoulderPlanPathForWork(cwd: string, work: BoulderWork): string {
	const absolutePlanPath = resolveTrackedPath(cwd, work.activePlan);
	const worktreePath = work.worktreePath?.trim();
	if (worktreePath === undefined || worktreePath.length === 0) return absolutePlanPath;

	const relativePlanPath = relative(resolve(cwd), absolutePlanPath);
	if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
		return absolutePlanPath;
	}

	const worktreePlanPath = resolve(resolveTrackedPath(cwd, worktreePath), relativePlanPath);
	return existsSync(worktreePlanPath) ? worktreePlanPath : absolutePlanPath;
}

function resolveTrackedPath(baseDirectory: string, trackedPath: string): string {
	return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath);
}

function parseTopLevelCheckbox(line: string): { readonly checked: boolean; readonly label: string } | null {
	if (line.startsWith("- [ ] ")) return { checked: false, label: line.slice(CHECKBOX_PREFIX_LENGTH) };
	if (line.startsWith("- [x] ") || line.startsWith("- [X] ")) {
		return { checked: true, label: line.slice(CHECKBOX_PREFIX_LENGTH) };
	}
	return null;
}

function parseLevelTwoHeading(line: string): string | null {
	if (!line.startsWith("## ")) return null;
	return line.slice("## ".length).trim();
}

function isCountedHeading(heading: string | null): boolean {
	return heading === TODO_HEADING || heading === FINAL_VERIFICATION_HEADING;
}

function parseBoulderWorkStatus(value: unknown): BoulderWorkStatus | undefined {
	if (value === "active" || value === "paused" || value === "completed" || value === "abandoned") return value;
	return undefined;
}

function parseSessionIds(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	const sessionIds: string[] = [];
	for (const item of value) {
		if (typeof item === "string") sessionIds.push(normalizeSessionId(item));
	}
	return sessionIds;
}

function normalizeSessionId(sessionId: string, platform: "codex" | "opencode" = "opencode"): string {
	if (SESSION_ID_PREFIX_PATTERN.test(sessionId)) return sessionId;
	return `${platform}:${sessionId}`;
}

function parseIsoToMs(value: string | undefined): number | null {
	if (value === undefined) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function isContinuableStatus(status: BoulderWorkStatus | undefined): boolean {
	return status === "active" || status === "paused";
}

function getBoulderFilePath(cwd: string): string {
	return join(cwd, ".omo", "boulder.json");
}

function emptyChecklist(): PlanChecklist {
	return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
