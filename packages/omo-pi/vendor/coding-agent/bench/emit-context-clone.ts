import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const MESSAGE_COUNTS = [10, 100, 1_000] as const;

type Scenario = {
	readonly messageCount: number;
	readonly messages: AgentMessage[];
};

function usage() {
	return {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function buildMessage(index: number): AgentMessage {
	const timestamp = 1_800_000_000_000 + index;
	const kind = index % 3;
	if (kind === 0) {
		return {
			role: "user",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						prompt: `inspect context ${index}`,
						filters: { jsonOnly: true, depth: 2, tags: ["emit", "context", "clone"] },
					}),
				},
			],
			timestamp,
		};
	}
	if (kind === 1) {
		return {
			role: "assistant",
			content: [
				{ type: "text", text: `assistant text ${index}` },
				{
					type: "providerNative",
					subtype: "web_search_call",
					raw: {
						query: `search ${index}`,
						results: [
							{ title: "alpha", score: index + 0.1, flags: [true, false], extra: null },
							{ title: "beta", score: index + 0.2, flags: [], extra: { source: "bench" } },
						],
						meta: { ok: true, count: 2, label: `provider-${index}` },
					},
				},
			],
			api: "openai-responses",
			provider: "openai",
			model: "bench-model",
			usage: usage(),
			stopReason: "toolUse",
			timestamp,
		};
	}
	return {
		role: "toolResult",
		toolCallId: `call-${index}`,
		toolName: "bench_tool",
		content: [{ type: "text", text: `tool result ${index}` }],
		details: {
			status: "complete",
			attempt: index,
			values: [index, "two", false, null],
			nested: {
				files: [`file-${index}.ts`, `file-${index + 1}.ts`],
				timing: { elapsedMs: index + 0.5 },
			},
		},
		isError: false,
		timestamp,
	};
}

function buildScenarios(): readonly Scenario[] {
	return MESSAGE_COUNTS.map((messageCount) => ({
		messageCount,
		messages: Array.from({ length: messageCount }, (_, index) => buildMessage(index)),
	}));
}

const SCENARIOS = buildScenarios();
const runtime = createExtensionRuntime();
const runner = new ExtensionRunner(
	[],
	runtime,
	process.cwd(),
	SessionManager.inMemory(),
	ModelRegistry.create(AuthStorage.inMemory()),
);

async function timeScenario(scenario: Scenario): Promise<number> {
	const start = performance.now();
	const result = await runner.emitContext(scenario.messages);
	if (result.length !== scenario.messageCount) {
		throw new Error(`Expected ${scenario.messageCount} cloned messages, got ${result.length}`);
	}
	if (result === scenario.messages) {
		throw new Error("Expected emitContext to return a cloned message array");
	}
	return performance.now() - start;
}

async function timeAllScenarios(caseSamples: Map<number, number[]>): Promise<number> {
	const start = performance.now();
	for (const scenario of SCENARIOS) {
		const elapsedMs = await timeScenario(scenario);
		const samples = caseSamples.get(scenario.messageCount);
		if (!samples) throw new Error(`Missing sample bucket for ${scenario.messageCount}`);
		samples.push(elapsedMs);
	}
	return performance.now() - start;
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(3, iterations); i++) {
	for (const scenario of SCENARIOS) {
		await runner.emitContext(scenario.messages);
	}
}
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
const caseSamples = new Map<number, number[]>(MESSAGE_COUNTS.map((messageCount) => [messageCount, []]));
for (let i = 0; i < iterations; i++) samples.push(await timeAllScenarios(caseSamples));
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "emit-context-clone",
		package: "@code-yeongyu/senpi",
		fixture: `${MESSAGE_COUNTS.join("-")}-json-context-messages`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		cases: MESSAGE_COUNTS.map((messageCount) => {
			const scenarioSamples = caseSamples.get(messageCount) ?? [];
			return {
				messageCount,
				samples: scenarioSamples,
				medianMs: percentile(scenarioSamples, 50),
				p95Ms: percentile(scenarioSamples, 95),
			};
		}),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
