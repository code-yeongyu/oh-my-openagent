import { accessSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export type CodegraphCommandSource = "bundled" | "env" | "path" | "provisioned";

export interface CodegraphCommandResolution {
	readonly argsPrefix: readonly string[];
	readonly command: string;
	readonly exists: boolean;
	readonly source: CodegraphCommandSource;
}

export interface ResolveCodegraphCommandOptions {
	readonly env?: Record<string, string | undefined>;
	readonly fileExists?: (filePath: string) => boolean;
	readonly homeDir?: string;
	readonly nodeRuntime?: () => string | null;
	readonly provisioned?: () => string | null;
	readonly requireResolve?: (specifier: string) => string;
	readonly which?: (commandName: string) => string | null;
}

const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
const CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN";
const requireFromHere = createRequire(import.meta.url);

function defaultRequireResolve(specifier: string): string {
	return requireFromHere.resolve(specifier);
}

function defaultNodeRuntime(): string | null {
	return process.execPath || null;
}

function defaultProvisionedBin(homeDir: string, fileExists: (filePath: string) => boolean): string | null {
	const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
	const candidates = [
		join(homeDir, ".omo", "codegraph", "bin", binaryName),
		join(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName),
	];
	return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function resolveBundledShim(
	requireResolve: (specifier: string) => string,
	fileExists: (filePath: string) => boolean,
): string | null {
	try {
		const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
		const packageRoot = dirname(packageJson);
		const candidates = [join(packageRoot, "bin", "codegraph.js"), join(packageRoot, "npm-shim.js")];
		return candidates.find((candidate) => fileExists(candidate)) ?? null;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function isUnsafeCommandName(commandName: string): boolean {
	if (commandName.includes("/") || commandName.includes("\\")) return true;
	if (commandName === "." || commandName === ".." || commandName.includes("..")) return true;
	if (/^[a-zA-Z]:/.test(commandName)) return true;
	return commandName.includes("\0");
}

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return true;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function resolvePathValue(env: Record<string, string | undefined>): string | undefined {
	if (process.platform === "win32") return env["Path"] ?? env["PATH"];
	return env["PATH"];
}

function getWindowsCandidates(commandName: string): readonly string[] {
	if (process.platform !== "win32") return [commandName];
	if (/\.[^\\/]+$/.test(commandName)) return [commandName];
	return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`];
}

function findOnPath(commandName: string, env: Record<string, string | undefined>): string | null {
	if (commandName.length === 0 || isUnsafeCommandName(commandName)) return null;

	const pathValue = resolvePathValue(env);
	if (pathValue === undefined || pathValue.length === 0) return null;

	const candidateNames = getWindowsCandidates(commandName);
	const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0);
	for (const pathEntry of pathEntries) {
		for (const candidateName of candidateNames) {
			const candidatePath = join(pathEntry, candidateName);
			if (isExecutable(candidatePath)) return candidatePath;
		}
	}

	return null;
}

export function resolveCodegraphCommand(
	options: ResolveCodegraphCommandOptions = {},
): CodegraphCommandResolution {
	const env = options.env ?? process.env;
	const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim();
	if (configuredBin !== undefined && configuredBin.length > 0) {
		return { argsPrefix: [], command: configuredBin, exists: true, source: "env" };
	}

	const fileExists = options.fileExists ?? existsSync;
	const nodeRuntime = options.nodeRuntime ?? defaultNodeRuntime;
	const bundled = resolveBundledShim(options.requireResolve ?? defaultRequireResolve, fileExists);
	const runtime = nodeRuntime();
	if (bundled !== null && runtime !== null) {
		return { argsPrefix: [bundled], command: runtime, exists: true, source: "bundled" };
	}

	const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir(), fileExists);
	if (provisioned !== null && fileExists(provisioned)) {
		return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" };
	}

	const pathCommand = (options.which ?? ((commandName) => findOnPath(commandName, env)))("codegraph");
	return {
		argsPrefix: [],
		command: pathCommand ?? "codegraph",
		exists: pathCommand !== null,
		source: "path",
	};
}
