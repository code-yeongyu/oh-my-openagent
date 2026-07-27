import { spawn } from "node:child_process";

import type { HookStdout, WorkerSpawnInvocation } from "./hook-types.js";

export function spawnDetachedSessionStartWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], {
		detached: true,
		env: invocation.env,
		stdio: "ignore",
	});
	child.unref();
}

export function writeSessionStartNotice(stdout: HookStdout, notice: string): void {
	stdout.write(`${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: notice,
		},
	})}\n`);
}
