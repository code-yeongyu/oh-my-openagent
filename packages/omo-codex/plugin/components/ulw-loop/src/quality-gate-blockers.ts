import type { UlwLoopItem, UlwLoopPlan } from "./types.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
