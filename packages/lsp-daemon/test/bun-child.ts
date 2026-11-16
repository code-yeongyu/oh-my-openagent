import { spawn } from "node:child_process";

import { MAX_IN_TEST_BUDGET_MS } from "../vitest.config.js";

interface BunChildResult {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
}

interface BunChildOptions {
	readonly label: string;
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly closeStdout?: boolean;
}

class BunChildCeilingError extends Error {
	constructor(
		readonly label: string,
		readonly ceilingMs: number,
		readonly elapsedMs: number,
		readonly stdout: string,
		readonly stderr: string,
	) {
		super(
			`${label}: the bun child did not exit within ${ceilingMs}ms (harness budget minus report margin); ` +
				`elapsed ${elapsedMs}ms; stderr: ${stderr.trim() || "<empty>"}; stdout: ${stdout.trim() || "<empty>"}`,
		);
		this.name = "BunChildCeilingError";
	}
}

/**
 * Runs `bun <args>` and settles on the child's own `close` event. A cold `bun` start on a loaded
 * Windows runner takes seconds, so the only clock is the ceiling derived from the vitest per-test
 * budget; a child still running then is killed and reported with its output.
 */
export function runBunChild(args: readonly string[], options: BunChildOptions): Promise<BunChildResult> {
	const startedAt = performance.now();
	return new Promise((resolve, reject) => {
		const child = spawn("bun", [...args], {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		if (options.closeStdout) child.stdout.destroy();
		const ceiling = setTimeout(() => {
			child.kill();
			reject(
				new BunChildCeilingError(
					options.label,
					MAX_IN_TEST_BUDGET_MS,
					Math.round(performance.now() - startedAt),
					stdout,
					stderr,
				),
			);
		}, MAX_IN_TEST_BUDGET_MS);
		child.once("error", (error) => {
			clearTimeout(ceiling);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(ceiling);
			resolve({ code, signal, stdout, stderr });
		});
	});
}
