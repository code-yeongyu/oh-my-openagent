import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PreToolUsePayload } from "./codex-hook.js";
import { parsePreToolUsePayload } from "./codex-hook.js";
import { isFinalRunCompletionCandidate } from "./goal-status.js";
import { ulwLoopAttemptEvidenceDir, ulwLoopDir } from "./paths.js";
import type { UlwLoopPlan } from "./types.js";

// spawn_agent = v1; collaborationspawn_agent = the delimiter-free flattened v2
// hook token from codex-rs hook_names.rs; collaboration.spawn_agent = the
// dotted token observed live in the task-1 probe (hook-tool-tokens.txt).
const SPAWN_TOOL_TOKENS = new Set(["spawn_agent", "collaborationspawn_agent", "collaboration.spawn_agent"]);
const DEFAULT_FANOUT_LIMIT = 60;
const GATE_MESSAGE_PATTERN = /lazycodex-gate-reviewer|final gate review/i;

export function applySpawnGuards(payload: PreToolUsePayload): string {
	if (payload.hook_event_name !== "PreToolUse" || !SPAWN_TOOL_TOKENS.has(payload.tool_name)) return "";
	const stateDir = ulwLoopDir(payload.cwd, { sessionId: payload.session_id });
	const plan = readPlan(join(stateDir, "goals.json"));
	if (plan === null) return "";
	const fanOutDenial = consumeFanOutBudget(stateDir);
	if (fanOutDenial !== null) return deny(fanOutDenial);
	const missingArtifact = missingGateArtifact(payload, plan);
	if (missingArtifact !== null)
		return deny(`spawn code-review + QA first; gate audits their artifacts: missing ${missingArtifact}`);
	return "";
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

// Per-session spawn counter; depth/lineage tracking is descoped — this is a
// total-volume backstop against fan-out explosions, not a recursion tracker.
function consumeFanOutBudget(stateDir: string): string | null {
	const counterPath = join(stateDir, "spawn-count.json");
	const count = readCount(counterPath) + 1;
	writeFileSync(counterPath, JSON.stringify({ count }));
	const limit = fanOutLimit();
	if (count <= limit) return null;
	return `ulw-loop spawn fan-out cap reached (${count}/${limit}). Consolidate work into the agents already running, or raise OMO_SPAWN_FANOUT_LIMIT if this volume is intentional.`;
}

function missingGateArtifact(payload: PreToolUsePayload, plan: UlwLoopPlan): string | null {
	if (!isGateReviewerSpawn(payload.tool_input)) return null;
	const goal = plan.goals.find((candidate) => isFinalRunCompletionCandidate(plan, candidate));
	if (goal === undefined || goal.status === "complete") return null;
	if (!goal.successCriteria.every((criterion) => criterion.status === "pass")) return null;
	const scope = { sessionId: payload.session_id } as const;
	if (plan.evidenceLayoutVersion === 2) {
		const attemptDir = ulwLoopAttemptEvidenceDir(goal.id, goal.attempt, scope);
		for (const name of [`${goal.id}-code-review.md`, `${goal.id}-manual-qa.md`]) {
			const relative = `${attemptDir}/${name}`;
			if (!isNonEmptyFile(join(payload.cwd, relative))) return relative;
		}
		return null;
	}
	const flatReport = `.omo/evidence/${goal.id}-code-review.md`;
	if (!isNonEmptyFile(join(payload.cwd, flatReport))) return flatReport;
	// v1 manual-QA approximation: any other non-empty evidence file counts.
	if (!hasOtherEvidenceFile(join(payload.cwd, ".omo", "evidence"), `${goal.id}-code-review.md`))
		return `.omo/evidence/<any manual-QA artifact besides ${goal.id}-code-review.md>`;
	return null;
}

function isGateReviewerSpawn(toolInput: unknown): boolean {
	if (typeof toolInput !== "object" || toolInput === null) return false;
	const record = toolInput as Record<string, unknown>;
	const agentType = record["agent_type"];
	if (typeof agentType === "string") return agentType === "lazycodex-gate-reviewer";
	const message = record["message"];
	return typeof message === "string" && GATE_MESSAGE_PATTERN.test(message);
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

function fanOutLimit(): number {
	const raw = process.env["OMO_SPAWN_FANOUT_LIMIT"];
	if (raw === undefined) return DEFAULT_FANOUT_LIMIT;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FANOUT_LIMIT;
}

function isNonEmptyFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).size > 0;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function hasOtherEvidenceFile(evidenceDir: string, excludedName: string): boolean {
	try {
		return readdirSync(evidenceDir).some((name) => name !== excludedName && isNonEmptyFile(join(evidenceDir, name)));
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

function readPlan(goalsPath: string): UlwLoopPlan | null {
	try {
		return JSON.parse(readFileSync(goalsPath, "utf8")) as UlwLoopPlan;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}
