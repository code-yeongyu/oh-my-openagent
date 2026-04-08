import type { PluginInput } from "@opencode-ai/plugin"
import type { ImageAttachment, ImageDimensions } from "./types"
import { parseImageDimensions } from "./image-dimensions"
import { calculateTargetDimensions, resizeImage } from "./image-resizer"
import { log } from "../../shared"
import { getSessionModel } from "../../shared/session-model-state"
const SUPPORTED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const TOKEN_DIVISOR = 750
interface ResizeEntry {
  filename: string
  originalDims: ImageDimensions | null
  resizedDims: ImageDimensions | null
  status: "resized" | "within-limits" | "resize-skipped" | "unknown-dims"
}
function isReadTool(toolName: string): boolean {
  return toolName.toLowerCase() === "read"
}
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
function isImageAttachmentRecord(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ImageAttachment {
  const filename = value.filename
  return (
    typeof value.mime === "string" &&
    typeof value.url === "string" &&
    (typeof filename === "undefined" || typeof filename === "string")
  )
}
function extractImageAttachments(output: Record<string, unknown>): ImageAttachment[] {
  const attachmentsValue = output.attachments
  if (!Array.isArray(attachmentsValue)) {
    return []
  }
  const attachments: ImageAttachment[] = []
  for (const attachmentValue of attachmentsValue) {
    const attachmentRecord = asRecord(attachmentValue)
    if (!attachmentRecord) {
      continue
    }

    const mime = attachmentRecord.mime
    const url = attachmentRecord.url
    if (typeof mime !== "string" || typeof url !== "string") {
      continue
    }

    const normalizedMime = mime.toLowerCase()
    if (!SUPPORTED_IMAGE_MIMES.has(normalizedMime)) {
      continue
    }

    attachmentRecord.mime = normalizedMime
    attachmentRecord.url = url
    if (isImageAttachmentRecord(attachmentRecord)) {
      attachments.push(attachmentRecord)
    }
  }

  return attachments
}
function calculateTokens(width: number, height: number): number {
  return Math.ceil((width * height) / TOKEN_DIVISOR)
}
function formatResizeAppendix(entries: ResizeEntry[]): string {
  const header = entries.some((entry) => entry.status === "resized") ? "[Image Resize Info]" : "[Image Info]"
  const lines = [`\n\n${header}`]

  for (const entry of entries) {
    if (entry.status === "unknown-dims" || !entry.originalDims) {
      lines.push(`- ${entry.filename}: dimensions could not be parsed`)
      continue
    }

    const original = entry.originalDims
    const originalText = `${original.width}x${original.height}`
    const originalTokens = calculateTokens(original.width, original.height)

    if (entry.status === "within-limits") {
      lines.push(`- ${entry.filename}: ${originalText} (within limits, tokens: ${originalTokens})`)
      continue
    }

    if (entry.status === "resize-skipped") {
      lines.push(`- ${entry.filename}: ${originalText} (exceeds provider limits, image removed to prevent API error)`)
      continue
    }

    if (!entry.resizedDims) {
      lines.push(`- ${entry.filename}: ${originalText} (resize skipped, tokens: ${originalTokens})`)
      continue
    }

    const resized = entry.resizedDims
    const resizedText = `${resized.width}x${resized.height}`
    const resizedTokens = calculateTokens(resized.width, resized.height)
    lines.push(
      `- ${entry.filename}: ${originalText} -> ${resizedText} (resized, tokens: ${originalTokens} -> ${resizedTokens})`,
    )
  }

  return lines.join("\n")
}
function resolveFilename(attachment: ImageAttachment, index: number): string {
  if (attachment.filename && attachment.filename.trim().length > 0) {
    return attachment.filename
  }

  return `image-${index + 1}`
}
export function createReadImageResizerHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (!isReadTool(input.tool)) {
        return
      }

      const sessionModel = getSessionModel(input.sessionID)
      if (sessionModel?.providerID !== "anthropic") {
        return
      }

      if (typeof output.output !== "string") {
        return
      }

      const outputRecord = output as Record<string, unknown>
      const attachments = extractImageAttachments(outputRecord)
      if (attachments.length === 0) {
        return
      }

      const entries: ResizeEntry[] = []
      const attachmentsToRemove: ImageAttachment[] = []
      for (const [index, attachment] of attachments.entries()) {
        const filename = resolveFilename(attachment, index)

        try {
          const originalDims = parseImageDimensions(attachment.url, attachment.mime)
          if (!originalDims) {
            entries.push({ filename, originalDims: null, resizedDims: null, status: "unknown-dims" })
            continue
          }

          const targetDims = calculateTargetDimensions(originalDims.width, originalDims.height)
          if (!targetDims) {
            entries.push({
              filename,
              originalDims,
              resizedDims: null,
              status: "within-limits",
            })
            continue
          }

          const resizedResult = await resizeImage(attachment.url, attachment.mime, targetDims)
          if (!resizedResult) {
            attachmentsToRemove.push(attachment)
            entries.push({
              filename,
              originalDims,
              resizedDims: null,
              status: "resize-skipped",
            })
            continue
          }

          attachment.url = resizedResult.resizedDataUrl

          entries.push({
            filename,
            originalDims: resizedResult.original,
            resizedDims: resizedResult.resized,
            status: "resized",
          })
        } catch (error) {
          log("[read-image-resizer] attachment processing failed", {
            error: error instanceof Error ? error.message : String(error),
            filename,
          })
          entries.push({ filename, originalDims: null, resizedDims: null, status: "unknown-dims" })
        }
      }

      if (attachmentsToRemove.length > 0) {
        const rawAttachments = outputRecord.attachments as unknown[]
        for (const toRemove of attachmentsToRemove) {
          const removeIndex = rawAttachments.indexOf(toRemove)
          if (removeIndex !== -1) {
            rawAttachments.splice(removeIndex, 1)
          }
        }
      }

      if (entries.length === 0) {
        return
      }

      output.output += formatResizeAppendix(entries)
    },
  }
}
