import type { Static } from "@sinclair/typebox";
import { meshOperationContracts, type TerminalResult } from "../../protocol/src/mesh.ts";
import type { ShellResult } from "../../protocol/src/terminal.ts";
/**
 * The SDK hands callers native operation results, and nothing on the shell/terminal shapes names itself:
 *
 * - `ShellResult` — the one-shot `shell()` surface: `exitCode`/`stdout`/`stderr` (+ optional `signal`,
 *   `timeout`, timing fields, and the big-output window `head`/`spillPath`/`totalBytes`/`omittedBytes`
 *   once combined output exceeded the durable inline budget — C-NOSHELL-1).
 * - `TerminalResult` — the streaming `exec_command`/`wait_for_command` surface: `handleId`/`output`/
 *   `state`/`lastSeq` plus replay bookkeeping (`truncated`/`omittedBytes`/`totalBytes`).
 *
 * These guards are the discriminant: a caller holding an `unknown` invoke result (or an agent reply
 * decoded defensively) can branch on `isShellResult` / `isTerminalFrame` instead of probing fields
 * (C-SHAPE-1). Both reject anything that is not their surface, including each other's shapes.
 */
export type BridgeInvokeResult = Static<(typeof meshOperationContracts.bridgeInvoke)[1]>;
/** Explicit bridge.invoke callers retain the envelope. Logical-row responses are unwrapped by the hub, not here. */
export declare const isBridgeEnvelope: (value: unknown) => value is BridgeInvokeResult;
/** Structural guard for the one-shot shell surface (`shell()` replies, durable `machine.response` results). */
export declare const isShellResult: (value: unknown) => value is ShellResult;
/** Structural guard for the streaming terminal surface (`exec_command`/`write_stdin`/`wait_for_command`). */
export declare const isTerminalFrame: (value: unknown) => value is TerminalResult;
