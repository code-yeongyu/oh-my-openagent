export type GateMarkerScope = {
	readonly workId: string;
	readonly planName: string;
	readonly planPath: string;
	readonly prefixedSessionId: string;
	readonly startedAt: string | null;
};

const REQUIRED_REVIEW_LANES = ["goal", "quality", "security", "qa", "context"] as const;
const NEGATIVE_GATE_EVIDENCE_PATTERN =
	/\b(?:fail(?:ed|ure)?|inconclusive|omitted|missing|not done|zero hypotheses|blocked|timed out|timeout|redaction omitted)\b/i;
const RAW_SENSITIVE_EVIDENCE_PATTERN =
	/(?:github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|Authorization:\s*Bearer\s+\S+|Cookie:\s*[^=\s]+=|api[_ -]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}|password\s*[:=]\s*["']?\S{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

export function hasGlobalReviewDebugGatePass(
	ledgerText: string | null,
	scope: GateMarkerScope,
	parseJsonObject: (json: string) => Record<string, unknown> | null,
): boolean {
	if (ledgerText === null) return false;
	let hasFreshPass = false;
	for (const line of ledgerText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const entry = parseJsonObject(trimmed);
		if (entry === null) continue;
		if (isMatchingGlobalReviewDebugGatePass(entry, scope)) {
			hasFreshPass = true;
			continue;
		}
		if (hasFreshPass && isRelevantLedgerEntry(entry, scope)) hasFreshPass = false;
	}
	return hasFreshPass;
}

function isMatchingGlobalReviewDebugGatePass(entry: Record<string, unknown>, scope: GateMarkerScope): boolean {
	return (
		entry["event"] === "global-review-debug-gate-passed" &&
		entry["verdict"] === "PASS" &&
		entry["work_id"] === scope.workId &&
		entry["plan"] === scope.planName &&
		entry["plan_path"] === scope.planPath &&
		entry["session_id"] === scope.prefixedSessionId &&
		scope.startedAt !== null &&
		entry["started_at"] === scope.startedAt &&
		hasNoRawSensitiveEvidence(entry) &&
		hasRequiredGateEvidence(entry)
	);
}

function hasRequiredGateEvidence(entry: Record<string, unknown>): boolean {
	return (
		hasVerificationEvidence(entry["verification"]) &&
		hasReviewEvidence(entry["review"]) &&
		hasDebuggingEvidence(entry["debugging"]) &&
		hasArtifactEvidence(entry["artifact"]) &&
		hasCleanupEvidence(entry["cleanup"])
	);
}

function hasVerificationEvidence(value: unknown): boolean {
	return (
		isRecord(value) &&
		value["verdict"] === "PASS" &&
		isNonEmptyStringArray(value["commands"]) &&
		hasSafeEvidence(value)
	);
}

function hasReviewEvidence(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return value["verdict"] === "PASS" && hasRequiredReviewLanes(value["lanes"]) && hasSafeEvidence(value);
}

function hasRequiredReviewLanes(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	const lanes = new Set(
		value.filter((lane): lane is string => typeof lane === "string").map((lane) => lane.toLowerCase()),
	);
	return REQUIRED_REVIEW_LANES.every((lane) => lanes.has(lane));
}

function hasDebuggingEvidence(value: unknown): boolean {
	if (!isRecord(value) || value["verdict"] !== "PASS") return false;
	const hypotheses = value["hypotheses"];
	return isNonEmptyStringArray(hypotheses) && hypotheses.length >= 3 && hasSafeEvidence(value);
}

function hasArtifactEvidence(value: unknown): boolean {
	return (
		isRecord(value) && value["redacted"] === true && hasNonEmptyString(value["summary"]) && hasSafeEvidence(value)
	);
}

function hasCleanupEvidence(value: unknown): boolean {
	return (
		isRecord(value) && value["status"] === "complete" && hasNonEmptyString(value["summary"]) && hasSafeEvidence(value)
	);
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function hasNonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim() !== "";
}

function hasSafeEvidence(value: unknown): boolean {
	const serialized = JSON.stringify(value);
	return (
		typeof serialized === "string" &&
		!NEGATIVE_GATE_EVIDENCE_PATTERN.test(serialized) &&
		!RAW_SENSITIVE_EVIDENCE_PATTERN.test(serialized)
	);
}

function hasNoRawSensitiveEvidence(value: unknown): boolean {
	const serialized = JSON.stringify(value);
	return typeof serialized === "string" && !RAW_SENSITIVE_EVIDENCE_PATTERN.test(serialized);
}

function isRelevantLedgerEntry(entry: Record<string, unknown>, scope: GateMarkerScope): boolean {
	const event = entry["event"];
	if (typeof event !== "string" || event.trim() === "") return false;
	return (
		isCompatibleScope(entry["work_id"], scope.workId) &&
		isCompatibleScope(entry["plan"], scope.planName) &&
		isCompatibleScope(entry["plan_path"], scope.planPath) &&
		isCompatibleScope(entry["session_id"], scope.prefixedSessionId)
	);
}

function isCompatibleScope(value: unknown, expected: string): boolean {
	return typeof value !== "string" || value === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
