// biome-ignore-all format: keep checkpoint orchestration below the pure LOC budget.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { formatCodexGoalReconciliation, readCodexGoalSnapshotInput, reconcileCodexGoalSnapshot } from "./codex-goal-snapshot.js";
import { requireAllCriteriaPass } from "./evidence.js";
import { codexGoalMode, compatibleCodexObjectives, expectedCodexObjective, isFinalRunCompletionCandidate } from "./goal-status.js";
import { ultragoalBriefPath } from "./paths.js";
import { appendLedger, readUltragoalPlan, withUltragoalMutationLock, writePlan } from "./plan-io.js";
import { classifyExternalAuthorizationBlocker, clearGoalBlockerFields, sameBlockerOccurrences, validateQualityGate } from "./quality-gate.js";
import type { UltragoalAggregateCompletion, UltragoalItem, UltragoalLedgerEntry, UltragoalPlan, UltragoalQualityGate } from "./types.js";
import { iso, ULTRAGOAL_DIR, ULTRAGOAL_GOALS, ULTRAGOAL_LEDGER, UltragoalError } from "./types.js";

export interface CheckpointUltragoalArgs { readonly goalId: string; readonly status: "complete" | "failed" | "blocked"; readonly evidence: string; readonly codexGoalJson?: string; readonly qualityGateJson?: string }
export interface CheckpointUltragoalResult { readonly plan: UltragoalPlan; readonly goal: UltragoalItem; readonly ledgerEntry: UltragoalLedgerEntry; readonly aggregateCompletion?: UltragoalAggregateCompletion }

function ultragoalFail(message: string, code: string): never { throw new UltragoalError(message, code); }
function normalizeObjective(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function nonEmptyEvidence(value: string): string { const trimmed = value.trim(); return trimmed || ultragoalFail("Evidence must be a non-empty string.", "ultragoal_evidence_required"); }
function findGoal(plan: UltragoalPlan, goalId: string): UltragoalItem { const goal = plan.goals.find((candidate) => candidate.id === goalId); return goal ?? ultragoalFail(`Unknown ultragoal id: ${goalId}.`, "ultragoal_goal_not_found"); }

function textMentionsUltragoalPlanArtifact(value: string | undefined): boolean {
	const normalized = (value ?? "").toLowerCase();
	return normalized.includes(ULTRAGOAL_DIR.toLowerCase()) || normalized.includes(ULTRAGOAL_GOALS.toLowerCase()) || normalized.includes(ULTRAGOAL_LEDGER.toLowerCase());
}
function textMentionsGoalId(value: string | undefined, goalId: string): boolean { return (value ?? "").toLowerCase().includes(goalId.toLowerCase()); }
function textHasCompletionValidationEvidence(value: string | undefined): boolean {
	const normalized = (value ?? "").toLowerCase();
	const done = /\b(?:planned work|implementation|deliverables?|scope|task|work)\b/.test(normalized) && /\b(?:done|complete|completed|finished|shipped)\b/.test(normalized);
	const verified = /\b(?:validation|verification|tests?|build|lint|review|quality gate|code-review)\b/.test(normalized) && /\b(?:passed|complete|completed|clean|green|approve|approved|clear)\b/.test(normalized);
	return done && verified;
}

async function snapshotObjectiveMapsToUltragoalPlan(repoRoot: string, snapshotObjective: string): Promise<boolean> {
	const actual = normalizeObjective(snapshotObjective).toLowerCase();
	if (textMentionsUltragoalPlanArtifact(actual)) return true;
	if (actual.length < 24 || !existsSync(ultragoalBriefPath(repoRoot))) return false;
	try {
		const brief = normalizeObjective(await readFile(ultragoalBriefPath(repoRoot), "utf8")).toLowerCase();
		return brief.length >= 24 && (brief.includes(actual) || actual.includes(brief));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

async function canReconcileCompletedTaskScopedAggregateSnapshot(repoRoot: string, plan: UltragoalPlan, goal: UltragoalItem, snapshotObjective: string, evidence: string): Promise<boolean> {
	if (codexGoalMode(plan) !== "aggregate") return false;
	if (goal.status !== "in_progress" || plan.activeGoalId !== goal.id) return false;
	if (isFinalRunCompletionCandidate(plan, goal)) return snapshotObjectiveMapsToUltragoalPlan(repoRoot, snapshotObjective);
	if (!textMentionsUltragoalPlanArtifact(evidence) || !textMentionsGoalId(evidence, goal.id)) return false;
	if (!textHasCompletionValidationEvidence(evidence)) return false;
	return snapshotObjectiveMapsToUltragoalPlan(repoRoot, snapshotObjective);
}

function buildCompletedLegacyGoalRemediation(goal: UltragoalItem): string {
	return [
		"If get_goal returns a different completed legacy/thread objective, do not repeat --status complete in this thread.",
		`Record a non-terminal blocker with: omo ultragoal checkpoint --goal-id ${goal.id} --status blocked --evidence "<completed legacy Codex goal blocks create_goal in this thread>" --codex-goal-json "<different completed get_goal JSON or path>".`,
		"Then continue only from a Codex goal context with no active/completed conflicting goal, in the same repo/worktree, and create the intended goal there.",
	].join(" ");
}

function buildTaskScopedAggregateReconciliationHint(goal: UltragoalItem, final: boolean): string {
	if (final) {
		return ` Final task-scoped aggregate reconciliation requires the checkpoint goal to be the active in-progress final OMO goal and the completed get_goal objective to map to the ultragoal brief or artifact. ${buildCompletedLegacyGoalRemediation(goal)}`;
	}
	return ` Completed task-scoped aggregate reconciliation requires the checkpoint goal to be the active in-progress OMO goal, evidence that names that active OMO goal id, names .omo/ultragoal/goals.json or ledger.jsonl, includes completed implementation plus validation/review evidence, and a get_goal objective that maps to the ultragoal brief/artifact. ${buildCompletedLegacyGoalRemediation(goal)}`;
}

async function readJsonInput(raw: string | undefined, repoRoot: string): Promise<unknown> {
	if (raw === undefined || raw.trim() === "") return undefined;
	const trimmed = raw.trim();
	try { return JSON.parse(trimmed); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
	const path = resolve(repoRoot, trimmed);
	if (!existsSync(path)) return ultragoalFail("Quality gate JSON is neither valid JSON nor a readable path.", "ultragoal_json_input_invalid");
	try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { return ultragoalFail(`Quality gate path does not contain valid JSON${error instanceof Error ? `: ${error.message}` : "."}`, "ultragoal_json_input_invalid"); }
}

function makeAggregateCompletion(now: string, evidence: string, codexGoal: unknown): UltragoalAggregateCompletion {
	return { status: "complete", completedAt: now, evidence, codexGoal };
}

function applyBlockedOrFailed(goal: UltragoalItem, plan: UltragoalPlan, status: "failed" | "blocked", evidence: string, now: string): void {
	const signature = classifyExternalAuthorizationBlocker(evidence);
	const occurrences = signature === null ? 0 : sameBlockerOccurrences(plan, signature) + 1;
	const needsDecision = signature !== null && occurrences >= 3;
	goal.status = needsDecision ? "needs_user_decision" : status;
	goal.updatedAt = now;
	if (status === "failed" || needsDecision) { goal.failedAt = now; goal.failureReason = evidence; }
	if (status === "blocked" || needsDecision) goal.blockedReason = evidence;
	if (signature !== null) { goal.blockerSignature = signature; goal.blockerOccurrenceCount = occurrences; goal.requiredExternalDecision = `Resolve external authorization: ${signature}`; }
	if (needsDecision) goal.nonRetriable = true;
	if (plan.activeGoalId === goal.id) delete plan.activeGoalId;
}

function ledgerKind(status: CheckpointUltragoalArgs["status"], goal: UltragoalItem, aggregateCompletion: UltragoalAggregateCompletion | undefined): UltragoalLedgerEntry["kind"] {
	if (aggregateCompletion !== undefined) return "aggregate_completed";
	if (status === "complete") return "goal_completed";
	if (goal.status === "needs_user_decision") return "goal_needs_user_decision";
	return status === "blocked" ? "goal_blocked" : "goal_failed";
}

function buildLedger(now: string, args: CheckpointUltragoalArgs, goal: UltragoalItem, qualityGate: UltragoalQualityGate | undefined, codexGoal: unknown, aggregateCompletion: UltragoalAggregateCompletion | undefined): UltragoalLedgerEntry {
	const entry: UltragoalLedgerEntry = { at: now, kind: ledgerKind(args.status, goal, aggregateCompletion), goalId: goal.id, status: goal.status, evidence: args.evidence };
	if (codexGoal !== undefined) entry.codexGoal = codexGoal;
	if (qualityGate !== undefined) entry.qualityGate = qualityGate;
	if (goal.blockerSignature !== undefined) entry.blockerSignature = goal.blockerSignature;
	if (goal.blockerOccurrenceCount !== undefined) entry.blockerOccurrenceCount = goal.blockerOccurrenceCount;
	if (goal.requiredExternalDecision !== undefined) entry.requiredExternalDecision = goal.requiredExternalDecision;
	return entry;
}

export async function checkpointUltragoal(repoRoot: string, args: CheckpointUltragoalArgs): Promise<CheckpointUltragoalResult> {
	return withUltragoalMutationLock(repoRoot, async () => {
		const plan = await readUltragoalPlan(repoRoot);
		const goal = findGoal(plan, args.goalId);
		if (args.status === "complete") requireAllCriteriaPass(goal);
		const evidence = nonEmptyEvidence(args.evidence);
		const now = iso();
		let aggregateCompletion: UltragoalAggregateCompletion | undefined;
		let qualityGate: UltragoalQualityGate | undefined;
		let codexGoal: unknown;
		if (args.status === "complete") {
			const aggregate = codexGoalMode(plan) === "aggregate";
			const final = isFinalRunCompletionCandidate(plan, goal);
			const snapshot = await readCodexGoalSnapshotInput(args.codexGoalJson, repoRoot);
			const reconciliation = reconcileCodexGoalSnapshot(snapshot, { expectedObjective: expectedCodexObjective(plan, goal), ...(aggregate ? { acceptedObjectives: compatibleCodexObjectives(plan) } : {}), allowedStatuses: aggregate ? (final ? ["complete"] : ["active"]) : ["complete"], requireSnapshot: true, requireComplete: !aggregate || final });
			codexGoal = reconciliation.snapshot.raw;
			if (!reconciliation.ok) {
				const objective = snapshot?.objective;
				const taskScoped = snapshot?.available === true && snapshot.status === "complete" && objective !== undefined && normalizeObjective(objective) !== normalizeObjective(expectedCodexObjective(plan, goal)) && await canReconcileCompletedTaskScopedAggregateSnapshot(repoRoot, plan, goal, objective, evidence);
				if (!taskScoped) throw new UltragoalError(`${formatCodexGoalReconciliation(reconciliation)}${aggregate && snapshot?.status === "complete" && objective !== undefined ? buildTaskScopedAggregateReconciliationHint(goal, final) : ""}`, "ultragoal_codex_snapshot_mismatch");
				aggregateCompletion = makeAggregateCompletion(now, evidence, codexGoal);
			}
			if (final) aggregateCompletion = makeAggregateCompletion(now, evidence, codexGoal);
			if (final || aggregateCompletion !== undefined) qualityGate = validateQualityGate(await readJsonInput(args.qualityGateJson, repoRoot));
			goal.status = "complete";
			goal.completedAt = now;
			goal.evidence = evidence;
			delete goal.failedAt;
			delete goal.failureReason;
			clearGoalBlockerFields(goal);
			if (plan.activeGoalId === goal.id) delete plan.activeGoalId;
		} else applyBlockedOrFailed(goal, plan, args.status, evidence, now);
		goal.updatedAt = now;
		if (aggregateCompletion !== undefined) plan.aggregateCompletion = aggregateCompletion;
		plan.updatedAt = now;
		await writePlan(repoRoot, plan);
		const ledgerEntry = buildLedger(now, args, goal, qualityGate, codexGoal, aggregateCompletion);
		await appendLedger(repoRoot, ledgerEntry);
		return aggregateCompletion === undefined ? { plan, goal, ledgerEntry } : { plan, goal, ledgerEntry, aggregateCompletion };
	});
}
