import { type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "./readonly.ts";
export declare const ShellRequestSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"shell">;
    command: import("@sinclair/typebox").TString;
    cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
    timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const ShellResultSchema: import("@sinclair/typebox").TObject<{
    exitCode: import("@sinclair/typebox").TInteger;
    stdout: import("@sinclair/typebox").TString;
    stderr: import("@sinclair/typebox").TString;
    signal: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    timeout: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"deadline">, import("@sinclair/typebox").TLiteral<"exit-unconfirmed">]>>;
    startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    durationMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const ExecCommandRequestSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"exec-command">;
    command: import("@sinclair/typebox").TString;
    args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
}>;
export declare const CommandStateSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>;
export type CommandState = Static<typeof CommandStateSchema>;
export declare const TerminalLifecycleSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
    state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
    stdinOpen: import("@sinclair/typebox").TBoolean;
    outputClosed: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    state: import("@sinclair/typebox").TLiteral<"exited">;
    exitCode: import("@sinclair/typebox").TInteger;
    stdinOpen: import("@sinclair/typebox").TLiteral<false>;
    outputClosed: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    state: import("@sinclair/typebox").TLiteral<"killed">;
    stdinOpen: import("@sinclair/typebox").TLiteral<false>;
    outputClosed: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    state: import("@sinclair/typebox").TLiteral<"lost">;
    reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
    stdinOpen: import("@sinclair/typebox").TLiteral<false>;
    outputClosed: import("@sinclair/typebox").TBoolean;
}>]>;
export type TerminalLifecycle = DeepReadonly<Static<typeof TerminalLifecycleSchema>>;
export declare const StdinEffectSchema: import("@sinclair/typebox").TObject<{
    acceptedBytes: import("@sinclair/typebox").TInteger;
    observed: import("@sinclair/typebox").TBoolean;
}>;
export type StdinEffect = DeepReadonly<Static<typeof StdinEffectSchema>>;
export declare const WriteStdinRequestSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"write-stdin">;
    handleId: import("@sinclair/typebox").TString;
    data: import("@sinclair/typebox").TString;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    expectActivityMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
}>;
export declare const WaitForCommandRequestSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"wait-for-command">;
    handleId: import("@sinclair/typebox").TString;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    until: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>>>;
}>;
export declare const TerminalHandleSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"terminal-handle">;
    handleId: import("@sinclair/typebox").TString;
    pid: import("@sinclair/typebox").TInteger;
    state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"exited">]>;
    exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const DisconnectedSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"disconnected">;
    handleId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"network">, import("@sinclair/typebox").TLiteral<"machine-dead">, import("@sinclair/typebox").TLiteral<"process-exited">]>;
    resumable: import("@sinclair/typebox").TBoolean;
    message: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    resumableId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    lastSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const ResumableSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"resumable">;
    handleId: import("@sinclair/typebox").TString;
    retainedUntil: import("@sinclair/typebox").TString;
}>;
export declare const TerminalMessageSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"shell">;
    command: import("@sinclair/typebox").TString;
    cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
    timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"exec-command">;
    command: import("@sinclair/typebox").TString;
    args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"write-stdin">;
    handleId: import("@sinclair/typebox").TString;
    data: import("@sinclair/typebox").TString;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    expectActivityMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"wait-for-command">;
    handleId: import("@sinclair/typebox").TString;
    yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    until: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>>>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"terminal-handle">;
    handleId: import("@sinclair/typebox").TString;
    pid: import("@sinclair/typebox").TInteger;
    state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"exited">]>;
    exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"disconnected">;
    handleId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"network">, import("@sinclair/typebox").TLiteral<"machine-dead">, import("@sinclair/typebox").TLiteral<"process-exited">]>;
    resumable: import("@sinclair/typebox").TBoolean;
    message: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    resumableId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    lastSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"resumable">;
    handleId: import("@sinclair/typebox").TString;
    retainedUntil: import("@sinclair/typebox").TString;
}>]>;
export type ShellRequest = DeepReadonly<Static<typeof ShellRequestSchema>>;
export type ShellResult = DeepReadonly<Static<typeof ShellResultSchema>>;
export type ExecCommandRequest = DeepReadonly<Static<typeof ExecCommandRequestSchema>>;
export type WriteStdinRequest = DeepReadonly<Static<typeof WriteStdinRequestSchema>>;
export type WaitForCommandRequest = DeepReadonly<Static<typeof WaitForCommandRequestSchema>>;
export type TerminalHandle = DeepReadonly<Static<typeof TerminalHandleSchema>>;
export type Disconnected = DeepReadonly<Static<typeof DisconnectedSchema>>;
export type Resumable = DeepReadonly<Static<typeof ResumableSchema>>;
export type TerminalMessage = DeepReadonly<Static<typeof TerminalMessageSchema>>;
