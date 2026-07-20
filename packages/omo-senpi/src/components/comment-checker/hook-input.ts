import type { HookInput } from "@oh-my-opencode/comment-checker-core"

import type { ToolResultContentBlock, ToolResultContextLike, ToolResultEventLike } from "./types"
import { getString, isRecord, isUnknownFunction } from "./utils"

export function toHookInput(event: ToolResultEventLike, ctx: ToolResultContextLike, absolutePath: string): HookInput {
  return {
    session_id: ctx.sessionManager?.getSessionId?.() ?? "unknown",
    tool_name: event.toolName,
    transcript_path: ctx.sessionManager?.getSessionFile?.() ?? "",
    cwd: ctx.cwd,
    hook_event_name: "PostToolUse",
    tool_input: toCoreToolInput(event.input, absolutePath),
    tool_response: {
      content: event.content,
      details: event.details,
      isError: event.isError,
    },
  }
}

function toCoreToolInput(input: Record<string, unknown>, absolutePath: string): HookInput["tool_input"] {
  const coreInput: {
    file_path: string
    content?: string
    old_string?: string
    new_string?: string
    edits?: readonly { old_string: string; new_string: string }[]
  } = {
    file_path: absolutePath,
  }

  const content = getString(input.content)
  if (content !== undefined) {
    coreInput.content = content
  }

  const oldString = getString(input.old_string) ?? getString(input.oldText)
  const newString = getString(input.new_string) ?? getString(input.newText)
  if (oldString !== undefined) {
    coreInput.old_string = oldString
  }
  if (newString !== undefined) {
    coreInput.new_string = newString
  }

  const edits = parseEdits(input.edits)
  if (edits.length > 0) {
    coreInput.edits = edits
  }

  return coreInput
}

function parseEdits(value: unknown): readonly { old_string: string; new_string: string }[] {
  if (!Array.isArray(value)) {
    return []
  }

  const edits: { old_string: string; new_string: string }[] = []
  for (const item of value) {
    if (!isRecord(item)) {
      continue
    }
    const oldString = getString(item.old_string) ?? getString(item.oldText)
    const newString = getString(item.new_string) ?? getString(item.newText)
    if (oldString !== undefined && newString !== undefined) {
      edits.push({ old_string: oldString, new_string: newString })
    }
  }
  return edits
}

export function parseToolResultEvent(value: unknown): ToolResultEventLike | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (
    value.type !== "tool_result" ||
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string" ||
    !isRecord(value.input) ||
    !Array.isArray(value.content) ||
    typeof value.isError !== "boolean"
  ) {
    return undefined
  }

  return {
    type: "tool_result",
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    input: value.input,
    content: value.content.filter(isToolResultContentBlock),
    details: value.details,
    isError: value.isError,
  }
}

export function parseToolResultContext(value: unknown): ToolResultContextLike {
  if (!isRecord(value)) {
    return { cwd: process.cwd() }
  }

  const cwd = getString(value.cwd) ?? process.cwd()
  const sessionManager = isRecord(value.sessionManager) ? value.sessionManager : undefined
  const getSessionIdValue = sessionManager?.getSessionId
  const getSessionFileValue = sessionManager?.getSessionFile
  return {
    cwd,
    sessionManager: {
      getSessionId: isUnknownFunction(getSessionIdValue)
        ? () => {
            const sessionId = getSessionIdValue.call(sessionManager)
            return getString(sessionId) ?? "unknown"
          }
        : undefined,
      getSessionFile: isUnknownFunction(getSessionFileValue)
        ? () => {
            const sessionFile = getSessionFileValue.call(sessionManager)
            return getString(sessionFile)
          }
        : undefined,
    },
  }
}

function isToolResultContentBlock(value: unknown): value is ToolResultContentBlock {
  return isRecord(value)
}
