import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import {
  MemoryApplyPatchError,
  MemoryPatchHunkError,
  MemoryPatchParseError,
  MemoryToolError,
  runMemoryApplyPatch,
  runMemoryTool,
} from "@oh-my-opencode/memory-core"
import { Type, type Static, type TSchema } from "typebox"

import { prepareMemoryEngineSession } from "./engine-session"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"

import {
  MEMORY_APPLY_PATCH_DESCRIPTION,
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_TOOL_DESCRIPTION,
  MEMORY_TOOL_NAME,
} from "./tool-metadata"

export { MEMORY_APPLY_PATCH_TOOL_NAME, MEMORY_TOOL_NAME }

const UNBOUND_IDENTITY_MESSAGE =
  "no memory identity bound to this session; enable omo memory and restart the session so the memory tools can initialize"

export const MemoryToolParams = Type.Object({
  command: Type.Union([
    Type.Literal("create"),
    Type.Literal("str_replace"),
    Type.Literal("insert"),
    Type.Literal("delete"),
    Type.Literal("rename"),
    Type.Literal("update_description"),
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
})

export const MemoryApplyPatchParams = Type.Object({
  reason: Type.String({ description: "Git commit message recorded for this memory change." }),
  input: Type.String({ description: "Patch text in the standard apply_patch format (*** Begin Patch ... *** End Patch)." }),
})

export interface MemoryToolResultDetails {
  readonly message: string
}

// The agent loop honors an inline `isError` on the returned result (senpi builtin tool convention);
// the base AgentToolResult type does not declare it, so it is intersected on here.
export type MemoryToolExecutionResult = AgentToolResult<MemoryToolResultDetails> & { readonly isError?: boolean }

export type MemoryToolDefinition<TParams extends TSchema> = Omit<ToolDefinition<TParams, MemoryToolResultDetails>, "execute"> & {
  readonly execute: (toolCallId: string, params: Static<TParams>) => Promise<MemoryToolExecutionResult>
}

export interface MemoryToolsOptions {
  /** Writer-lock wait budget before contention is reported; defaults to 5000ms. */
  readonly lockWaitTimeoutMs?: number
  /** Writer-lock retry cadence while waiting; defaults to the memory-core default (25ms). */
  readonly lockRetryDelayMs?: number
}

export type MemoryContextResolver = () => MemoryIdentityContext | undefined

export function createMemoryTools(
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions = {},
): readonly [MemoryToolDefinition<typeof MemoryToolParams>, MemoryToolDefinition<typeof MemoryApplyPatchParams>] {
  return [createMemoryTool(resolveContext, options), createMemoryApplyPatchTool(resolveContext, options)]
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

export const MEMORY_MCP_SERVER_NAME = "omo-memory"

export interface MemoryToolSurfaceOptions extends MemoryToolsOptions {
  readonly exposure?: "direct" | "search"
}

// Direct registration is the DEFAULT surface: an extension-declared MCP server that fails to start
// (as shipped in 5.0.0-beta.3, where the declaration missing `enabled: true` resolved as state
// "disabled") removes memory entirely. The search exposure stays available as an explicit opt-in
// (memory.tool_exposure: "search") and must declare enabled: true so senpi actually starts it;
// hosts without registerMcpServer fall back to direct registration even when opted in.
export function registerMemoryToolSurface(
  pi: SenpiExtensionAPI,
  resolveContext: MemoryContextResolver,
  options: MemoryToolSurfaceOptions = {},
): void {
  if (options.exposure === "search" && typeof pi.registerMcpServer === "function") {
    pi.registerMcpServer(MEMORY_MCP_SERVER_NAME, {
      command: process.execPath,
      args: [join(dirname(fileURLToPath(import.meta.url)), "omo-memory-mcp.js")],
      exposure: "search",
      enabled: true,
    })
    return
  }
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
    promptSnippet: "memory - edit omo memory blocks (create/str_replace/insert/delete/rename/update_description); auto-commits each change",
    promptGuidelines: [
      "Record durable facts, preferences, and decisions with the memory tool as you learn them; every change is committed with the reason you provide.",
      "Memory files are markdown with YAML frontmatter; keep each block's description accurate because the memory index surfaces it.",
      "When creating, renaming, or deleting memory files, update [[path]] references in other memory files so they stay discoverable.",
    ],
    parameters: MemoryToolParams,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const context = resolveContext()
      if (context === undefined) return errorResult(`${MEMORY_TOOL_NAME}: ${UNBOUND_IDENTITY_MESSAGE}`)
      try {
        const { repo, lock, author } = await prepareEngine(context, options)
        const result = await runMemoryTool({ repo, lock, params: { ...params, author } })
        return okResult(result.message)
      } catch (error) {
        if (error instanceof MemoryToolError) return errorResult(error.message)
        throw error
      }
    },
  }
}

function createMemoryApplyPatchTool(
  resolveContext: MemoryContextResolver,
  options: MemoryToolsOptions,
): MemoryToolDefinition<typeof MemoryApplyPatchParams> {
  return {
    name: MEMORY_APPLY_PATCH_TOOL_NAME,
    label: "Memory Apply Patch",
    description: MEMORY_APPLY_PATCH_DESCRIPTION,
    promptSnippet: "memory_apply_patch - apply a codex-style patch to omo memory files; auto-commits the change",
    promptGuidelines: [
      "Use memory_apply_patch for multi-file or multi-hunk memory edits; prefer the memory tool for single-block changes.",
      "Patches may only target paths inside the memory repo, and read_only memory files cannot be modified.",
    ],
    parameters: MemoryApplyPatchParams,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const context = resolveContext()
      if (context === undefined) return errorResult(`${MEMORY_APPLY_PATCH_TOOL_NAME}: ${UNBOUND_IDENTITY_MESSAGE}`)
      try {
        const { repo, lock, author } = await prepareEngine(context, options)
        const result = await runMemoryApplyPatch({ repo, lock, params: { ...params, author } })
        return okResult(result.message)
      } catch (error) {
        if (
          error instanceof MemoryApplyPatchError
          || error instanceof MemoryPatchParseError
          || error instanceof MemoryPatchHunkError
        ) {
          return errorResult(error.message)
        }
        throw error
      }
    },
  }
}

async function prepareEngine(context: MemoryIdentityContext, options: MemoryToolsOptions) {
  return prepareMemoryEngineSession(context.identity, context.identityPaths, options)
}

function okResult(message: string): MemoryToolExecutionResult {
  return { content: [{ type: "text", text: message }], details: { message } }
}

function errorResult(message: string): MemoryToolExecutionResult {
  return { content: [{ type: "text", text: message }], details: { message }, isError: true }
}
