/// <reference types="node" />

import process from "node:process";
import { TextEncoder } from "node:util";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";
import { createRpcEventOutputBuffer } from "../src/modes/rpc/event-output-buffer.ts";

const EVENT_COUNT = 1_000;
const SCENARIOS_PER_SAMPLE = 50;
const encoder = new TextEncoder();

type RpcBenchmarkEvent = Readonly<{
	type: string;
	sequence: number;
	timestamp: number;
	payload: Readonly<Record<string, unknown>>;
}>;

class CountingSink {
	writeCalls = 0;
	totalBytes = 0;

	write(chunk: string): void {
		this.writeCalls++;
		this.totalBytes += encoder.encode(chunk).byteLength;
	}
}

function buildEvents(): readonly RpcBenchmarkEvent[] {
	return Array.from({ length: EVENT_COUNT }, (_, index) => {
		const kind = index % 5;
		if (kind === 0) {
			return {
				type: "message_update",
				sequence: index,
				timestamp: 1_800_000_000_000 + index,
				payload: {
					role: "assistant",
					delta: `stream chunk ${index} ${"x".repeat(80)}`,
				},
			};
		}
		if (kind === 1) {
			return {
				type: "tool_execution_update",
				sequence: index,
				timestamp: 1_800_000_000_000 + index,
				payload: {
					toolCallId: `call-${index}`,
					toolName: "bash",
					partialResult: `stdout ${index} ${"y".repeat(80)}`,
				},
			};
		}
		if (kind === 2) {
			return {
				type: "queue_update",
				sequence: index,
				timestamp: 1_800_000_000_000 + index,
				payload: {
					steering: [`steer-${index}`],
					followUp: [`follow-up-${index}`],
				},
			};
		}
		if (kind === 3) {
			return {
				type: "compaction_progress",
				sequence: index,
				timestamp: 1_800_000_000_000 + index,
				payload: {
					reason: "pre_prompt",
					delta: `summary delta ${index} ${"z".repeat(80)}`,
				},
			};
		}
		return {
			type: "auto_retry_start",
			sequence: index,
			timestamp: 1_800_000_000_000 + index,
			payload: {
				attempt: (index % 3) + 1,
				maxAttempts: 3,
				delayMs: 500 + index,
				errorMessage: `transient error ${index}`,
			},
		};
	});
}

const EVENTS = buildEvents();

function runScenario(): CountingSink {
	const sink = new CountingSink();
	const scheduledFlushes: Array<() => void> = [];
	const output = createRpcEventOutputBuffer(
		(chunk) => sink.write(chunk),
		(flush) => scheduledFlushes.push(flush),
	);
	for (const event of EVENTS) {
		output.enqueueEvent(event);
	}
	for (const flush of scheduledFlushes) {
		flush();
	}
	if (sink.writeCalls !== 1) {
		throw new Error(`Expected 1 coalesced write, got ${sink.writeCalls}`);
	}
	if (sink.totalBytes === 0) {
		throw new Error("Expected serialized bytes");
	}
	return sink;
}

function timeScenario(): { readonly elapsedMs: number; readonly writeCalls: number; readonly totalBytes: number } {
	const start = performance.now();
	let sink = runScenario();
	for (let i = 1; i < SCENARIOS_PER_SAMPLE; i++) {
		sink = runScenario();
	}
	return {
		elapsedMs: performance.now() - start,
		writeCalls: sink.writeCalls,
		totalBytes: sink.totalBytes,
	};
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(3, iterations); i++) runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
let writeCalls = 0;
let totalBytes = 0;
for (let i = 0; i < iterations; i++) {
	const result = timeScenario();
	samples.push(result.elapsedMs);
	writeCalls = result.writeCalls;
	totalBytes = result.totalBytes;
}
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "coding-agent-rpc-event-emit",
		package: "@code-yeongyu/senpi",
		fixture: `${EVENT_COUNT}-representative-events`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		writeCalls,
		totalBytes,
		scenariosPerSample: SCENARIOS_PER_SAMPLE,
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
