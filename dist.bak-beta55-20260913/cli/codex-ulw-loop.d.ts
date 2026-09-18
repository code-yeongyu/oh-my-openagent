/**
 * Sentinel forwarded to every delegated ulw-loop child. A delegation chain is
 * expected to terminate in ONE hop (component bin or cached component CLI).
 * Without it, a broken install (missing component CLI) made the legacy `omo`
 * wrapper re-enter this resolver: wrapper -> omo CLI -> wrapper -> ... which
 * fork-bombed thousands of live processes and exhausted system RAM.
 */
export declare const ULW_LOOP_DELEGATION_SENTINEL = "OMO_ULW_LOOP_DELEGATED";
export type CodexUlwLoopCommand = {
    readonly executable: string;
    readonly argsPrefix: readonly string[];
};
type ResolveCodexUlwLoopCommandInput = {
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDir?: string;
    readonly currentExecutablePaths?: readonly string[];
};
export declare function resolveCodexUlwLoopCommand(input?: ResolveCodexUlwLoopCommandInput): CodexUlwLoopCommand | null;
export declare function codexUlwLoop(args: readonly string[]): Promise<number>;
export {};
