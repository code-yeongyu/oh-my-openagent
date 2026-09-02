import { type PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit";
import { type LspRequestContext } from "@oh-my-opencode/lsp-core/request-context";
export { extractMutatedFilePaths } from "./mutated-file-paths.js";
export type DiagnosticsRunner = (filePath: string) => Promise<PostEditDiagnosticsOutcome>;
export interface CodexPostToolUseInput {
    session_id?: unknown;
    tool_name?: unknown;
    tool_input?: unknown;
    tool_response?: unknown;
    transcript_path?: unknown;
}
export interface CodexPostCompactInput {
    session_id?: unknown;
}
export declare function runLspDiagnosticsText(filePath: string): Promise<PostEditDiagnosticsOutcome>;
export declare function codexLspRequestContext(env?: Record<string, string | undefined>, cwd?: string): LspRequestContext;
export declare function runLspPostToolUseHook(input: CodexPostToolUseInput, runDiagnostics?: DiagnosticsRunner): Promise<string>;
export declare function runLspPostCompactHook(input: CodexPostCompactInput): Promise<string>;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
