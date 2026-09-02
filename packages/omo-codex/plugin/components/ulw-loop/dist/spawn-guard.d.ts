import type { PreToolUsePayload } from "./codex-hook.js";
export declare function applySpawnGuards(payload: PreToolUsePayload): string;
export declare function runSpawnGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void>;
