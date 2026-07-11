import { resolve } from "node:path";
import { isWithinAttemptDir } from "./paths.js";
import {
	emptyBlockers,
	invalid,
	literal,
	numberField,
	section,
	stringArray,
	textField,
} from "./quality-gate-fields.js";
import { adversarialVerdict, codeQualityStatusField, passedVerdict } from "./quality-gate-verdicts.js";
import type {
	UlwLoopManualQaArtifactKind,
	UlwLoopManualQaArtifactRef,
	UlwLoopManualQaSurface,
	UlwLoopQualityGate,
} from "./types.js";

const REVIEWER_ROLES = {
	codeReview: "lazycodex-code-reviewer",
	manualQa: "lazycodex-qa-executor",
	gateReview: "lazycodex-gate-reviewer",
} as const;

export {
	classifyExternalAuthorizationBlocker,
	clearGoalBlockerFields,
	normalizeBlockerEvidence,
	sameBlockerOccurrences,
} from "./quality-gate-blockers.js";

export interface QualityGateFs {
	readonly existsSync: (path: string) => boolean;
	readonly statSync: (path: string) => { readonly size: number };
}

export interface ValidateQualityGateOptions {
	readonly repoRoot: string;
	readonly fs: QualityGateFs;
	readonly currentAttemptDir?: string;
}

function reviewerRoleField<T extends string>(value: unknown, expected: T, field: string): T {
	const actual = textField(value, field);
	if (actual !== expected) invalid(`${field} must be ${expected}.`, field);
	return expected;
}

function surfaceField(value: unknown, field: string): UlwLoopManualQaSurface {
	if (
		value === "cli" ||
		value === "http" ||
		value === "tmux" ||
		value === "browser" ||
		value === "gui" ||
		value === "data"
	)
		return value;
	invalid(`${field} must be a supported manual QA surface.`, field);
}

function kindField(value: unknown, field: string): UlwLoopManualQaArtifactKind {
	if (
		value === "cli-transcript" ||
		value === "log" ||
		value === "screenshot" ||
		value === "image" ||
		value === "http-dump" ||
		value === "data-diff"
	)
		return value;
	invalid(`${field} must be a supported artifact kind.`, field);
}

function artifactCompatible(surface: UlwLoopManualQaSurface, kind: UlwLoopManualQaArtifactKind): boolean {
	switch (surface) {
		case "cli":
		case "tmux":
			return kind === "cli-transcript" || kind === "log";
		case "http":
			return kind === "http-dump";
		case "browser":
		case "gui":
			return kind === "screenshot" || kind === "image";
		case "data":
			return kind === "data-diff";
		default:
			invalid("manualQa.surfaceEvidence has an unsupported surface.", "manualQa.surfaceEvidence.surface");
	}
}

function checkFile(path: string, field: string, opts?: ValidateQualityGateOptions): void {
	if (opts === undefined) return;
	const absolute = resolve(opts.repoRoot, path);
	if (!opts.fs.existsSync(absolute)) invalid(`${field} must point to an existing artifact.`, field);
	if (opts.fs.statSync(absolute).size <= 0) invalid(`${field} must point to a non-empty artifact.`, field);
	if (opts.currentAttemptDir !== undefined) {
		const attemptRoot = resolve(opts.repoRoot, opts.currentAttemptDir);
		if (!isWithinAttemptDir(absolute, attemptRoot))
			invalid(
				`${field} (${path}) must point to an artifact from the current attempt (${opts.currentAttemptDir}).`,
				field,
			);
	}
}

function artifactMap(refs: readonly UlwLoopManualQaArtifactRef[]): Map<string, UlwLoopManualQaArtifactRef> {
	const byId = new Map<string, UlwLoopManualQaArtifactRef>();
	for (const ref of refs) {
		if (byId.has(ref.id)) invalid(`manualQa.artifactRefs contains duplicate ${ref.id}.`, "manualQa.artifactRefs");
		byId.set(ref.id, ref);
	}
	return byId;
}

function parseArtifactRefs(value: unknown, opts?: ValidateQualityGateOptions): readonly UlwLoopManualQaArtifactRef[] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.artifactRefs must not be empty.", "manualQa.artifactRefs");
	return value.map((item, index) => {
		const ref = section(item, `manualQa.artifactRefs[${index}]`);
		const path = textField(ref["path"], `manualQa.artifactRefs[${index}].path`);
		checkFile(path, `manualQa.artifactRefs[${index}].path`, opts);
		return {
			id: textField(ref["id"], `manualQa.artifactRefs[${index}].id`),
			kind: kindField(ref["kind"], `manualQa.artifactRefs[${index}].kind`),
			description: textField(ref["description"], `manualQa.artifactRefs[${index}].description`),
			path,
		};
	});
}

function referencedArtifacts(
	value: unknown,
	field: string,
	byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>,
): readonly UlwLoopManualQaArtifactRef[] {
	return stringArray(value, field).map((id) => {
		const artifact = byId.get(id);
		if (artifact === undefined) invalid(`${field} references unknown artifact ${id}.`, field);
		return artifact;
	});
}

export function validateQualityGate(input: unknown, opts?: ValidateQualityGateOptions): UlwLoopQualityGate {
	const gate = section(input, "qualityGate");
	const codeReview = section(gate["codeReview"], "codeReview");
	const manualQa = section(gate["manualQa"], "manualQa");
	const gateReview = section(gate["gateReview"], "gateReview");
	const iteration = section(gate["iteration"], "iteration");
	const coverage = section(gate["criteriaCoverage"], "criteriaCoverage");
	const totalCriteria = numberField(coverage["totalCriteria"], "criteriaCoverage.totalCriteria");
	const passCount = numberField(coverage["passCount"], "criteriaCoverage.passCount");
	if (passCount < totalCriteria)
		invalid("criteriaCoverage.passCount must cover totalCriteria.", "criteriaCoverage.passCount");
	const artifactRefs = parseArtifactRefs(manualQa["artifactRefs"], opts);
	const byId = artifactMap(artifactRefs);
	const surfaceEvidence = parseSurfaceEvidence(manualQa["surfaceEvidence"], byId);
	const adversarialCases = parseAdversarialCases(manualQa["adversarialCases"], byId);
	const codeReportPath = textField(codeReview["reportPath"], "codeReview.reportPath");
	const gateReportPath = textField(gateReview["reportPath"], "gateReview.reportPath");
	checkFile(codeReportPath, "codeReview.reportPath", opts);
	checkFile(gateReportPath, "gateReview.reportPath", opts);
	return {
		codeReview: {
			by: reviewerRoleField(codeReview["by"], REVIEWER_ROLES.codeReview, "codeReview.by"),
			recommendation: literal(codeReview["recommendation"], "APPROVE", "codeReview.recommendation"),
			codeQualityStatus: codeQualityStatusField(codeReview["codeQualityStatus"], "codeReview.codeQualityStatus"),
			reportPath: codeReportPath,
			evidence: textField(codeReview["evidence"], "codeReview.evidence"),
			blockers: emptyBlockers(codeReview["blockers"], "codeReview.blockers"),
		},
		manualQa: {
			by: reviewerRoleField(manualQa["by"], REVIEWER_ROLES.manualQa, "manualQa.by"),
			status: literal(manualQa["status"], "passed", "manualQa.status"),
			evidence: textField(manualQa["evidence"], "manualQa.evidence"),
			surfaceEvidence,
			adversarialCases,
			artifactRefs,
		},
		gateReview: {
			by: reviewerRoleField(gateReview["by"], REVIEWER_ROLES.gateReview, "gateReview.by"),
			recommendation: literal(gateReview["recommendation"], "APPROVE", "gateReview.recommendation"),
			reportPath: gateReportPath,
			evidence: textField(gateReview["evidence"], "gateReview.evidence"),
			blockers: emptyBlockers(gateReview["blockers"], "gateReview.blockers"),
		},
		iteration: {
			fullRerun: literal(iteration["fullRerun"], true, "iteration.fullRerun"),
			status: literal(iteration["status"], "passed", "iteration.status"),
			rerunCommands: stringArray(iteration["rerunCommands"], "iteration.rerunCommands"),
			evidence: textField(iteration["evidence"], "iteration.evidence"),
		},
		criteriaCoverage: {
			totalCriteria,
			passCount,
			originalIntent: textField(coverage["originalIntent"], "criteriaCoverage.originalIntent"),
			desiredOutcome: textField(coverage["desiredOutcome"], "criteriaCoverage.desiredOutcome"),
			userOutcomeReview: textField(coverage["userOutcomeReview"], "criteriaCoverage.userOutcomeReview"),
			adversarialClassesCovered: stringArray(
				coverage["adversarialClassesCovered"],
				"criteriaCoverage.adversarialClassesCovered",
			),
		},
	};
}

function parseSurfaceEvidence(
	value: unknown,
	byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>,
): UlwLoopQualityGate["manualQa"]["surfaceEvidence"] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.surfaceEvidence must not be empty.", "manualQa.surfaceEvidence");
	return value.map((item, index) => {
		const row = section(item, `manualQa.surfaceEvidence[${index}]`);
		const surface = surfaceField(row["surface"], `manualQa.surfaceEvidence[${index}].surface`);
		const artifacts = referencedArtifacts(
			row["artifactRefs"],
			`manualQa.surfaceEvidence[${index}].artifactRefs`,
			byId,
		);
		for (const artifact of artifacts) {
			if (!artifactCompatible(surface, artifact.kind)) {
				invalid(
					`manualQa.surfaceEvidence ${surface} artifact ${artifact.kind} is incompatible.`,
					"manualQa.surfaceEvidence",
				);
			}
		}
		return {
			id: textField(row["id"], `manualQa.surfaceEvidence[${index}].id`),
			criterionRef: textField(row["criterionRef"], `manualQa.surfaceEvidence[${index}].criterionRef`),
			surface,
			invocation: textField(row["invocation"], `manualQa.surfaceEvidence[${index}].invocation`),
			verdict: passedVerdict(row["verdict"], `manualQa.surfaceEvidence[${index}].verdict`),
			artifactRefs: artifacts.map((artifact) => artifact.id),
		};
	});
}

function parseAdversarialCases(
	value: unknown,
	byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>,
): UlwLoopQualityGate["manualQa"]["adversarialCases"] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.adversarialCases must not be empty.", "manualQa.adversarialCases");
	return value.map((item, index) => {
		const row = section(item, `manualQa.adversarialCases[${index}]`);
		const artifacts = referencedArtifacts(
			row["artifactRefs"],
			`manualQa.adversarialCases[${index}].artifactRefs`,
			byId,
		);
		const verdictInfo = adversarialVerdict(row, `manualQa.adversarialCases[${index}]`);
		return {
			id: textField(row["id"], `manualQa.adversarialCases[${index}].id`),
			criterionRef: textField(row["criterionRef"], `manualQa.adversarialCases[${index}].criterionRef`),
			scenario: textField(row["scenario"], `manualQa.adversarialCases[${index}].scenario`),
			expectedBehavior: textField(row["expectedBehavior"], `manualQa.adversarialCases[${index}].expectedBehavior`),
			verdict: verdictInfo.verdict,
			...(verdictInfo.reason === undefined ? {} : { reason: verdictInfo.reason }),
			artifactRefs: artifacts.map((artifact) => artifact.id),
		};
	});
}
