import type { Part } from "@opencode-ai/sdk"
import type { ToolRegistry } from "../../shared/tool-registry"
import type { MessageWithParts, ToolUsePart, ToolResultPart, TextPart } from "./types"
import {
  INVALID_TOOL_PLACEHOLDER_PREFIX,
  INVALID_TOOL_PLACEHOLDER_SUFFIX,
  PAIRED_RESULT_PLACEHOLDER,
} from "./constants"

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function isToolUsePart(part: Part): part is ToolUsePart {
  const type = part.type as string
  return type === "tool_use" || type === "tool"
}

function isToolResultPart(part: Part): part is ToolResultPart {
  const type = part.type as string
  return type === "tool_result"
}

function getToolName(part: ToolUsePart): string | undefined {
  return part.name || part.tool
}

function getToolUseIdFromResult(part: Part): string | undefined {
  return (part as { tool_use_id?: string }).tool_use_id
}

function createInvalidToolPlaceholder(toolName: string): TextPart {
  return {
    type: "text",
    text: `${INVALID_TOOL_PLACEHOLDER_PREFIX}${toolName}${INVALID_TOOL_PLACEHOLDER_SUFFIX}`,
    synthetic: true,
  } as TextPart
}

function createPairedResultPlaceholder(): TextPart {
  return {
    type: "text",
    text: PAIRED_RESULT_PLACEHOLDER,
    synthetic: true,
  } as TextPart
}

export function createToolCallValidatorHook(
  registry: ToolRegistry
): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      if (!messages || messages.length === 0) {
        return
      }

      const invalidatedToolUseIds = new Set<string>()

      for (const message of messages) {
        if (message.info.role === "user") {
          continue
        }

        const parts = message.parts
        if (!parts || parts.length === 0) {
          continue
        }

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]

          if (isToolUsePart(part)) {
            const toolName = getToolName(part)

            if (toolName && !registry.isValidTool(toolName)) {
              if (part.id) {
                invalidatedToolUseIds.add(part.id)
              }

              parts[i] = createInvalidToolPlaceholder(toolName)
            }
          } else if (isToolResultPart(part)) {
            const toolUseId = getToolUseIdFromResult(part)

            if (toolUseId && invalidatedToolUseIds.has(toolUseId)) {
              parts[i] = createPairedResultPlaceholder()
            }
          }
        }
      }
    },
  }
}
