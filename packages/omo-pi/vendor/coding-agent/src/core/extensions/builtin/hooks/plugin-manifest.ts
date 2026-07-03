import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { diagnostic } from "./diagnostics.ts";
import type { HookDiagnostic, HookDiscoveryTiming, HookSourceMetadata } from "./types.ts";

export const MANIFEST_PATH = ".codex-plugin/plugin.json";
export const DEFAULT_HOOK_PATH = "hooks/hooks.json";

export type PluginHookEnv = {
	readonly PLUGIN_ROOT: string;
	readonly PLUGIN_DATA: string;
	readonly CLAUDE_PLUGIN_ROOT: string;
	readonly CLAUDE_PLUGIN_DATA: string;
};

export type PluginHookSourceMetadata = HookSourceMetadata & {
	readonly pluginEnv: PluginHookEnv;
};

export type LoadPluginHookManifestOptions = {
	readonly pluginRoot: string;
	readonly displayOrder: number;
	readonly discoveredAt?: HookDiscoveryTiming;
	readonly dataRoot?: string;
	readonly includeDefaultHooks?: boolean;
};

export function buildPluginEnv(pluginRoot: string, dataRoot: string | undefined): PluginHookEnv {
	const pluginData = dataRoot === undefined ? join(pluginRoot, ".plugin-data") : resolve(dataRoot);
	return {
		CLAUDE_PLUGIN_DATA: pluginData,
		CLAUDE_PLUGIN_ROOT: pluginRoot,
		PLUGIN_DATA: pluginData,
		PLUGIN_ROOT: pluginRoot,
	};
}

export function pluginSource(input: {
	readonly discoveredAt: HookDiscoveryTiming;
	readonly displayOrder: number;
	readonly env: PluginHookEnv;
	readonly manifestPath: string;
	readonly pluginRoot: string;
	readonly sourcePath: string;
}): PluginHookSourceMetadata {
	return {
		discoveredAt: input.discoveredAt,
		displayOrder: input.displayOrder,
		manifestPath: input.manifestPath,
		pluginEnv: input.env,
		pluginRoot: input.pluginRoot,
		scope: "plugin",
		sourcePath: input.sourcePath,
	};
}

export function sourceForPath(
	options: LoadPluginHookManifestOptions,
	env: PluginHookEnv,
	sourcePath: string,
): PluginHookSourceMetadata {
	const pluginRoot = resolve(options.pluginRoot);
	return pluginSource({
		discoveredAt: options.discoveredAt ?? "pre-session",
		displayOrder: options.displayOrder,
		env,
		manifestPath: join(pluginRoot, MANIFEST_PATH),
		pluginRoot,
		sourcePath,
	});
}

export function resolveContainedPath(
	pluginRootInput: string,
	manifestPathInput: string,
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string } {
	const pluginRoot = resolve(pluginRootInput);
	const normalizedInput = manifestPathInput.replaceAll("\\", "/").replace(/^\.\//, "");
	const resolvedPath = isAbsolute(normalizedInput) ? resolve(normalizedInput) : resolve(pluginRoot, normalizedInput);
	if (!isContained(pluginRoot, resolvedPath)) {
		return {
			message: `Plugin hook path is outside plugin root: ${manifestPathInput}`,
			ok: false,
		};
	}
	if (fileExists(resolvedPath)) {
		const realPath = realpathSync(resolvedPath);
		if (!isContained(realpathSync(pluginRoot), realPath)) {
			return {
				message: `Plugin hook path is outside plugin root: ${manifestPathInput}`,
				ok: false,
			};
		}
	}
	return { ok: true, path: resolvedPath };
}

export function readJsonFile(
	path: string,
	manifestPath: string,
	source: PluginHookSourceMetadata,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly diagnostic: HookDiagnostic } {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
		return { ok: true, value };
	} catch (error) {
		if (error instanceof Error) {
			return {
				diagnostic: diagnostic(
					{ code: "invalid_root", message: `Could not read plugin hook JSON: ${error.message}`, path: "$" },
					{ ...source, manifestPath },
				),
				ok: false,
			};
		}
		throw error;
	}
}

export function fileExists(path: string): boolean {
	return existsSync(path) && statSync(path).isFile();
}

export function directoryExists(path: string): boolean {
	return existsSync(path) && statSync(path).isDirectory();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContained(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
