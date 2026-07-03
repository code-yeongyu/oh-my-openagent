import { benchRunMetadata, forceGc, percentile, readIterations } from "./_meta.ts";
import { EventStream } from "../src/utils/event-stream.ts";

const EVENT_COUNT = 50_000;

async function consumeAll(stream: EventStream<number, number>): Promise<number> {
	let count = 0;
	for await (const _event of stream) count++;
	return count;
}

async function runScenario(): Promise<void> {
	const stream = new EventStream<number, number>(
		(event) => event === EVENT_COUNT - 1,
		(event) => event,
	);
	for (let i = 0; i < EVENT_COUNT; i++) stream.push(i);
	const consumed = await consumeAll(stream);
	if (consumed !== EVENT_COUNT) {
		throw new Error(`Expected ${EVENT_COUNT} events, consumed ${consumed}`);
	}
	const result = await stream.result();
	if (result !== EVENT_COUNT - 1) {
		throw new Error(`Unexpected final result ${result}`);
	}
}

async function timeScenario(): Promise<number> {
	const start = performance.now();
	await runScenario();
	return performance.now() - start;
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(5, iterations); i++) await runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
for (let i = 0; i < iterations; i++) samples.push(await timeScenario());
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "ai-event-stream",
		package: "@earendil-works/pi-ai",
		fixture: `${EVENT_COUNT}-queued-events`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: benchRunMetadata(),
	}),
);
