import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { redactUrl } from "@oh-my-opencode/memory-core"
import type { Static, TSchema } from "typebox"

import type { WakeToolBudget } from "./budget"

// The agent loop honors an inline `isError` (senpi builtin convention) and `terminate` (pi-agent-core
// early-termination hint); neither is declared on the base result type, so they are intersected here.
export type KibitzerToolResult = AgentToolResult<undefined> & { readonly isError?: boolean; readonly terminate?: boolean }

/** A sidecar tool: a member-scoped ToolDefinition whose execute is a plain two-argument closure. */
export type KibitzerSidecarTool<TParams extends TSchema> = Omit<
  ToolDefinition<TParams, undefined>,
  "execute" | "renderCall" | "renderResult"
> & {
  readonly execute: (toolCallId: string, params: Static<TParams>) => Promise<KibitzerToolResult>
}

/**
 * Registry element type: any sidecar tool regardless of its parameter schema. `params: never` is the
 * contravariant bottom, so every concrete closure is assignable here, and the whole array is still
 * assignable to senpi's `ToolDefinition[]` (ChildSpec.memberScopedTools) through method bivariance.
 */
export type AnyKibitzerSidecarTool = Omit<
  ToolDefinition<TSchema, undefined>,
  "execute" | "renderCall" | "renderResult"
> & {
  readonly execute: (toolCallId: string, params: never) => Promise<KibitzerToolResult>
}

export type KibitzerRejectionCode =
  | "tool_budget_exceeded"
  | "path_escape"
  | "path_traversal"
  | "path_absolute"
  | "path_separator"
  | "path_empty"
  | "system_path"
  | "not_found"
  | "not_a_file"
  | "not_committed"
  | "invalid_pattern"
  | "unsupported_operation"
  | "missing_argument"

export interface KibitzerRejection {
  readonly rejected: KibitzerRejectionCode
  readonly message: string
  readonly path?: string
}

export function rejection(code: KibitzerRejectionCode, message: string, path?: string): KibitzerToolResult {
  const body: KibitzerRejection = { rejected: code, message, ...(path === undefined ? {} : { path }) }
  return { content: [{ type: "text", text: JSON.stringify(body) }], details: undefined, isError: true }
}

export function okText(text: string): KibitzerToolResult {
  return { content: [{ type: "text", text }], details: undefined }
}

export function okJson(value: unknown): KibitzerToolResult {
  return okText(JSON.stringify(value))
}

/** Redaction FIRST (a secret split by truncation would escape the pattern), then the cap. */
export function boundedText(text: string, cap: number): string {
  const redacted = redactUrl(text)
  if (redacted.length <= cap) return redacted
  return `${redacted.slice(0, cap)}\n[truncated: ${cap} of ${redacted.length} chars]`
}

/**
 * Wraps a closure so it charges the per-wake budget on entry. Exceeding the budget is a structured,
 * non-failing rejection: the lifecycle classifies the wake as `tool_budget_exceeded`, never as a
 * diagnostic failure.
 */
export function budgeted<TParams>(
  budget: () => WakeToolBudget,
  run: (params: TParams) => Promise<KibitzerToolResult>,
): (toolCallId: string, params: TParams) => Promise<KibitzerToolResult> {
  return async (_toolCallId, params) => {
    const current = budget()
    if (!current.charge()) {
      return rejection("tool_budget_exceeded", `The tool-call budget for this wake (${current.limit}) is exhausted; end the turn.`)
    }
    return run(params)
  }
}
