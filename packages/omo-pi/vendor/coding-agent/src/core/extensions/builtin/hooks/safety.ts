import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { diagnostic } from "./diagnostics.ts";
import type { PluginHookEnv } from "./plugin-manifest.ts";
import type { ExecutableHookHandler, HookDiagnostic, HookInputWire, HookSourceMetadata } from "./types.ts";

export {
	applyHookOutputSafety,
	DEFAULT_STDERR_LIMIT_BYTES,
	DEFAULT_STDOUT_LIMIT_BYTES,
	type HookOutputPolicy,
	type HookOutputSafetyMetadata,
	type HookSafeOutput,
	type HookStreamSafetyMetadata,
} from "./output-bounds.ts";

export const DEFAULT_HOOK_TIMEOUT_SECONDS = 600;

const MINIMAL_INHERITED_ENV = [
	"PATH",
	"HOME",
	"USER",
	"USERNAME",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"TMP",
	"TEMP",
	"SystemRoot",
	"ComSpec",
	"PATHEXT",
] as const;
const PLUGIN_ROOT_TEMPLATE_TOKEN = "$" + "{PLUGIN_ROOT}";
const PLUGIN_ROOT_TOKENS = [PLUGIN_ROOT_TEMPLATE_TOKEN, "$PLUGIN_ROOT", "%PLUGIN_ROOT%"] as const;

type HookEnvironmentOptions = {
	readonly handler: ExecutableHookHandler;
	readonly input: HookInputWire;
	readonly sourceEnv: NodeJS.ProcessEnv;
	readonly envPassthrough?: readonly string[];
};

type PluginRootTarget = {
	readonly raw: string;
	readonly resolvedPath: string;
};

export function resolveHookTimeoutSeconds(handler: ExecutableHookHandler): number {
	const timeout = handler.config.timeout;
	if (timeout === undefined) {
		return DEFAULT_HOOK_TIMEOUT_SECONDS;
	}
	if (!isValidHookTimeoutSeconds(timeout)) {
		throw new Error("Invalid command hook timeout reached runtime execution.");
	}
	return timeout;
}

export function isValidHookTimeoutSeconds(timeout: number): boolean {
	return Number.isFinite(timeout) && timeout > 0;
}

export function buildHookEnvironment(options: HookEnvironmentOptions): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of MINIMAL_INHERITED_ENV) {
		const value = options.sourceEnv[key];
		if (value !== undefined) env[key] = value;
	}
	for (const key of options.envPassthrough ?? []) {
		const value = options.sourceEnv[key];
		if (value !== undefined) env[key] = value;
	}
	const pluginEnv = pluginEnvForSource(options.handler.source);
	if (pluginEnv !== undefined) {
		env.PLUGIN_ROOT = pluginEnv.PLUGIN_ROOT;
		env.PLUGIN_DATA = pluginEnv.PLUGIN_DATA;
		env.CLAUDE_PLUGIN_ROOT = pluginEnv.CLAUDE_PLUGIN_ROOT;
		env.CLAUDE_PLUGIN_DATA = pluginEnv.CLAUDE_PLUGIN_DATA;
	}
	env.SENPI_HOOK_SOURCE = options.handler.source.sourcePath;
	env.SENPI_HOOK_EVENT = options.input.event;
	return env;
}

export function validateHookHandlerSafety(handler: ExecutableHookHandler): readonly HookDiagnostic[] {
	if (handler.source.scope !== "plugin" || handler.source.pluginRoot === undefined) return [];
	return [
		...validateCommandField(handler, "command", handler.config.command),
		...(handler.config.commandWindows === undefined
			? []
			: validateCommandField(handler, "commandWindows", handler.config.commandWindows)),
	];
}

function validateCommandField(
	handler: ExecutableHookHandler,
	field: "command" | "commandWindows",
	command: string,
): readonly HookDiagnostic[] {
	const diagnostics: HookDiagnostic[] = [];
	for (const target of extractPluginRootTargets(command, handler.source.pluginRoot ?? "")) {
		const path = `hooks.${handler.event}[${handler.groupIndex}].hooks[${handler.handlerIndex}].${field}`;
		if (!isContained(resolve(handler.source.pluginRoot ?? ""), target.resolvedPath)) {
			diagnostics.push(
				diagnostic(
					{
						code: "invalid_command_target",
						event: handler.event,
						message: `Plugin command target is outside plugin root: ${target.raw}`,
						path,
					},
					handler.source,
				),
			);
			continue;
		}
		if (!existsSync(target.resolvedPath)) {
			diagnostics.push(
				diagnostic(
					{
						code: "missing_command_target",
						event: handler.event,
						message: `Plugin command target does not exist: ${target.raw}`,
						path,
					},
					handler.source,
				),
			);
			continue;
		}
		const realTarget = realpathSync(target.resolvedPath);
		const realRoot = realpathSync(resolve(handler.source.pluginRoot ?? ""));
		if (!isContained(realRoot, realTarget)) {
			diagnostics.push(
				diagnostic(
					{
						code: "invalid_command_target",
						event: handler.event,
						message: `Plugin command target resolves outside plugin root: ${target.raw}`,
						path,
					},
					handler.source,
				),
			);
		}
	}
	return diagnostics;
}

function extractPluginRootTargets(command: string, pluginRoot: string): readonly PluginRootTarget[] {
	const targets: PluginRootTarget[] = [];
	for (const word of readCommandWords(command)) {
		for (const token of PLUGIN_ROOT_TOKENS) {
			if (!word.expanded.includes(token)) continue;
			const expanded = word.expanded.replaceAll(token, pluginRoot).replaceAll("\\", "/");
			targets.push({ raw: word.raw, resolvedPath: resolve(expanded) });
		}
	}
	return targets;
}

function readCommandWords(command: string): readonly { readonly expanded: string; readonly raw: string }[] {
	const words: { readonly expanded: string; readonly raw: string }[] = [];
	let index = 0;
	while (index < command.length) {
		while (index < command.length && isCommandWordTerminator(command[index])) index += 1;
		if (index >= command.length) break;

		const start = index;
		let expanded = "";
		while (index < command.length && !isCommandWordTerminator(command[index])) {
			const char = command[index];
			if (char === "'" || char === '"' || char === "`") {
				const quote = char;
				index += 1;
				while (index < command.length && command[index] !== quote) {
					expanded += command[index];
					index += 1;
				}
				if (command[index] === quote) index += 1;
				continue;
			}
			expanded += char;
			index += 1;
		}
		words.push({ expanded, raw: command.slice(start, index) });
	}
	return words;
}

function isCommandWordTerminator(char: string | undefined): boolean {
	return (
		char === undefined ||
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === ";" ||
		char === "&" ||
		char === "|" ||
		char === "<" ||
		char === ">" ||
		char === ")"
	);
}

function isContained(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pluginEnvForSource(source: HookSourceMetadata): PluginHookEnv | undefined {
	if (!("pluginEnv" in source)) return undefined;
	const pluginEnv = source.pluginEnv;
	if (!isPluginHookEnv(pluginEnv)) return undefined;
	return pluginEnv;
}

function isPluginHookEnv(value: unknown): value is PluginHookEnv {
	return (
		isRecord(value) &&
		typeof value.PLUGIN_ROOT === "string" &&
		typeof value.PLUGIN_DATA === "string" &&
		typeof value.CLAUDE_PLUGIN_ROOT === "string" &&
		typeof value.CLAUDE_PLUGIN_DATA === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
