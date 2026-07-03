import { forceGc, metadata, percentile, readIterations } from "../../tui/bench/_meta.ts";
import { executeBashWithOperations } from "../src/core/bash-executor.ts";
import type { BashOperations } from "../src/core/tools/bash.ts";

const CHUNK_COUNT = 10_000;
const CHUNK_TEXT = `${"x".repeat(180)}\n`;
const CHUNKS = Array.from({ length: CHUNK_COUNT }, () => Buffer.from(CHUNK_TEXT, "utf-8"));

const operations: BashOperations = {
	exec: async (_command, _cwd, { onData }) => {
		for (const chunk of CHUNKS) {
			onData(chunk);
		}
		return { exitCode: 0 };
	},
};

async function runScenario(): Promise<number> {
	const result = await executeBashWithOperations("bench", process.cwd(), operations);
	if (!result.truncated) throw new Error("Expected truncated output");
	if (!result.fullOutputPath) throw new Error("Expected full output path");
	return result.output.length;
}

async function timeScenario(): Promise<number> {
	const start = performance.now();
	const length = await runScenario();
	if (length === 0) throw new Error("Expected output");
	return performance.now() - start;
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(3, iterations); i++) await runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
for (let i = 0; i < iterations; i++) samples.push(await timeScenario());
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "coding-agent-bash-output",
		package: "@code-yeongyu/senpi",
		fixture: `${CHUNK_COUNT}-chunks`,
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
