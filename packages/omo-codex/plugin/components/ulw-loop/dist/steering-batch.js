import { appendLedger, appendLedgerEntries, findAcceptedSteeringLedgerEntry, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import { applySteeringMutation, validateUlwLoopSteeringProposal } from "./steering.js";
import { buildSteeringPlanSnapshot, changedGoalIdsBetween } from "./steering-snapshot.js";
import { iso } from "./types.js";
import { batchUpdateLedgerEntry } from "./validation-batch.js";
export async function steerUlwLoopBatch(repoRoot, proposals, scope) {
    return withUlwLoopMutationLock(repoRoot, scope, async () => {
        const plan = await readUlwLoopPlan(repoRoot, scope);
        const prepared = await prepareBatch(repoRoot, plan, proposals, scope);
        const failed = prepared.results.find((item) => !item.accepted);
        if (failed !== undefined) {
            const entry = rejectedLedgerEntry(prepared.results);
            await appendLedger(repoRoot, entry, scope);
            return rejected(plan, prepared.results, failed.rejectedReasons);
        }
        let next = plan;
        for (const item of prepared.items)
            if (item.kind === "fresh")
                next = item.prepared.next;
        const fresh = prepared.items.filter((item) => item.kind === "fresh");
        if (fresh.length > 0) {
            await writePlan(repoRoot, next, scope);
            const entries = fresh.map((item) => ledgerEntry(item.prepared.proposal, item.prepared.audit, item.prepared.proposal.now?.toISOString() ?? iso()));
            const batchEntry = batchUpdateLedgerEntry(plan, next, iso());
            await appendLedgerEntries(repoRoot, batchEntry === null ? entries : [...entries, batchEntry], scope);
        }
        return { plan: next, accepted: true, results: prepared.results, rejectedReasons: [] };
    });
}
async function prepareBatch(repoRoot, plan, proposals, scope) {
    const items = [];
    const results = [];
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
function rejected(plan, results, rejectedReasons) {
    return { plan, accepted: false, results, rejectedReasons };
}
function rejectedLedgerEntry(results) {
    const rejectedItems = results.map((result, index) => ({ result, index })).filter((item) => !item.result.accepted);
    return { at: iso(), kind: "steering_rejected", message: rejectedItems.map((item) => `index ${item.index}: ${item.result.rejectedReasons.join(", ")}`).join("; ") };
}
function ledgerEntry(proposal, audit, at) {
    const entry = {
        at,
        kind: proposal.kind === "revise_criterion" ? "criteria_revised" : "steering_accepted",
        evidence: proposal.evidence,
        message: proposal.rationale,
        steering: audit,
        mutationKind: proposal.kind,
    };
    const goalId = audit.targetGoalIds[0];
    if (goalId !== undefined)
        entry.goalId = goalId;
    if (proposal.criterionId !== undefined)
        entry.criterionId = proposal.criterionId;
    if (proposal.idempotencyKey !== undefined)
        entry.idempotencyKey = proposal.idempotencyKey;
    return entry;
}
