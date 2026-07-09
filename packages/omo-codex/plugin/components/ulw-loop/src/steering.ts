// biome-ignore-all format: compact steering module must stay below the 240 pure-LOC budget
import { isUlwLoopDone } from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import { seedDefaultSuccessCriteria } from "./plan-crud.js";
import { appendLedger, findAcceptedSteeringLedgerEntry, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import { buildSteeringPlanSnapshot, changedGoalIdsBetween } from "./steering-snapshot.js";
import type {
	SteerUlwLoopResult,
	UlwLoopItem,
	UlwLoopLedgerEntry,
	UlwLoopPlan,
	UlwLoopSteeringAudit,
	UlwLoopSteeringChildGoal,
	UlwLoopSteeringMutationKind,
	UlwLoopSteeringProposal,
	UlwLoopSteeringSource,
	UlwLoopSuccessCriterionUserModel,
} from "./types.js";
import { iso, ULW_LOOP_STEERING_MUTATION_KINDS, ULW_LOOP_SUCCESS_CRITERION_USER_MODELS } from "./types.js";

const SOURCES = ["user_prompt_submit", "finding", "cli"] as const satisfies readonly UlwLoopSteeringSource[];
const PROTECTED = new Set(["aggregateCompletion", "codexObjective", "codexObjectiveAliases", "originalConstraints", "qualityGate", "status", "completedAt", "completionStatus"]);
const isObject = (value: unknown): value is object => typeof value === "object" && value !== null; const isPlain = (value: unknown): value is object => isObject(value) && !Array.isArray(value);
const read = (value: object, key: string): unknown => Object.entries(value).find(([name]) => name === key)?.[1];
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const text = (value: object, key: string): string | undefined => {
	const candidate = read(value, key);
	return isText(candidate) ? candidate.trim() : undefined;
};
const isKind = (value: unknown): value is UlwLoopSteeringMutationKind => typeof value === "string" && ULW_LOOP_STEERING_MUTATION_KINDS.some((kind) => kind === value);
const isSource = (value: unknown): value is UlwLoopSteeringSource => typeof value === "string" && SOURCES.some((source) => source === value);
const isModel = (value: unknown): value is UlwLoopSuccessCriterionUserModel => typeof value === "string" && ULW_LOOP_SUCCESS_CRITERION_USER_MODELS.some((model) => model === value);
const texts = (value: object, key: string): string[] => {
	const candidate = read(value, key);
	return Array.isArray(candidate) && candidate.every((item) => typeof item === "string") ? candidate : [];
};

function targets(proposal: object): string[] {
	const many = texts(proposal, "targetGoalIds");
	const one = text(proposal, "targetGoalId") ?? text(proposal, "goalId");
	return many.length > 0 ? many : one === undefined ? [] : [one];
}

const after = (proposal: object): object | undefined => {
	const candidate = read(proposal, "after");
	return isPlain(candidate) ? candidate : undefined;
};
const revised = (proposal: object, direct: string, nested: string): string | undefined => text(proposal, direct) ?? text(after(proposal) ?? proposal, nested);

function child(value: unknown): UlwLoopSteeringChildGoal | null {
	if (!isPlain(value)) return null;
	const title = text(value, "title");
	const objective = text(value, "objective");
	if (title === undefined || objective === undefined) return null;
	return { title, objective };
}

function childValues(proposal: object): unknown[] {
	const direct = read(proposal, "childGoals");
	if (Array.isArray(direct) && direct.length > 0) return direct;
	const nested = after(proposal);
	const fromAfter = nested === undefined ? undefined : read(nested, "children");
	return Array.isArray(fromAfter) ? fromAfter : [];
}

const children = (proposal: object): UlwLoopSteeringChildGoal[] => childValues(proposal).map(child).filter((item): item is UlwLoopSteeringChildGoal => item !== null);
const pendingOrder = (proposal: object): string[] => {
	const direct = texts(proposal, "pendingOrder");
	return direct.length > 0 ? direct : texts(after(proposal) ?? proposal, "pendingGoalIds");
};

function hasProtected(value: unknown): boolean {
	if (!isObject(value)) return false;
	for (const [key, childValue] of Object.entries(value)) if (PROTECTED.has(key) || key.toLowerCase().includes("complete") || hasProtected(childValue)) return true;
	return false;
}

function allText(value: unknown): string {
	if (typeof value === "string") return value;
	return isObject(value) ? Object.values(value).map(allText).filter(Boolean).join("\n") : "";
}

function weakens(value: unknown): boolean {
	const valueText = allText(value).toLowerCase();
	return /\b(skip|bypass|weaken|remove|omit|auto[-\s]?complete|mark complete|complete faster)\b/.test(valueText) && /\b(test|tests|verification|review|quality gate|complete|completion)\b/.test(valueText);
}

function auditFor(proposal: unknown, reasons: string[]): UlwLoopSteeringAudit {
	const object = isPlain(proposal) ? proposal : undefined;
	const kindRaw = object === undefined ? undefined : read(object, "kind");
	const sourceRaw = object === undefined ? undefined : read(object, "source");
	const evidence = object === undefined ? "" : (text(object, "evidence") ?? "");
	const rationale = object === undefined ? "" : (text(object, "rationale") ?? "");
	const audit: UlwLoopSteeringAudit = { kind: isKind(kindRaw) ? kindRaw : "annotate_ledger", source: isSource(sourceRaw) ? sourceRaw : "cli", targetGoalIds: object === undefined ? [] : targets(object), evidence, rationale, invariant: { accepted: reasons.length === 0, structuralInvariantAccepted: reasons.length === 0, evidenceBackedNecessity: evidence.length > 0 && rationale.length > 0, noEasierCompletion: !weakens(proposal), rejectedReasons: reasons, reasons } };
	if (object === undefined) return audit;
	const criterionId = text(object, "criterionId");
	const directiveText = text(object, "directiveText");
	const promptSignature = text(object, "promptSignature");
	const idempotencyKey = text(object, "idempotencyKey");
	if (criterionId !== undefined) audit.criterionId = criterionId;
	if (directiveText !== undefined) audit.directiveText = directiveText;
	if (promptSignature !== undefined) audit.promptSignature = promptSignature;
	if (idempotencyKey !== undefined) audit.idempotencyKey = idempotencyKey;
	return audit;
}

export function validateUlwLoopSteeringProposal(plan: UlwLoopPlan, proposal: unknown): UlwLoopSteeringAudit {
	const reasons: string[] = [];
	if (!isPlain(proposal)) reasons.push("proposal must be an object");
	const object = isPlain(proposal) ? proposal : {};
	const kind = read(object, "kind");
	if (!isKind(kind)) reasons.push(`invalid kind: ${String(kind)}`);
	if (!isSource(read(object, "source"))) reasons.push(`invalid source: ${String(read(object, "source"))}`);
	if (text(object, "evidence") === undefined) reasons.push("missing evidence");
	if (text(object, "rationale") === undefined) reasons.push("missing rationale");
	if (hasProtected(proposal)) reasons.push("protected payload");
	if (weakens(proposal)) reasons.push("weakened completion");
	if (isUlwLoopDone(plan)) reasons.push("plan already complete");
	if (isKind(kind)) validateKind(plan, object, kind, reasons);
	return auditFor(proposal, reasons);
}

function goal(plan: UlwLoopPlan, id: string | undefined): UlwLoopItem | undefined {
	return id === undefined ? undefined : plan.goals.find((item) => item.id === id);
}

function validateKind(plan: UlwLoopPlan, proposal: object, kind: UlwLoopSteeringMutationKind, reasons: string[]): void {
	const target = goal(plan, targets(proposal)[0]);
	if (kind === "add_subgoal" && (text(proposal, "title") === undefined || text(proposal, "objective") === undefined)) reasons.push("add_subgoal requires title/objective");
	if ((kind === "split_subgoal" || kind === "revise_pending_wording" || kind === "mark_blocked_superseded") && target === undefined) reasons.push(`${kind} requires target`);
	if ((kind === "split_subgoal" || kind === "revise_pending_wording") && target !== undefined && target.status !== "pending") reasons.push(`${kind} requires pending target`);
	const rawChildren = childValues(proposal);
	if (kind === "split_subgoal" && rawChildren.length === 0) reasons.push("split_subgoal requires children");
	if ((kind === "split_subgoal" || kind === "mark_blocked_superseded") && rawChildren.some((item) => child(item) === null)) reasons.push(`${kind} children require title/objective`);
	if (kind === "reorder_pending") validateOrder(plan, proposal, reasons);
	if (kind === "revise_pending_wording" && revised(proposal, "revisedTitle", "title") === undefined && revised(proposal, "revisedObjective", "objective") === undefined) reasons.push("revise_pending_wording requires update");
	if (kind === "revise_criterion") validateCriterion(plan, proposal, reasons);
}

function validateOrder(plan: UlwLoopPlan, proposal: object, reasons: string[]): void {
	const requested = pendingOrder(proposal);
	const pending = plan.goals.filter((item) => item.status === "pending" && item.steeringStatus === undefined).map((item) => item.id);
	if (requested.length === 0) reasons.push("reorder_pending requires ids");
	if (new Set(requested).size !== requested.length) reasons.push("duplicate pending id");
	if (requested.some((id) => !pending.includes(id))) reasons.push("unknown pending id");
}

function validateCriterion(plan: UlwLoopPlan, proposal: object, reasons: string[]): void {
	const target = goal(plan, targets(proposal)[0]);
	const criterionId = text(proposal, "criterionId");
	if (target === undefined) reasons.push("revise_criterion requires goalId");
	else if (criterionId === undefined || target.successCriteria.every((item) => item.id !== criterionId)) reasons.push("revise_criterion requires criterionId");
	const model = read(proposal, "userModel");
	if (read(proposal, "scenario") === undefined && read(proposal, "expectedEvidence") === undefined && model === undefined) reasons.push("revise_criterion requires update");
	if (model !== undefined && !isModel(model)) reasons.push("invalid userModel");
}

function nextId(plan: UlwLoopPlan, offset: number): string {
	const max = plan.goals.reduce((current, item) => {
		const digits = /^G(\d+)(?:-|$)/u.exec(item.id)?.[1];
		return digits === undefined ? current : Math.max(current, Number(digits));
	}, 0);
	return `G${String(max + offset).padStart(3, "0")}`;
}

function makeGoal(plan: UlwLoopPlan, childGoal: UlwLoopSteeringChildGoal, evidence: string, now: string, offset: number): UlwLoopItem {
	const id = nextId(plan, offset);
	const digits = /^G(\d+)/u.exec(id)?.[1];
	const goalIndex = digits === undefined ? plan.goals.length + offset - 1 : Number(digits) - 1;
	return { id, title: childGoal.title, objective: childGoal.objective, status: "pending", successCriteria: seedDefaultSuccessCriteria(goalIndex, childGoal.objective), attempt: 0, createdAt: now, updatedAt: now, evidence };
}

export function applySteeringMutation(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, audit: UlwLoopSteeringAudit): UlwLoopPlan {
	const next = structuredClone(plan);
	if (!audit.invariant.accepted) return next;
	const now = proposal.now?.toISOString() ?? iso();
	if (proposal.kind === "add_subgoal") next.goals.push(makeGoal(next, { title: proposal.title ?? "", objective: proposal.objective ?? "" }, proposal.evidence, now, 1));
	if (proposal.kind === "reorder_pending") {
		const order = pendingOrder(proposal);
		next.goals = [...order.map((id) => goal(next, id)).filter((item): item is UlwLoopItem => item !== undefined), ...next.goals.filter((item) => !order.includes(item.id))];
	}
	if (proposal.kind === "revise_pending_wording") reviseWording(next, proposal, now);
	if (proposal.kind === "split_subgoal" || proposal.kind === "mark_blocked_superseded") splitOrBlock(next, proposal, now);
	if (proposal.kind === "revise_criterion") reviseCriterion(next, proposal, now);
	if (proposal.kind !== "annotate_ledger") next.updatedAt = now;
	return next;
}

function reviseWording(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]);
	if (target === undefined) return;
	target.title = revised(proposal, "revisedTitle", "title") ?? target.title;
	target.objective = revised(proposal, "revisedObjective", "objective") ?? target.objective;
	target.steeringEvidence = proposal.evidence;
	target.steeringRationale = proposal.rationale;
	target.updatedAt = now;
}

function splitOrBlock(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]);
	if (target === undefined) return;
	const replacements = children(proposal).map((item, index) => makeGoal(plan, item, proposal.evidence, now, index + 1));
	target.steeringEvidence = proposal.evidence;
	target.steeringRationale = proposal.rationale;
	target.updatedAt = now;
	if (replacements.length === 0) {
		target.status = "blocked";
		target.steeringStatus = "blocked";
		target.blockedReason = proposal.blockedReason ?? proposal.rationale;
	} else {
		target.steeringStatus = "superseded";
		target.supersededBy = replacements.map((item) => item.id);
		for (const item of replacements) item.supersedes = [target.id];
		plan.goals.splice(plan.goals.indexOf(target) + 1, 0, ...replacements);
	}
	if (plan.activeGoalId === target.id) delete plan.activeGoalId;
}

function reviseCriterion(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]);
	const index = target?.successCriteria.findIndex((item) => item.id === proposal.criterionId) ?? -1;
	const current = target?.successCriteria[index];
	if (target === undefined || current === undefined) return;
	const model = read(proposal, "userModel");
	target.successCriteria[index] = { ...current, scenario: text(proposal, "scenario") ?? current.scenario, expectedEvidence: text(proposal, "expectedEvidence") ?? current.expectedEvidence, userModel: isModel(model) ? model : current.userModel };
	target.updatedAt = now;
}

function isProposal(value: unknown): value is UlwLoopSteeringProposal {
	return isPlain(value) && isKind(read(value, "kind")) && isSource(read(value, "source")) && isText(read(value, "evidence")) && isText(read(value, "rationale"));
}

export function parseUlwLoopSteeringDirective(text: string): UlwLoopSteeringProposal | null {
	const match = /(?:^|\s)(?:OMO_ULW_LOOP_STEER|omo\.ulw-loop\.steer|omo ulw-loop steer):\s*([\s\S]+)$/u.exec(text);
	if (match?.[1] === undefined) return null;
	try {
		const parsed: unknown = JSON.parse(match[1].trim());
		return isProposal(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

export async function steerUlwLoop(repoRoot: string, proposal: UlwLoopSteeringProposal, scope?: UlwLoopScope): Promise<SteerUlwLoopResult> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const key = proposal.idempotencyKey ?? proposal.promptSignature;
		const prior = key === undefined ? undefined : await findAcceptedSteeringLedgerEntry(repoRoot, key, scope);
		if (prior?.steering !== undefined) {
			// Legacy entries embedded full-plan before/after snapshots; never
			// re-surface those multi-MB payloads on the dedup path.
			const { before: _before, after: _after, ...compactPrior } = prior.steering;
			return { plan, accepted: true, audit: { ...compactPrior, deduped: true }, rejectedReasons: [], deduped: true };
		}
		const audit = validateUlwLoopSteeringProposal(plan, proposal);
		const accepted = audit.invariant.accepted;
		const next = accepted ? applySteeringMutation(plan, proposal, audit) : plan;
		const finalAudit: UlwLoopSteeringAudit = { ...audit };
		if (accepted) {
			const changed = changedGoalIdsBetween(plan, next);
			finalAudit.before = buildSteeringPlanSnapshot(plan, changed);
			finalAudit.after = buildSteeringPlanSnapshot(next, changed);
		}
		if (accepted) await writePlan(repoRoot, next, scope);
		await appendLedger(repoRoot, ledgerEntry(proposal, finalAudit, proposal.now?.toISOString() ?? iso()), scope);
		return { plan: next, accepted, audit: finalAudit, rejectedReasons: audit.invariant.rejectedReasons, deduped: false };
	});
}

function ledgerEntry(proposal: UlwLoopSteeringProposal, audit: UlwLoopSteeringAudit, at: string): UlwLoopLedgerEntry {
	const entry: UlwLoopLedgerEntry = { at, kind: audit.invariant.accepted ? (proposal.kind === "revise_criterion" ? "criteria_revised" : "steering_accepted") : "steering_rejected", evidence: proposal.evidence, message: proposal.rationale, steering: audit, mutationKind: proposal.kind };
	const goalId = audit.targetGoalIds[0];
	if (goalId !== undefined) entry.goalId = goalId;
	if (proposal.criterionId !== undefined) entry.criterionId = proposal.criterionId;
	if (proposal.idempotencyKey !== undefined) entry.idempotencyKey = proposal.idempotencyKey;
	return entry;
}
