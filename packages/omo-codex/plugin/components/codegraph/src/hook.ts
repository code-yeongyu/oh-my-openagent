import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr, stdin as processStdin, stdout as processStdout } from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { buildCodegraphEnv } from "./codegraph-env.js";
import { resolveCodegraphCommand, type CodegraphCommandResolution, type ResolveCodegraphCommandOptions } from "./codegraph-resolve.js";

export const CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";

export type SessionStartAction = "skipped-disabled" | "spawned";
export type WorkerAction = "failed" | "initialized" | "skipped-disabled" | "skipped-status" | "skipped-unavailable" | "synced";

export interface WorkerSpawnInvocation {
	readonly args: readonly string[];
	readonly command: string;
	readonly env: Record<string, string | undefined>;
}

export interface HookStdout {
	readonly write: (chunk: string) => void;
}

export interface SessionStartHookResult {
	readonly action: SessionStartAction;
	readonly exitCode: 0;
}

export interface CodegraphCommandResult {
	readonly exitCode: number;
	readonly stderr?: string;
	readonly stdout: string;
	readonly timedOut: boolean;
}

export interface CodegraphConfig {
	readonly auto_provision?: boolean;
	readonly enabled?: boolean;
	readonly install_dir?: string;
	readonly telemetry?: boolean;
}

export interface CodexOmoConfig {
	readonly codegraph?: CodegraphConfig;
	readonly sources: readonly OmoConfigSource[];
	readonly warnings: readonly string[];
}

export interface OmoConfigSource {
	readonly exists: boolean;
	readonly loaded: boolean;
	readonly path: string;
	readonly scope: "global" | "project";
}

export type CodegraphWorkspaceMode = "global-linked" | "in-place-fallback" | "in-project";

export interface CodegraphWorkspacePreparation {
	readonly dataDir: string;
	readonly dataRoot: string;
	readonly linked: boolean;
	readonly mode: CodegraphWorkspaceMode;
	readonly projectLink: string;
	readonly reason?: string;
}

export interface CodegraphProvisionResult {
	readonly binPath?: string;
	readonly error?: string;
	readonly provisioned: boolean;
}

export interface CodegraphSessionStartOutcome {
	readonly action: WorkerAction;
	readonly error?: string;
	readonly exitCode?: number;
	readonly projectRoot?: string;
	readonly source?: CodegraphCommandResolution["source"];
	readonly timedOut?: boolean;
}

export interface CodegraphSessionStartDeps {
	readonly ensureGitignored: (projectRoot: string) => boolean;
	readonly ensureProvisioned: (options: { readonly installDir?: string; readonly lockDir: string; readonly version: "1.0.1" }) => Promise<CodegraphProvisionResult>;
	readonly prepareWorkspace: (projectRoot: string, options: { readonly homeDir: string }) => CodegraphWorkspacePreparation;
	readonly resolveCommand: (options?: ResolveCodegraphCommandOptions) => CodegraphCommandResolution;
	readonly runCommand: (
		projectRoot: string,
		command: string,
		args: readonly string[],
		options: { readonly env: Record<string, string>; readonly timeoutMs: number },
	) => Promise<CodegraphCommandResult>;
}

export interface SessionStartHookOptions {
	readonly argv?: readonly string[];
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly spawnWorker?: (invocation: WorkerSpawnInvocation) => void;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly stdout?: HookStdout;
	readonly workerCliPath?: string;
}

export interface SessionStartWorkerOptions {
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly deps?: Partial<CodegraphSessionStartDeps>;
	readonly env?: Record<string, string | undefined>;
	readonly logOutcome?: (outcome: CodegraphSessionStartOutcome) => void;
}

const CODEGRAPH_VERSION = "1.0.1";
const COMMAND_TIMEOUT_MS = 60_000;
const SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";

const defaultDeps: CodegraphSessionStartDeps = {
	ensureGitignored,
	ensureProvisioned,
	prepareWorkspace,
	resolveCommand: resolveCodegraphCommand,
	runCommand: runCodegraphCommand,
};

export async function runCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<number> {
	return (await executeCodegraphSessionStartHook(options)).exitCode;
}

export async function executeCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<SessionStartHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const projectRoot = resolveProjectRoot(input, options.cwd ?? processCwd());
	const homeDir = resolveHomeDir(env);
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });

	if (config.codegraph?.enabled === false) {
		writeHookJson(options.stdout ?? processStdout, "skipped-disabled");
		return { action: "skipped-disabled", exitCode: 0 };
	}

	(options.spawnWorker ?? spawnDetachedWorker)({
		args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
		command: process.execPath,
		env: { ...env, [SESSION_START_CWD_ENV]: projectRoot },
	});
	writeHookJson(options.stdout ?? processStdout, "spawned");
	return { action: "spawned", exitCode: 0 };
}

export async function runCodegraphSessionStartWorker(options: SessionStartWorkerOptions = {}): Promise<{ readonly action: WorkerAction }> {
	const env = options.env ?? processEnv;
	const homeDir = resolveHomeDir(env);
	const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	const logOutcome = options.logOutcome ?? ((outcome) => appendOutcome(homeDir, outcome));

	if (config.codegraph?.enabled === false) {
		return finish("skipped-disabled", { projectRoot }, logOutcome);
	}

	return runBootstrap(projectRoot, config.codegraph ?? {}, env, homeDir, { ...defaultDeps, ...options.deps }, logOutcome);
}

async function runBootstrap(
	projectRoot: string,
	config: CodegraphConfig,
	env: Record<string, string | undefined>,
	homeDir: string,
	deps: CodegraphSessionStartDeps,
	logOutcome: (outcome: CodegraphSessionStartOutcome) => void,
): Promise<{ readonly action: WorkerAction }> {
	try {
		deps.prepareWorkspace(projectRoot, { homeDir });
		deps.ensureGitignored(projectRoot);
		const command = await resolveOrProvisionCommand(deps, config, env, homeDir);
		if (command.kind === "unavailable") {
			return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
		}

		const codegraphEnv = config.install_dir === undefined ? buildCodegraphEnv({ homeDir }) : { ...buildCodegraphEnv({ homeDir }), CODEGRAPH_INSTALL_DIR: config.install_dir };
		const status = await deps.runCommand(projectRoot, command.resolution.command, [...command.resolution.argsPrefix, "status", "--json"], { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
		const decision = decideStartupAction(status);
		if (decision.kind === "skip") return finish("skipped-status", { error: decision.reason, projectRoot }, logOutcome);

		const actionArgs = command.resolution.argsPrefix.concat(decision.kind === "init" ? ["init"] : ["sync"]);
		const action = await deps.runCommand(projectRoot, command.resolution.command, actionArgs, { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
		return finish(decision.kind === "init" ? "initialized" : "synced", { exitCode: action.exitCode, projectRoot, source: command.resolution.source, timedOut: action.timedOut }, logOutcome);
	} catch (error) {
		return finish("failed", { error: error instanceof Error ? error.message : String(error), projectRoot }, logOutcome);
	}
}

function finish(action: WorkerAction, detail: Omit<CodegraphSessionStartOutcome, "action">, logOutcome: (outcome: CodegraphSessionStartOutcome) => void): { readonly action: WorkerAction } {
	safeLogOutcome(logOutcome, { ...detail, action });
	return { action };
}

type ResolutionResult =
	| { readonly kind: "resolved"; readonly resolution: CodegraphCommandResolution }
	| { readonly error: string; readonly kind: "unavailable"; readonly projectRoot?: string; readonly source: CodegraphCommandResolution["source"] };

async function resolveOrProvisionCommand(deps: CodegraphSessionStartDeps, config: CodegraphConfig, env: Record<string, string | undefined>, homeDir: string): Promise<ResolutionResult> {
	const resolved = deps.resolveCommand({ env, homeDir, provisioned: () => provisionedBinFromInstallDir(config.install_dir) });
	if (resolved.exists) return { kind: "resolved", resolution: resolved };
	if (config.auto_provision === false) return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };

	const installDir = config.install_dir ?? join(homeDir, ".omo", "codegraph");
	const provisioned = await deps.ensureProvisioned({ installDir, lockDir: join(installDir, "locks"), version: CODEGRAPH_VERSION });
	if (!provisioned.provisioned || provisioned.binPath === undefined) {
		return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
	}
	return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}

function decideStartupAction(status: CodegraphCommandResult): { readonly kind: "init" } | { readonly kind: "skip"; readonly reason: string } | { readonly kind: "sync" } {
	if (status.timedOut) return { kind: "skip", reason: "status timed out" };
	const text = `${status.stdout}\n${status.stderr ?? ""}`.toLowerCase();
	if (text.includes("not initialized") || text.includes("uninitialized")) return { kind: "init" };
	const initialized = jsonSaysInitialized(parseJson(status.stdout));
	if (initialized === false) return { kind: "init" };
	if (initialized === true) return { kind: "sync" };
	if (status.exitCode !== 0) return { kind: "skip", reason: `status exited ${status.exitCode}` };
	return { kind: "sync" };
}

function jsonSaysInitialized(value: unknown): boolean | undefined {
	if (!isRecord(value)) return undefined;
	const initialized = value["initialized"] ?? value["isInitialized"] ?? value["ready"];
	if (typeof initialized === "boolean") return initialized;
	const status = value["status"];
	if (typeof status !== "string") return undefined;
	const normalized = status.toLowerCase();
	if (normalized.includes("not initialized") || normalized.includes("uninitialized")) return false;
	if (normalized.includes("initialized") || normalized.includes("ready")) return true;
	return undefined;
}

async function runCodegraphCommand(projectRoot: string, command: string, args: readonly string[], options: { readonly env: Record<string, string>; readonly timeoutMs: number }): Promise<CodegraphCommandResult> {
	return new Promise((resolvePromise) => {
		execFile(command, [...args], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, ...options.env }, maxBuffer: 1024 * 1024, timeout: options.timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
			if (error === null) {
				resolvePromise({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false });
				return;
			}
			resolvePromise({ exitCode: resolveExitCode(error), stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: error.killed === true });
		});
	});
}

function writeHookJson(stdout: HookStdout, action: SessionStartAction): void {
	const output = action === "spawned"
		? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: CODEGRAPH_SESSION_START_NOTICE }, codegraph: { action } }
		: { hookSpecificOutput: { hookEventName: "SessionStart" }, codegraph: { action } };
	stdout.write(`${JSON.stringify(output)}\n`);
}

function spawnDetachedWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
	child.unref();
}

function appendOutcome(homeDir: string, outcome: CodegraphSessionStartOutcome): void {
	const logDir = join(homeDir, ".omo", "codegraph");
	mkdirSync(logDir, { recursive: true });
	appendFileSync(join(logDir, "session-start.jsonl"), `${JSON.stringify({ ...outcome, timestamp: new Date().toISOString() })}\n`);
}

function safeLogOutcome(logOutcome: (outcome: CodegraphSessionStartOutcome) => void, outcome: CodegraphSessionStartOutcome): void {
	try {
		logOutcome(outcome);
	} catch (error) {
		if (error instanceof Error) processStderr.write(`[codegraph-session-start] failed to write outcome: ${error.message}\n`);
		else throw error;
	}
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
	if (installDir === undefined) return null;
	const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.exe" : "codegraph");
	return existsSync(candidate) ? candidate : null;
}

function resolveExitCode(error: Error): number {
	if ("code" in error && typeof error.code === "number") return error.code;
	return 1;
}

function toOutputText(value: string | Buffer): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function getCodexOmoConfig(options: { readonly cwd: string; readonly env: Record<string, string | undefined>; readonly homeDir: string }): CodexOmoConfig {
	const globalPath = join(options.homeDir, ".omo", "config.jsonc");
	const sources: OmoConfigSource[] = [];
	let codegraph: CodegraphConfig = { auto_provision: true, enabled: true, telemetry: false };
	if (existsSync(globalPath)) {
		const loaded = loadCodegraphConfig(globalPath);
		sources.push({ exists: true, loaded: loaded.loaded, path: globalPath, scope: "global" });
		codegraph = { ...codegraph, ...loaded.config.codegraph, ...loaded.config.codexCodegraph };
	} else {
		sources.push({ exists: false, loaded: false, path: globalPath, scope: "global" });
	}

	const envCodegraph = loadCodegraphEnv(options.env);
	return { codegraph: { ...codegraph, ...envCodegraph }, sources, warnings: [] };
}

function loadCodegraphConfig(path: string): { readonly config: { readonly codegraph?: CodegraphConfig; readonly codexCodegraph?: CodegraphConfig }; readonly loaded: boolean } {
	const parsed = parseJson(stripJsonComments(readFileSync(path, "utf8")));
	if (!isRecord(parsed)) return { config: {}, loaded: false };
	const codegraph = readCodegraphSection(parsed["codegraph"]);
	const codexCodegraph = isRecord(parsed["[codex]"]) ? readCodegraphSection(parsed["[codex]"]["codegraph"]) : undefined;
	return {
		config: {
			...(codegraph === undefined ? {} : { codegraph }),
			...(codexCodegraph === undefined ? {} : { codexCodegraph }),
		},
		loaded: true,
	};
}

function stripJsonComments(text: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];
		if (char === undefined) continue;
		if (inString) {
			output += char;
			escaped = char === "\\" && !escaped;
			if (char === "\"" && !escaped) inString = false;
			if (char !== "\\") escaped = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			output += char;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			output += "\n";
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
			index += 1;
			continue;
		}
		output += char;
	}
	return output.replace(/,\s*([}\]])/g, "$1");
}

function readCodegraphSection(value: unknown): CodegraphConfig | undefined {
	if (!isRecord(value)) return undefined;
	const config: { auto_provision?: boolean; enabled?: boolean; install_dir?: string; telemetry?: boolean } = {};
	if (typeof value["auto_provision"] === "boolean") config.auto_provision = value["auto_provision"];
	if (typeof value["enabled"] === "boolean") config.enabled = value["enabled"];
	if (typeof value["install_dir"] === "string") config.install_dir = value["install_dir"];
	if (typeof value["telemetry"] === "boolean") config.telemetry = value["telemetry"];
	return Object.keys(config).length === 0 ? undefined : config;
}

function loadCodegraphEnv(env: Record<string, string | undefined>): CodegraphConfig {
	const config: { auto_provision?: boolean; enabled?: boolean; install_dir?: string; telemetry?: boolean } = {};
	const omoAutoProvision = readBooleanValue(env["OMO_CODEGRAPH_AUTO_PROVISION"]);
	const codexAutoProvision = readBooleanValue(env["CODEX_CODEGRAPH_AUTO_PROVISION"]);
	const omoEnabled = readBooleanValue(env["OMO_CODEGRAPH_ENABLED"]);
	const codexEnabled = readBooleanValue(env["CODEX_CODEGRAPH_ENABLED"]);
	const omoTelemetry = readBooleanValue(env["OMO_CODEGRAPH_TELEMETRY"]);
	const codexTelemetry = readBooleanValue(env["CODEX_CODEGRAPH_TELEMETRY"]);
	if (omoAutoProvision !== undefined) config.auto_provision = omoAutoProvision;
	if (codexAutoProvision !== undefined) config.auto_provision = codexAutoProvision;
	if (omoEnabled !== undefined) config.enabled = omoEnabled;
	if (codexEnabled !== undefined) config.enabled = codexEnabled;
	if (env["OMO_CODEGRAPH_INSTALL_DIR"] !== undefined) config.install_dir = env["OMO_CODEGRAPH_INSTALL_DIR"];
	if (env["CODEX_CODEGRAPH_INSTALL_DIR"] !== undefined) config.install_dir = env["CODEX_CODEGRAPH_INSTALL_DIR"];
	if (omoTelemetry !== undefined) config.telemetry = omoTelemetry;
	if (codexTelemetry !== undefined) config.telemetry = codexTelemetry;
	return config;
}

function readBooleanValue(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}

function resolveProjectRoot(input: unknown, fallback: string): string {
	if (!isRecord(input)) return fallback;
	const cwd = input["cwd"];
	return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : fallback;
}

async function readHookInput(stdin: Readable & { readonly isTTY?: boolean }): Promise<unknown> {
	if (stdin.isTTY === true) return undefined;
	let text = "";
	for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : String(chunk);
	if (text.trim().length === 0) return undefined;
	return parseJson(text);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function ensureGitignored(projectRoot: string): boolean {
	const excludePath = join(projectRoot, ".git", "info", "exclude");
	try {
		mkdirSync(dirname(excludePath), { recursive: true });
		const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
		if (existing.split(/\r?\n/).includes(".codegraph")) return true;
		appendFileSync(excludePath, `${existing.length === 0 || existing.endsWith("\n") ? "" : "\n"}.codegraph\n`);
		return true;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function prepareWorkspace(projectRoot: string, options: { readonly homeDir: string }): CodegraphWorkspacePreparation {
	const resolvedRoot = resolve(projectRoot);
	const dataRoot = join(options.homeDir, ".omo", "codegraph");
	const dataDir = join(dataRoot, "projects", workspaceStorageName(resolvedRoot));
	const projectLink = join(resolvedRoot, ".codegraph");
	try {
		mkdirSync(dataDir, { recursive: true });
		if (existsSync(projectLink)) return inspectExistingWorkspace(dataRoot, dataDir, projectLink);
		if (statSync(resolvedRoot).dev !== statSync(dataRoot).dev) return createInPlaceWorkspace(dataRoot, projectLink, "workspace and OMO store are on different filesystems");
		symlinkSync(dataDir, projectLink, process.platform === "win32" ? "junction" : "dir");
		return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return createInPlaceWorkspace(dataRoot, projectLink, reason);
	}
}

function inspectExistingWorkspace(dataRoot: string, dataDir: string, projectLink: string): CodegraphWorkspacePreparation {
	const linkStat = lstatSync(projectLink);
	if (!linkStat.isSymbolicLink()) return { dataDir: projectLink, dataRoot, linked: false, mode: "in-project", projectLink };
	if (realpathSync(projectLink) === realpathSync(dataDir)) return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
	return createInPlaceWorkspace(dataRoot, projectLink, "existing .codegraph symlink points outside OMO store");
}

function createInPlaceWorkspace(dataRoot: string, projectLink: string, reason: string): CodegraphWorkspacePreparation {
	if (!existsSync(projectLink)) mkdirSync(projectLink, { recursive: true });
	return { dataDir: projectLink, dataRoot, linked: false, mode: "in-place-fallback", projectLink, reason };
}

function workspaceStorageName(projectRoot: string): string {
	const name = basename(projectRoot).replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-") || "workspace";
	const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
	return `${name}-${hash}`;
}

async function ensureProvisioned(options: { readonly installDir?: string; readonly lockDir: string; readonly version: "1.0.1" }): Promise<CodegraphProvisionResult> {
	const installDir = options.installDir ?? join(homedir(), ".omo", "codegraph");
	const existing = readProvisionMarker(installDir, options.version);
	if (existing !== null) return { binPath: existing, provisioned: true };
	const asset = codegraphAsset();
	if (asset === null) return { error: `no CodeGraph ${options.version} asset for ${process.platform}-${process.arch}`, provisioned: false };
	try {
		mkdirSync(options.lockDir, { recursive: true });
		const bytes = await downloadAsset(asset.url);
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual !== asset.sha256) return { error: `checksum mismatch for ${basename(asset.url)}: expected ${asset.sha256}, got ${actual}`, provisioned: false };
		const stagingDir = join(installDir, ".staging", randomUUID());
		const archivePath = join(stagingDir, basename(asset.url));
		const extractDir = join(stagingDir, "extract");
		mkdirSync(extractDir, { recursive: true });
		try {
			writeFileSync(archivePath, bytes);
			await execFilePromise("tar", ["-xzf", archivePath, "-C", extractDir]);
			const binPath = installExtractedBundle(extractDir, installDir, asset.executableName, options.version);
			return { binPath, provisioned: true };
		} finally {
			rmSync(stagingDir, { force: true, recursive: true });
		}
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), provisioned: false };
	}
}

function readProvisionMarker(installDir: string, version: string): string | null {
	const marker = join(installDir, ".provisioned", `codegraph-${version}.json`);
	if (!existsSync(marker)) return null;
	const parsed = parseJson(readFileSync(marker, "utf8"));
	if (!isRecord(parsed) || typeof parsed["binPath"] !== "string") return null;
	return existsSync(parsed["binPath"]) ? parsed["binPath"] : null;
}

interface CodegraphAsset {
	readonly executableName: string;
	readonly sha256: string;
	readonly url: string;
}

function codegraphAsset(): CodegraphAsset | null {
	const key = `${process.platform}-${process.arch}`;
	const assets: Record<string, CodegraphAsset> = {
		"darwin-arm64": { executableName: "codegraph", sha256: "95bb27bf6382b69659e158e0c04d71cc394778951e1317d582be7807e7866908", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-arm64.tar.gz" },
		"darwin-x64": { executableName: "codegraph", sha256: "3311cc1d1f0f0ad742709b6a43d8a9187b1ef0af0dd30e0b58008dc673e29478", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-x64.tar.gz" },
		"linux-arm64": { executableName: "codegraph", sha256: "e16f612bc96c2ebccd04574cbed500c9939147c80666ad6bb024398dff7992ae", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-arm64.tar.gz" },
		"linux-x64": { executableName: "codegraph", sha256: "d45a068f44596a85c7ba7d0ef924eaf7103fbbf3cafbeb668127daff60a52228", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-x64.tar.gz" },
	};
	return assets[key] ?? null;
}

async function downloadAsset(url: string): Promise<Uint8Array> {
	const response = await fetch(url, { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

function installExtractedBundle(extractDir: string, installDir: string, executableName: string, version: string): string {
	const roots = readdirSync(extractDir);
	const bundleRoot = roots.length === 1 ? roots[0] : undefined;
	if (bundleRoot === undefined) throw new Error(`CodeGraph archive should contain one root directory, found ${roots.length}`);
	for (const entry of readdirSync(join(extractDir, bundleRoot))) {
		rmSync(join(installDir, entry), { force: true, recursive: true });
		renameSync(join(extractDir, bundleRoot, entry), join(installDir, entry));
	}
	const binPath = join(installDir, "bin", executableName);
	if (!existsSync(binPath)) throw new Error(`CodeGraph archive did not contain bin/${executableName}`);
	chmodSync(binPath, 0o755);
	mkdirSync(join(installDir, ".provisioned"), { recursive: true });
	writeFileSync(join(installDir, ".provisioned", `codegraph-${version}.json`), `${JSON.stringify({ binPath, version })}\n`);
	return binPath;
}

function execFilePromise(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, [...args], (error) => {
			if (error === null) resolvePromise();
			else reject(error);
		});
	});
}

function defaultWorkerCliPath(): string {
	return fileURLToPath(import.meta.url);
}
