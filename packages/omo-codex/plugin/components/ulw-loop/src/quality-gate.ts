import { resolve } from "node:path";

import type { UlwLoopItem, UlwLoopManualQaArtifactKind, UlwLoopManualQaArtifactRef, UlwLoopManualQaSurface, UlwLoopPlan, UlwLoopQualityGate } from "./types.js";
import { UlwLoopError } from "./types.js";

const BLOCKER_FIELD_KEYS = "blocker blockerSignature blockerEvidence blockerOccurrences blockedAt".split(" ");
const URL_PATTERN = /https?:\/\/\S+/g;
const PUNCTUATION_PATTERN = /[`"'()[\]{}:,;]/g;
const WHITESPACE_PATTERN = /\s+/g;
const AUTH_PATTERN = /\b(auth\w*|credential\w*|token|permission\w*|scope\w*|access|unauthorized|forbidden|401|403)\b/;
const MISSING_PATTERN =
	/\b(unset|missing|required|requires|without|omit\w*|not set|not available|no read packages|read packages)\b/;
const GHCR_PATTERN =
	/\b(ghcr|github container registry|read packages|imagepullsecret|package api|anonymous|container image)\b/;
const GHCR_401_PATTERN = /\b(401|unauthorized|anonymous pull|authentication required)\b/;
const GHCR_403_PATTERN = /\b(403|forbidden|read packages|package api)\b/;
const PLACEHOLDER_PATTERN = /^(?:placeholder|todo|tbd|n\/a|stub)$/i;

export interface QualityGateFs { readonly existsSync: (path: string) => boolean; readonly statSync: (path: string) => { readonly size: number } }
export interface ValidateQualityGateOptions { readonly repoRoot: string; readonly fs: QualityGateFs }

function invalid(message: string, field: string): never {
	throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", { details: { field } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(value: unknown, field: string): Record<string, unknown> {
	return isRecord(value) ? value : invalid(`Final quality gate is missing ${field} evidence.`, field);
}

function textField(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") invalid(`Final quality gate requires non-empty ${field}.`, field);
	const trimmed = value.trim();
	if (PLACEHOLDER_PATTERN.test(trimmed)) invalid(`Final quality gate rejects placeholder ${field}.`, field);
	return trimmed;
}

function numberField(value: unknown, field: string): number {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: invalid(`Final quality gate requires numeric ${field}.`, field);
}

function stringArray(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) return invalid(`Final quality gate requires ${field}.`, field);
	return value.map((item) => textField(item, field));
}

function emptyBlockers(value: unknown, field: string): readonly [] {
	if (Array.isArray(value) && value.length === 0) return [];
	invalid(`${field} must be empty.`, field);
}

function literal<T extends string | boolean>(value: unknown, expected: T, field: string): T {
	if (value === expected) return expected;
	invalid(`${field} must be ${String(expected)}.`, field);
}

function surfaceField(value: unknown, field: string): UlwLoopManualQaSurface {
	if (value === "cli" || value === "http" || value === "tmux" || value === "browser" || value === "gui" || value === "data") return value;
	invalid(`${field} must be a supported manual QA surface.`, field);
}

function kindField(value: unknown, field: string): UlwLoopManualQaArtifactKind {
	if (value === "cli-transcript" || value === "log" || value === "screenshot" || value === "image" || value === "http-dump" || value === "data-diff") return value;
	invalid(`${field} must be a supported artifact kind.`, field);
}

function passedVerdict(value: unknown, field: string): "passed" {
	if (value === "not_applicable") invalid(`${field} must not be not_applicable.`, field);
	return literal(value, "passed", field);
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
	const stat = opts.fs.statSync(absolute);
	if (stat.size <= 0) invalid(`${field} must point to a non-empty artifact.`, field);
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
	if (!Array.isArray(value) || value.length === 0) invalid("manualQa.artifactRefs must not be empty.", "manualQa.artifactRefs");
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

function referencedArtifacts(value: unknown, field: string, byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>): readonly UlwLoopManualQaArtifactRef[] {
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
			by: textField(codeReview["by"], "codeReview.by"),
			recommendation: literal(codeReview["recommendation"], "APPROVE", "codeReview.recommendation"),
			codeQualityStatus: literal(codeReview["codeQualityStatus"], "CLEAR", "codeReview.codeQualityStatus"),
			reportPath: codeReportPath,
			evidence: textField(codeReview["evidence"], "codeReview.evidence"),
			blockers: emptyBlockers(codeReview["blockers"], "codeReview.blockers"),
		},
		manualQa: {
			by: textField(manualQa["by"], "manualQa.by"),
			status: literal(manualQa["status"], "passed", "manualQa.status"),
			evidence: textField(manualQa["evidence"], "manualQa.evidence"),
			surfaceEvidence,
			adversarialCases,
			artifactRefs,
		},
		gateReview: {
			by: textField(gateReview["by"], "gateReview.by"),
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
			adversarialClassesCovered: stringArray(
				coverage["adversarialClassesCovered"],
				"criteriaCoverage.adversarialClassesCovered",
			),
		},
	};
}

function parseSurfaceEvidence(value: unknown, byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>): UlwLoopQualityGate["manualQa"]["surfaceEvidence"] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.surfaceEvidence must not be empty.", "manualQa.surfaceEvidence");
	return value.map((item, index) => {
		const row = section(item, `manualQa.surfaceEvidence[${index}]`);
		const surface = surfaceField(row["surface"], `manualQa.surfaceEvidence[${index}].surface`);
		const artifacts = referencedArtifacts(row["artifactRefs"], `manualQa.surfaceEvidence[${index}].artifactRefs`, byId);
		for (const artifact of artifacts) {
			if (!artifactCompatible(surface, artifact.kind)) {
				invalid(`manualQa.surfaceEvidence ${surface} artifact ${artifact.kind} is incompatible.`, "manualQa.surfaceEvidence");
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

function parseAdversarialCases(value: unknown, byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>): UlwLoopQualityGate["manualQa"]["adversarialCases"] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.adversarialCases must not be empty.", "manualQa.adversarialCases");
	return value.map((item, index) => {
		const row = section(item, `manualQa.adversarialCases[${index}]`);
		const artifacts = referencedArtifacts(row["artifactRefs"], `manualQa.adversarialCases[${index}].artifactRefs`, byId);
		return {
			id: textField(row["id"], `manualQa.adversarialCases[${index}].id`),
			criterionRef: textField(row["criterionRef"], `manualQa.adversarialCases[${index}].criterionRef`),
			scenario: textField(row["scenario"], `manualQa.adversarialCases[${index}].scenario`),
			expectedBehavior: textField(row["expectedBehavior"], `manualQa.adversarialCases[${index}].expectedBehavior`),
			verdict: passedVerdict(row["verdict"], `manualQa.adversarialCases[${index}].verdict`),
			artifactRefs: artifacts.map((artifact) => artifact.id),
		};
	});
}

export function normalizeBlockerEvidence(evidence: string): string {
	const withoutUrls = evidence.toLowerCase().replace(URL_PATTERN, " ");
	const withoutPunctuation = withoutUrls.replace(PUNCTUATION_PATTERN, " ");
	return withoutPunctuation.replace(WHITESPACE_PATTERN, " ").trim();
}

export function classifyExternalAuthorizationBlocker(evidence: string): string | null {
	const normalized = normalizeBlockerEvidence(evidence);
	if (!normalized || !AUTH_PATTERN.test(normalized) || !MISSING_PATTERN.test(normalized)) return null;
	if (!GHCR_PATTERN.test(normalized)) return "EXTERNAL_AUTHORIZATION_REQUIRED";
	const status401 = GHCR_401_PATTERN.test(normalized) ? "HTTP_401_ANONYMOUS" : null;
	const status403 = GHCR_403_PATTERN.test(normalized) ? "HTTP_403_NO_READ_PACKAGES" : null;
	const status = [status401, status403].filter((part): part is string => part !== null).join("+");
	return `GHCR_PULL_ACCESS:${status || "AUTHORIZATION_REQUIRED"}:GHCR_VISIBILITY_OR_CREDENTIAL_REQUIRED`;
}

function nestedBlockerSignature(goal: UlwLoopItem): string | null {
	const blocker = Reflect.get(goal, "blocker");
	const signature = isRecord(blocker) ? blocker["signature"] : null;
	return typeof signature === "string" ? signature : null;
}

export function sameBlockerOccurrences(plan: UlwLoopPlan, signature: string): number {
	return plan.goals.filter((goal) => goal.blockerSignature === signature || nestedBlockerSignature(goal) === signature)
		.length;
}

export function clearGoalBlockerFields(goal: UlwLoopItem): void {
	for (const key of BLOCKER_FIELD_KEYS) Reflect.deleteProperty(goal, key);
}
