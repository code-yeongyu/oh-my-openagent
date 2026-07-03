import { benchRunMetadata, forceGc, percentile, readIterations } from "./_meta.ts";
import { getModels, getProviders } from "../src/models.ts";

function runScenario(): number {
	let found = 0;
	for (const provider of getProviders()) {
		const models = getModels(provider);
		found += models.length;
	}
	return found;
}

function timeScenario(): number {
	const start = performance.now();
	const found = runScenario();
	if (found === 0) throw new Error("Expected at least one bundled model");
	return performance.now() - start;
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(5, iterations); i++) runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
for (let i = 0; i < iterations; i++) samples.push(timeScenario());
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "ai-model-registry",
		package: "@earendil-works/pi-ai",
		fixture: "enumerate-and-lookup-all-models",
		iterations,
		modelCount: runScenario(),
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: benchRunMetadata(),
	}),
);
