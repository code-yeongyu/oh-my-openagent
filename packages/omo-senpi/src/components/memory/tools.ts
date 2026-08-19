import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import {
  MemoryApplyPatchError,
  MemoryPatchHunkError,
  MemoryPatchParseError,
  MemoryToolError,
  createNodeGitExec,
  runMemoryApplyPatch,
  runMemoryTool,
  type MemoryToolCommit,
  type MemoryToolProvenance,
} from "@oh-my-opencode/memory-core"
import { Type, type Static, type TSchema } from "typebox"

import { prepareMemoryEngineSession } from "./engine-session"
import { createMemoryWriteRenderResult } from "./memory-write-render"
import type { MemoryRpcSnapshot } from "./memory-rpc-bridge"
import { buildMemorySnapshot, createMemoryRpcGitRepo } from "./memory-rpc-snapshot-state"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"

import {
  MEMORY_APPLY_PATCH_DESCRIPTION,
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_MCP_SERVER_NAME,
  MEMORY_TOOL_DESCRIPTION,
  MEMORY_TOOL_NAME,
} from "./tool-metadata"

export { MEMORY_APPLY_PATCH_TOOL_NAME, MEMORY_MCP_SERVER_NAME, MEMORY_TOOL_NAME }

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
    renderResult: renderResultFor(options),
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
        const provenance = readToolProvenance(params)
        const result = await runMemoryApplyPatch({
          repo,
          lock,
          params: { ...params, author, ...(provenance === undefined ? {} : { provenance }) },
        })
        if (result.commit !== undefined) options.onCommit?.(result.commit)
        return okResult(result.message, await writeNoticeFor(context, result.commit, options))
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
    renderResult: renderResultFor(options),
  }
}

function renderResultFor(options: MemoryToolsOptions) {
  return createMemoryWriteRenderResult({ enabled: () => options.writeNotice?.enabled === true })
}

/**
 * Gathering is DECORATION for the visible row: it runs only behind the gate, only after a real
 * commit, and it can never fail the tool result, so the whole call is wrapped once more here on
 * top of the per-field guards inside `gatherMemoryWriteNotice`.
 */
async function writeNoticeFor(
  context: MemoryIdentityContext,
  commit: MemoryToolCommit | undefined,
  options: MemoryToolsOptions,
): Promise<MemoryWriteNotice | undefined> {
  if (commit === undefined || options.writeNotice?.enabled !== true) return undefined
  try {
    const sessionId = options.writeNotice.resolveSessionId?.()
    // Bounded: a wedged git or filesystem probe degrades the row, it never holds the tool result.
    return await Promise.race([
      gatherMemoryWriteNotice(context, commit, sessionId === undefined ? {} : { sessionId }),
      new Promise<undefined>((resolve) => {
        setTimeout(resolve, WRITE_NOTICE_BUDGET_MS).unref?.()
      }),
    ])
  } catch {
    return undefined
  }
}

/** Whole-gather budget; the row is decoration, so it yields to the result long before git does. */
const WRITE_NOTICE_BUDGET_MS = 3_000

export interface MemoryWriteNoticeDeps {
  /** Bound session id; without one the journal-derived unreflected-step count is unavailable. */
  readonly sessionId?: string
  /** Snapshot seam; production reuses the RPC snapshot builder so the numbers cannot drift. */
  readonly buildSnapshot?: (context: MemoryIdentityContext, sessionId: string) => Promise<MemoryRpcSnapshot>
}

/**
 * Collects the raw post-commit facts behind the visible notice. Every source is probed
 * independently and every probe swallows its own failure: a broken git, a missing reflection
 * directory, or a corrupt journal state omits ONLY its own field.
 */
export async function gatherMemoryWriteNotice(
  context: MemoryIdentityContext,
  commit: MemoryToolCommit,
  deps: MemoryWriteNoticeDeps = {},
): Promise<MemoryWriteNotice> {
  const [affected, snapshot] = await Promise.all([
    readAffectedFiles(context.identityPaths.repo, commit.sha),
    readSnapshot(context, deps),
  ])
  const repo = snapshot?.repo
  const size = repo === undefined
      || repo.systemBytes === undefined
      || repo.totalBytes === undefined
      || repo.fileCount === undefined
    ? undefined
    : { systemBytes: repo.systemBytes, totalBytes: repo.totalBytes, fileCount: repo.fileCount }
  const unreflectedSteps = snapshot?.reflection.backlogSteps
  return {
    sha: commit.sha,
    subject: commit.subject,
    identity: context.identity,
    affected,
    ...(size === undefined ? {} : { size }),
    timeline: {
      ...(repo?.entriesToday === undefined ? {} : { entriesToday: repo.entriesToday }),
      ...(repo?.previousEntryAtISO === undefined ? {} : { previousEntryAtISO: repo.previousEntryAtISO }),
      ...(snapshot?.reflection.lastConsolidationAtISO === undefined
        ? {}
        : { lastConsolidationAtISO: snapshot.reflection.lastConsolidationAtISO }),
      ...(unreflectedSteps === undefined || unreflectedSteps <= 0 ? {} : { unreflectedSteps }),
    },
  }
}

async function readSnapshot(
  context: MemoryIdentityContext,
  deps: MemoryWriteNoticeDeps,
): Promise<MemoryRpcSnapshot | undefined> {
  const sessionId = deps.sessionId
  if (sessionId === undefined || sessionId.length === 0) return undefined
  try {
    if (deps.buildSnapshot !== undefined) return await deps.buildSnapshot(context, sessionId)
    return await buildMemorySnapshot(context, sessionId, {
      repo: createMemoryRpcGitRepo(context.identityPaths.repo),
      activeRun: () => undefined,
      tokenEstimates: new Map(),
      treeStats: new Map(),
    })
  } catch {
    return undefined
  }
}

/**
 * Per-path line counts from `git show --numstat -z <sha>`. The NUL-delimited form is used because
 * memory paths may contain characters git would otherwise quote; binary files report "-" counts
 * and are reported as zero rather than dropped.
 */
async function readAffectedFiles(repoPath: string, sha: string): Promise<readonly MemoryWriteAffectedFile[]> {
  try {
    const result = await createNodeGitExec().run(
      ["show", "--numstat", "-z", "--format=", sha],
      { cwd: repoPath, timeoutMs: NUMSTAT_TIMEOUT_MS },
    )
    if (result.code !== 0) return []
    return parseNumstat(result.stdout)
  } catch {
    return []
  }
}

const NUMSTAT_TIMEOUT_MS = 10_000

/**
 * `--numstat -z` emits `<ins>\t<del>\t<path>\0` per file, except for renames, which emit
 * `<ins>\t<del>\t\0<old>\0<new>\0` - the destination path is what the notice reports.
 */
export function parseNumstat(stdout: string): readonly MemoryWriteAffectedFile[] {
  const fields = stdout.split("\0")
  const affected: MemoryWriteAffectedFile[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.trim().length === 0) continue
    const parts = field.split("\t")
    if (parts.length < 3) continue
    const insertions = countOf(parts[0])
    const deletions = countOf(parts[1])
    let path = parts[2] ?? ""
    if (path.length === 0) {
      // Rename: the old path and the new path follow as their own NUL-terminated fields.
      path = fields[index + 2] ?? fields[index + 1] ?? ""
      index += 2
    }
    if (path.length === 0) continue
    affected.push({ path, insertions, deletions })
  }
  return affected
}

function countOf(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
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
