// biome-ignore-all format: keep this module under the mandated pure LOC budget.
import { parseGoalArg, readJsonInput, readValue } from "./cli-arg-parser.js";
import { printJson, printStatus } from "./cli-output.js";
import type { SteerUlwLoopBatchResult } from "./steering-batch.js";
import type { SteerUlwLoopResult, UlwLoopSteeringChildGoal, UlwLoopSteeringMutationKind, UlwLoopSteeringProposal, UlwLoopSteeringSource, UlwLoopSuccessCriterionUserModel } from "./types.js";
import { ULW_LOOP_STEERING_MUTATION_KINDS, ULW_LOOP_SUCCESS_CRITERION_USER_MODELS, UlwLoopError } from "./types.js";

const SOURCES = ["user_prompt_submit", "finding", "cli"] as const satisfies readonly UlwLoopSteeringSource[];
const STEERING_KIND_HELP = [
	`Allowed --kind values: ${ULW_LOOP_STEERING_MUTATION_KINDS.join(", ")}`,
	"Kind-specific required flags:",
	"  add_subgoal: --title, --objective, --evidence, --rationale",
	"  split_subgoal: --goal-id, --children, --evidence, --rationale",
	"  reorder_pending: --order, --evidence, --rationale",
	"  revise_pending_wording: --goal-id, --title or --objective, --evidence, --rationale",
	"  revise_criterion: --goal-id, --criterion-id, one of --scenario/--expected-evidence/--user-model, --evidence, --rationale",
	"  annotate_ledger: --evidence, --rationale",
	"  mark_blocked_superseded: --goal-id, optional --replacements, --evidence, --rationale",
	"Example: omo ulw-loop steer --kind annotate_ledger --evidence \"observed behavior\" --rationale \"why this changes the plan\" --json",
].join("\n");

export type CliSteeringProposal = UlwLoopSteeringProposal & { readonly goalId?: string; readonly scenario?: string; readonly expectedEvidence?: string; readonly userModel?: UlwLoopSuccessCriterionUserModel };

function isKind(value: string | undefined): value is UlwLoopSteeringMutationKind { return value !== undefined && ULW_LOOP_STEERING_MUTATION_KINDS.some((kind) => kind === value); }
function isSource(value: string | undefined): value is UlwLoopSteeringSource { return value !== undefined && SOURCES.some((source) => source === value); }
function isModel(value: string): value is UlwLoopSuccessCriterionUserModel { return ULW_LOOP_SUCCESS_CRITERION_USER_MODELS.some((model) => model === value); }
function fail(message: string, code: string, details: Record<string, unknown>): never { throw new UlwLoopError(message, code, { details }); }
function kindMessage(prefix: string): string { return `${prefix}\n\n${STEERING_KIND_HELP}`; }
function text(value: string | undefined, field: string): string | undefined { if (value === undefined) return undefined; const trimmed = value.trim(); if (trimmed.length > 0) return trimmed; return fail(`Empty ${field}.`, "ULW_LOOP_STEERING_FIELD_EMPTY", { field }); }
function required(argv: readonly string[], flag: string): string { const value = text(readValue(argv, flag), flag); return value ?? fail(`Missing ${flag}.`, "ULW_LOOP_STEERING_FIELD_REQUIRED", { flag }); }
function requiredGoal(argv: readonly string[]): string { const value = text(parseGoalArg(argv), "--goal-id"); return value ?? fail("Missing --goal-id.", "ULW_LOOP_GOAL_ID_REQUIRED", { flag: "--goal-id" }); }
function readObject(value: object, key: string): unknown { return Object.entries(value).find(([name]) => name === key)?.[1]; }
function isPlain(value: unknown): value is object { return typeof value === "object" && value !== null && !Array.isArray(value); }
function objectText(value: object, key: string): string | undefined { const candidate = readObject(value, key); return typeof candidate === "string" ? candidate : undefined; }
function objectStrings(value: object, key: string): string[] | undefined { const candidate = readObject(value, key); return Array.isArray(candidate) && candidate.every((item) => typeof item === "string") ? candidate : undefined; }
function objectChildren(value: object, key: string): UlwLoopSteeringChildGoal[] | undefined { const candidate = readObject(value, key); if (!Array.isArray(candidate)) return undefined; const parsed: UlwLoopSteeringChildGoal[] = []; for (const item of candidate) { const next = child(item); if (next === null) return fail(`${key} entries require title/objective.`, "ULW_LOOP_STEERING_CHILD_INVALID", { key }); parsed.push(next); } return parsed; }
function isProposalKind(value: unknown): value is UlwLoopSteeringMutationKind { return typeof value === "string" && ULW_LOOP_STEERING_MUTATION_KINDS.some((kind) => kind === value); }
function isProposalSource(value: unknown): value is UlwLoopSteeringSource { return typeof value === "string" && SOURCES.some((source) => source === value); }

export function parseSteeringKind(argv: readonly string[]): UlwLoopSteeringMutationKind {
	const value = readValue(argv, "--kind");
	if (isKind(value)) return value;
	return value === undefined ? fail(kindMessage("Missing --kind."), "ULW_LOOP_STEERING_KIND_REQUIRED", { flag: "--kind", expected: ULW_LOOP_STEERING_MUTATION_KINDS, usage: STEERING_KIND_HELP }) : fail(kindMessage(`Invalid --kind: ${value}.`), "ULW_LOOP_STEERING_KIND_INVALID", { value, expected: ULW_LOOP_STEERING_MUTATION_KINDS, usage: STEERING_KIND_HELP });
}

export function parseSteeringSource(argv: readonly string[]): UlwLoopSteeringSource {
	const value = readValue(argv, "--source");
	if (value === undefined) return "cli";
	return isSource(value) ? value : fail(`Invalid --source: ${value}.`, "ULW_LOOP_STEERING_SOURCE_INVALID", { value, expected: SOURCES });
}

function child(value: unknown): UlwLoopSteeringChildGoal | null {
	if (!isPlain(value)) return null;
	const title = text(objectText(value, "title"), "title"); const objective = text(objectText(value, "objective"), "objective");
	if (title === undefined || objective === undefined) return null;
	return { title, objective };
}

async function children(argv: readonly string[], flag: string, needed: boolean): Promise<UlwLoopSteeringChildGoal[]> {
	const input = needed ? required(argv, flag) : text(readValue(argv, flag), flag);
	if (input === undefined) return [];
	const raw = await readJsonInput(input);
	if (!Array.isArray(raw)) return fail(`${flag} must be a JSON array.`, "ULW_LOOP_STEERING_JSON_ARRAY_REQUIRED", { flag });
	const parsed: UlwLoopSteeringChildGoal[] = [];
	for (const item of raw) { const next = child(item); if (next === null) return fail(`${flag} entries require title/objective.`, "ULW_LOOP_STEERING_CHILD_INVALID", { flag }); parsed.push(next); }
	return parsed;
}

async function stringArray(argv: readonly string[], flag: string): Promise<string[]> {
	const raw = await readJsonInput(required(argv, flag));
	if (!Array.isArray(raw)) return fail(`${flag} must be a JSON array.`, "ULW_LOOP_STEERING_JSON_ARRAY_REQUIRED", { flag });
	const values: string[] = [];
	for (const item of raw) { if (typeof item !== "string") return fail(`${flag} entries must be strings.`, "ULW_LOOP_STEERING_STRING_ARRAY_REQUIRED", { flag }); values.push(text(item, flag) ?? ""); }
	return values;
}

function model(value: string | undefined): UlwLoopSuccessCriterionUserModel | undefined { const trimmed = text(value, "--user-model"); if (trimmed === undefined) return undefined; return isModel(trimmed) ? trimmed : fail(`Invalid --user-model: ${trimmed}.`, "ULW_LOOP_STEERING_USER_MODEL_INVALID", { value: trimmed, expected: ULW_LOOP_SUCCESS_CRITERION_USER_MODELS }); }
function neverKind(kind: never): never { return fail(`Unsupported steering kind: ${String(kind)}.`, "ULW_LOOP_STEERING_KIND_UNSUPPORTED", { kind }); }

export async function parseSteeringProposal(argv: readonly string[]): Promise<CliSteeringProposal> {
	const kind = parseSteeringKind(argv); const source = parseSteeringSource(argv); const idempotencyKey = text(readValue(argv, "--idempotency-key"), "--idempotency-key");
	const base = { kind, source, evidence: required(argv, "--evidence"), rationale: required(argv, "--rationale"), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
	switch (kind) {
		case "add_subgoal": return normalizeSteeringProposal({ ...base, title: required(argv, "--title"), objective: required(argv, "--objective") });
		case "split_subgoal": { const goalId = requiredGoal(argv); return normalizeSteeringProposal({ ...base, goalId, targetGoalId: goalId, childGoals: await children(argv, "--children", true) }); }
		case "reorder_pending": return normalizeSteeringProposal({ ...base, pendingOrder: await stringArray(argv, "--order") });
		case "revise_pending_wording": { const goalId = requiredGoal(argv); const revisedTitle = readValue(argv, "--title"); const revisedObjective = readValue(argv, "--objective"); if (revisedTitle === undefined && revisedObjective === undefined) return fail("revise_pending_wording requires --title or --objective.", "ULW_LOOP_STEERING_UPDATE_REQUIRED", { kind }); return normalizeSteeringProposal({ ...base, goalId, targetGoalId: goalId, ...(revisedTitle === undefined ? {} : { revisedTitle }), ...(revisedObjective === undefined ? {} : { revisedObjective }) }); }
		case "revise_criterion": { const goalId = requiredGoal(argv); const criterionId = required(argv, "--criterion-id"); const scenario = readValue(argv, "--scenario"); const expectedEvidence = readValue(argv, "--expected-evidence"); const userModel = model(readValue(argv, "--user-model")); if (scenario === undefined && expectedEvidence === undefined && userModel === undefined) return fail("revise_criterion requires scenario, expected-evidence, or user-model.", "ULW_LOOP_STEERING_UPDATE_REQUIRED", { kind }); return normalizeSteeringProposal({ ...base, goalId, targetGoalId: goalId, criterionId, ...(scenario === undefined ? {} : { scenario }), ...(expectedEvidence === undefined ? {} : { expectedEvidence }), ...(userModel === undefined ? {} : { userModel }) }); }
		case "annotate_ledger": return normalizeSteeringProposal(base);
		case "mark_blocked_superseded": { const goalId = requiredGoal(argv); const childGoals = await children(argv, "--replacements", false); return normalizeSteeringProposal({ ...base, goalId, targetGoalId: goalId, ...(childGoals.length === 0 ? {} : { childGoals }) }); }
		default: return neverKind(kind);
	}
}

function normalizedChildren(values: readonly UlwLoopSteeringChildGoal[] | undefined): UlwLoopSteeringChildGoal[] | undefined { if (values === undefined) return undefined; return values.map((item) => ({ title: text(item.title, "child.title") ?? "", objective: text(item.objective, "child.objective") ?? "" })); }
function normalizedStrings(values: readonly string[] | undefined, field: string): string[] | undefined { if (values === undefined) return undefined; return values.map((value) => text(value, field) ?? ""); }

export function normalizeSteeringProposal(proposal: CliSteeringProposal): CliSteeringProposal {
	const evidence = text(proposal.evidence, "evidence") ?? ""; const rationale = text(proposal.rationale, "rationale") ?? ""; const goalId = text(proposal.goalId, "goalId"); const targetGoalId = text(proposal.targetGoalId, "targetGoalId"); const targetGoalIds = normalizedStrings(proposal.targetGoalIds, "targetGoalIds");
	const criterionId = text(proposal.criterionId, "criterionId"); const title = text(proposal.title, "title"); const objective = text(proposal.objective, "objective"); const revisedTitle = text(proposal.revisedTitle, "revisedTitle"); const revisedObjective = text(proposal.revisedObjective, "revisedObjective");
	const blockedReason = text(proposal.blockedReason, "blockedReason"); const directiveText = text(proposal.directiveText, "directiveText"); const promptSignature = text(proposal.promptSignature, "promptSignature"); const idempotencyKey = text(proposal.idempotencyKey, "idempotencyKey");
	const scenario = text(proposal.scenario, "scenario"); const expectedEvidence = text(proposal.expectedEvidence, "expectedEvidence"); const childGoals = normalizedChildren(proposal.childGoals); const pendingOrder = normalizedStrings(proposal.pendingOrder, "pendingOrder");
	return { kind: proposal.kind, source: proposal.source, evidence, rationale, ...(goalId === undefined ? {} : { goalId }), ...(targetGoalId === undefined ? {} : { targetGoalId }), ...(targetGoalIds === undefined ? {} : { targetGoalIds }), ...(criterionId === undefined ? {} : { criterionId }), ...(title === undefined ? {} : { title }), ...(objective === undefined ? {} : { objective }), ...(childGoals === undefined ? {} : { childGoals }), ...(revisedTitle === undefined ? {} : { revisedTitle }), ...(revisedObjective === undefined ? {} : { revisedObjective }), ...(pendingOrder === undefined ? {} : { pendingOrder }), ...(blockedReason === undefined ? {} : { blockedReason }), ...(proposal.after === undefined ? {} : { after: proposal.after }), ...(directiveText === undefined ? {} : { directiveText }), ...(promptSignature === undefined ? {} : { promptSignature }), ...(idempotencyKey === undefined ? {} : { idempotencyKey }), ...(proposal.now === undefined ? {} : { now: proposal.now }), ...(scenario === undefined ? {} : { scenario }), ...(expectedEvidence === undefined ? {} : { expectedEvidence }), ...(proposal.userModel === undefined ? {} : { userModel: proposal.userModel }) };
}

export async function parseSteeringProposals(argv: readonly string[]): Promise<readonly CliSteeringProposal[]> {
	const input = text(readValue(argv, "--proposals-json"), "--proposals-json");
	if (input === undefined) return [await parseSteeringProposal(argv)];
	const raw = await readJsonInput(input);
	if (!Array.isArray(raw) || raw.length === 0) return fail("--proposals-json must be a non-empty JSON array.", "ULW_LOOP_STEERING_BATCH_ARRAY_REQUIRED", { flag: "--proposals-json" });
	const proposals: CliSteeringProposal[] = [];
	for (const item of raw) proposals.push(normalizeSteeringProposal(proposalFromObject(item)));
	return proposals;
}

function proposalFromObject(value: unknown): CliSteeringProposal {
	if (!isPlain(value)) return fail("--proposals-json entries must be objects.", "ULW_LOOP_STEERING_BATCH_ITEM_INVALID", { flag: "--proposals-json" });
	const kind = readObject(value, "kind"); const source = readObject(value, "source") ?? "cli";
	if (!isProposalKind(kind)) return fail(`Invalid batch steering kind: ${String(kind)}.`, "ULW_LOOP_STEERING_KIND_INVALID", { value: kind });
	if (!isProposalSource(source)) return fail(`Invalid batch steering source: ${String(source)}.`, "ULW_LOOP_STEERING_SOURCE_INVALID", { value: source });
	let proposal: CliSteeringProposal = { kind, source, evidence: objectText(value, "evidence") ?? "", rationale: objectText(value, "rationale") ?? "" };
	const goalId = objectText(value, "goalId"); const targetGoalId = objectText(value, "targetGoalId"); const criterionId = objectText(value, "criterionId");
	const title = objectText(value, "title"); const objective = objectText(value, "objective"); const revisedTitle = objectText(value, "revisedTitle"); const revisedObjective = objectText(value, "revisedObjective");
	const scenario = objectText(value, "scenario"); const expectedEvidence = objectText(value, "expectedEvidence"); const idempotencyKey = objectText(value, "idempotencyKey");
	const targetGoalIds = objectStrings(value, "targetGoalIds"); const pendingOrder = objectStrings(value, "pendingOrder"); const childGoals = objectChildren(value, "childGoals");
	if (goalId !== undefined) proposal = { ...proposal, goalId };
	if (targetGoalId !== undefined) proposal = { ...proposal, targetGoalId };
	if (criterionId !== undefined) proposal = { ...proposal, criterionId };
	if (title !== undefined) proposal = { ...proposal, title };
	if (objective !== undefined) proposal = { ...proposal, objective };
	if (revisedTitle !== undefined) proposal = { ...proposal, revisedTitle };
	if (revisedObjective !== undefined) proposal = { ...proposal, revisedObjective };
	if (scenario !== undefined) proposal = { ...proposal, scenario };
	if (expectedEvidence !== undefined) proposal = { ...proposal, expectedEvidence };
	if (idempotencyKey !== undefined) proposal = { ...proposal, idempotencyKey };
	if (targetGoalIds !== undefined) proposal = { ...proposal, targetGoalIds };
	if (pendingOrder !== undefined) proposal = { ...proposal, pendingOrder };
	if (childGoals !== undefined) proposal = { ...proposal, childGoals };
	return proposal;
}

export function printSteerResult(result: SteerUlwLoopResult, json: boolean): void {
	if (json) { printJson({ ok: result.accepted, accepted: result.accepted, rejectedReasons: result.rejectedReasons, deduped: result.deduped, audit: result.audit, plan: result.plan }); return; }
	const outcome = result.deduped ? "deduped" : result.accepted ? "accepted" : "rejected";
	process.stdout.write(`ulw-loop steer: ${outcome} ${result.audit.kind}\n`);
	if (result.rejectedReasons.length > 0) process.stdout.write(`rejected: ${result.rejectedReasons.join("; ")}\n`);
	if (result.audit.idempotencyKey !== undefined) process.stdout.write(`idempotency-key: ${result.audit.idempotencyKey}\n`);
	printStatus(result.plan);
}

export function printSteerBatchResult(result: SteerUlwLoopBatchResult, json: boolean): void {
	if (json) { printJson({ ok: result.accepted, accepted: result.accepted, rejectedReasons: result.rejectedReasons, results: result.results, plan: result.plan }); return; }
	process.stdout.write(`ulw-loop steer batch: ${result.accepted ? "accepted" : "rejected"} ${result.results.length} proposal(s)\n`);
	if (result.rejectedReasons.length > 0) process.stdout.write(`rejected: ${result.rejectedReasons.join("; ")}\n`);
	printStatus(result.plan);
}
