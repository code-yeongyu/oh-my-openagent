import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSpawnCommand, killProcessTree } from "./process.js";
import { resolveServerBinary } from "./server-installation.js";

export type BunProjectCommand = "check" | "lint" | "format";

export interface BunProjectChecksOptions {
	readonly resolveBun?: (cwd: string) => string | null;
	readonly homeDir?: string;
}

export interface BunCommandRun {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

const BUN_LOCKFILES = ["bun.lock", "bun.lockb", "bunfig.toml"];
const RUNNABLE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".cts", ".cjs", ".js", ".mjs", ".mts"];
const BIN_SUFFIXES = process.platform === "win32" ? [".exe", ".bunx", ".cmd", ""] : [""];
const PROBE_TIMEOUT_MS = 10_000;
const UNFORMATTED_PROBE = "const a=1\n";

const probeCache = new Map<string, Promise<boolean>>();

export function __resetBunCommandProbeCacheForTests(): void {
	probeCache.clear();
}

// The walk stops at the repository boundary, and never reads the home directory or anything above
// it, so a stray file there does not turn every directory outside a repository into a Bun project.
export function findBunProjectRoot(start: string, home: string = homedir()): string | undefined {
	const stopAt = resolve(home);
	let dir = resolve(start);
	for (;;) {
		if (dir === stopAt) return undefined;
		if (BUN_LOCKFILES.some((name) => existsSync(join(dir, name)))) return dir;
		if (packageManagerIsBun(join(dir, "package.json"))) return dir;
		if (existsSync(join(dir, ".git"))) return undefined;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function packageManagerIsBun(packageJsonPath: string): boolean {
	const manifest = readJsonObject(packageJsonPath);
	const packageManager = manifest?.["packageManager"];
	return typeof packageManager === "string" && packageManager.startsWith("bun@");
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

// Bun still runs a project's own script (nearest package.json) named check/lint/format, and for
// lint/format also what `bun <name>` would run as a file: `name` or `name.<ext>`, a `name/` directory
// with a package.json or an index file, or an executable a package installed in node_modules/.bin.
export function projectShadowsBunCommand(command: BunProjectCommand, cwd: string): boolean {
	const packageJsonDir = nearestPackageJsonDir(cwd);
	if (packageJsonDir !== undefined) {
		const scripts = readJsonObject(join(packageJsonDir, "package.json"))?.["scripts"];
		if (scripts !== null && typeof scripts === "object" && typeof (scripts as Record<string, unknown>)[command] === "string") {
			return true;
		}
	}
	if (command === "check") return false;
	const base = join(cwd, command);
	if (isFile(base) || RUNNABLE_EXTENSIONS.some((extension) => isFile(`${base}${extension}`))) return true;
	if (isDirectory(base) && (isFile(join(base, "package.json")) || RUNNABLE_EXTENSIONS.some((extension) => isFile(join(base, `index${extension}`))))) {
		return true;
	}
	let dir = resolve(cwd);
	for (;;) {
		if (BIN_SUFFIXES.some((suffix) => existsSync(join(dir, "node_modules", ".bin", `${command}${suffix}`)))) return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

function nearestPackageJsonDir(start: string): string | undefined {
	let dir = resolve(start);
	for (;;) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function binaryIdentity(bunPath: string): string {
	try {
		const stats = statSync(bunPath);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "missing";
	}
}

// Feature detection by exit code, in an empty directory: next to a same-named project script an
// older Bun runs that script for `--help` and exits 0. Asynchronous, so a probe never blocks the
// event loop; cached per binary and command, and re-probed when the binary file changes. Only a
// definite answer is kept: a probe that timed out or could not spawn is retried on the next call.
export function bunHasCommand(
	bunPath: string,
	command: BunProjectCommand,
	timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
	const key = `${bunPath}\0${binaryIdentity(bunPath)}\0${command}`;
	const cached = probeCache.get(key);
	if (cached !== undefined) return cached;
	const probe = probeOnce(bunPath, command, timeoutMs).then((answer) => {
		if (answer === undefined) probeCache.delete(key);
		return answer === true;
	});
	probeCache.set(key, probe);
	return probe;
}

// `format` must also prove it rewrites a file in place: a bun whose `format --write` printed to stdout
// instead, or ignored the flag, would leave every file unchanged and silently stop formatting.
async function probeOnce(bunPath: string, command: BunProjectCommand, timeoutMs: number): Promise<boolean | undefined> {
	const emptyDir = mkdtempSync(join(tmpdir(), "omo-bun-probe-"));
	const timeout = AbortSignal.timeout(timeoutMs);
	try {
		const help = await runBunCommand(bunPath, [command, "--help"], emptyDir, timeout);
		if (help.exitCode === null) return undefined;
		if (help.exitCode !== 0) return false;
		if (command !== "format") return true;
		const probeFile = join(emptyDir, "probe.ts");
		writeFileSync(probeFile, UNFORMATTED_PROBE);
		const write = await runBunCommand(bunPath, ["format", "--write", "probe.ts"], emptyDir, timeout);
		if (write.exitCode === null) return undefined;
		return write.exitCode === 0 && readFileSync(probeFile, "utf8") !== UNFORMATTED_PROBE;
	} catch {
		return undefined;
	} finally {
		rmSync(emptyDir, { recursive: true, force: true });
	}
}

export async function resolveBunProjectCommand(
	command: BunProjectCommand,
	cwd: string,
	options: BunProjectChecksOptions = {},
): Promise<string | undefined> {
	if (findBunProjectRoot(cwd, options.homeDir) === undefined) return undefined;
	if (projectShadowsBunCommand(command, cwd)) return undefined;
	const bunPath = (options.resolveBun ?? defaultResolveBun)(cwd);
	if (!bunPath) return undefined;
	return (await bunHasCommand(bunPath, command)) ? bunPath : undefined;
}

function defaultResolveBun(cwd: string): string | null {
	return resolveServerBinary(["bun"], cwd);
}

export function runBunCommand(bunPath: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<BunCommandRun> {
	signal?.throwIfAborted();
	const prepared = createSpawnCommand([bunPath, ...args]);
	return new Promise((resolvePromise, reject) => {
		const child = spawn(prepared.command, prepared.args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: prepared.shell,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		// A wrapper (a .cmd shim through cmd.exe on Windows, a non-exec sh script elsewhere) leaves bun holding
		// the pipes when only the direct child dies, so an aborted probe would outlive its timeout. Kill the
		// whole tree: taskkill /T on Windows, the process group (hence `detached`) elsewhere.
		const onAbort = () => killProcessTree(child, "SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", (error) => {
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		child.once("close", (exitCode) => {
			signal?.removeEventListener("abort", onAbort);
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}
