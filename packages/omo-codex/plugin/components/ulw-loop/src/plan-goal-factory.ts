import { criteriaFromInput, criterionId, type SuccessCriterionInput } from "./success-criteria-input.js";
import type { UlwLoopToolkitSurface } from "./surface.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "./types.js";
import { UlwLoopError } from "./types.js";

export interface GoalSeedOptions {
	readonly goalId?: string;
	readonly surface?: UlwLoopToolkitSurface;
	readonly successCriteria?: readonly SuccessCriterionInput[];
}

function cleanLine(line: string): string {
	return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
}

function normalizeObjective(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function titleFromObjective(objective: string, fallback: string): string {
	const firstLine =
		objective
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) ?? fallback;
	return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine;
}

function normalizeGoalId(title: string, index: number): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 36)
		.replace(/-+$/g, "");
	return `G${String(index + 1).padStart(3, "0")}${slug ? `-${slug}` : ""}`;
}

function assertNonEmpty(value: string | undefined, label: string): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new UlwLoopError(`Missing ${label}.`, "ULW_LOOP_ARGUMENT_MISSING");
	return trimmed;
}

function truncateObjective(objective: string): string {
	return objective.length > 80 ? `${objective.slice(0, 77).trimEnd()}...` : objective;
}

// The placeholder must name the exact call that replaces it on the surface the plan is driven from,
// so a goal seeded without criteria costs one documented call per criterion instead of a doc hunt.
function replaceVia(goalId: string, id: string, surface: UlwLoopToolkitSurface): string {
	return surface === "omo-senpi"
		? `Replace via agentToolkit.steer({ kind: "revise_criterion", source: "finding", goalId: "${goalId}", criterionId: "${id}", scenario, expectedEvidence, evidence, rationale }) (or pass successCriteria to addGoal)`
		: `Replace via omo-agent-toolkit ulw-loop steer --kind revise_criterion --goal-id ${goalId} --criterion-id ${id} --scenario "<scenario>" --expected-evidence "<proof>" --evidence "<why>" --rationale "<why>"`;
}

export function seedDefaultSuccessCriteria(
	goalIndex: number,
	objective: string,
	options: Pick<GoalSeedOptions, "goalId" | "surface"> = {},
): UlwLoopSuccessCriterion[] {
	const subject = truncateObjective(normalizeObjective(objective) || `Goal ${goalIndex + 1}`);
	const goalId = options.goalId ?? `G${String(goalIndex + 1).padStart(3, "0")}`;
	const surface = options.surface ?? "lazycodex";
	const rows = [
		["happy", `happy path for: ${subject}`, `observable happy-path proof for goal ${goalIndex + 1}`, true],
		["edge", "edge case (boundary/empty/malformed)", `boundary or malformed-input proof for: ${subject}`, true],
		[
			"regression",
			"regression: adjacent surface still works",
			`regression proof for neighboring behavior after: ${subject}`,
			false,
		],
	] as const;
	return rows.map(([userModel, scenario, proof, essential], index) => {
		const id = criterionId(index);
		return {
			id,
			scenario,
			userModel,
			expectedEvidence: `${replaceVia(goalId, id, surface)} with ${proof}.`,
			essential,
			capturedEvidence: null,
			status: "pending",
		};
	});
}

export function deriveGoalCandidates(brief: string): Array<{ title: string; objective: string }> {
	const bulletGoals = brief
		.split(/\r?\n/)
		.map((line) => ({ original: line, cleaned: normalizeObjective(cleanLine(line)) }))
		.filter(({ cleaned }) => cleaned.length > 0 && cleaned.length <= 1200)
		.filter(
			({ original, cleaned }, index, all) =>
				/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(original) &&
				all.findIndex((candidate) => candidate.cleaned === cleaned) === index,
		)
		.map(({ cleaned }) => cleaned);
	const paragraphs = brief
		.split(/\n\s*\n/)
		.map(normalizeObjective)
		.filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
	const selected =
		(bulletGoals.length > 0 ? bulletGoals : paragraphs).length > 0
			? bulletGoals.length > 0
				? bulletGoals
				: paragraphs
			: ["Complete the requested project objective."];
	return selected.map((objective, index) => ({
		title: titleFromObjective(objective, `Goal ${index + 1}`),
		objective,
	}));
}

export function makeGoal(
	title: string,
	objective: string,
	index: number,
	now: string,
	options: GoalSeedOptions = {},
): UlwLoopItem {
	const cleanTitle = assertNonEmpty(title, "title");
	const cleanObjective = assertNonEmpty(objective, "objective");
	const id = normalizeGoalId(cleanTitle, index);
	const successCriteria =
		options.successCriteria === undefined
			? seedDefaultSuccessCriteria(index, cleanObjective, {
					goalId: id,
					...(options.surface === undefined ? {} : { surface: options.surface }),
				})
			: criteriaFromInput(options.successCriteria);
	return {
		id,
		title: cleanTitle,
		objective: cleanObjective,
		status: "pending",
		successCriteria,
		attempt: 0,
		createdAt: now,
		updatedAt: now,
	};
}

export function appendGoalToPlan(
	plan: UlwLoopPlan,
	title: string,
	objective: string,
	now: string,
	options: GoalSeedOptions = {},
): UlwLoopItem {
	const goal = makeGoal(title, objective, plan.goals.length, now, options);
	plan.goals.push(goal);
	plan.updatedAt = now;
	return goal;
}
