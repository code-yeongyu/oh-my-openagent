import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";

const WIDTH = 100;
const MESSAGE_COUNT = 400;

function markdown(index: number): string {
	return [
		`### Result ${index}`,
		"",
		"Here is a realistic assistant response with **bold**, _italic_, and a list:",
		"",
		`- item ${index}`,
		`- item ${index + 1}`,
		"",
		"```ts",
		`const value = ${index};`,
		"console.log(value);",
		"```",
	].join("\n");
}

function createAssistantMessage(index: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: markdown(index) }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function runScenario(): number {
	let lines = 0;
	for (let i = 0; i < MESSAGE_COUNT; i++) {
		const message = createAssistantMessage(i % 25);
		const component = new AssistantMessageComponent(message);
		lines += component.render(WIDTH).length;
	}
	return lines;
}

function timeScenario(): number {
	const start = performance.now();
	const lines = runScenario();
	if (lines === 0) throw new Error("Expected transcript output");
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
		suite: "coding-agent-render-transcript",
		package: "@code-yeongyu/senpi",
		fixture: `${MESSAGE_COUNT}-assistant-components`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
