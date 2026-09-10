import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PreToolUsePayload } from "./codex-hook.js";
import { parsePreToolUsePayload } from "./codex-hook.js";
import { isFinalRunCompletionCandidate } from "./goal-status.js";
import { ulwLoopAttemptEvidenceDir, ulwLoopDir, ulwLoopStateLockPath } from "./paths.js";
import { isStateLockTimeout, type StateLockOptions, withStateLockSync } from "./state-lock.js";
import {
	GATE_REVIEWER_AGENT_NAMES,
	REVIEWER_ROLES_BY_SURFACE,
	resolveToolkitSurface,
	reviewerRolesFor,
} from "./surface.js";
import type { UlwLoopPlan } from "./types.js";

// spawn_agent = v1; collaborationspawn_agent = the delimiter-free flattened v2
// hook token from codex-rs hook_names.rs; collaboration.spawn_agent = the
// dotted token observed live in the task-1 probe (hook-tool-tokens.txt).
const SPAWN_TOOL_TOKENS = new Set(["spawn_agent", "collaborationspawn_agent", "collaboration.spawn_agent"]);
export const DEFAULT_FANOUT_LIMIT = 24;
const DEFAULT_REVIEW_SPAWN_LIMIT = 3;
const GATE_MESSAGE_PATTERN = /lazycodex-gate-reviewer|omo-senpi-gate-reviewer|final gate review/i;
const REVIEW_AGENT_TYPES = [
	...Object.values(REVIEWER_ROLES_BY_SURFACE).map((roles) => roles.gateReview),
	...Object.values(REVIEWER_ROLES_BY_SURFACE).map((roles) => roles.codeReview),
	...Object.values(REVIEWER_ROLES_BY_SURFACE).map((roles) => roles.manualQa),
] as const;
const REVIEW_AGENT_TYPE_SET = new Set<string>(REVIEW_AGENT_TYPES);

export interface SpawnGuardOptions {
	readonly lockTimeoutMs?: number;
}

export function applySpawnGuards(payload: PreToolUsePayload, options: SpawnGuardOptions = {}): string {
	if (payload.hook_event_name !== "PreToolUse" || !SPAWN_TOOL_TOKENS.has(payload.tool_name)) return "";
	const breaker = readAdmissionBreaker(payload.session_id);
	if (breaker !== null)
		return deny(
			`Subagent admission failed earlier in this session (${breaker}). Do not spawn more workers or reviewers; report the capacity block and wait for the user.`,
		);
	const scope = { sessionId: payload.session_id } as const;
	const stateDir = ulwLoopDir(payload.cwd, scope);
	const plan = readPlan(join(stateDir, "goals.json"));
	if (plan === null) return "";
	const lockOptions: StateLockOptions =
		options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs };
	try {
		return withStateLockSync(
			ulwLoopStateLockPath(payload.cwd, scope),
			() => evaluateGuards(payload, plan, stateDir),
			lockOptions,
		);
	} catch (error) {
		if (isStateLockTimeout(error))
			return deny(`ulw-loop spawn guard could not take the session state lock: ${error.message}`);
		throw error;
	}
}

function evaluateGuards(payload: PreToolUsePayload, plan: UlwLoopPlan, stateDir: string): string {
	const fanOutPeek = peekFanOutBudget(stateDir);
	if (fanOutPeek !== null) return deny(fanOutPeek);
	const missingArtifact = missingGateArtifact(payload, plan);
	if (missingArtifact !== null)
		return deny(`record manual QA first; gate audits its artifacts: missing ${missingArtifact}`);
	const reviewDenial = consumeReviewSpawnBudget(payload, plan, stateDir);
	if (reviewDenial !== null) return deny(reviewDenial);
	const fanOutDenial = consumeFanOutBudget(stateDir);
	if (fanOutDenial !== null) return deny(fanOutDenial);
	return "";
}

export async function runSpawnAdmissionRecorderCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
	try {
		const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
		const response =
			typeof payload["tool_response"] === "string"
				? payload["tool_response"]
				: JSON.stringify(payload["tool_response"] ?? "");
		if (!/too many active cells|AgentLimitReached|max_threads|max_concurrent_threads_per_session/i.test(response))
			return;
		const dataDir = process.env["PLUGIN_DATA"];
		if (typeof dataDir !== "string" || typeof payload["session_id"] !== "string") return;
		const markerDir = join(dataDir, "spawn-breaker");
		try {
			mkdirSync(markerDir, { recursive: true });
			atomicWriteJson(join(markerDir, `${payload["session_id"]}.json`), {
				reason: response,
				at: new Date().toISOString(),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[ulw-loop] spawn-guard: could not persist admission failure: ${message}\n`);
		}
	} catch {
		/* malformed hook input is ignored */
	}
	void stdout;
}

export async function runSpawnGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
		const payload = parsePreToolUsePayload(Buffer.concat(chunks).toString("utf8"));
		if (payload === null) return;
		const output = applySpawnGuards(payload);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
	}
}

// Read-only fan-out eligibility check. Returns a denial reason when the next
// spawn would exceed the limit, without incrementing the counter. Call this
// before charging any per-reviewer quota so a saturated global cap cannot
// silently consume reviewer allowances for spawns that will never run.
function peekFanOutBudget(stateDir: string): string | null {
	const counterPath = join(stateDir, "spawn-count.json");
	const count = readCount(counterPath) + 1;
	const limit = fanOutLimit();
	if (count <= limit) return null;
	return `ulw-loop spawn fan-out cap reached (${count}/${limit}). Consolidate work into the agents already running, or raise OMO_SPAWN_FANOUT_LIMIT if this volume is intentional.`;
}

// Per-session spawn counter; depth/lineage tracking is descoped — this is a
// total-volume backstop against fan-out explosions, not a recursion tracker.
function consumeFanOutBudget(stateDir: string): string | null {
	const counterPath = join(stateDir, "spawn-count.json");
	const count = readCount(counterPath) + 1;
	atomicWriteJson(counterPath, { count });
	const limit = fanOutLimit();
	if (count <= limit) return null;
	return `ulw-loop spawn fan-out cap reached (${count}/${limit}). Consolidate work into the agents already running, or raise OMO_SPAWN_FANOUT_LIMIT if this volume is intentional.`;
}

function consumeReviewSpawnBudget(payload: PreToolUsePayload, plan: UlwLoopPlan, stateDir: string): string | null {
	const agentType = reviewAgentType(payload.tool_input);
	if (agentType === null) return null;
	const goal =
		plan.goals.find((candidate) => candidate.id === plan.activeGoalId) ??
		plan.goals.find((candidate) => isFinalRunCompletionCandidate(plan, candidate));
	if (goal === undefined) return null;
	const counterPath = join(stateDir, "review-spawn-counts.json");
	const limit = reviewSpawnLimit();
	const counts = readCounts(counterPath);
	const key = `${agentType}:${goal.id}:a${goal.attempt}`;
	const count = (counts[key] ?? 0) + 1;
	if (count > limit)
		return `ulw-loop reviewer no-progress cap reached (${agentType} ${count}/${limit}) for ${goal.id} attempt ${goal.attempt}. Consolidate existing review findings, or checkpoint and start a new attempt after concrete progress.`;
	counts[key] = count;
	atomicWriteJson(counterPath, counts);
	return null;
}

function missingGateArtifact(payload: PreToolUsePayload, plan: UlwLoopPlan): string | null {
	if (!isGateReviewerSpawn(payload.tool_input)) return null;
	const goal = plan.goals.find((candidate) => isFinalRunCompletionCandidate(plan, candidate));
	if (goal === undefined || goal.status === "complete") return null;
	if (!goal.successCriteria.every((criterion) => criterion.status === "pass")) return null;
	const scope = { sessionId: payload.session_id } as const;
	const requiredArtifacts = [`${goal.id}-manual-qa.md`];
	if (plan.evidenceLayoutVersion === 2) {
		const attemptDir = ulwLoopAttemptEvidenceDir(goal.id, goal.attempt, scope);
		for (const name of requiredArtifacts) {
			const relative = `${attemptDir}/${name}`;
			if (!isNonEmptyFile(join(payload.cwd, relative))) return relative;
		}
		return null;
	}
	const manualQa = `.omo/evidence/${goal.id}-manual-qa.md`;
	return isNonEmptyFile(join(payload.cwd, manualQa)) ? null : manualQa;
}

function isGateReviewerSpawn(toolInput: unknown): boolean {
	const agentType = reviewAgentType(toolInput);
	return agentType !== null && GATE_REVIEWER_AGENT_NAMES.has(agentType);
}

function reviewAgentType(toolInput: unknown): string | null {
	if (typeof toolInput !== "object" || toolInput === null) return null;
	const record = toolInput as Record<string, unknown>;
	const agentType = record["agent_type"];
	if (typeof agentType === "string") {
		// V1: agent_type is present — only reviewer types proceed; any other type is not a review spawn.
		if (!REVIEW_AGENT_TYPE_SET.has(agentType)) return null;
		return activeSurfaceReviewerAlias(agentType);
	}
	const message = record["message"];
	if (typeof message !== "string") return null;
	const normalizedMessage = message.toLowerCase();
	// Explicit "act as <role>" assignment takes priority. If the assigned role is not a reviewer,
	// treat the spawn as non-review so a message that merely mentions a reviewer name does not
	// accidentally charge that reviewer's quota.
	const allRoleNames = [...REVIEW_AGENT_TYPES];
	const explicitAssignment = allRoleNames
		.map((name) => ({
			name,
			index: normalizedMessage.search(new RegExp(`\\bact as (?:an? )?${name}\\b`)),
		}))
		.filter(({ index }) => index >= 0)
		.sort((left, right) => left.index - right.index)[0];
	if (explicitAssignment !== undefined) return activeSurfaceReviewerAlias(explicitAssignment.name);
	// Check for an explicit "act as <non-reviewer-role>" assignment. If found, the spawn is not a
	// review spawn even if the message body mentions a reviewer name.
	const nonReviewerActAs = /\bact as (?:an? )?\S+/.test(normalizedMessage);
	if (nonReviewerActAs) return null;
	const namedReviewer = REVIEW_AGENT_TYPES.find((name) => normalizedMessage.includes(name));
	if (namedReviewer !== undefined) return activeSurfaceReviewerAlias(namedReviewer);
	return GATE_MESSAGE_PATTERN.test(message) ? reviewerRolesFor(resolveToolkitSurface()).gateReview : null;
}

function activeSurfaceReviewerAlias(reviewer: string): string {
	const activeRoles = reviewerRolesFor(resolveToolkitSurface());
	for (const roles of Object.values(REVIEWER_ROLES_BY_SURFACE)) {
		if (reviewer === roles.codeReview) return activeRoles.codeReview;
		if (reviewer === roles.manualQa) return activeRoles.manualQa;
		if (reviewer === roles.gateReview) return activeRoles.gateReview;
	}
	return reviewer;
}

function atomicWriteJson(targetPath: string, data: unknown): void {
	const tmp = join(dirname(targetPath), `.tmp-${randomBytes(6).toString("hex")}`);
	writeFileSync(tmp, JSON.stringify(data));
	renameSync(tmp, targetPath);
}

function deny(reason: string): string {
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: reason,
			additionalContext: reason,
		},
	})}\n`;
}

function readAdmissionBreaker(sessionId: string): string | null {
	const dataDir = process.env["PLUGIN_DATA"];
	if (typeof dataDir !== "string") return null;
	try {
		const value = JSON.parse(readFileSync(join(dataDir, "spawn-breaker", `${sessionId}.json`), "utf8")) as {
			reason?: unknown;
		};
		return typeof value.reason === "string" ? value.reason : "capacity limit";
	} catch {
		return null;
	}
}

function fanOutLimit(): number {
	const raw = process.env["OMO_SPAWN_FANOUT_LIMIT"];
	if (raw === undefined) return DEFAULT_FANOUT_LIMIT;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FANOUT_LIMIT;
}

function reviewSpawnLimit(): number {
	const raw = process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	if (raw === undefined) return DEFAULT_REVIEW_SPAWN_LIMIT;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REVIEW_SPAWN_LIMIT;
}

function isNonEmptyFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).size > 0;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function readCount(counterPath: string): number {
	try {
		const parsed = JSON.parse(readFileSync(counterPath, "utf8")) as Record<string, unknown>;
		return typeof parsed["count"] === "number" && parsed["count"] >= 0 ? parsed["count"] : 0;
	} catch (error) {
		if (error instanceof Error) return 0;
		throw error;
	}
}

function readCounts(counterPath: string): Record<string, number> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(counterPath, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const counts: Record<string, number> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && value >= 0) counts[key] = value;
		}
		return counts;
	} catch (error) {
		if (error instanceof Error) return {};
		throw error;
	}
}

function readPlan(goalsPath: string): UlwLoopPlan | null {
	try {
		return JSON.parse(readFileSync(goalsPath, "utf8")) as UlwLoopPlan;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}
