import type { ToolDefinition } from "@opencode-ai/plugin"
import { truncateDescription } from "../shared/truncate-description"
import type { ToolsRecord } from "./types"

const COMPACT_TOOL_DESCRIPTION_LENGTH = 96

export function compactToolDescriptionText(description: string): string {
  const firstParagraph = description.split(/\n\s*\n/)[0]?.trim() || description.trim()
  return truncateDescription(firstParagraph.replace(/\s+/g, " "), COMPACT_TOOL_DESCRIPTION_LENGTH)
}

export function compactToolDescription(toolDefinition: ToolDefinition): void {
  const descriptor = Object.getOwnPropertyDescriptor(toolDefinition, "description")

  if (descriptor?.get) {
    const readOriginalDescription = descriptor.get.bind(toolDefinition)
    Object.defineProperty(toolDefinition, "description", {
      ...descriptor,
      get() {
        const description = readOriginalDescription()
        return typeof description === "string"
          ? compactToolDescriptionText(description)
          : description
      },
    })
    return
  }

  if (typeof descriptor?.value !== "string") return

  Object.defineProperty(toolDefinition, "description", {
    ...descriptor,
    value: compactToolDescriptionText(descriptor.value),
  })
}

type CompactToolDescriptionsOptions = {
  readonly excludedToolNames?: ReadonlySet<string>
}

export function compactToolDescriptions(
  tools: ToolsRecord,
  options: CompactToolDescriptionsOptions = {}
): void {
  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (options.excludedToolNames?.has(toolName)) continue

    compactToolDescription(toolDefinition)
  }
}
