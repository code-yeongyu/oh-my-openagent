import type { ToolContext } from "@opencode-ai/plugin/tool"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { applyHashlineEditsWithReport } from "./edit-operations"
import { countLineDiffs, generateUnifiedDiff } from "./diff-utils"
import { canonicalizeFileText, restoreFileText } from "./file-text-canonicalization"
import { normalizeHashlineEdits, type RawHashlineEdit } from "./normalize-edits"
import type { HashlineEdit } from "./types"
import { HashlineMismatchError } from "./validation"

interface HashlineEditArgs {
  filePath: string
  edits: RawHashlineEdit[]
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
  return edits.every((edit) => edit.op === "append" || edit.op === "prepend")
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
  const beforeLines = beforeContent.split("\n")
  const afterLines = afterContent.split("\n")
  const maxLength = Math.max(beforeLines.length, afterLines.length)
  let firstChangedLine: number | undefined

  for (let index = 0; index < maxLength; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      firstChangedLine = index + 1
      break
    }
  }

  return {
    title: effectivePath,
    metadata: {
      filePath: effectivePath,
      path: effectivePath,
      file: effectivePath,
      diff: unifiedDiff,
      noopEdits,
      deduplicatedEdits,
      firstChangedLine,
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
    const { delete: deleteMode, rename } = args

    if (!deleteMode && (!args.edits || !Array.isArray(args.edits) || args.edits.length === 0)) {
      return "Error: edits parameter must be a non-empty array"
    }

    const edits = deleteMode ? [] : normalizeHashlineEdits(args.edits)

    if (deleteMode && rename) {
      return "Error: delete and rename cannot be used together"
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

    if (canonicalNewContent === oldEnvelope.content && !rename) {
      let diagnostic = `No changes made to ${filePath}. The edits produced identical content.`
      if (applyResult.noopEdits > 0) {
        diagnostic += ` No-op edits: ${applyResult.noopEdits}. Re-read the file and provide content that differs from current lines.`
      }
      return `Error: ${diagnostic}`
    }

    const writeContent = restoreFileText(canonicalNewContent, oldEnvelope)

    await Bun.write(filePath, writeContent)

    if (rename && rename !== filePath) {
      await Bun.write(rename, writeContent)
      await Bun.file(filePath).delete()
    }

    const effectivePath = rename && rename !== filePath ? rename : filePath
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

    if (rename && rename !== filePath) {
      return `Moved ${filePath} to ${rename}`
    }

    return `Updated ${effectivePath}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof HashlineMismatchError) {
      return `Error: hash mismatch - ${message}\nTip: reuse LINE#ID entries from the latest read/edit output, or batch related edits in one call.`
    }
    return `Error: ${message}`
  }
}
