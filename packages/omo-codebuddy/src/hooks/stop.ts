import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { blockOutput } from "../protocol/index.ts";
import { resolveProjectRoot } from "./paths.ts";
import { transcriptShowsContextPressure } from "./transcript.ts";

/**
 * Stop-hook continuation, CodeBuddy flavour.
 *
 * CodeBuddy blocks a stop with `{continue: false, reason}` (the legacy
 * `decision: "block"` field is deprecated). Two producers exist, evaluated in
 * order so active execution work wins over loop work:
 *   1. a continuable Boulder work plan written by the `ulw-execute` skill
 *   2. an unfinished ulw-loop run (`.omo/ulw-loop/<session>/goals.json`)
 *
 * Both are budgeted: a resume only fires while the artifact keeps changing, and
 * at most `STOP_RESUME_CAP` times without progress. Every other path stays
 * silent, which is the safe default for a Stop hook.
 */
export const STOP_RESUME_CAP = 2;

export interface StopHookOptions {
	readonly env?: Record<string, string | undefined>;
	readonly boulderStatePath?: string;
	readonly stateDir?: string;
}

export function runStopHook(
	payload: Record<string, unknown>,
	options: StopHookOptions = {},
): string {
	if (payload["hook_event_name"] !== "Stop") return "";
	if (payload["stop_hook_active"] === true) return "";

	const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
	const cwd = resolveProjectRoot(
		typeof payload["cwd"] === "string" ? payload["cwd"] : undefined,
		{ env: options.env },
	);
	const transcriptPath = typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : null;
	if (transcriptShowsContextPressure(transcriptPath)) return "";

	const normalizedSession = normalizeSessionId(sessionId);
	const stateDir = options.stateDir ?? join(cwd, ".omo", "codebuddy", normalizedSession);

	const boulder = findContinuableBoulderWork(cwd, sessionId, options);
	if (boulder !== null) {
		const key = `boulder-${boulder.workId}`;
		if (!consumeResumeBudget(stateDir, key, boulder.signature)) return "";
		return blockOutput("Stop", renderBoulderDirective(boulder.planPath, sessionId));
	}

	const loop = findContinuableUlwLoop(cwd, normalizedSession);
	if (loop !== null) {
		const key = `ulw-loop-${loop.goalId}`;
		if (!consumeResumeBudget(stateDir, key, loop.signature)) return "";
		return blockOutput("Stop", renderUlwLoopDirective(loop, sessionId));
	}

	return "";
}

export interface BoulderContinuation {
	readonly workId: string;
	readonly planPath: string;
	readonly signature: string;
}

export function findContinuableBoulderWork(
	cwd: string,
	sessionId: string,
	options: StopHookOptions = {},
): BoulderContinuation | null {
	const statePath = options.boulderStatePath ?? join(resolveProjectRoot(cwd, { env: options.env }), ".omo", "boulder.json");
	if (!existsSync(statePath)) return null;

	const state = readJsonObject(statePath);
	if (state === null) return null;

	const worksValue = state["works"];
	const works: Record<string, unknown>[] =
		typeof worksValue === "object" && worksValue !== null && !Array.isArray(worksValue)
			? Object.values(worksValue as Record<string, unknown>).filter(isRecord)
			: [state];

	const sessionKey = `codebuddy:${sessionId}`;
	for (const work of works) {
		const status = work["status"];
		if (status !== "active" && status !== "paused") continue;
		const sessions = Array.isArray(work["session_ids"]) ? work["session_ids"] : [];
		if (!sessions.some((entry) => entry === sessionKey)) continue;

		const activePlan = work["active_plan"];
		if (typeof activePlan !== "string" || activePlan.trim().length === 0) continue;
		const planPath = isAbsolute(activePlan) ? activePlan : join(cwd, activePlan);
		const checklist = readChecklist(planPath);
		if (checklist === null) continue;

		return {
			workId: typeof work["work_id"] === "string" ? work["work_id"] : (activePlan.split("/").pop() ?? activePlan),
			planPath,
			signature: `${checklist.done}/${checklist.total}`,
		};
	}
	return null;
}

interface UlwLoopContinuation {
	readonly goalId: string;
	readonly goalTitle: string;
	readonly goalsPath: string;
	readonly signature: string;
}

export function findContinuableUlwLoop(cwd: string, normalizedSessionId: string): UlwLoopContinuation | null {
	const goalsPath = join(cwd, ".omo", "ulw-loop", normalizedSessionId, "goals.json");
	if (!existsSync(goalsPath)) return null;

	const plan = readJsonObject(goalsPath);
	if (plan === null) return null;

	const aggregate = plan["aggregateCompletion"];
	if (isRecord(aggregate) && aggregate["status"] === "complete") return null;

	const goals = Array.isArray(plan["goals"]) ? plan["goals"].filter(isRecord) : [];
	if (goals.length === 0) return null;

	const activeGoalId = typeof plan["activeGoalId"] === "string" ? plan["activeGoalId"] : undefined;
	const active = goals.find((goal) => goal["id"] === activeGoalId && isResumable(goal));
	const resumable = active ?? goals.find(isResumable);
	if (resumable === undefined) return null;

	const done = goals.filter((goal) => goal["status"] === "complete").length;
	return {
		goalId: typeof resumable["id"] === "string" ? resumable["id"] : "unknown",
		goalTitle: typeof resumable["title"] === "string" ? resumable["title"] : "",
		goalsPath,
		signature: `${done}/${goals.length}`,
	};
}

function isResumable(goal: Record<string, unknown>): boolean {
	return goal["status"] === "pending" || goal["status"] === "in_progress";
}

function readChecklist(planPath: string): { done: number; total: number } | null {
	try {
		if (!existsSync(planPath)) return null;
		const lines = readFileSync(planPath, "utf8").split(/\r?\n/);
		let done = 0;
		let total = 0;
		for (const line of lines) {
			if (line.startsWith("- [ ] ")) total += 1;
			else if (line.startsWith("- [x] ") || line.startsWith("- [X] ")) {
				total += 1;
				done += 1;
			}
		}
		return total === 0 ? null : { done, total };
	} catch {
		return null;
	}
}

/**
 * A resume is a budgeted side effect. The counter resets whenever the artifact
 * signature changes (real progress), so a proven-progress run keeps going while
 * a stalled one stops after `STOP_RESUME_CAP` attempts.
 */
export function consumeResumeBudget(stateDir: string, key: string, signature: string): boolean {
	try {
		const counterPath = join(stateDir, `auto-resume-${key}.json`);
		const stuckPath = join(stateDir, `auto-resume-${key}.stuck`);
		const previous = readJsonObject(counterPath);
		const sameSignature = previous !== null && previous["signature"] === signature;
		const count = sameSignature && typeof previous["count"] === "number" ? (previous["count"] as number) : 0;

		if (count >= STOP_RESUME_CAP) {
			mkdirSync(stateDir, { recursive: true });
			writeFileSync(stuckPath, `no progress after ${count} resumes\n`);
			return false;
		}

		mkdirSync(dirname(counterPath), { recursive: true });
		writeFileSync(counterPath, JSON.stringify({ count: count + 1, signature }));
		return true;
	} catch {
		return false;
	}
}

export function renderBoulderDirective(planPath: string, sessionId: string): string {
	return [
		"The ulw-execute work plan for this session is still unfinished. The turn ended before the plan was completed, so resume it now:",
		`1. Read the plan at ${planPath} and reload its checklist.`,
		`2. Continue the remaining unchecked items in this session (\`codebuddy:${sessionId}\`), one item at a time, keeping the plan checkboxes updated as each one is proven.`,
		"3. Record evidence for every acceptance criterion (command, observed result, artifact path) before checking an item off.",
		"Do not restart finished work and do not rewrite the plan structure.",
		"If the work is genuinely blocked on the user, stop and say exactly what is blocking and what you need.",
	].join("\n");
}

function renderUlwLoopDirective(loop: UlwLoopContinuation, sessionId: string): string {
	const title = loop.goalTitle.length > 0 ? ` (${loop.goalTitle})` : "";
	return [
		`The ulw-loop run in this session still has unfinished goals (next: ${loop.goalId}${title}).`,
		"The turn ended before the loop completed. Resume it now:",
		`1. Read ${loop.goalsPath} to reload the plan, the active goal, and its success criteria.`,
		"2. Continue the active goal's remaining success criteria, recording evidence as you go.",
		`3. Update the goal status in that file when its criteria are proven, then start the next pending goal.`,
		`4. If the loop is genuinely blocked on the user, mark the goal blocked with the reason instead of spinning (session \`codebuddy:${sessionId}\`).`,
	].join("\n");
}

export function normalizeSessionId(sessionId: string): string {
	const normalized = sessionId
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "");
	return normalized.length > 0 ? normalized : "anonymous";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
