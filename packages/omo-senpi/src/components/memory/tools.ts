import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import {
  MemoryToolError,
  runMemoryTool,
  type MemoryToolCommit,
  type MemoryToolProvenance,
} from "@oh-my-opencode/memory-core"
import { Type, type Static, type TSchema } from "typebox"

import { prepareMemoryEngineSession } from "./engine-session"
import { createMemoryWriteRenderResult, renderMemoryWriteCall } from "./memory-write-render"
import { writeNoticeFor } from "./write-notice"
export { gatherMemoryWriteNotice, parseNumstat } from "./write-notice"
export type { MemoryWriteNoticeDeps } from "./write-notice"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"

import {
  MEMORY_TOOL_DESCRIPTION,
  MEMORY_TOOL_NAME,
} from "./tool-metadata"

export { MEMORY_TOOL_NAME }

const UNBOUND_IDENTITY_MESSAGE =
  "no memory identity bound to this session yet; the binding is re-established on the next user turn, or start a new session if this persists"

export const MemoryToolParams = Type.Object({
  command: Type.Union([
    Type.Literal("create"),
    Type.Literal("str_replace"),
    Type.Literal("insert"),
    Type.Literal("delete"),
    Type.Literal("rename"),
    Type.Literal("update_description"),
    Type.Literal("apply_patch"),
  ], { description: "The memory operation to perform." }),
  reason: Type.String({ description: "Git commit message recorded for this memory change." }),
  file_path: Type.Optional(Type.String({ description: "Target memory file: relative to the memory repo, or absolute inside it. Required by create, str_replace, insert, delete, and update_description." })),
  old_path: Type.Optional(Type.String({ description: "Current path of the memory file. Required by rename." })),
  new_path: Type.Optional(Type.String({ description: "Destination path of the memory file. Required by rename." })),
  old_string: Type.Optional(Type.String({ description: "Exact text to replace. Required by str_replace." })),
  new_string: Type.Optional(Type.String({ description: "Replacement text. Required by str_replace." })),
  insert_line: Type.Optional(Type.Number({ description: "1-based line number at which to insert text. Required by insert." })),
  insert_text: Type.Optional(Type.String({ description: "Text to insert. Required by insert." })),
  description: Type.Optional(Type.String({ description: "Frontmatter description of the memory block. Required by create and update_description." })),
  file_text: Type.Optional(Type.String({ description: "Initial body text for create." })),
  input: Type.Optional(Type.String({ description: "Codex-style patch text for apply_patch." })),
})

/** One path touched by the commit, with the line counts `git show --numstat` reported for it. */
export interface MemoryWriteAffectedFile {
  readonly path: string
  readonly insertions: number
  readonly deletions: number
}

/**
 * RAW post-commit facts for the visible tool-result row. This is a decoration payload: it carries
 * numbers and identifiers only - no prose, no formatting, no tone - so the renderer owns every
 * presentation decision, and each field is optional because gathering it is best-effort.
 */
export interface MemoryWriteNotice {
  readonly sha: string
  readonly subject: string
  readonly identity: string
  readonly affected: readonly MemoryWriteAffectedFile[]
  readonly size?: {
    readonly systemBytes: number
    readonly totalBytes: number
    readonly fileCount: number
  }
  readonly timeline: {
    readonly entriesToday?: number
    readonly previousEntryAtISO?: string
    readonly lastConsolidationAtISO?: string
    readonly unreflectedSteps?: number
  }
}

export interface MemoryToolResultDetails {
  readonly message: string
  /** Present only after a successful commit while the write-notice gate is on. */
  readonly writeNotice?: MemoryWriteNotice
}

// The agent loop honors an inline `isError` on the returned result (senpi builtin tool convention);
// the base AgentToolResult type does not declare it, so it is intersected on here.
export type MemoryToolExecutionResult = AgentToolResult<MemoryToolResultDetails> & { readonly isError?: boolean }

export type MemoryToolDefinition<TParams extends TSchema> = Omit<ToolDefinition<TParams, MemoryToolResultDetails>, "execute"> & {
  readonly execute: (toolCallId: string, params: Static<TParams>) => Promise<MemoryToolExecutionResult>
}

export interface MemoryToolWriteNoticeOptions {
  /** memory.write_notice.enabled; false gathers nothing and renders the plain message. */
  readonly enabled: boolean
  /** Bound session whose journal state supplies the unreflected-step count. */
  readonly resolveSessionId?: () => string | undefined
}

export interface MemoryToolsOptions {
  /** Writer-lock wait budget before contention is reported; defaults to 5000ms. */
  readonly lockWaitTimeoutMs?: number
  /** Writer-lock retry cadence while waiting; defaults to the memory-core default (25ms). */
  readonly lockRetryDelayMs?: number
  /** Post-commit notice seam (plan IC-4): invoked once after each successful commit, never on errors. */
  readonly onCommit?: (commit: MemoryToolCommit) => void
  /** Visible tool-result notice; absent behaves as disabled. */
  readonly writeNotice?: MemoryToolWriteNoticeOptions
}

export type MemoryContextResolver = () => MemoryIdentityContext | undefined | Promise<MemoryIdentityContext | undefined>

export function createMemoryTools(
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions = {},
): readonly [MemoryToolDefinition<typeof MemoryToolParams>] {
  return [createMemoryTool(resolveContext, options)]
}

// Registration is cheap and always available; ACTIVATION is gated at execute time through the
// resolver (the session_start binding seam), so a stale invocation in an unbound session returns
// an actionable initialization error instead of failing to find the tool.
export function registerMemoryTools(
  pi: SenpiExtensionAPI,
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions = {},
): void {
  for (const tool of createMemoryTools(resolveContext, options)) pi.registerTool({ ...tool })
}

export function registerMemoryToolSurface(
  pi: SenpiExtensionAPI,
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions = {},
): void {
  registerMemoryTools(pi, resolveContext, options)
}

function createMemoryTool(
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions,
): MemoryToolDefinition<typeof MemoryToolParams> {
  return {
    name: MEMORY_TOOL_NAME,
    label: "Memory",
    description: MEMORY_TOOL_DESCRIPTION,
    promptSnippet: "memory - edit omo memory blocks (create/str_replace/insert/delete/rename/update_description/apply_patch); auto-commits each change",
    promptGuidelines: [
      "Record durable facts, preferences, and decisions with the memory tool as you learn them; every change is committed with the reason you provide.",
      "Memory files are markdown with YAML frontmatter; keep each block's description accurate because the memory index surfaces it.",
      "When creating, renaming, or deleting memory files, update [[path]] references in other memory files so they stay discoverable.",
    ],
    parameters: MemoryToolParams,
    executionMode: "sequential",
    renderShell: "self",
    execute: async (_toolCallId, params) => {
      const context = await resolveContext()
      if (context === undefined) return errorResult(`${MEMORY_TOOL_NAME}: ${UNBOUND_IDENTITY_MESSAGE}`)
      try {
        const { repo, lock, author } = await prepareEngine(context, options)
        const provenance = readToolProvenance(params)
        const result = await runMemoryTool({
          repo,
          lock,
          params: { ...params, author, ...(provenance === undefined ? {} : { provenance }) },
        })
        if (result.commit !== undefined) options.onCommit?.(result.commit)
        return okResult(result.message, await writeNoticeFor(context, result.commit, options))
      } catch (error) {
        if (error instanceof MemoryToolError) return errorResult(error.message)
        throw error
      }
    },
    renderCall: renderMemoryWriteCall,
    renderResult: renderResultFor(options),
  }
}

function renderResultFor(options: MemoryToolsOptions) {
  return createMemoryWriteRenderResult({ enabled: () => options.writeNotice?.enabled === true })
}


async function prepareEngine(context: MemoryIdentityContext, options: MemoryToolsOptions) {
  return prepareMemoryEngineSession(context.identity, context.identityPaths, options)
}

function readToolProvenance(value: unknown): MemoryToolProvenance | undefined {
  if (!isRecord(value) || !isRecord(value.provenance)) return undefined
  const provenance = value.provenance
  if (
    typeof provenance.sessionId !== "string"
    || provenance.sessionId.length === 0
    || typeof provenance.userTurns !== "number"
    || !Number.isSafeInteger(provenance.userTurns)
    || provenance.userTurns < 0
  ) return undefined
  return { sessionId: provenance.sessionId, userTurns: provenance.userTurns }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function okResult(message: string, writeNotice?: MemoryWriteNotice): MemoryToolExecutionResult {
  return {
    content: [{ type: "text", text: message }],
    details: { message, ...(writeNotice === undefined ? {} : { writeNotice }) },
  }
}

function errorResult(message: string): MemoryToolExecutionResult {
  return { content: [{ type: "text", text: message }], details: { message }, isError: true }
}
