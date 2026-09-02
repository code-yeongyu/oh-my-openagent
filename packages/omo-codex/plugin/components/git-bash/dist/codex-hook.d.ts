export interface PreToolUsePayload {
    readonly cwd: string;
    readonly hook_event_name: "PreToolUse";
    readonly model: string;
    readonly permission_mode: string;
    readonly session_id: string;
    readonly tool_input: unknown;
    readonly tool_name: string;
    readonly tool_use_id: string;
    readonly transcript_path: string | null;
    readonly turn_id: string;
}
export interface GitBashHookOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform | string;
    readonly pluginDataRoot?: string;
}
export interface PostCompactPayload {
    readonly hook_event_name: "PostCompact";
    readonly session_id: string;
    readonly transcript_path?: string | null;
    readonly trigger?: string;
}
export declare function parsePreToolUsePayload(raw: string): PreToolUsePayload | null;
export declare function parsePostCompactPayload(raw: string): PostCompactPayload | null;
export declare function applyGitBashPreToolUseReminder(payload: PreToolUsePayload, options?: GitBashHookOptions): string;
export declare function applyGitBashPostCompactReset(payload: PostCompactPayload, options?: GitBashHookOptions): string;
export declare function runGitBashHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, eventName?: "pre-tool-use" | "post-compact", options?: GitBashHookOptions): Promise<void>;
