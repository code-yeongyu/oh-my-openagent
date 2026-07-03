import { diagnostic } from "./diagnostics.ts";
import { parseHookConfig } from "./schema.ts";
import type { HookDiagnostic, HookSourceMetadata, ParsedHookConfig } from "./types.ts";

export type HookConfigFileSystem = {
	readonly readTextFile: (path: string) => string | undefined;
};

export type HookConfigLoaderOptions = {
	readonly cwd: string;
	readonly agentDir: string;
	readonly fileSystem: HookConfigFileSystem;
	readonly globalSettingsHooks?: unknown;
	readonly projectSettingsHooks?: unknown;
	readonly globalHooksPath?: string;
	readonly projectHooksPath?: string;
	readonly globalHookSourcePaths?: readonly string[];
	readonly projectHookSourcePaths?: readonly string[];
	readonly preSessionHookSourcePaths?: readonly string[];
	readonly runtimeHookSourcePaths?: readonly string[];
};

type SourceScope = HookSourceMetadata["scope"];
type SourceTiming = HookSourceMetadata["discoveredAt"];

type InlineSource = {
	readonly kind: "inline";
	readonly hooks: unknown;
	readonly scope: SourceScope;
	readonly sourcePath: string;
	readonly discoveredAt: SourceTiming;
};

type FileSource = {
	readonly kind: "file";
	readonly scope: SourceScope;
	readonly sourcePath: string;
	readonly discoveredAt: SourceTiming;
};

type SourceCandidate = InlineSource | FileSource;

export function loadHookConfigSources(options: HookConfigLoaderOptions): ParsedHookConfig {
	const executableHandlers: ParsedHookConfig["executableHandlers"][number][] = [];
	const diagnostics: HookDiagnostic[] = [];
	let displayOrder = 0;

	for (const candidate of createSourceCandidates(options)) {
		const source: HookSourceMetadata = {
			discoveredAt: candidate.discoveredAt,
			displayOrder,
			scope: candidate.scope,
			sourcePath: candidate.sourcePath,
		};
		const loaded = loadCandidate(candidate, source, options.fileSystem);
		if (!loaded) {
			continue;
		}
		displayOrder += 1;
		executableHandlers.push(...loaded.executableHandlers);
		diagnostics.push(...loaded.diagnostics);
		if (source.discoveredAt === "runtime") {
			diagnostics.push(...runtimeSessionStartDiagnostics(loaded.executableHandlers, source));
		}
	}

	return { executableHandlers, diagnostics };
}

function createSourceCandidates(options: HookConfigLoaderOptions): SourceCandidate[] {
	const candidates: SourceCandidate[] = [];
	if (options.globalSettingsHooks !== undefined) {
		candidates.push({
			discoveredAt: "pre-session",
			hooks: options.globalSettingsHooks,
			kind: "inline",
			scope: "global",
			sourcePath: "<global-settings-hooks>",
		});
	}
	candidates.push(fileSource("global", options.globalHooksPath ?? `${options.agentDir}/hooks.json`, "pre-session"));
	candidates.push(...fileSources("global", options.globalHookSourcePaths, "pre-session"));
	if (options.projectSettingsHooks !== undefined) {
		candidates.push({
			discoveredAt: "pre-session",
			hooks: options.projectSettingsHooks,
			kind: "inline",
			scope: "project",
			sourcePath: "<project-settings-hooks>",
		});
	}
	candidates.push(
		fileSource("project", options.projectHooksPath ?? `${options.cwd}/.senpi/hooks.json`, "pre-session"),
	);
	candidates.push(...fileSources("project", options.projectHookSourcePaths, "pre-session"));
	candidates.push(...fileSources("plugin", options.preSessionHookSourcePaths, "pre-session"));
	candidates.push(...fileSources("runtime", options.runtimeHookSourcePaths, "runtime"));
	return candidates;
}

function fileSources(
	scope: SourceScope,
	paths: readonly string[] | undefined,
	discoveredAt: SourceTiming,
): SourceCandidate[] {
	if (!paths) {
		return [];
	}
	return paths.map((path) => fileSource(scope, path, discoveredAt));
}

function fileSource(scope: SourceScope, sourcePath: string, discoveredAt: SourceTiming): FileSource {
	return { discoveredAt, kind: "file", scope, sourcePath };
}

function loadCandidate(
	candidate: SourceCandidate,
	source: HookSourceMetadata,
	fileSystem: HookConfigFileSystem,
): ParsedHookConfig | undefined {
	if (candidate.kind === "inline") {
		return parseHookConfig({ hooks: candidate.hooks }, source);
	}

	const text = readSourceText(candidate.sourcePath, source, fileSystem);
	if (text === undefined) {
		return undefined;
	}
	if (typeof text !== "string") {
		return text;
	}

	try {
		const parsed: unknown = JSON.parse(text);
		return parseHookConfig(parsed, source);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown JSON parse failure.";
		return {
			diagnostics: [
				diagnostic(
					{
						code: "invalid_root",
						message: `Hook source JSON is malformed: ${message}`,
						path: "$",
					},
					source,
				),
			],
			executableHandlers: [],
		};
	}
}

function readSourceText(
	sourcePath: string,
	source: HookSourceMetadata,
	fileSystem: HookConfigFileSystem,
): string | undefined | ParsedHookConfig {
	try {
		return fileSystem.readTextFile(sourcePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown file read failure.";
		return {
			diagnostics: [
				diagnostic(
					{
						code: "invalid_root",
						message: `Hook source could not be read: ${message}`,
						path: "$",
					},
					source,
				),
			],
			executableHandlers: [],
		};
	}
}

function runtimeSessionStartDiagnostics(
	handlers: ParsedHookConfig["executableHandlers"],
	source: HookSourceMetadata,
): HookDiagnostic[] {
	if (!handlers.some((handler) => handler.event === "SessionStart")) {
		return [];
	}
	return [
		diagnostic(
			{
				code: "unsupported_event",
				event: "SessionStart",
				message: "Runtime SessionStart hooks are loaded for reload or the next session only.",
				path: "hooks.SessionStart",
				severity: "warning",
			},
			source,
		),
	];
}
