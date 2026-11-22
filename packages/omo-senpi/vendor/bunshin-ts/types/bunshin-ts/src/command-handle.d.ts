import type { TerminalExecArgs, TerminalKillArgs, TerminalWaitArgs, TerminalWriteArgs } from "../../protocol/src/mesh.ts";
import type { CommandState, StdinEffect, TerminalLifecycle } from "../../protocol/src/terminal.ts";
export type { CommandState, StdinEffect, TerminalLifecycle };
export type CommandWaitOptions = {
    readonly until: readonly CommandState[];
    readonly timeoutMs?: number;
};
export type CommandWaitResult = {
    readonly status: CommandStatus;
    readonly matched: boolean;
    readonly reason: "matched" | "timeout" | "terminal";
};
export type CommandWriteOptions = {
    readonly expectActivityMs: number;
};
export type CommandWriteResult = {
    readonly status: CommandStatus;
    readonly stdinEffect: StdinEffect;
};
export declare class TerminalLifecycleUnsupportedError extends Error {
    constructor();
}
export declare class StdinActivityTimeoutError extends Error {
    readonly status: CommandStatus;
    readonly acceptedBytes: number;
    constructor(status: CommandStatus, acceptedBytes: number);
}
export type SpawnOptions = {
    readonly cwd?: string;
};
/**
 * `truncated` / `omittedBytes` describe THIS consumer's view: bytes the agent had already dropped
 * when the handle was created, plus every hole THIS consumer's own polls had to skip. `status()`,
 * each `wait()`, and each `output()` stream advance independent cursors, so each accounts for its
 * own losses — one consumer's gap is never billed to another. They are not the agent's per-frame
 * head/tail bookkeeping, which re-counts the same missing bytes on every poll and cannot be summed.
 */
export type CommandStatus = {
    readonly state: CommandState;
    readonly lifecycle: TerminalLifecycle;
    readonly exitCode?: number;
    readonly elapsedMs: number;
    readonly output: string;
    readonly truncated: boolean;
    readonly omittedBytes: number;
    readonly totalBytes: number;
    readonly lastSeq: number;
};
export type CommandExit = {
    readonly exitCode: number;
    readonly output: string;
    readonly durationMs: number;
    /** True when any byte of the command's output never reached this waiter. */
    readonly truncated: boolean;
    /** Total bytes this waiter never received; holes skipped mid-wait are also marked inline in `output`. */
    readonly omittedBytes: number;
};
export type CommandHandle = {
    readonly handleId: string;
    status(): Promise<CommandStatus>;
    wait(): Promise<CommandExit>;
    wait(options: CommandWaitOptions): Promise<CommandWaitResult>;
    output(): AsyncIterable<string>;
    write(data: string): Promise<void>;
    write(data: string, options: CommandWriteOptions): Promise<CommandWriteResult>;
    kill(): Promise<void>;
};
export declare class CommandKilledError extends Error {
    constructor(handleId: string);
}
export declare class CommandHandleLostError extends Error {
    readonly reason: Extract<TerminalLifecycle, {
        state: "lost";
    }>["reason"];
    readonly status: CommandStatus | undefined;
    constructor(handleId: string, reason?: Extract<TerminalLifecycle, {
        state: "lost";
    }>["reason"], status?: CommandStatus);
}
type TerminalCallArgs = {
    readonly exec_command: TerminalExecArgs;
    readonly wait_for_command: TerminalWaitArgs;
    readonly write_stdin: TerminalWriteArgs;
    readonly kill_terminal: TerminalKillArgs;
};
/** Results stay `unknown` because the handle parses them; the ARGS are contract-checked at every call site. */
type TerminalInvoke = <K extends keyof TerminalCallArgs>(capability: K, args: TerminalCallArgs[K], options?: {
    readonly timeoutMs: number;
}) => Promise<unknown>;
/** How a spawn runs: the caller's `SpawnOptions`, plus the clock and the machine's advertised protocol features. */
type SpawnContext = {
    readonly options?: SpawnOptions | undefined;
    readonly now?: () => number;
    readonly protocolFeatures?: readonly string[] | undefined;
};
export declare const spawnCommand: (invoke: TerminalInvoke, command: string, { options, now, protocolFeatures }?: SpawnContext) => Promise<CommandHandle>;
