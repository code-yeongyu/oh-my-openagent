import { spawnSync } from "node:child_process";
import { cpus } from "node:os";

export function readIterations(defaultIterations: number): number {
	const index = process.argv.indexOf("--iterations");
	if (index === -1) return defaultIterations;
	const raw = process.argv[index + 1];
	const parsed = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : defaultIterations;
}

export function percentile(samples: readonly number[], p: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index] ?? 0;
}

export function forceGc(): void {
	if (global.gc) global.gc();
}

export function metadata() {
	const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
	return {
		createdAt: new Date().toISOString(),
		gitCommit: git.status === 0 ? git.stdout.trim() : null,
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model ?? null,
	};
}
