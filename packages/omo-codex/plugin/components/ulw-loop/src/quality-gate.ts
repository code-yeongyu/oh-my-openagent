import type { UlwLoopItem, UlwLoopPlan, UlwLoopQualityGate } from "./types.js";
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

function invalid(message: string, field: string): never {
	throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", { details: { field } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(value: unknown, field: string): Record<string, unknown> {
	return isRecord(value) ? value : invalid(`Final quality gate is missing ${field} evidence.`, field);
}

function nonEmptyString(value: unknown, field: string): string {
	return typeof value === "string" && value.trim() !== ""
		? value
		: invalid(`Final quality gate requires non-empty ${field}.`, field);
}

function numberField(value: unknown, field: string): number {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: invalid(`Final quality gate requires numeric ${field}.`, field);
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length === 0) return invalid(`Final quality gate requires ${field}.`, field);
	return value.map((item) => nonEmptyString(item, field));
}

export function validateQualityGate(input: unknown): UlwLoopQualityGate {
	const gate = section(input, "qualityGate");
	const cleaner = section(gate["aiSlopCleaner"], "aiSlopCleaner");
	const verification = section(gate["verification"], "verification");
	const review = section(gate["codeReview"], "codeReview");
	const coverage = section(gate["criteriaCoverage"], "criteriaCoverage");
	if (cleaner["status"] !== "passed") invalid("aiSlopCleaner.status must be passed.", "aiSlopCleaner.status");
	if (verification["status"] !== "passed") invalid("verification.status must be passed.", "verification.status");
	if (review["recommendation"] !== "APPROVE") invalid("recommendation must be APPROVE.", "codeReview.recommendation");
	if (review["architectStatus"] !== "CLEAR") invalid("architectStatus must be CLEAR.", "codeReview.architectStatus");
	const totalCriteria = numberField(coverage["totalCriteria"], "criteriaCoverage.totalCriteria");
	const passCount = numberField(coverage["passCount"], "criteriaCoverage.passCount");
	if (passCount < totalCriteria)
		invalid("criteriaCoverage.passCount must cover totalCriteria.", "criteriaCoverage.passCount");
	const commands = stringArray(verification["commands"], "verification.commands");
	const covered = stringArray(coverage["adversarialClassesCovered"], "criteriaCoverage.adversarialClassesCovered");
	const cleanerEvidence = nonEmptyString(cleaner["evidence"], "aiSlopCleaner.evidence");
	const verificationEvidence = nonEmptyString(verification["evidence"], "verification.evidence");
	const reviewEvidence = nonEmptyString(review["evidence"], "codeReview.evidence");
	const result: UlwLoopQualityGate = {
		aiSlopCleaner: { status: "passed", evidence: cleanerEvidence },
		verification: { status: "passed", commands, evidence: verificationEvidence },
		codeReview: { recommendation: "APPROVE", architectStatus: "CLEAR", evidence: reviewEvidence },
	};
	Object.assign(result, { criteriaCoverage: { totalCriteria, passCount, adversarialClassesCovered: covered } });
	return result;
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
