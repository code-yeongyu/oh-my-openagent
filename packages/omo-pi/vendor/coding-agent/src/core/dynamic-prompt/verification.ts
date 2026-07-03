export type TestDisciplineRule = {
	id:
		| "deterministic-tests"
		| "fixed-wait-ban"
		| "event-timeout-pattern"
		| "mock-contract-integrity"
		| "prompt-behavior-coverage"
		| "single-pass-runner";
	concern: "test-determinism" | "async-test-orchestration" | "mock-contracts" | "prompt-tests" | "test-runner";
	directive: string;
};

export const TEST_DISCIPLINE_RULES = [
	{
		id: "deterministic-tests",
		concern: "test-determinism",
		directive: "When you read or edit test code, treat nondeterminism as a bug; tests must not pass by timing luck.",
	},
	{
		id: "fixed-wait-ban",
		concern: "async-test-orchestration",
		directive:
			"Unless time itself is the behavior under test, fixed sleeps, polling delays, and wait-for-time patterns are forbidden.",
	},
	{
		id: "event-timeout-pattern",
		concern: "async-test-orchestration",
		directive:
			"For async behavior, subscribe to the exact event or state change before triggering the action, then await that signal with a bounded timeout.",
	},
	{
		id: "mock-contract-integrity",
		concern: "mock-contracts",
		directive:
			"Mocks must preserve the contract being asserted; do not isolate so heavily that the integration under test cannot fail.",
	},
	{
		id: "prompt-behavior-coverage",
		concern: "prompt-tests",
		directive:
			"Prompt tests must assert behavior, decisions, structure, or parsed rule data rather than merely pinning an exact prompt sentence.",
	},
	{
		id: "single-pass-runner",
		concern: "test-runner",
		directive:
			"Run the relevant test command once and make that pass reliable; for Bun test targets, bun test must pass in a single run.",
	},
] as const satisfies readonly TestDisciplineRule[];

export function buildTestDisciplineSection(): string {
	const lines = ["### Test Discipline"];
	for (const rule of TEST_DISCIPLINE_RULES) {
		lines.push(`- ${rule.directive}`);
	}
	return lines.join("\n");
}

export function buildVerificationSection(): string {
	return `## Verification

Tier the scope, never the rigor.

- V1 — single-file non-behavioral edits: diagnostics on that file. Done.
- V2 — single-domain behavioral edits: diagnostics on changed files in parallel, related tests, one execution of the affected runnable entry point when one exists.
- V3 — multi-file or cross-cutting work: diagnostics on every changed file, related tests, build, manual exercise of user-visible behavior through its real surface.

${buildTestDisciplineSection()}

"Should pass" is not verification. Reporting clean output without running the validator is a violation. Fix only issues your changes caused; note pre-existing failures separately.`;
}
