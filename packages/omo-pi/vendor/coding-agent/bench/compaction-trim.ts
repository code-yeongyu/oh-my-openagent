import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";
import { hardLimitEmergencyPrune } from "../src/core/extensions/builtin/compaction/speculative.ts";

const MESSAGE_COUNTS = [500, 1_000, 2_000] as const;
const CONTEXT_WINDOW = 53;

type Scenario = {
	readonly messageCount: number;
	readonly messages: AgentMessage[];
};

function userMessage(index: number): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text: `m${index}` }],
		timestamp: index,
	};
}

function buildScenarios(): readonly Scenario[] {
	return MESSAGE_COUNTS.map((messageCount) => ({
		messageCount,
		messages: Array.from({ length: messageCount }, (_, index) => userMessage(index)),
	}));
}

const SCENARIOS = buildScenarios();

function runScenario(): number {
	let retainedMessages = 0;
	for (const scenario of SCENARIOS) {
		const result = hardLimitEmergencyPrune(scenario.messages, CONTEXT_WINDOW);
		if (!result.needsAggressiveCompaction) {
			throw new Error(`Expected aggressive compaction for ${scenario.messageCount} messages`);
		}
		retainedMessages += result.messages.length;
	}
	return retainedMessages;
}

function timeScenario(): number {
	const start = performance.now();
	const retainedMessages = runScenario();
	if (retainedMessages <= 0 || retainedMessages > 150) {
		throw new Error(`Expected 1..150 retained messages, got ${retainedMessages}`);
	}
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
		suite: "compaction-trim",
		package: "@code-yeongyu/senpi",
		fixture: `${MESSAGE_COUNTS.join("-")}-message-emergency-prune`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		messageCounts: MESSAGE_COUNTS,
		maxRetainedMessages: 150,
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
