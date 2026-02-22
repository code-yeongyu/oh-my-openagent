import type { ToolContext } from "@opencode-ai/plugin/tool"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { applyHashlineEditsWithReport } from "./edit-operations"
import { countLineDiffs, generateUnifiedDiff, toHashlineContent } from "./diff-utils"
import { canonicalizeFileText, restoreFileText } from "./file-text-canonicalization"
import { generateHashlineDiff } from "./hashline-edit-diff"
import type { HashlineEdit } from "./types"

interface HashlineEditArgs {
  filePath: string
  edits: HashlineEdit[]
  delete?: boolean
  rename?: string
}

type ToolContextWithCallID = ToolContext & {
  callID?: string
  callId?: string
  call_id?: string
}

type ToolContextWithMetadata = ToolContextWithCallID & {
  metadata?: (value: unknown) => void
}

function resolveToolCallID(ctx: ToolContextWithCallID): string | undefined {
  if (typeof ctx.callID === "string" && ctx.callID.trim() !== "") return ctx.callID
  if (typeof ctx.callId === "string" && ctx.callId.trim() !== "") return ctx.callId
  if (typeof ctx.call_id === "string" && ctx.call_id.trim() !== "") return ctx.call_id
  return undefined
}

function canCreateFromMissingFile(edits: HashlineEdit[]): boolean {
  if (edits.length === 0) return false
  return edits.every((edit) => edit.type === "append" || edit.type === "prepend")
}

function buildSuccessMeta(
  effectivePath: string,
  beforeContent: string,
  afterContent: string,
  noopEdits: number,
  deduplicatedEdits: number
) {
  const unifiedDiff = generateUnifiedDiff(beforeContent, afterContent, effectivePath)
  const { additions, deletions } = countLineDiffs(beforeContent, afterContent)

  return {
    title: effectivePath,
    metadata: {
      filePath: effectivePath,
      path: effectivePath,
      file: effectivePath,
      diff: unifiedDiff,
      noopEdits,
      deduplicatedEdits,
      filediff: {
        file: effectivePath,
        path: effectivePath,
        filePath: effectivePath,
        before: beforeContent,
        after: afterContent,
        additions,
        deletions,
      },
    },
  }
}

export async function executeHashlineEditTool(args: HashlineEditArgs, context: ToolContext): Promise<string> {
  try {
    const metadataContext = context as ToolContextWithMetadata
    const filePath = args.filePath
    const { edits, delete: deleteMode, rename } = args

    if (deleteMode && rename) {
      return "Error: delete and rename cannot be used together"
    }
    if (!deleteMode && (!edits || !Array.isArray(edits) || edits.length === 0)) {
      return "Error: edits parameter must be a non-empty array"
    }
    if (deleteMode && edits.length > 0) {
      return "Error: delete mode requires edits to be an empty array"
    }

    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists && !deleteMode && !canCreateFromMissingFile(edits)) {
      return `Error: File not found: ${filePath}`
    }

    if (deleteMode) {
      if (!exists) return `Error: File not found: ${filePath}`
      await Bun.file(filePath).delete()
      return `Successfully deleted ${filePath}`
    }

    const rawOldContent = exists ? Buffer.from(await file.arrayBuffer()).toString("utf8") : ""
    const oldEnvelope = canonicalizeFileText(rawOldContent)

    const applyResult = applyHashlineEditsWithReport(oldEnvelope.content, edits)
    const canonicalNewContent = applyResult.content
    const writeContent = restoreFileText(canonicalNewContent, oldEnvelope)

    await Bun.write(filePath, writeContent)

    if (rename && rename !== filePath) {
      await Bun.write(rename, writeContent)
      await Bun.file(filePath).delete()
    }

    const effectivePath = rename && rename !== filePath ? rename : filePath
    const diff = generateHashlineDiff(oldEnvelope.content, canonicalNewContent, effectivePath)
    const newHashlined = toHashlineContent(canonicalNewContent)
    const meta = buildSuccessMeta(
      effectivePath,
      oldEnvelope.content,
      canonicalNewContent,
      applyResult.noopEdits,
      applyResult.deduplicatedEdits
    )

    if (typeof metadataContext.metadata === "function") {
      metadataContext.metadata(meta)
    }

    const callID = resolveToolCallID(metadataContext)
    if (callID) {
      storeToolMetadata(context.sessionID, callID, meta)
    }

    return `Successfully applied ${edits.length} edit(s) to ${effectivePath}
No-op edits: ${applyResult.noopEdits}, deduplicated edits: ${applyResult.deduplicatedEdits}

${diff}

Updated file (LINE#ID:content):
${newHashlined}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes("hash")) {
      return `Error: hash mismatch - ${message}\nTip: reuse LINE#ID entries from the latest read/edit output, or batch related edits in one call.`
    }
    return `Error: ${message}`
  }
}
