// Shared consumer for the MCP memory tool surface (memory.tool_exposure: "search").
//
// The MCP server process has no senpi session state, so commit metadata reaches the extension
// through an out-of-band receipt file (tool-receipts.ts) that is READ-AND-DELETED. That makes the
// read a one-shot: every visible notice derived from a commit has to come from the SAME read, or
// the second consumer silently finds nothing. This module owns that single read per memory
// tool_result and fans it out to both notices - soul-updated (soul.edit_notice) and write-updated
// (write_notice.enabled) - so neither gate can starve the other.
//
// The DIRECT tool surface deliberately emits no write-updated entry: there the tool's own
// renderResult (memory-write-render.ts) already draws the same notice on the tool row, and a
// second transcript entry would double-notify.

import type { EntryRenderer } from "@code-yeongyu/senpi"
import { touchesSoulPath, type MemoryToolCommit } from "@oh-my-opencode/memory-core"

import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { renderMemoryWriteNotice } from "./memory-write-render"
import { SOUL_UPDATED_ENTRY_TYPE, renderSoulUpdatedEntry, type SoulUpdatedRecord } from "./soul-notice"
import { MEMORY_MCP_APPLY_PATCH_TOOL_NAME, MEMORY_MCP_TOOL_NAME } from "./tool-metadata"
import { consumeToolReceipt, type MemoryToolReceipt } from "./tool-receipts"
import { gatherMemoryWriteNotice, type MemoryWriteNotice } from "./tools"

export const MEMORY_WRITE_UPDATED_ENTRY_TYPE = "omo-memory:write-updated"

/** The write notice as a transcript entry; identical payload and rendering to the direct tool row. */
export const renderMemoryWriteUpdatedEntry: EntryRenderer<MemoryWriteNotice> = (entry, options, theme) => {
  const record = entry.data
  if (record === undefined) return undefined
  return renderMemoryWriteNotice(record, options, theme, Date.now())
}

export interface MemoryNoticeWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** memory.soul.edit_notice for the identity behind the commit. */
  readonly resolveEditNotice: (identity: string) => boolean
  /** memory.write_notice.enabled for the identity behind the commit. */
  readonly resolveWriteNotice: (identity: string) => boolean
  /** Gather seam; production reuses the direct surface's own best-effort gather. */
  readonly gatherWriteNotice?: (
    context: MemoryIdentityContext,
    commit: MemoryToolCommit,
    sessionId: string,
  ) => Promise<MemoryWriteNotice | undefined>
  /** Receipt seam; production read-and-deletes the on-disk receipt exactly once per tool_result. */
  readonly consumeReceipt?: (
    receiptsDir: string,
    toolCallId: string,
  ) => Promise<MemoryToolReceipt | undefined>
}

export interface MemoryNoticeWiring {
  register(pi: MemoryExtensionAPI): void
  onCommit(context: MemoryIdentityContext, commit: MemoryToolCommit): void
}

export function createMemoryNoticeWiring(options: MemoryNoticeWiringOptions): MemoryNoticeWiring {
  let api: MemoryExtensionAPI | undefined

  /**
   * The write notice is DECORATION: gathering probes git and the filesystem, so a failure or a
   * degraded gather drops this one entry and never disturbs the soul notice or the tool result.
   */
  async function emitWrite(
    context: MemoryIdentityContext,
    commit: MemoryToolCommit,
    sessionId: string,
  ): Promise<void> {
    if (api === undefined) return
    if (!options.resolveWriteNotice(context.identity)) return
    const gather = options.gatherWriteNotice ?? defaultGatherWriteNotice
    let notice: MemoryWriteNotice | undefined
    try {
      notice = await gather(context, commit, sessionId)
    } catch {
      return
    }
    if (notice === undefined) return
    api.appendEntry(MEMORY_WRITE_UPDATED_ENTRY_TYPE, notice)
  }

  function emitSoul(identity: string, commit: MemoryToolCommit): void {
    if (api === undefined) return
    if (!touchesSoulPath(commit.affectedPaths)) return
    if (!options.resolveEditNotice(identity)) return
    api.appendEntry(SOUL_UPDATED_ENTRY_TYPE, {
      sha: commit.sha,
      subject: commit.subject,
      affectedPaths: commit.affectedPaths,
    } satisfies SoulUpdatedRecord)
  }

  return {
    register(pi): void {
      api = pi
      pi.registerEntryRenderer(SOUL_UPDATED_ENTRY_TYPE, renderSoulUpdatedEntry)
      pi.registerEntryRenderer(MEMORY_WRITE_UPDATED_ENTRY_TYPE, renderMemoryWriteUpdatedEntry)
      pi.on("tool_result", async (payload, eventCtx) => {
        if (!isRecord(payload) || payload.type !== "tool_result") return
        if (!isMemoryMcpToolName(payload.toolName)) return
        if (typeof payload.toolCallId !== "string" || payload.toolCallId.length === 0) return
        const sessionId = readSessionId(eventCtx)
        if (sessionId === undefined) return
        const context = options.resolveContext(sessionId)
        if (context === undefined) return
        const consume = options.consumeReceipt ?? consumeToolReceipt
        // ONE read per tool_result: the receipt is read-and-deleted, so every notice below is
        // derived from this single commit record.
        const receipt = await consume(context.identityPaths.toolReceipts, payload.toolCallId)
        if (receipt === undefined) return
        const commit: MemoryToolCommit = {
          sha: receipt.sha,
          subject: receipt.subject,
          affectedPaths: receipt.affectedPaths,
        }
        emitSoul(context.identity, commit)
        await emitWrite(context, commit, sessionId)
      })
    },

    // Direct surface only: the tool's own renderResult already draws the write notice on the tool
    // row, so emitting a write-updated entry here would notify twice for one commit.
    onCommit(context, commit): void {
      emitSoul(context.identity, commit)
    },
  }
}

async function defaultGatherWriteNotice(
  context: MemoryIdentityContext,
  commit: MemoryToolCommit,
  sessionId: string,
): Promise<MemoryWriteNotice | undefined> {
  // Bounded: a wedged git or filesystem probe degrades the entry, it never stalls the event loop
  // handler the host awaits.
  return await Promise.race([
    gatherMemoryWriteNotice(context, commit, { sessionId }),
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, WRITE_NOTICE_BUDGET_MS).unref?.()
    }),
  ])
}

/** Same budget the direct surface gives its own gather; the entry is decoration, not the write. */
const WRITE_NOTICE_BUDGET_MS = 3_000

function isMemoryMcpToolName(value: unknown): boolean {
  return value === MEMORY_MCP_TOOL_NAME || value === MEMORY_MCP_APPLY_PATCH_TOOL_NAME
}

function readSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const manager = eventCtx.sessionManager
  const getter = manager.getSessionId
  if (typeof getter !== "function") return undefined
  const value = Reflect.apply(getter, manager, [])
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
