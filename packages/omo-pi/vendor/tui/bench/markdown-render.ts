import { Markdown } from "../src/components/markdown.ts";
import { defaultMarkdownTheme } from "../test/test-themes.ts";
import { forceGc, metadata, percentile, readIterations } from "./_meta.ts";

const WIDTH = 100;
const markdownSource = Array.from({ length: 80 }, (_, index) =>
	[
		`## Section ${index}`,
		"",
		"Here is **bold** text, _italic_ text, a [link](https://example.com), and `inline code`.",
		"",
		"- item one with enough words to wrap across several terminal columns",
		"- item two with enough words to wrap across several terminal columns",
		"",
		"```ts",
		`const value${index} = ${index};`,
		"console.log(value);",
		"```",
	].join("\n"),
).join("\n\n");

function runScenario(): number {
	let lines = 0;
	for (let i = 0; i < 200; i++) {
		lines += new Markdown(markdownSource, 1, 0, defaultMarkdownTheme).render(WIDTH).length;
	}
	return lines;
}

function timeScenario(): number {
	const start = performance.now();
	const lines = runScenario();
	if (lines === 0) throw new Error("Expected markdown output");
	return performance.now() - start;
}

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
		suite: "tui-markdown",
		package: "@earendil-works/pi-tui",
		fixture: "200-fresh-markdown-components",
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
