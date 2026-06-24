#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import {
	cwd as processCwd,
	env as processEnv,
	execPath as processExecPath,
	stdin as processStdin,
	stderr as processStderr,
	stdout as processStdout,
} from "node:process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import {
	buildCodegraphNodeSkipHint,
	evaluateCodegraphNodeSupport,
} from "../../../../../utils/src/codegraph/node-support.ts";
import {
	ensureCodegraphProvisioned,
	type EnsureCodegraphProvisionedOptions,
} from "../../../../../utils/src/codegraph/provision.ts";
import {
	codegraphCommandRequiresSupportedLocalNode,
	resolveCodegraphCommand,
	type CodegraphCommandResolution,
	type ResolveCodegraphCommandOptions,
} from "../../../../../utils/src/codegraph/resolve.ts";
import { getCodexOmoConfig, type CodexOmoConfig } from "../../../shared/src/config-loader.ts";
import type { CodegraphConfig } from "./hook.js";
import { runUnavailableCodegraphMcpServer } from "./mcp-unavailable.js";

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
export type CodegraphProvisioner = (
	options: EnsureCodegraphProvisionedOptions,
) => ReturnType<typeof ensureCodegraphProvisioned>;

export interface ServeProcessInvocation {
	readonly args: readonly string[];
	readonly command: string;
}

export interface CodegraphServeStderr {
	readonly write: (chunk: string) => void;
}

export interface RunCodegraphServeOptions {
	readonly buildEnv?: (options: { readonly homeDir: string }) => Record<string, string>;
	readonly commandExists?: (filePath: string) => boolean;
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly homeDir?: string;
	readonly stdin?: Readable;
	readonly stdout?: Writable;
	readonly nodeVersion?: string;
	readonly resolve?: (options: ResolveCodegraphCommandOptions) => ReturnType<typeof resolveCodegraphCommand>;
	readonly runProcess?: CodegraphServeProcessRunner;
	readonly stderr?: CodegraphServeStderr;
	readonly ensureProvisioned?: CodegraphProvisioner;
}

const CODEGRAPH_SKIP_HINT =
	"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n";
const CODEGRAPH_DISABLED_HINT =
	"CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.\n";
const CODEGRAPH_VERSION = "1.0.1";
const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

export async function runCodegraphServe(options: RunCodegraphServeOptions = {}): Promise<number> {
	const env = options.env ?? processEnv;
	const homeDir = options.homeDir ?? homedir();
	const config = options.config ?? getCodexOmoConfig({ cwd: options.cwd ?? processCwd(), env, homeDir });
	const codegraphConfig = config.codegraph ?? {};
	if (codegraphConfig.enabled === false) {
		return runUnavailableMcp(CODEGRAPH_DISABLED_HINT, options);
	}

	const trustedInstallDir = config.trustedCodegraphInstallDir;
	const resolutionOptions = {
		env,
		homeDir,
		provisioned: () => provisionedBinFromInstallDir(trustedInstallDir),
	} satisfies ResolveCodegraphCommandOptions;
	let resolution = options.resolve?.(resolutionOptions) ?? resolveCodegraphCommand(resolutionOptions);
	const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
	if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync)) {
		if (resolution.source === "path" && !nodeSupport.supported) {
			return runUnavailableMcp(buildCodegraphNodeSkipHint(nodeSupport), options);
		}
		const provisioned = await provisionMissingCodegraph({
			config: codegraphConfig,
			ensureProvisioned: options.ensureProvisioned ?? ensureCodegraphProvisioned,
			homeDir,
			resolution,
			...(trustedInstallDir === undefined ? {} : { trustedInstallDir }),
		});
		if (provisioned === null) {
			return runUnavailableMcp(CODEGRAPH_SKIP_HINT, options);
		}
		resolution = provisioned;
	}

	if (codegraphCommandRequiresSupportedLocalNode(resolution) && !nodeSupport.supported) {
		return runUnavailableMcp(buildCodegraphNodeSkipHint(nodeSupport), options);
	}

	const runProcess = options.runProcess ?? runChildProcess;
	const codegraphEnv = codegraphEnvForConfig(trustedInstallDir, homeDir, options.buildEnv);
	const mergedEnv = {
		...env,
		...codegraphEnv,
	};
	return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
		env: mergedEnv,
		stdio: "inherit",
	});
}

async function runUnavailableMcp(reason: string, options: RunCodegraphServeOptions): Promise<number> {
	(options.stderr ?? processStderr).write(reason);
	await runUnavailableCodegraphMcpServer({
		input: options.stdin ?? processStdin,
		output: options.stdout ?? processStdout,
		reason,
		serverVersion: CODEGRAPH_VERSION,
	});
	return 0;
}

async function provisionMissingCodegraph(options: {
	readonly config: CodegraphConfig;
	readonly ensureProvisioned: CodegraphProvisioner;
	readonly homeDir: string;
	readonly resolution: CodegraphCommandResolution;
	readonly trustedInstallDir?: string;
}): Promise<CodegraphCommandResolution | null> {
	if (options.resolution.source === "env") return null;
	if (options.config.auto_provision === false) return null;

	const installDir = options.trustedInstallDir ?? join(options.homeDir, ".omo", "codegraph");
	const result = await options.ensureProvisioned({
		installDir,
		lockDir: join(installDir, ".locks"),
		version: CODEGRAPH_VERSION,
	});
	if (!result.provisioned || result.binPath === undefined) return null;
	return { argsPrefix: [], command: result.binPath, exists: true, source: "provisioned" };
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

function codegraphEnvForConfig(
	trustedInstallDir: string | undefined,
	homeDir: string,
	buildEnv: ((options: { readonly homeDir: string }) => Record<string, string>) | undefined,
): Record<string, string> {
	const env = buildEnv?.({ homeDir }) ?? buildCodegraphEnv({ homeDir });
	return trustedInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: trustedInstallDir };
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
	if (installDir === undefined) return null;
	const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
	return existsSync(candidate) ? candidate : null;
}

export async function runCodegraphServeCli(): Promise<void> {
	process.exitCode = await runCodegraphServe();
}

async function runChildProcess(
	command: string,
	args: readonly string[],
	options: CodegraphServeProcessOptions,
): Promise<number> {
	const invocation = resolveServeProcessInvocation(command, args);
	const child = spawn(invocation.command, invocation.args, { env: options.env, stdio: options.stdio });
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

export function resolveServeProcessInvocation(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): ServeProcessInvocation {
	if (platform !== "win32") return { args: [...args], command };

	const extension = extname(command).toLowerCase();
	if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) {
		return { args: [command, ...args], command: processExecPath };
	}

	if (WINDOWS_CMD_EXTENSIONS.has(extension)) {
		return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
	}

	return { args: [...args], command };
}

if (isDirectInvocation(process.argv[1])) {
	runCodegraphServeCli().catch((error: unknown) => {
		processStderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

function isDirectInvocation(argvPath: string | undefined): boolean {
	if (argvPath === undefined) return false;
	const modulePath = fileURLToPath(import.meta.url);
	const moduleName = basename(modulePath);
	if (moduleName !== "serve.js" && moduleName !== "serve.ts") return false;
	return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
}
