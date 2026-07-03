import { renderDiff } from "../src/modes/interactive/components/diff.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";

const REPEATS_PER_SAMPLE = 600;
const LONG_LINE_PREFIX = Array.from({ length: 120 }, (_, index) => `token${index}`).join(" ");

type WordDiffCase = {
	readonly name: string;
	readonly removed: string;
	readonly added: string;
	readonly fastPathEligible: boolean;
};

const CASES: readonly WordDiffCase[] = [
	{
		name: "identical",
		removed: "const unchanged = formatValue(input);",
		added: "const unchanged = formatValue(input);",
		fastPathEligible: true,
	},
	{
		name: "single-word-replacement",
		removed: "  return format(oldValue);",
		added: "  return format(newValue);",
		fastPathEligible: true,
	},
	{
		name: "long-single-span-replacement",
		removed: `${LONG_LINE_PREFIX} before tail`,
		added: `${LONG_LINE_PREFIX} after tail`,
		fastPathEligible: true,
	},
	{
		name: "whitespace-only",
		removed: "const result = format(value);",
		added: "const  result = format(value);",
		fastPathEligible: false,
	},
	{
		name: "multi-span",
		removed: "alpha beta gamma delta",
		added: "alpha theta gamma omega",
		fastPathEligible: false,
	},
] as const;

function diffText(testCase: WordDiffCase): string {
	return [`-1 ${testCase.removed}`, `+1 ${testCase.added}`].join("\n");
}

function runScenario(): number {
	let renderedLength = 0;
	for (let repeat = 0; repeat < REPEATS_PER_SAMPLE; repeat++) {
		for (const testCase of CASES) {
			renderedLength += renderDiff(diffText(testCase)).length;
		}
	}
	return renderedLength;
}

function timeScenario(): number {
	const start = performance.now();
	const renderedLength = runScenario();
	if (renderedLength === 0) throw new Error("Expected rendered diff output");
	return performance.now() - start;
}

initTheme("dark");
const iterations = readIterations(20);
for (let i = 0; i < Math.min(3, iterations); i++) runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
for (let i = 0; i < iterations; i++) samples.push(timeScenario());
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "word-diff",
		package: "@code-yeongyu/senpi",
		fixture: `${CASES.length}-single-line-diff-cases`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		fastPathEligibleCases: CASES.filter((testCase) => testCase.fastPathEligible).map((testCase) => testCase.name),
		fallbackCases: CASES.filter((testCase) => !testCase.fastPathEligible).map((testCase) => testCase.name),
		metadata: metadata(),
	}),
);
