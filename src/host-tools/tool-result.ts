import type { HostToolContent, HostToolResult, JsonValue } from "../host-contract"

export type OpenCodeToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: JsonValue
      attachments?: readonly unknown[]
    }

export type TargetToolResult<TDetails = unknown> = {
  content: readonly HostToolContent[]
  details?: TDetails
  isError?: boolean
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}

function createTextContent(text: string): HostToolContent {
  return { type: "text", text }
}

export function normalizeOpenCodeToolResult(result: OpenCodeToolResult): HostToolResult {
  if (typeof result === "string") {
    return { content: [createTextContent(result)] }
  }

  return {
    content: [createTextContent(result.output)],
    details: {
      title: result.title,
      metadata: result.metadata,
      attachments: result.attachments,
    },
  }
}

export function createHostToolErrorResult(error: unknown): HostToolResult {
  return {
    content: [createTextContent(stringifyUnknown(error))],
    isError: true,
  }
}

export function toTargetToolResult<TDetails = unknown>(result: HostToolResult<TDetails>): TargetToolResult<TDetails> {
  return {
    content: result.content,
    details: result.details,
    isError: result.isError,
  }
}
