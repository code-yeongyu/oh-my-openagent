#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { env as processEnv, stderr as processStderr } from "node:process";
import { fileURLToPath } from "node:url";

import { buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { resolveCodegraphCommand } from "../../../../../utils/src/codegraph/resolve.ts";
import type { CodegraphCommandResolution } from "../../../../../utils/src/codegraph/resolve.ts";

export type ServeStdio = "inherit";

export interface CodegraphServeProcessOptions {
	readonly env: Record<string, string | undefined>;
	readonly stdio: ServeStdio;
}

export type CodegraphServeProcessRunner = (
	command: string,
	args: readonly string[],
	options: CodegraphServeProcessOptions,
) => Promise<number>;

export interface CodegraphServeStderr {
	readonly write: (chunk: string) => void;
}

export interface RunCodegraphServeOptions {
	readonly buildEnv?: (options: { readonly homeDir: string }) => Record<string, string>;
	readonly commandExists?: (filePath: string) => boolean;
	readonly env?: Record<string, string | undefined>;
	readonly homeDir?: string;
	readonly resolve?: (options: { readonly env: Record<string, string | undefined>; readonly homeDir: string }) => CodegraphCommandResolution;
	readonly runProcess?: CodegraphServeProcessRunner;
	readonly stderr?: CodegraphServeStderr;
}

const CODEGRAPH_SKIP_HINT =
	"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n";

export async function runCodegraphServe(options: RunCodegraphServeOptions = {}): Promise<number> {
	const env = options.env ?? processEnv;
	const homeDir = options.homeDir ?? homedir();
	const resolution = options.resolve?.({ env, homeDir }) ?? resolveCodegraphCommand({ env, homeDir });
	if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync)) {
		(options.stderr ?? processStderr).write(CODEGRAPH_SKIP_HINT);
		return 1;
	}

	const runProcess = options.runProcess ?? runChildProcess;
	const codegraphEnv = options.buildEnv?.({ homeDir }) ?? buildCodegraphEnv({ homeDir });
	const mergedEnv = {
		...env,
		...codegraphEnv,
	};
	return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
		env: mergedEnv,
		stdio: "inherit",
	});
}

function shouldSkipResolvedCommand(
	resolution: CodegraphCommandResolution,
	commandExists: (filePath: string) => boolean,
): boolean {
	if (resolution.source !== "env") return false;
	if (!looksLikePath(resolution.command)) return false;
	return !commandExists(resolution.command);
}

function looksLikePath(command: string): boolean {
	return command.includes("/") || command.includes("\\");
}

export async function runCodegraphServeCli(): Promise<void> {
	process.exitCode = await runCodegraphServe();
}

async function runChildProcess(
	command: string,
	args: readonly string[],
	options: CodegraphServeProcessOptions,
): Promise<number> {
	const child = spawn(command, args, { env: options.env, stdio: options.stdio });
	return new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code !== null) {
				resolve(code);
				return;
			}
			resolve(signal === null ? 0 : 1);
		});
	});
}

if (isDirectInvocation(process.argv[1])) {
	runCodegraphServeCli().catch((error: unknown) => {
		processStderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

function isDirectInvocation(argvPath: string | undefined): boolean {
	if (argvPath === undefined) return false;
	return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
}
