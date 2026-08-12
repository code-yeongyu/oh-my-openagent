// Soul-edit visible notice channel (plan IC-4 / todo 7). A committed change
// touching system/persona.md or system/identity.md emits a NON-MODEL-FACING
// entry through appendEntry + registerEntryRenderer; sendMessage is never used
// because senpi converts it into user-role model context. On the direct tool
// surface the commit metadata arrives through MemoryToolsOptions.onCommit; on
// the MCP surface it arrives through the out-of-band receipt consumed by the
// tool_result handler (plan IC-17). Emission is gated by memory.soul.edit_notice;
// the tool-result discipline line is unconditional and lives in memory-core.

import type { EntryRenderer } from "@code-yeongyu/senpi"
import { touchesSoulPath, type MemoryToolCommit } from "@oh-my-opencode/memory-core"
import { linesComponent, normalizeRendererText } from "@oh-my-opencode/senpi-task"

import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { MEMORY_MCP_APPLY_PATCH_TOOL_NAME, MEMORY_MCP_TOOL_NAME } from "./tool-metadata"
import { consumeToolReceipt } from "./tool-receipts"

export const SOUL_UPDATED_ENTRY_TYPE = "omo-memory:soul-updated"

export interface SoulUpdatedRecord {
  readonly sha: string
  readonly subject: string
  readonly affectedPaths: readonly string[]
}

export const renderSoulUpdatedEntry: EntryRenderer<SoulUpdatedRecord> = (entry) => {
  const record = entry.data
  if (!record) return undefined
  return linesComponent([
    `memory soul updated ${normalizeRendererText(record.sha.slice(0, 7))}: ${normalizeRendererText(record.subject)}`,
    ...record.affectedPaths.map((path) => normalizeRendererText(path)),
  ])
}

export interface SoulNoticeWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveEditNotice: (identity: string) => boolean
}

export interface SoulNoticeWiring {
  register(pi: MemoryExtensionAPI): void
  onCommit(context: MemoryIdentityContext, commit: MemoryToolCommit): void
}

export function createSoulNoticeWiring(options: SoulNoticeWiringOptions): SoulNoticeWiring {
  let api: MemoryExtensionAPI | undefined

  function emit(identity: string, commit: MemoryToolCommit): void {
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
      pi.on("tool_result", async (payload, eventCtx) => {
        if (!isRecord(payload) || payload.type !== "tool_result") return
        if (!isMemoryMcpToolName(payload.toolName)) return
        if (typeof payload.toolCallId !== "string" || payload.toolCallId.length === 0) return
        const sessionId = readSessionId(eventCtx)
        if (sessionId === undefined) return
        const context = options.resolveContext(sessionId)
        if (context === undefined) return
        const receipt = await consumeToolReceipt(context.identityPaths.toolReceipts, payload.toolCallId)
        if (receipt === undefined) return
        emit(context.identity, {
          sha: receipt.sha,
          subject: receipt.subject,
          affectedPaths: receipt.affectedPaths,
        })
      })
    },

    onCommit(context, commit): void {
      emit(context.identity, commit)
    },
  }
}

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
