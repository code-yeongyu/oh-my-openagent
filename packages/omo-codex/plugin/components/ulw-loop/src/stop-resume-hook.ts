import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import { normalizeUlwLoopSessionId, ulwLoopDir } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";

// Turn-death recovery only: Codex emits Stop when a turn ends, so a run that
// dies mid-turn (crash, kill, context blowup before any Stop) never reaches
// this handler. Mid-turn stalls are out of scope by design.

const RESUME_CAP = 2;

// Mirrors start-work-continuation's context-pressure bail-out: injecting a
// resume directive into an already-overflowing context makes things worse.
const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

interface StopPayload {
	readonly session_id: string;
	readonly cwd: string;
	readonly transcript_path: string;
	readonly stop_hook_active: boolean;
}

export function runStopResumeHook(input: unknown): string {
	const payload = parseStopPayload(input);
	if (payload === null || payload.stop_hook_active) return "";
	if (transcriptShowsContextPressure(payload.transcript_path)) return "";
	if (boulderContinuationWillFire(payload.cwd, payload.session_id)) return "";
	const stateDir = ulwLoopDir(payload.cwd, { sessionId: payload.session_id });
	const plan = readPlan(join(stateDir, "goals.json"));
	if (plan === null || plan.aggregateCompletion?.status === "complete") return "";
	const goal = resumableGoal(plan);
	if (goal === undefined) return "";
	if (!consumeResumeBudget(stateDir, goal.id)) return "";
	const output: { decision: "block"; reason: string } = {
		decision: "block",
		reason: renderResumeDirective(plan, goal, payload.session_id),
	};
	return JSON.stringify(output);
}

export async function runStopResumeHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
		const output = runStopResumeHook(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
	}
}

function resumableGoal(plan: UlwLoopPlan): UlwLoopItem | undefined {
	const active = plan.goals.find((goal) => goal.id === plan.activeGoalId);
	if (active !== undefined && isResumableStatus(active.status)) return active;
	return plan.goals.find((goal) => isResumableStatus(goal.status));
}

function isResumableStatus(status: UlwLoopItem["status"]): boolean {
	return status === "pending" || status === "in_progress";
}

// Two-strike cap keyed on ledger movement: an unchanged ledger.jsonl line
// count across resumes means the loop is not progressing. The stuck marker is
// a separate file — a ledger append would change the count and self-reset.
function consumeResumeBudget(stateDir: string, goalId: string): boolean {
	const ledgerLineCount = countLedgerLines(join(stateDir, "ledger.jsonl"));
	const counterPath = resolve(stateDir, `auto-resume-${goalId}.json`);
	const stuckPath = resolve(stateDir, `auto-resume-${goalId}.stuck`);
	// goals.json is untrusted input: a crafted goal id (e.g. `../../x`) must
	// never drive a write outside the session state dir. Deny the resume.
	if (!isInsideDir(stateDir, counterPath) || !isInsideDir(stateDir, stuckPath)) return false;
	const previous = readCounter(counterPath);
	const count = previous !== null && previous.ledgerLineCount === ledgerLineCount ? previous.count : 0;
	if (count >= RESUME_CAP) {
		writeFileSync(stuckPath, `no ledger progress after ${count} resumes\n`);
		return false;
	}
	writeFileSync(counterPath, JSON.stringify({ count: count + 1, ledgerLineCount }));
	return true;
}

function isInsideDir(dir: string, candidate: string): boolean {
	return candidate.startsWith(resolve(dir) + sep);
}

function renderResumeDirective(plan: UlwLoopPlan, goal: UlwLoopItem, sessionId: string): string {
	const normalized = normalizeUlwLoopSessionId(sessionId);
	const option =
		normalized !== null && plan.goalsPath.includes(`/${normalized}/`) ? ` --session-id ${normalized}` : "";
	return [
		`The ulw-loop run in this session still has unfinished goals (next: ${goal.id} — ${goal.title}).`,
		"The turn ended before the loop completed. Resume it now:",
		`1. Run \`omo ulw-loop status${option} --json\` to reload the plan, the active goal, and currentAttemptDir.`,
		"2. Continue the active goal's remaining success criteria, recording evidence with record-evidence.",
		`3. Checkpoint through \`omo ulw-loop checkpoint${option}\` when the goal's criteria are proven; a complete checkpoint prints the next goal instruction.`,
		"If the loop is genuinely blocked on the user, checkpoint the goal as blocked with the reason instead.",
	].join("\n");
}

function readPlan(goalsPath: string): UlwLoopPlan | null {
	try {
		return JSON.parse(readFileSync(goalsPath, "utf8")) as UlwLoopPlan;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function countLedgerLines(ledgerPath: string): number {
	try {
		return readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).length;
	} catch (error) {
		if (error instanceof Error) return 0;
		throw error;
	}
}

function readCounter(counterPath: string): { count: number; ledgerLineCount: number } | null {
	try {
		if (!existsSync(counterPath)) return null;
		const parsed = JSON.parse(readFileSync(counterPath, "utf8")) as Record<string, unknown>;
		if (typeof parsed["count"] !== "number" || typeof parsed["ledgerLineCount"] !== "number") return null;
		return { count: parsed["count"], ledgerLineCount: parsed["ledgerLineCount"] };
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

// Local ~10-LOC approximation of start-work-continuation's boulder check (no
// cross-component import allowed): any continuable work for this session means
// that hook owns the Stop event, so this one stays silent.
function boulderContinuationWillFire(cwd: string, sessionId: string): boolean {
	try {
		const raw = JSON.parse(readFileSync(join(cwd, ".omo", "boulder.json"), "utf8")) as Record<string, unknown>;
		const works = raw["works"];
		// The flat legacy shape has no works map: the top level is the single work.
		const entries = typeof works === "object" && works !== null ? Object.values(works) : [raw];
		return entries.some((work) => {
			if (typeof work !== "object" || work === null) return false;
			const entry = work as Record<string, unknown>;
			const sessionIds = Array.isArray(entry["session_ids"]) ? entry["session_ids"] : [];
			const continuable = entry["status"] === "active" || entry["status"] === "paused";
			return continuable && sessionIds.includes(`codex:${sessionId}`) && boulderPlanHasChecklist(cwd, entry);
		});
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function transcriptShowsContextPressure(transcriptPath: string): boolean {
	try {
		const transcript = readFileSync(transcriptPath, "utf8").toLowerCase();
		return CONTEXT_PRESSURE_MARKERS.some((marker) => transcript.includes(marker));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

// start-work-continuation owns an active Boulder plan until its final gate marks
// the work complete, including the zero-remaining checklist state.
function boulderPlanHasChecklist(cwd: string, entry: Record<string, unknown>): boolean {
	const activePlan = entry["active_plan"];
	if (typeof activePlan !== "string" || activePlan.trim().length === 0) return false;
	const planPath = isAbsolute(activePlan) ? activePlan : join(cwd, activePlan);
	const worktree = entry["worktree_path"];
	const candidates =
		typeof worktree === "string" && worktree.trim().length > 0 && !isAbsolute(activePlan)
			? [join(isAbsolute(worktree) ? worktree : join(cwd, worktree), activePlan), planPath]
			: [planPath];
	for (const candidate of candidates) {
		try {
			return readFileSync(candidate, "utf8")
				.split(/\r?\n/)
				.some((line) => line.startsWith("- [ ] ") || line.startsWith("- [x] ") || line.startsWith("- [X] "));
		} catch (error) {
			if (!(error instanceof Error)) throw error;
		}
	}
	return false;
}

function parseStopPayload(value: unknown): StopPayload | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const optionalMessage = record["last_assistant_message"];
	const valid =
		record["hook_event_name"] === "Stop" &&
		typeof record["session_id"] === "string" &&
		typeof record["turn_id"] === "string" &&
		typeof record["transcript_path"] === "string" &&
		typeof record["cwd"] === "string" &&
		typeof record["model"] === "string" &&
		typeof record["permission_mode"] === "string" &&
		typeof record["stop_hook_active"] === "boolean" &&
		(optionalMessage === undefined || typeof optionalMessage === "string");
	if (!valid) return null;
	return {
		session_id: record["session_id"] as string,
		cwd: record["cwd"] as string,
		transcript_path: record["transcript_path"] as string,
		stop_hook_active: record["stop_hook_active"] as boolean,
	};
}
