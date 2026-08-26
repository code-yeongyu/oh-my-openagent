import { env as processEnv, stdin as processStdin, stdout as processStdout } from "node:process";

import { buildCodegraphInitGuidanceForToolResult } from "../../../../../utils/src/codegraph/guidance.ts";
import { isRecord, readHookInput, resolveHomeDir } from "./hook-input.js";
import type { PostToolUseHookOptions, PostToolUseHookResult } from "./hook-types.js";

export async function runCodegraphPostToolUseHookCli(options: PostToolUseHookOptions = {}): Promise<number> {
	return (await executeCodegraphPostToolUseHook(options)).exitCode;
}

export async function executeCodegraphPostToolUseHook(options: PostToolUseHookOptions = {}): Promise<PostToolUseHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const output = runCodegraphPostToolUseHook(input, { homeDir: resolveHomeDir(env) });
	if (output.length === 0) return { action: "skipped", exitCode: 0 };

	(options.stdout ?? processStdout).write(output);
	return { action: "emitted-guidance", exitCode: 0 };
}

export function runCodegraphPostToolUseHook(input: unknown, options: { readonly homeDir?: string } = {}): string {
	const toolName = isRecord(input) ? input["tool_name"] : undefined;
	const cwd = isRecord(input) ? input["cwd"] : undefined;
	const toolOutput = isRecord(input) ? (input["tool_response"] ?? input["tool_output"] ?? input["response"]) : input;
	const guidance = buildCodegraphInitGuidanceForToolResult({ cwd, toolName, toolOutput }, options);
	if (guidance === null) return "";

	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: guidance,
		},
	})}\n`;
}
