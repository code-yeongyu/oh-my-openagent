/// <reference types="node" />

import { TextEncoder } from "node:util";
import { PassThrough } from "node:stream";
import process from "node:process";
import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";
import { attachJsonlLineReader } from "../src/modes/rpc/jsonl.ts";

const RECORD_COUNT = 10_000;
const TRAILING_INCOMPLETE_BYTES = 500;
const RECORD_TEXT = "streaming-jsonl-payload-with-stable-width-0123456789";
const SCENARIOS_PER_SAMPLE = 50;

function buildPayload(): string {
	const records: string[] = [];
	for (let i = 0; i < RECORD_COUNT; i++) {
		records.push(JSON.stringify({ index: i, type: "message_update", delta: RECORD_TEXT }));
	}
	return `${records.join("\n")}\n${"x".repeat(TRAILING_INCOMPLETE_BYTES)}`;
}

const PAYLOAD = buildPayload();
const encoder = new TextEncoder();
const PAYLOAD_BYTES = encoder.encode(PAYLOAD).byteLength;

function runScenario(): number {
	const stream = new PassThrough();
	let lineCount = 0;
	const detach = attachJsonlLineReader(stream, () => {
		lineCount++;
	});

	stream.write(PAYLOAD);
	detach();
	stream.destroy();

	if (lineCount !== RECORD_COUNT) {
		throw new Error(`Expected ${RECORD_COUNT} JSONL records, got ${lineCount}`);
	}

	return lineCount;
}

function timeScenario(): number {
	const start = performance.now();
	let lineCount = 0;
	for (let i = 0; i < SCENARIOS_PER_SAMPLE; i++) {
		lineCount = runScenario();
	}
	if (lineCount === 0) throw new Error("Expected parsed lines");
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
		suite: "coding-agent-jsonl-parse",
		package: "@code-yeongyu/senpi",
		fixture: `${RECORD_COUNT}-records-plus-${TRAILING_INCOMPLETE_BYTES}-byte-tail`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		parsedLines: RECORD_COUNT,
		payloadBytes: PAYLOAD_BYTES,
		scenariosPerSample: SCENARIOS_PER_SAMPLE,
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
