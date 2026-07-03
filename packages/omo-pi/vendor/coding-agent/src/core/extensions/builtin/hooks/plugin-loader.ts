import { join, resolve } from "node:path";
import { diagnostic } from "./diagnostics.ts";
import {
	buildPluginEnv,
	DEFAULT_HOOK_PATH,
	directoryExists,
	fileExists,
	isRecord,
	type LoadPluginHookManifestOptions,
	MANIFEST_PATH,
	type PluginHookEnv,
	type PluginHookSourceMetadata,
	pluginSource,
	readJsonFile,
	resolveContainedPath,
	sourceForPath,
} from "./plugin-manifest.ts";
import { validateHookHandlerSafety } from "./safety.ts";
import { parseHookConfig } from "./schema.ts";
import type { ExecutableHookHandler, HookDiagnostic, ParsedHookConfig } from "./types.ts";

export type { LoadPluginHookManifestOptions, PluginHookEnv, PluginHookSourceMetadata } from "./plugin-manifest.ts";

export type PluginHookManifestLoadResult = {
	readonly sources: readonly PluginHookSourceMetadata[];
	readonly parsed: ParsedHookConfig;
	readonly diagnostics: readonly HookDiagnostic[];
};

type HookSourceDraft = {
	readonly key: string;
	readonly config: unknown;
};

export function loadPluginHookManifest(options: LoadPluginHookManifestOptions): PluginHookManifestLoadResult {
	const pluginRoot = resolve(options.pluginRoot);
	const manifestPath = join(pluginRoot, MANIFEST_PATH);
	const env = buildPluginEnv(pluginRoot, options.dataRoot);
	const discoveredAt = options.discoveredAt ?? "pre-session";
	const diagnostics: HookDiagnostic[] = [];
	const drafts: HookSourceDraft[] = [];

	if (!directoryExists(pluginRoot)) {
		const source = pluginSource({
			discoveredAt,
			displayOrder: options.displayOrder,
			env,
			manifestPath,
			pluginRoot,
			sourcePath: manifestPath,
		});
		diagnostics.push(
			diagnostic(
				{ code: "invalid_root", message: `Plugin root does not exist: ${pluginRoot}`, path: "$.pluginRoot" },
				source,
			),
		);
		return emptyResult(diagnostics);
	}

	if (fileExists(manifestPath)) {
		const manifest = readJsonFile(manifestPath, manifestPath, sourceForPath(options, env, manifestPath));
		if (manifest.ok) {
			drafts.push(...readManifestHookDrafts(manifest.value, options, env, manifestPath, diagnostics));
		} else {
			diagnostics.push(manifest.diagnostic);
		}
	}

	const defaultPath = resolveContainedPath(pluginRoot, DEFAULT_HOOK_PATH);
	if (options.includeDefaultHooks !== false && defaultPath.ok && fileExists(defaultPath.path)) {
		const source = sourceForPath(options, env, defaultPath.path);
		const config = readJsonFile(defaultPath.path, manifestPath, source);
		if (config.ok) {
			drafts.push({ config: config.value, key: defaultPath.path });
		} else {
			diagnostics.push(config.diagnostic);
		}
	}

	return parseDrafts(drafts, options, env, manifestPath, diagnostics);
}

export function selectHookCommandForPlatform(
	handler: ExecutableHookHandler,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "win32" && handler.config.commandWindows !== undefined) {
		return handler.config.commandWindows;
	}
	return handler.config.command;
}

function readManifestHookDrafts(
	manifest: unknown,
	options: LoadPluginHookManifestOptions,
	env: PluginHookEnv,
	manifestPath: string,
	diagnostics: HookDiagnostic[],
): HookSourceDraft[] {
	if (!isRecord(manifest)) {
		diagnostics.push(
			diagnostic(
				{ code: "invalid_root", message: "Plugin manifest must be an object.", path: "$" },
				sourceForPath(options, env, manifestPath),
			),
		);
		return [];
	}

	const hooks = manifest.hooks;
	if (hooks === undefined) {
		return [];
	}
	return normalizeHookDrafts(hooks, "$.hooks", options, env, manifestPath, diagnostics);
}

function normalizeHookDrafts(
	value: unknown,
	path: string,
	options: LoadPluginHookManifestOptions,
	env: PluginHookEnv,
	manifestPath: string,
	diagnostics: HookDiagnostic[],
): HookSourceDraft[] {
	if (typeof value === "string") {
		const resolved = resolveContainedPath(options.pluginRoot, value);
		if (!resolved.ok) {
			diagnostics.push(
				diagnostic(
					{ code: "invalid_root", message: resolved.message, path },
					sourceForPath(options, env, manifestPath),
				),
			);
			return [];
		}
		if (!fileExists(resolved.path)) {
			diagnostics.push(
				diagnostic(
					{ code: "invalid_root", message: `Plugin hook file does not exist: ${resolved.path}`, path },
					sourceForPath(options, env, resolved.path),
				),
			);
			return [];
		}
		const source = sourceForPath(options, env, resolved.path);
		const parsed = readJsonFile(resolved.path, manifestPath, source);
		if (parsed.ok) {
			return [{ config: parsed.value, key: resolved.path }];
		}
		diagnostics.push(parsed.diagnostic);
		return [];
	}

	if (Array.isArray(value)) {
		const drafts: HookSourceDraft[] = [];
		for (const [index, item] of value.entries()) {
			drafts.push(...normalizeHookDrafts(item, `${path}[${index}]`, options, env, manifestPath, diagnostics));
		}
		return drafts;
	}

	if (isRecord(value)) {
		return [{ config: value, key: `${manifestPath}#${inlineKeyPath(path)}` }];
	}

	diagnostics.push(
		diagnostic(
			{ code: "invalid_root", message: "Plugin manifest hooks must be a path or hook object.", path },
			sourceForPath(options, env, manifestPath),
		),
	);
	return [];
}

function parseDrafts(
	drafts: readonly HookSourceDraft[],
	options: LoadPluginHookManifestOptions,
	env: PluginHookEnv,
	manifestPath: string,
	diagnostics: HookDiagnostic[],
): PluginHookManifestLoadResult {
	const sources: PluginHookSourceMetadata[] = [];
	const executableHandlers: ExecutableHookHandler[] = [];
	const parseDiagnostics: HookDiagnostic[] = [];

	for (const [index, draft] of drafts.entries()) {
		const source = pluginSource({
			discoveredAt: options.discoveredAt ?? "pre-session",
			displayOrder: options.displayOrder + index,
			env,
			manifestPath,
			pluginRoot: resolve(options.pluginRoot),
			sourcePath: draft.key,
		});
		sources.push(source);
		const parsed = parseHookConfig(draft.config, source);
		for (const handler of parsed.executableHandlers) {
			const safetyDiagnostics = validateHookHandlerSafety(handler);
			if (safetyDiagnostics.length === 0) {
				executableHandlers.push(handler);
			} else {
				parseDiagnostics.push(...safetyDiagnostics);
			}
		}
		parseDiagnostics.push(...parsed.diagnostics);
	}

	return {
		diagnostics: [...diagnostics, ...parseDiagnostics],
		parsed: { diagnostics: parseDiagnostics, executableHandlers },
		sources,
	};
}

function emptyResult(diagnostics: readonly HookDiagnostic[]): PluginHookManifestLoadResult {
	return {
		diagnostics,
		parsed: { diagnostics, executableHandlers: [] },
		sources: [],
	};
}

function inlineKeyPath(path: string): string {
	return path.replace(/^\$\.?/, "");
}
