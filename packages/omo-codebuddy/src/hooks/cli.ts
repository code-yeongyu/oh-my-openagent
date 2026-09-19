import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { readStdinPayload } from "../protocol/index.ts";
import { resolvePluginRoot } from "./paths.ts";
import { runPostToolUseHook } from "./post-tool-use.ts";
import { runSessionStartHook } from "./session-start.ts";
import { runStopHook } from "./stop.ts";
import { runUserPromptSubmitHook } from "./user-prompt-submit.ts";

/**
 * One entrypoint for every omo CodeBuddy hook:
 *
 *   node "${CODEBUDDY_PLUGIN_ROOT}/hooks/scripts/hook.mjs" <command>
 *
 * A hook must NEVER break the host: every failure path is swallowed and the
 * process exits 0 without output, which CodeBuddy reads as "no opinion".
 */
export const HOOK_COMMANDS = [
	"user-prompt-submit",
	"stop",
	"post-tool-use",
	"session-start",
] as const;

export type HookCommand = (typeof HOOK_COMMANDS)[number];

export interface HookCliIo {
	readonly stdin: NodeJS.ReadableStream;
	readonly stdout: NodeJS.WritableStream;
	readonly env?: Record<string, string | undefined>;
	readonly pluginRoot?: string;
}

export function isHookCommand(value: string | undefined): value is HookCommand {
	return value !== undefined && (HOOK_COMMANDS as readonly string[]).includes(value);
}

export function dispatchHook(
	command: HookCommand,
	payload: Record<string, unknown>,
	options: { readonly pluginRoot: string; readonly env?: Record<string, string | undefined> },
): string | Promise<string> {
	switch (command) {
		case "user-prompt-submit":
			return runUserPromptSubmitHook(payload, { pluginRoot: options.pluginRoot, env: options.env });
		case "stop":
			return runStopHook(payload, { env: options.env });
		case "post-tool-use":
			return runPostToolUseHook(payload, { env: options.env });
		case "session-start":
			return runSessionStartHook(payload, { env: options.env });
	}
}

export async function runHookCli(
	argv: readonly string[] = process.argv.slice(2),
	io: HookCliIo = { stdin: process.stdin, stdout: process.stdout },
): Promise<void> {
	const command = argv[0];
	if (!isHookCommand(command)) return;

	const env = io.env ?? process.env;
	const pluginRoot = io.pluginRoot ?? resolvePluginRoot({ env });

	try {
		const payload = (await readStdinPayload(io.stdin)) ?? {};
		const output = await dispatchHook(command, payload, { pluginRoot, env });
		if (typeof output === "string" && output.length > 0) io.stdout.write(output);
	} catch {
		// Hooks are advisory: a crash must not fail the tool call it observes.
	}
}

/**
 * True when this module is the process entrypoint. A plain
 * `import.meta.url === pathToFileURL(argv[1])` check breaks when the plugin is
 * reached through a symlink (Node resolves the real path, argv keeps the
 * symlinked spelling), which would silently turn every hook into a no-op.
 */
export function isCliEntry(importMetaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
	if (argv1 === undefined) return false;
	if (importMetaUrl === pathToFileURL(argv1).href) return true;
	try {
		return importMetaUrl === pathToFileURL(realpathSync(argv1)).href;
	} catch {
		return false;
	}
}

if (isCliEntry(import.meta.url)) {
	await runHookCli();
}
