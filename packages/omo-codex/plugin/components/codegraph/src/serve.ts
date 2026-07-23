#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
	cwd as processCwd,
	env as processEnv,
	stdin as processStdin,
	stderr as processStderr,
	stdout as processStdout,
} from "node:process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
	buildCodegraphChildEnv,
	buildCodegraphEnv,
} from "../../../../../utils/src/codegraph/env.ts";
import type { ParentWatchdogConfig } from "../../../../../mcp-stdio-core/src/index.ts";
import { CODEGRAPH_PINNED_VERSION } from "../../../../../utils/src/codegraph/manifest.ts";
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
import { shouldExcludeCodegraphProject } from "../../../../../utils/src/codegraph/workspace.ts";
import { getCodexOmoConfig, type CodexOmoConfig } from "../../../shared/src/config-loader.ts";
import type { CodegraphConfig } from "./hook.js";
import { runBridgedCodegraphProcess } from "./mcp-bridge.js";
import { runUnavailableCodegraphMcpServer } from "./mcp-unavailable.js";
import { SESSION_START_CWD_ENV } from "./session-start-worker.js";
export { resolveServeProcessInvocation } from "./serve-invocation.js";

export type ServeStdio = "pipe";

export interface CodegraphServeProcessOptions {
	readonly cwd: string;
	readonly env: Record<string, string | undefined>;
	readonly input: Readable;
	readonly output: Writable;
	readonly stderr: CodegraphServeStderr;
	readonly stdio: ServeStdio;
	readonly parentWatchdog?: ParentWatchdogConfig;
}

export type CodegraphServeProcessRunner = (
	command: string,
	args: readonly string[],
	options: CodegraphServeProcessOptions,
) => Promise<number>;
export type CodegraphProvisioner = (
	options: EnsureCodegraphProvisionedOptions,
) => ReturnType<typeof ensureCodegraphProvisioned>;

export interface CodegraphServeStderr {
	readonly write: (chunk: string) => void;
}

export interface RunCodegraphServeOptions {
	readonly buildEnv?: (options: { readonly daemon: boolean; readonly homeDir: string }) => Record<string, string>;
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
	// Test seam: production callers leave this unset so the bridge and the
	// unavailable facade use the watchdog defaults (parentPid = process.ppid,
	// 30s poll).
	readonly parentWatchdog?: ParentWatchdogConfig;
}

const CODEGRAPH_SKIP_HINT =
	"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n";
const CODEGRAPH_DISABLED_HINT =
	"CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.\n";
const CODEGRAPH_EXCLUDED_HINT = "CodeGraph MCP skipped: project excluded by OMO CodeGraph policy.\n";
const CODEGRAPH_VERSION = CODEGRAPH_PINNED_VERSION;
const PROJECT_CWD_ENV_KEYS = ["OMO_CODEGRAPH_PROJECT_CWD", SESSION_START_CWD_ENV, "PWD"] as const;

export async function runCodegraphServe(options: RunCodegraphServeOptions = {}): Promise<number> {
	const env = options.env ?? processEnv;
	const homeDir = options.homeDir ?? homedir();
	const wrapperCwd = options.cwd ?? processCwd();
	const projectCwd = resolveProjectCwd(env, wrapperCwd);
	const config = options.config ?? getCodexOmoConfig({ cwd: projectCwd, env, homeDir });
	const codegraphConfig = config.codegraph ?? {};
	if (codegraphConfig.enabled === false) {
		return runUnavailableMcp(CODEGRAPH_DISABLED_HINT, options);
	}
	const excludedRoots = codegraphConfig.excluded_roots;
	const exclusion = shouldExcludeCodegraphProject(projectCwd, {
		homeDir,
		...(excludedRoots === undefined ? {} : { excludedRoots }),
	});
	if (exclusion.excluded) {
		return runUnavailableMcp(CODEGRAPH_EXCLUDED_HINT, options);
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

	const runProcess = options.runProcess ?? runBridgedCodegraphProcess;
	const codegraphEnv = codegraphEnvForConfig(trustedInstallDir, homeDir, codegraphConfig.daemon === true, options.buildEnv);
	const mergedEnv = buildCodegraphChildEnv({ ambientEnv: env, codegraphEnv, runtimeEnv: env });
	return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
		cwd: projectCwd,
		env: mergedEnv,
		input: options.stdin ?? processStdin,
		output: options.stdout ?? processStdout,
		stderr: options.stderr ?? processStderr,
		stdio: "pipe",
		parentWatchdog: options.parentWatchdog ?? {},
	});
}

async function runUnavailableMcp(reason: string, options: RunCodegraphServeOptions): Promise<number> {
	(options.stderr ?? processStderr).write(reason);
	await runUnavailableCodegraphMcpServer({
		input: options.stdin ?? processStdin,
		output: options.stdout ?? processStdout,
		reason,
		serverVersion: CODEGRAPH_VERSION,
		parentWatchdog: options.parentWatchdog ?? {},
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
	daemon: boolean,
	buildEnv: ((options: { readonly daemon: boolean; readonly homeDir: string }) => Record<string, string>) | undefined,
): Record<string, string> {
	const env = buildEnv?.({ daemon, homeDir }) ?? buildCodegraphEnv({ daemon, homeDir });
	return trustedInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: trustedInstallDir };
}

function resolveProjectCwd(env: Record<string, string | undefined>, fallback: string): string {
	for (const key of PROJECT_CWD_ENV_KEYS) {
		const candidate = env[key]?.trim();
		if (candidate === undefined || candidate.length === 0) continue;
		const resolved = resolve(candidate);
		if (existsSync(resolved)) return resolved;
	}
	return resolve(fallback);
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
	if (installDir === undefined) return null;
	const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
	return existsSync(candidate) ? candidate : null;
}

export async function runCodegraphServeCli(): Promise<void> {
	process.exitCode = await runCodegraphServe();
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
