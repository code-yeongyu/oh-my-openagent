import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Project markers that authorize probing a set of repo-local binary directories.
 *
 * A local bin directory is only trusted when the sibling marker proves the directory
 * belongs to a project of that ecosystem. An unmarked `node_modules/.bin` is ignored so
 * that a stray directory cannot inject an executable into the resolution order.
 */
interface LocalBinRule {
	readonly markers: readonly string[];
	readonly binDirs: readonly string[];
}

const LOCAL_BIN_RULES: readonly LocalBinRule[] = [
	{
		markers: ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
		binDirs: [join("node_modules", ".bin")],
	},
	{
		markers: [
			"pyproject.toml",
			"ty.toml",
			"requirements.txt",
			"setup.py",
			"setup.cfg",
			"Pipfile",
			"pyrightconfig.json",
			"ruff.toml",
			".ruff.toml",
		],
		binDirs: [
			join(".venv", "bin"),
			join(".venv", "Scripts"),
			join("venv", "bin"),
			join("venv", "Scripts"),
			join(".env", "bin"),
			join(".env", "Scripts"),
		],
	},
	{
		markers: ["Gemfile", "Gemfile.lock"],
		binDirs: [join("vendor", "bundle", "bin"), "bin"],
	},
	{
		markers: ["go.mod", "go.sum", "go.work"],
		binDirs: ["bin"],
	},
];

export interface ResolveServerBinaryOptions {
	/**
	 * Upward walk boundary. The walk never ascends above this directory, which lets callers
	 * confine resolution to a trusted request cwd.
	 */
	readonly stopAt?: string;
	readonly platform?: NodeJS.Platform;
	readonly pathExt?: string;
	readonly pathEnv?: string;
}

const resolutionCache = new Map<string, string | null>();
let probeCount = 0;

/** Test seam: clears the per-process resolution cache. */
export function __resetServerBinaryResolutionCacheForTests(): void {
	resolutionCache.clear();
	probeCount = 0;
}

/** Test seam: counts filesystem probes so cache hits are observable. */
export function __serverBinaryProbeCountForTests(): number {
	return probeCount;
}

function probe(path: string): boolean {
	probeCount += 1;
	return existsSync(path);
}

function executableSuffixes(platform: NodeJS.Platform, pathExt: string | undefined): readonly string[] {
	if (platform !== "win32") return [""];
	const configured = pathExt ?? process.env["PATHEXT"] ?? "";
	// PATHEXT is conventionally uppercase, but the on-disk shims npm/bun write are lowercase.
	// Probe lowercase first so the returned path matches the real filename on case-sensitive
	// filesystems; the resolved path is spawned, so its casing has to be exact.
	const systemExts = configured
		.split(";")
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.toLowerCase());
	return [...new Set(["", ...systemExts, ".exe", ".cmd", ".bat", ".ps1"])];
}

function probeWithSuffixes(directory: string, command: string, suffixes: readonly string[]): string | null {
	for (const suffix of suffixes) {
		const candidate = join(directory, command + suffix);
		if (probe(candidate)) return candidate;
	}
	return null;
}

function resolveLocal(
	command: string,
	workingDirectory: string,
	suffixes: readonly string[],
	stopAt: string | undefined,
): string | null {
	const boundary = stopAt === undefined ? undefined : resolve(stopAt);
	let current = resolve(workingDirectory);

	while (true) {
		for (const rule of LOCAL_BIN_RULES) {
			if (!rule.markers.some((marker) => probe(join(current, marker)))) continue;
			for (const binDir of rule.binDirs) {
				const found = probeWithSuffixes(join(current, binDir), command, suffixes);
				if (found !== null) return found;
			}
		}

		// A repository root ends the walk: tooling above it belongs to a different project.
		if (probe(join(current, ".git"))) return null;
		if (boundary !== undefined && current === boundary) return null;

		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function resolveFromPath(
	command: string,
	suffixes: readonly string[],
	platform: NodeJS.Platform,
	pathEnvOverride: string | undefined,
): string | null {
	let pathEnv = pathEnvOverride ?? process.env["PATH"] ?? "";
	if (platform === "win32" && !pathEnv) {
		pathEnv = process.env["Path"] ?? "";
	}

	for (const entry of pathEnv.split(delimiter)) {
		if (entry.length === 0) continue;
		const found = probeWithSuffixes(entry, command, suffixes);
		if (found !== null) return found;
	}
	return null;
}

/**
 * Resolves the absolute path of an LSP server binary.
 *
 * Probing order:
 * 1. a path-shaped command is validated as-is,
 * 2. marker-gated repo-local bin directories, walking up from `workingDirectory`,
 * 3. `PATH` (including Windows executable suffixes),
 * 4. `null` when nothing matches.
 *
 * Results are cached per process, keyed by working directory and command.
 */
export function resolveServerBinary(
	command: string[],
	workingDirectory?: string,
	options: ResolveServerBinaryOptions = {},
): string | null {
	if (command.length === 0) return null;
	const [cmd] = command;
	if (cmd === undefined || cmd.length === 0) return null;

	const platform = options.platform ?? process.platform;
	const suffixes = executableSuffixes(platform, options.pathExt);

	if (cmd.includes("/") || cmd.includes("\\")) {
		const explicit = isAbsolute(cmd) ? cmd : resolve(workingDirectory ?? process.cwd(), cmd);
		return probe(explicit) ? explicit : null;
	}

	const cacheKey = JSON.stringify([
		workingDirectory ?? "",
		cmd,
		platform,
		options.stopAt ?? "",
		options.pathExt ?? "",
		options.pathEnv ?? process.env["PATH"] ?? "",
	]);
	const cached = resolutionCache.get(cacheKey);
	if (cached !== undefined) return cached;

	let resolved: string | null = null;
	if (workingDirectory !== undefined && workingDirectory.length > 0) {
		resolved = resolveLocal(cmd, workingDirectory, suffixes, options.stopAt);
	}
	resolved ??= resolveFromPath(cmd, suffixes, platform, options.pathEnv);
	// A configured server may be launched through the interpreter itself, e.g.
	// { command: ["node", "my-ls.js"] }. isServerInstalled() has always treated bare `node`
	// as available regardless of PATH, so keep those servers selectable instead of
	// regressing them into a not_installed result. The name is returned unresolved so the
	// spawn still goes through `node`; rewriting it to process.execPath would silently
	// substitute a different interpreter (bun) for the one the config asked for.
	if (resolved === null && cmd === "node") resolved = cmd;

	resolutionCache.set(cacheKey, resolved);
	return resolved;
}

/**
 * Reports whether an LSP server binary is available.
 *
 * Retained for existing consumers; `resolveServerBinary` is the richer entry point.
 */
export function isServerInstalled(
	command: string[],
	workingDirectory?: string,
	options: ResolveServerBinaryOptions = {},
): boolean {
	if (command.length === 0) return false;
	return resolveServerBinary(command, workingDirectory, options) !== null;
}
