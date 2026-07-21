// biome-ignore-all format: compact batch steering module stays below the pure LOC budget.
import type { UlwLoopScope } from "./paths.js";
import { appendLedger, findAcceptedSteeringLedgerEntry, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import { applySteeringMutation, validateUlwLoopSteeringProposal } from "./steering.js";
import { buildSteeringPlanSnapshot, changedGoalIdsBetween } from "./steering-snapshot.js";
import type { UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSteeringAudit, UlwLoopSteeringProposal } from "./types.js";
import { iso } from "./types.js";
import { batchUpdateLedgerEntry } from "./validation-batch.js";

export interface SteerUlwLoopBatchItemResult {
	readonly accepted: boolean;
	readonly deduped: boolean;
	readonly audit: UlwLoopSteeringAudit;
	readonly rejectedReasons: readonly string[];
}

export interface SteerUlwLoopBatchResult {
	readonly plan: UlwLoopPlan;
	readonly accepted: boolean;
	readonly results: readonly SteerUlwLoopBatchItemResult[];
	readonly rejectedReasons: readonly string[];
}

type PreparedFresh = {
	readonly proposal: UlwLoopSteeringProposal;
	readonly audit: UlwLoopSteeringAudit;
	readonly before: UlwLoopPlan;
	readonly next: UlwLoopPlan;
};

type PreparedItem =
	| { readonly kind: "deduped"; readonly result: SteerUlwLoopBatchItemResult }
	| { readonly kind: "fresh"; readonly prepared: PreparedFresh };

export async function steerUlwLoopBatch(
	repoRoot: string,
	proposals: readonly UlwLoopSteeringProposal[],
	scope?: UlwLoopScope,
): Promise<SteerUlwLoopBatchResult> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const prepared = await prepareBatch(repoRoot, plan, proposals, scope);
		const failed = prepared.results.find((item) => !item.accepted);
		if (failed !== undefined) return rejected(plan, prepared.results, failed.rejectedReasons);
		let next = plan;
		for (const item of prepared.items) if (item.kind === "fresh") next = item.prepared.next;
		if (prepared.items.some((item) => item.kind === "fresh")) await writePlan(repoRoot, next, scope);
		for (const item of prepared.items) {
			if (item.kind === "fresh") {
				const at = item.prepared.proposal.now?.toISOString() ?? iso();
				await appendLedger(repoRoot, ledgerEntry(item.prepared.proposal, item.prepared.audit, at), scope);
				const batchEntry = batchUpdateLedgerEntry(item.prepared.before, item.prepared.next, at);
				if (batchEntry !== null) await appendLedger(repoRoot, batchEntry, scope);
			}
		}
		return { plan: next, accepted: true, results: prepared.results, rejectedReasons: [] };
	});
}

async function prepareBatch(
	repoRoot: string,
	plan: UlwLoopPlan,
	proposals: readonly UlwLoopSteeringProposal[],
	scope: UlwLoopScope | undefined,
): Promise<{ readonly items: readonly PreparedItem[]; readonly results: readonly SteerUlwLoopBatchItemResult[] }> {
	const items: PreparedItem[] = [];
	const results: SteerUlwLoopBatchItemResult[] = [];
	let current = plan;
	for (const proposal of proposals) {
		const key = proposal.idempotencyKey ?? proposal.promptSignature;
		const prior = key === undefined ? undefined : await findAcceptedSteeringLedgerEntry(repoRoot, key, scope);
		if (prior?.steering !== undefined) {
			const result = { accepted: true, deduped: true, audit: { ...prior.steering, deduped: true }, rejectedReasons: [] };
			items.push({ kind: "deduped", result });
			results.push(result);
			continue;
		}
		const audit = validateUlwLoopSteeringProposal(current, proposal);
		if (!audit.invariant.accepted) {
			const result = { accepted: false, deduped: false, audit, rejectedReasons: audit.invariant.rejectedReasons };
			items.push({ kind: "deduped", result });
			results.push(result);
			continue;
		}
		const next = applySteeringMutation(current, proposal, audit);
		const changed = changedGoalIdsBetween(current, next);
		const finalAudit = { ...audit, before: buildSteeringPlanSnapshot(current, changed), after: buildSteeringPlanSnapshot(next, changed) };
		const result = { accepted: true, deduped: false, audit: finalAudit, rejectedReasons: [] };
		items.push({ kind: "fresh", prepared: { proposal, audit: finalAudit, before: current, next } });
		results.push(result);
		current = next;
	}
	return { items, results };
}

function rejected(
	plan: UlwLoopPlan,
	results: readonly SteerUlwLoopBatchItemResult[],
	rejectedReasons: readonly string[],
): SteerUlwLoopBatchResult {
	return { plan, accepted: false, results, rejectedReasons };
}

function ledgerEntry(proposal: UlwLoopSteeringProposal, audit: UlwLoopSteeringAudit, at: string): UlwLoopLedgerEntry {
	const entry: UlwLoopLedgerEntry = {
		at,
		kind: proposal.kind === "revise_criterion" ? "criteria_revised" : "steering_accepted",
		evidence: proposal.evidence,
		message: proposal.rationale,
		steering: audit,
		mutationKind: proposal.kind,
	};
	const goalId = audit.targetGoalIds[0];
	if (goalId !== undefined) entry.goalId = goalId;
	if (proposal.criterionId !== undefined) entry.criterionId = proposal.criterionId;
	if (proposal.idempotencyKey !== undefined) entry.idempotencyKey = proposal.idempotencyKey;
	return entry;
}
