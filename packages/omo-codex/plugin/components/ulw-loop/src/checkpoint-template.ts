import { type UlwLoopScope, ulwLoopAttemptEvidenceDir } from "./paths.js";
import { readUlwLoopPlan } from "./plan-io.js";
import { resolveToolkitSurface, type UlwLoopToolkitSurface } from "./surface.js";
import type { UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

export interface CheckpointTemplate {
	readonly qualityGateTemplate: Record<string, unknown>;
	readonly codexGoalTemplate: Record<string, unknown>;
	readonly attemptDir?: string;
	readonly guidance?: string;
}

export interface CheckpointTemplateDependencies {
	readonly surface?: UlwLoopToolkitSurface;
}

function artifactPath(base: string, name: string): string {
	return `${base}/${name}`;
}

function gateTemplate(surface: UlwLoopToolkitSurface, base: string): Record<string, unknown> {
	const artifacts = [
		{
			id: "artifact-cli",
			kind: "cli-transcript",
			description: "<replace:artifact description>",
			path: artifactPath(base, "cli-transcript.txt"),
		},
		{
			id: "artifact-data",
			kind: "data-diff",
			description: "<replace:artifact description>",
			path: artifactPath(base, "data-diff.txt"),
		},
	];
	const manualQa = {
		by: "main-session",
		status: "passed",
		evidence: "<replace:manual QA evidence>",
		surfaceEvidence: [
			{
				id: "surface-cli",
				criterionRef: "<replace:criterion id>",
				surface: "cli",
				invocation: "<replace:command>",
				verdict: "passed",
				artifactRefs: ["artifact-cli"],
			},
			{
				id: "surface-data",
				criterionRef: "<replace:criterion id>",
				surface: "data",
				invocation: "<replace:command>",
				verdict: "passed",
				artifactRefs: ["artifact-data"],
			},
		],
		adversarialCases: [
			{
				id: "<replace:adversarial case id>",
				criterionRef: "<replace:criterion id>",
				scenario: "<replace:scenario>",
				expectedBehavior: "<replace:expected behavior>",
				verdict: "not_applicable",
				reason: "<replace:reason>",
				artifactRefs: ["artifact-cli"],
			},
		],
		artifactRefs: artifacts,
	};
	const common = {
		manualQa,
		gateReview: {
			by: surface === "omo-senpi" ? "category:deep" : "main-session",
			recommendation: "APPROVE",
			reportPath: artifactPath(base, "gate-review.md"),
			evidence: "<replace:gate review evidence>",
			blockers: [],
			notes: [],
		},
		iteration: {
			fullRerun: true,
			status: "passed",
			rerunCommands: ["<replace:verification command>"],
			evidence: "<replace:iteration evidence>",
		},
		criteriaCoverage: {
			totalCriteria: 0,
			passCount: 0,
			originalIntent: "<replace:original intent>",
			desiredOutcome: "<replace:desired outcome>",
			userOutcomeReview: "<replace:user outcome review>",
			adversarialClassesCovered: ["<replace:adversarial class>"],
		},
	};
	return common;
}

export async function checkpointTemplate(
	repoRoot: string,
	scope?: UlwLoopScope,
	goalId?: string,
	dependencies?: CheckpointTemplateDependencies,
): Promise<CheckpointTemplate> {
	const plan: UlwLoopPlan = await readUlwLoopPlan(repoRoot, scope);
	const surface = dependencies?.surface ?? resolveToolkitSurface();
	const targetId = goalId ?? plan.activeGoalId;
	const active = plan.goals.find((goal) => goal.id === targetId);
	if (goalId !== undefined && active === undefined)
		throw new UlwLoopError(`Unknown ulw-loop id: ${goalId}.`, "ULW_LOOP_GOAL_NOT_FOUND", { details: { goalId } });
	const hasAttempt = plan.evidenceLayoutVersion === 2 && active !== undefined;
	const attemptDir = hasAttempt ? ulwLoopAttemptEvidenceDir(active.id, active.attempt, scope) : ".omo/evidence";
	const guidance = [
		"codex-goal-json requires goal.objective to equal the plan's codexObjective verbatim; do not paraphrase it.",
		"Fill every <replace:...> value with plausible non-empty evidence and use real, non-empty artifact files.",
		'Passing codex-goal-json example: {"goal":{"objective":"<plan codexObjective verbatim>","status":"complete"}}.',
		'Passing quality-gate-json example requires gateReview {"by":"category:deep","recommendation":"APPROVE","evidence":"review passed","reportPath":"<attemptDir>/gate-review.md","blockers":[],"notes":[]}, manualQa.artifactRefs objects, iteration, and criteriaCoverage.',
		...(surface === "lazycodex"
			? [
					"Self-review defaults: manualQa.by and gateReview.by are main-session. Alternatives: manualQa.by accepts lazycodex-qa-executor; gateReview.by accepts lazycodex-gate-reviewer, category:deep, category:unspecified-high, or category:unspecified-low. Optional codeReview.by accepts lazycodex-code-reviewer or main-session.",
				]
			: []),
		...(hasAttempt ? [] : ["This plan is evidence-layout v1; artifacts go under .omo/evidence/."]),
	].join(" ");
	return {
		qualityGateTemplate: gateTemplate(surface, attemptDir),
		codexGoalTemplate: {
			goal: { objective: plan.codexObjective ?? "<replace:codex objective>", status: "complete" },
		},
		guidance,
		...(hasAttempt ? { attemptDir } : {}),
	};
}
