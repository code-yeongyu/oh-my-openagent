import { aggregateQualityGateDefects } from "./quality-gate-aggregate.js";
import {
	artifactCompatible,
	artifactMap,
	checkFile,
	parseArtifactRefs,
	referencedArtifacts,
	surfaceField,
} from "./quality-gate-artifacts.js";
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
import { GATE_SECTION_BY_ACCEPTOR, REQUIRED_GATE_SECTIONS_BY_SURFACE, type UlwLoopToolkitSurface } from "./surface.js";
import type { UlwLoopManualQaArtifactRef, UlwLoopQualityGate } from "./types.js";

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
	readonly repoRoot?: string;
	readonly fs?: QualityGateFs;
	readonly currentAttemptDir?: string;
	readonly reviewerSurface?: UlwLoopToolkitSurface;
}

function reviewerRoleField(value: unknown, expected: string, field: string): string {
	const actual = textField(value, field);
	if (actual !== expected) invalid(`${field} must be ${expected}.`, field);
	return expected;
}

function reviewerAcceptorField(
	value: unknown,
	surface: UlwLoopToolkitSurface,
	sectionName: "manualQa" | "gateReview",
): string {
	const field = `${sectionName}.by`;
	const actual = textField(value, field);
	const accepted = GATE_SECTION_BY_ACCEPTOR[surface][sectionName];
	if (accepted === undefined || !accepted.includes(actual))
		invalid(`${field} must be one of ${accepted?.join(", ") ?? "the configured reviewers"}.`, field);
	return actual;
}

export function validateQualityGate(input: unknown, opts?: ValidateQualityGateOptions): UlwLoopQualityGate {
	const surface = opts?.reviewerSurface ?? "lazycodex";
	aggregateQualityGateDefects(input, opts);
	const gate = section(input, "qualityGate");
	const requiredSections = REQUIRED_GATE_SECTIONS_BY_SURFACE[surface];
	for (const sectionName of requiredSections) section(gate[sectionName], sectionName);
	if (surface === "omo-senpi" && gate["codeReview"] !== undefined)
		invalid("omo-senpi gate has no codeReview lane.", "codeReview");
	const manualQa = section(gate["manualQa"], "manualQa");
	const gateReview = section(gate["gateReview"], "gateReview");
	const iteration = section(gate["iteration"], "iteration");
	const coverage = section(gate["criteriaCoverage"], "criteriaCoverage");
	const manualQaBy = reviewerAcceptorField(manualQa["by"], surface, "manualQa");
	const gateReviewBy = reviewerAcceptorField(gateReview["by"], surface, "gateReview");
	if (surface === "lazycodex")
		reviewerRoleField(section(gate["codeReview"], "codeReview")["by"], "lazycodex-code-reviewer", "codeReview.by");
	const totalCriteria = numberField(coverage["totalCriteria"], "criteriaCoverage.totalCriteria");
	const passCount = numberField(coverage["passCount"], "criteriaCoverage.passCount");
	if (passCount < totalCriteria)
		invalid("criteriaCoverage.passCount must cover totalCriteria.", "criteriaCoverage.passCount");
	const artifactRefs = parseArtifactRefs(manualQa["artifactRefs"], opts);
	const byId = artifactMap(artifactRefs);
	const surfaceEvidence = parseSurfaceEvidence(manualQa["surfaceEvidence"], byId);
	const adversarialCases = parseAdversarialCases(manualQa["adversarialCases"], byId);
	const gateReportPath = textField(gateReview["reportPath"], "gateReview.reportPath");
	checkFile(gateReportPath, "gateReview.reportPath", opts);
	const common = {
		manualQa: {
			by: manualQaBy,
			status: literal(manualQa["status"], "passed", "manualQa.status"),
			evidence: textField(manualQa["evidence"], "manualQa.evidence"),
			surfaceEvidence,
			adversarialCases,
			artifactRefs,
		},
		gateReview: {
			by: gateReviewBy,
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
	if (surface === "omo-senpi") return { surface, ...common };
	const codeReview = section(gate["codeReview"], "codeReview");
	const codeReportPath = textField(codeReview["reportPath"], "codeReview.reportPath");
	checkFile(codeReportPath, "codeReview.reportPath", opts);
	return {
		surface,
		...common,
		codeReview: {
			by: "lazycodex-code-reviewer",
			recommendation: literal(codeReview["recommendation"], "APPROVE", "codeReview.recommendation"),
			codeQualityStatus: codeQualityStatusField(codeReview["codeQualityStatus"], "codeReview.codeQualityStatus"),
			reportPath: codeReportPath,
			evidence: textField(codeReview["evidence"], "codeReview.evidence"),
			blockers: emptyBlockers(codeReview["blockers"], "codeReview.blockers"),
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
