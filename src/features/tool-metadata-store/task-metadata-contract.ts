import { log } from "../../shared/logger"

export interface TaskLink {
  sessionId?: string
  taskId?: string
  backgroundTaskId?: string
  agent?: string
  category?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

function readSessionIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return readString(metadata.sessionId) ?? readString(metadata.sessionID) ?? readString(metadata.session_id)
}

function readTaskIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return readString(metadata.taskId) ?? readString(metadata.taskID) ?? readString(metadata.task_id)
}

function readBackgroundTaskIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return readString(metadata.backgroundTaskId)
    ?? readString(metadata.backgroundTaskID)
    ?? readString(metadata.background_task_id)
}

function readAgentFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return readString(metadata.agent) ?? readString(metadata.subagent)
}

function readCategoryFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return readString(metadata.category)
}

function extractTaskMetadataContent(text: string): string | undefined {
  const blocks = [...text.matchAll(/<task_metadata>([\s\S]*?)<\/task_metadata>/gi)]
  return blocks.at(-1)?.[1]
}

function extractExplicitSessionId(text: string): string | undefined {
  const matches = [...text.matchAll(/Session ID:\s*(ses_[a-zA-Z0-9_-]+)/g)]
  return matches.at(-1)?.[1]
}

export function buildTaskMetadataBlock(link: TaskLink): string {
  const lines: string[] = []

  if (link.sessionId) {
    lines.push(`session_id: ${link.sessionId}`)
  }
  if (link.taskId) {
    lines.push(`task_id: ${link.taskId}`)
  }
  if (link.backgroundTaskId) {
    lines.push(`background_task_id: ${link.backgroundTaskId}`)
  }
  if (link.agent) {
    lines.push(`subagent: ${link.agent}`)
  }
  if (link.category) {
    lines.push(`category: ${link.category}`)
  }

  return `<task_metadata>\n${lines.join("\n")}\n</task_metadata>`
}

export function parseTaskMetadataBlock(text: string): TaskLink {
  const blockContent = extractTaskMetadataContent(text) ?? text
  const lines = blockContent
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)

  const parsed: TaskLink = {}

  for (const line of lines) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = readString(line.slice(separatorIndex + 1))

    if (!value) {
      continue
    }

    if (key === "session_id") {
      parsed.sessionId = value
    } else if (key === "task_id") {
      parsed.taskId = value
    } else if (key === "background_task_id") {
      parsed.backgroundTaskId = value
    } else if (key === "subagent" || key === "agent") {
      parsed.agent = value
    } else if (key === "category") {
      parsed.category = value
    }
  }

  return parsed
}

export function extractTaskLink(metadata: unknown, outputText: string): TaskLink {
  if (isRecord(metadata)) {
    const metadataLink: TaskLink = {
      sessionId: readSessionIdFromMetadata(metadata),
      taskId: readTaskIdFromMetadata(metadata),
      backgroundTaskId: readBackgroundTaskIdFromMetadata(metadata),
      agent: readAgentFromMetadata(metadata),
      category: readCategoryFromMetadata(metadata),
    }

    if (metadataLink.sessionId || metadataLink.taskId || metadataLink.backgroundTaskId || metadataLink.agent || metadataLink.category) {
      return metadataLink
    }
  }

  const parsed = parseTaskMetadataBlock(outputText)
  if (parsed.sessionId || parsed.taskId || parsed.backgroundTaskId || parsed.agent || parsed.category) {
    log("[tool-metadata-store] Falling back to <task_metadata> parsing")
    return parsed
  }

  const explicitSessionId = extractExplicitSessionId(outputText)
  if (explicitSessionId) {
    log("[tool-metadata-store] Falling back to explicit Session ID parsing")
    return { sessionId: explicitSessionId }
  }

  return {}
}
