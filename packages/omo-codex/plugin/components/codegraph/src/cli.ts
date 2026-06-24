#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stderr as processStderr } from "node:process";
import { fileURLToPath } from "node:url";

import {
	runCodegraphPostToolUseHookCli,
	runCodegraphSessionStartHook,
	runCodegraphSessionStartWorker,
	type PostToolUseHookOptions,
	type SessionStartHookOptions,
	type SessionStartWorkerOptions,
} from "./hook.js";
import { runCodegraphServeCli } from "./serve.js";

export interface RunCodegraphCliOptions extends SessionStartHookOptions {
	readonly workerOptions?: SessionStartWorkerOptions;
}

export async function runCodegraphCli(options: RunCodegraphCliOptions = {}): Promise<number> {
	const argv = options.argv ?? process.argv;
	const command = argv[2];
	const subcommand = argv[3];

	if (command === "hook" && subcommand === "session-start") {
		return runCodegraphSessionStartHook(options);
	}

	if (command === "hook" && subcommand === "post-tool-use") {
		const hookOptions: PostToolUseHookOptions = {
			...(options.env === undefined ? {} : { env: options.env }),
			...(options.stdin === undefined ? {} : { stdin: options.stdin }),
			...(options.stdout === undefined ? {} : { stdout: options.stdout }),
		};
		return runCodegraphPostToolUseHookCli(hookOptions);
	}

	if (command === "hook" && subcommand === "session-start-worker") {
		const workerOptions: SessionStartWorkerOptions = {
			...options.workerOptions,
			...(options.workerOptions?.cwd === undefined && options.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options.workerOptions?.env === undefined && options.env !== undefined ? { env: options.env } : {}),
		};
		await runCodegraphSessionStartWorker(workerOptions);
		return 0;
	}

	await runCodegraphServeCli();
	return process.exitCode === undefined ? 0 : Number(process.exitCode);
}

if (isDirectInvocation(process.argv[1])) {
	runCodegraphCli().catch((error: unknown) => {
		processStderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

function isDirectInvocation(argvPath: string | undefined): boolean {
	if (argvPath === undefined) return false;
	const modulePath = fileURLToPath(import.meta.url);
	const moduleName = basename(modulePath);
	if (moduleName !== "cli.js" && moduleName !== "cli.ts") return false;
	return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
}
