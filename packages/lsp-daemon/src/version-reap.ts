import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { isProcessAlive, readLockPid } from "./lock.js";
import { type DaemonOwner, readDaemonOwner } from "./ownership.js";
import { type DaemonPaths, daemonPaths, OMO_LSP_DAEMON_DIR } from "./paths.js";

const TERM_GRACE_MS = 5_000;
const KILL_GRACE_MS = 1_000;
const VERSION_ENTRY_PATTERN = /^v([A-Za-z0-9][A-Za-z0-9._+-]{0,127})$/;

export interface DaemonCliAttestationDeps {
	readonly readProcFile?: (path: string) => Promise<Buffer>;
	readonly executeForStdout?: (file: string, args: readonly string[]) => Promise<string | null>;
}

export interface ReapStaleDaemonVersionsDeps {
	readonly platform?: NodeJS.Platform;
	readonly isAlive?: (pid: number) => boolean;
	readonly attest?: (pid: number, platform: NodeJS.Platform) => Promise<boolean>;
	readonly sendSignal?: (pid: number, signal: NodeJS.Signals) => boolean;
	readonly waitForExit?: (pid: number, timeoutMs: number) => Promise<boolean>;
	readonly removeDir?: (path: string) => Promise<void>;
	readonly readOwner?: (paths: DaemonPaths) => DaemonOwner | null;
	readonly log?: (message: string) => void;
	readonly termGraceMs?: number;
	readonly killGraceMs?: number;
}

export type VersionReapStatus = "terminated" | "removed" | "deferred" | "spared";

export interface VersionReapResult {
	readonly version: string;
	readonly status: VersionReapStatus;
	readonly reason: string;
}

export async function attestDaemonCliProcess(
	pid: number,
	platform: NodeJS.Platform,
	deps: DaemonCliAttestationDeps = {},
): Promise<boolean> {
	if (platform === "win32") return false;
	if (platform === "linux") {
		const readProcFile = deps.readProcFile ?? defaultReadProcFile;
		const cmdline = await readProcFile(`/proc/${pid}/cmdline`).catch(() => null);
		if (cmdline === null) return false;
		return isNodeCliDaemonArgv(splitCmdline(cmdline));
	}
	const executeForStdout = deps.executeForStdout ?? defaultExecuteForStdout;
	const command = await executeForStdout("/bin/ps", ["-p", String(pid), "-o", "command="]);
	if (command === null) return false;
	return isNodeCliDaemonCommand(command.trim());
}

export async function reapStaleDaemonVersions(
	ownPaths: DaemonPaths,
	deps: ReapStaleDaemonVersionsDeps = {},
): Promise<readonly VersionReapResult[]> {
	const baseDir = dirname(ownPaths.dir);
	const platform = deps.platform ?? process.platform;
	const isAlive = deps.isAlive ?? isProcessAlive;
	const attest = deps.attest ?? ((pid: number) => attestDaemonCliProcess(pid, platform));
	const sendSignal = deps.sendSignal ?? defaultSendSignal;
	const waitForExit = deps.waitForExit ?? defaultWaitForExit;
	const removeDir = deps.removeDir ?? ((path: string) => rm(path, { recursive: true, force: true }));
	const readOwner = deps.readOwner ?? readDaemonOwner;
	const log = deps.log ?? defaultLog;
	const termGraceMs = deps.termGraceMs ?? TERM_GRACE_MS;
	const killGraceMs = deps.killGraceMs ?? KILL_GRACE_MS;

	const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
	const results: VersionReapResult[] = [];
	for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
		if (entry.name === `v${ownPaths.version}`) continue;
		const version = parseVersionEntry(entry.name);
		if (version === null || !entry.isDirectory()) continue;
		const versionDir = join(baseDir, entry.name);
		const siblingPaths = daemonPaths({ [OMO_LSP_DAEMON_DIR]: baseDir }, { cliPath: ownPaths.cliPath, version });
		results.push(
			await reapOneVersion({
				version,
				versionDir,
				siblingPaths,
				platform,
				isAlive,
				attest,
				sendSignal,
				waitForExit,
				removeDir,
				readOwner,
				log,
				termGraceMs,
				killGraceMs,
			}),
		);
	}
	return results;
}

interface ReapOneContext {
	readonly version: string;
	readonly versionDir: string;
	readonly siblingPaths: DaemonPaths;
	readonly platform: NodeJS.Platform;
	readonly isAlive: (pid: number) => boolean;
	readonly attest: (pid: number, platform: NodeJS.Platform) => Promise<boolean>;
	readonly sendSignal: (pid: number, signal: NodeJS.Signals) => boolean;
	readonly waitForExit: (pid: number, timeoutMs: number) => Promise<boolean>;
	readonly removeDir: (path: string) => Promise<void>;
	readonly readOwner: (paths: DaemonPaths) => DaemonOwner | null;
	readonly log: (message: string) => void;
	readonly termGraceMs: number;
	readonly killGraceMs: number;
}

async function reapOneVersion(context: ReapOneContext): Promise<VersionReapResult> {
	const { version, versionDir } = context;
	const owner = context.readOwner(context.siblingPaths);
	if (!owner) {
		const lockPid = readLockPid(join(versionDir, "daemon.lock"));
		if (lockPid !== null && context.isAlive(lockPid)) {
			context.log(
				`reap: sparing v${version}: owner metadata missing but daemon.lock is held by live pid ${lockPid}`,
			);
			return { version, status: "spared", reason: `owner metadata missing but lock held by live pid ${lockPid}` };
		}
		await context.removeDir(versionDir);
		return { version, status: "removed", reason: "removed stale version dir without readable owner metadata" };
	}

	if (!context.isAlive(owner.pid)) {
		await context.removeDir(versionDir);
		return { version, status: "removed", reason: `removed stale version dir for dead owner pid ${owner.pid}` };
	}

	if (context.platform === "win32") {
		context.log(`reap: deferring v${version}: Windows cannot prove pid ownership safely (named-pipe policy)`);
		return {
			version,
			status: "deferred",
			reason: "Windows cannot prove pid ownership safely; named-pipe reap deferred",
		};
	}

	if (!(await context.attest(owner.pid, context.platform))) {
		context.log(
			`reap: sparing v${version}: pid ${owner.pid} is alive but cmdline attestation failed (possible recycled pid)`,
		);
		return {
			version,
			status: "spared",
			reason: `pid ${owner.pid} attestation failed; possible recycled pid`,
		};
	}

	return await terminateAttestedOwner(context, owner.pid);
}

async function terminateAttestedOwner(context: ReapOneContext, pid: number): Promise<VersionReapResult> {
	const { version, versionDir } = context;
	if (!context.sendSignal(pid, "SIGTERM")) {
		await context.removeDir(versionDir);
		return {
			version,
			status: "removed",
			reason: `owner pid ${pid} exited before SIGTERM; removed stale version dir`,
		};
	}
	if (await context.waitForExit(pid, context.termGraceMs)) {
		await context.removeDir(versionDir);
		return { version, status: "terminated", reason: `terminated attested older daemon pid ${pid} with SIGTERM` };
	}
	context.log(`reap: v${version} pid ${pid} survived SIGTERM; escalating to SIGKILL`);
	if (!context.sendSignal(pid, "SIGKILL") || !(await context.waitForExit(pid, context.killGraceMs))) {
		context.log(`reap: deferring v${version}: pid ${pid} survived SIGKILL`);
		return { version, status: "deferred", reason: `attested daemon pid ${pid} survived SIGKILL; dir kept` };
	}
	await context.removeDir(versionDir);
	return {
		version,
		status: "terminated",
		reason: `terminated attested older daemon pid ${pid} after SIGKILL escalation`,
	};
}

function parseVersionEntry(entryName: string): string | null {
	const match = VERSION_ENTRY_PATTERN.exec(entryName);
	return match?.[1] ?? null;
}

function splitCmdline(buffer: Buffer): readonly string[] {
	return buffer
		.toString("utf8")
		.split("\u0000")
		.filter((value) => value.length > 0);
}

function isNodeCliDaemonArgv(argv: readonly string[]): boolean {
	if (argv.length < 2 || !argv.includes("daemon")) return false;
	const executable = basename(argv[0] ?? "");
	if (!/^node(?:\.exe)?$/i.test(executable)) return false;
	return argv.some((value) => value === "cli.js" || value.endsWith("/cli.js") || value.endsWith("\\cli.js"));
}

function isNodeCliDaemonCommand(command: string): boolean {
	return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /\bdaemon\b/.test(command);
}

function defaultReadProcFile(path: string): Promise<Buffer> {
	return readFile(path);
}

function defaultExecuteForStdout(file: string, args: readonly string[]): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		execFile(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1_000 }, (error, stdout) => {
			if (error !== null) {
				resolve(null);
				return;
			}
			resolve(stdout);
		});
	});
}

function defaultSendSignal(pid: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false;
	}
}

async function defaultWaitForExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (!isProcessAlive(pid)) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function defaultLog(message: string): void {
	process.stderr.write(`[lsp-daemon] ${message}\n`);
}
