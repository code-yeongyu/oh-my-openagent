export const lazycodexAgentInvariants = new Map([
	[
		"explorer.toml",
		{
			model: "gpt-5.6-terra",
			effort: "medium",
			includes: [/Read-only/, /working tree/, /rg/],
		},
	],
	[
		"librarian.toml",
		{
			model: "gpt-5.6-terra",
			effort: "medium",
			includes: [/Read-only/, /SHA-pinned GitHub permalink/, /external/],
		},
	],
	[
		"metis.toml",
		{
			model: "gpt-5.6-sol",
			effort: "high",
			includes: [/pre-planning analyst/i, /contradictions/, /Read-only/],
		},
	],
	[
		"momus.toml",
		{
			model: "gpt-5.6-sol",
			effort: "ultra",
			includes: [/plan reviewer/i, /OKAY, ITERATE, or REJECT/, /Read-only/],
		},
	],
	[
		"plan.toml",
		{
			model: "gpt-5.6-sol",
			effort: "max",
			includes: [
				/strategic planning consultant/i,
				/\.omo\/plans\/<slug>\.md/,
				/never implements/i,
			],
		},
	],
	[
		"lazycodex-worker-low.toml",
		{
			model: "gpt-5.6-terra",
			effort: "high",
			includes: [
				/EVIDENCE_RECORDED: <path>/,
				/low-difficulty/i,
				/smallest correct change/i,
			],
		},
	],
	[
		"lazycodex-worker-medium.toml",
		{
			model: "gpt-5.6-terra",
			effort: "high",
			includes: [
				/EVIDENCE_RECORDED: <path>/,
				/medium-difficulty/i,
				/smallest correct change/i,
			],
		},
	],
	[
		"lazycodex-worker-high.toml",
		{
			model: "gpt-5.6-sol",
			effort: "max",
			includes: [
				/EVIDENCE_RECORDED: <path>/,
				/high-difficulty/i,
				/smallest correct change/i,
			],
		},
	],
	[
		"lazycodex-clone-fidelity-reviewer.toml",
		{
			model: "gpt-5.6-sol",
			effort: "xhigh",
			includes: [
				/recommendation/,
				/blockers/,
				/\.omo\/evidence\/<goal>-clone-fidelity\.md/,
			],
		},
	],
	[
		"lazycodex-code-reviewer.toml",
		{
			model: "gpt-5.6-sol",
			effort: "xhigh",
			includes: [
				/codeQualityStatus/,
				/recommendation/,
				/<attemptDir>\/<goalId>-code-review\.md/,
				/currentAttemptDir/,
			],
		},
	],
	[
		"lazycodex-qa-executor.toml",
		{
			model: "gpt-5.6-terra",
			effort: "medium",
			includes: [
				/not_applicable/,
				/surfaceEvidence/,
				/adversarialCases/,
				/<attemptDir>\/<goalId>-manual-qa\.md/,
			],
		},
	],
	[
		"lazycodex-gate-reviewer.toml",
		{
			model: "gpt-5.6-sol",
			effort: "high",
			includes: [
				/APPROVE\/REJECT/,
				/blockers/,
				/<attemptDir>\/<goalId>-gate-review\.md/,
				/currentAttemptDir/,
			],
		},
	],
]);

export const externalSourceTokenPattern = new RegExp(
	[
		"ga" + "jae",
		"ga" + "jae" + "code",
		"ga" + "jae-code",
		"\uAC00\uC7AC",
		"g" + "jc",
	].join("|"),
	"i",
);
