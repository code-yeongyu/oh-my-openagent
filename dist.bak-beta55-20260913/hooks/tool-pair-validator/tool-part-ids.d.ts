import { isRecord } from "@oh-my-opencode/utils";
import type { TransformPart, UnpairedToolPart } from "./types";
export { isRecord };
export declare const UNKNOWN_TOOL_STATUS = "unknown";
export declare function toRecord(value: unknown): Record<string, unknown> | null;
export declare function getToolCallID(part: TransformPart): string | null;
export declare function getToolStatus(part: TransformPart): string;
export declare function isTerminalToolStatus(status: string): boolean;
/**
 * OpenCode has no standalone `tool_use` or `tool_result` part. A single assistant
 * `tool` part is converted into BOTH the `tool_use` block and its `tool_result`
 * block, but only once the part carries a terminal (`completed` / `error`) state.
 * A part still in `pending` / `running` is therefore the only shape that can reach
 * the provider as a `tool_use` without a paired `tool_result`.
 */
export declare function findUnpairedToolParts(parts: TransformPart[]): UnpairedToolPart[];
