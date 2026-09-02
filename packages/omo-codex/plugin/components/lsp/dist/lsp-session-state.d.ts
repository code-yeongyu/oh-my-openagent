import type { PostEditNotConfiguredCache } from "@oh-my-opencode/lsp-core/post-edit";
export declare function sessionIdFrom(input: {
    readonly session_id?: unknown;
}): string | undefined;
export declare function readLspPostEditCache(sessionId: string | undefined): PostEditNotConfiguredCache;
export declare function writeLspPostEditCache(sessionId: string | undefined, cache: PostEditNotConfiguredCache): void;
export declare function markLspSessionCompacted(sessionId: string | undefined): void;
export declare function isLspDaemonUnreachableDiagnostics(diagnostics: string): boolean;
