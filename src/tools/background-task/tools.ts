import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import type { BackgroundTaskArgs, BackgroundOutputArgs, BackgroundCancelArgs } from "./types"
import { BACKGROUND_TASK_DESCRIPTION, BACKGROUND_OUTPUT_DESCRIPTION, BACKGROUND_CANCEL_DESCRIPTION } from "./constants"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { consumeNewMessages } from "../../shared/session-cursor"
import { storeToolMetadata } from "../../features/tool-metadata-store"

type BackgroundOutputMessage = {
  info?: { role?: string; time?: string | { created?: number }; agent?: string }
  parts?: Array<{
    type?: string
    text?: string
    content?: string | Array<{ type: string; text?: string }>
    name?: string
  }>
}

type BackgroundOutputMessagesResult =
  | { data?: BackgroundOutputMessage[]; error?: unknown }
  | BackgroundOutputMessage[]

export type BackgroundOutputClient = {
  session: {
    messages: (args: { path: { id: string } }) => Promise<BackgroundOutputMessagesResult>
  }
}

export type BackgroundCancelClient = {
  session: {
    abort: (args: { path: { id: string } }) => Promise<unknown>
  }
}

export type BackgroundOutputManager = Pick<BackgroundManager, "getTask">

const MAX_MESSAGE_LIMIT = 100
const THINKING_MAX_CHARS = 2000

type FullSessionMessagePart = {
  type?: string
  text?: string
  thinking?: string
  content?: string | Array<{ type?: string; text?: string }>
  output?: string
}

type FullSessionMessage = {
  id?: string
  info?: { role?: string; time?: string; agent?: string }
  parts?: FullSessionMessagePart[]
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}

export function createBackgroundTask(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: BACKGROUND_TASK_DESCRIPTION,
    args: {
      description: tool.schema.string().describe("Short task description (shown in status)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      agent: tool.schema.string().describe("Agent type to use (any registered agent)"),
    },
    async execute(args: BackgroundTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (!args.agent || args.agent.trim() === "") {
        return `[ERROR] Agent parameter is required. Please specify which agent to use (e.g., "explore", "librarian", "build", etc.)`
      }

      try {
        const messageDir = getMessageDir(ctx.sessionID)
        const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
        const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
        const sessionAgent = getSessionAgent(ctx.sessionID)
        const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent
        
        log("[background_task] parentAgent resolution", {
          sessionID: ctx.sessionID,
          ctxAgent: ctx.agent,
          sessionAgent,
          firstMessageAgent,
          prevMessageAgent: prevMessage?.agent,
          resolvedParentAgent: parentAgent,
        })
        
        const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
          ? { 
              providerID: prevMessage.model.providerID, 
              modelID: prevMessage.model.modelID,
              ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {})
            }
          : undefined

        const task = await manager.launch({
          description: args.description,
          prompt: args.prompt,
          agent: args.agent.trim(),
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          parentModel,
          parentAgent,
        })

        const WAIT_FOR_SESSION_INTERVAL_MS = 50
        const WAIT_FOR_SESSION_TIMEOUT_MS = 30000
        const waitStart = Date.now()
        let sessionId = task.sessionID
        while (!sessionId && Date.now() - waitStart < WAIT_FOR_SESSION_TIMEOUT_MS) {
          if (ctx.abort?.aborted) {
            await manager.cancelTask(task.id)
            return `Task aborted and cancelled while waiting for session to start.\n\nTask ID: ${task.id}`
          }
          await delay(WAIT_FOR_SESSION_INTERVAL_MS)
          const updated = manager.getTask(task.id)
          if (!updated || updated.status === "error") {
            return `Task ${!updated ? "was deleted" : `entered error state`}.\n\nTask ID: ${task.id}`
          }
          sessionId = updated?.sessionID
        }

        const bgMeta = {
          title: args.description,
          metadata: { sessionId: sessionId ?? "pending" } as Record<string, unknown>,
        }
        await ctx.metadata?.(bgMeta)
        const callID = (ctx as any).callID as string | undefined
        if (callID) {
          storeToolMetadata(ctx.sessionID, callID, bgMeta)
        }

        return `Background task launched successfully.

Task ID: ${task.id}
Session ID: ${sessionId ?? "pending"}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

The system will notify you when the task completes.
Use \`background_output\` tool with task_id="${task.id}" to check progress:
- block=false (default): Check status immediately - returns full status info
- block=true: Wait for completion (rarely needed since system notifies)`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `[ERROR] Failed to launch background task: ${message}`
      }
    },
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

function formatTaskStatus(task: BackgroundTask): string {
  let duration: string
  if (task.status === "pending" && task.queuedAt) {
    duration = formatDuration(task.queuedAt, undefined)
  } else if (task.startedAt) {
    duration = formatDuration(task.startedAt, task.completedAt)
  } else {
    duration = "N/A"
  }
  const promptPreview = truncateText(task.prompt, 500)
  
  let progressSection = ""
  if (task.progress?.lastTool) {
    progressSection = `\n| Last tool | ${task.progress.lastTool} |`
  }

  let lastMessageSection = ""
  if (task.progress?.lastMessage) {
    const truncated = truncateText(task.progress.lastMessage, 500)
    const messageTime = task.progress.lastMessageAt 
      ? task.progress.lastMessageAt.toISOString()
      : "N/A"
    lastMessageSection = `

## Last Message (${messageTime})

\`\`\`
${truncated}
\`\`\``
  }

  let statusNote = ""
  if (task.status === "pending") {
    statusNote = `

> **Queued**: Task is waiting for a concurrency slot to become available.`
  } else if (task.status === "running") {
    statusNote = `

> **Note**: No need to wait explicitly - the system will notify you when this task completes.`
  } else if (task.status === "error") {
    statusNote = `

> **Failed**: The task encountered an error. Check the last message for details.`
  }

  const durationLabel = task.status === "pending" ? "Queued for" : "Duration"

  return `# Task Status

| Field | Value |
|-------|-------|
| Task ID | \`${task.id}\` |
| Description | ${task.description} |
| Agent | ${task.agent} |
| Status | **${task.status}** |
| ${durationLabel} | ${duration} |
| Session ID | \`${task.sessionID}\` |${progressSection}
${statusNote}
## Original Prompt

\`\`\`
${promptPreview}
\`\`\`${lastMessageSection}`
}

function getErrorMessage(value: BackgroundOutputMessagesResult): string | null {
  if (Array.isArray(value)) return null
  if (value.error === undefined || value.error === null) return null
  if (typeof value.error === "string" && value.error.length > 0) return value.error
  return String(value.error)
}

function isSessionMessage(value: unknown): value is {
  info?: { role?: string; time?: string }
  parts?: Array<{
    type?: string
    text?: string
    content?: string | Array<{ type: string; text?: string }>
    name?: string
  }>
} {
  return typeof value === "object" && value !== null
}

function extractMessages(value: BackgroundOutputMessagesResult): BackgroundOutputMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isSessionMessage)
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isSessionMessage)
  }
  return []
}

async function formatTaskResult(task: BackgroundTask, client: BackgroundOutputClient): Promise<string> {
  if (!task.sessionID) {
    return `Error: Task has no sessionID`
  }
  
  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return `Error fetching messages: ${errorMessage}`
  }

  const messages = extractMessages(messagesResult)

  if (!Array.isArray(messages) || messages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No messages found)`
  }

  // Include both assistant messages AND tool messages
  // Tool results (grep, glob, bash output) come from role "tool"
  const relevantMessages = messages.filter(
    (m) => m.info?.role === "assistant" || m.info?.role === "tool"
  )

  if (relevantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No assistant or tool response found)`
  }

  // Sort by time ascending (oldest first) to process messages in order
  const sortedMessages = [...relevantMessages].sort((a, b) => {
    const timeA = String((a as { info?: { time?: string } }).info?.time ?? "")
    const timeB = String((b as { info?: { time?: string } }).info?.time ?? "")
    return timeA.localeCompare(timeB)
  })
  
  const newMessages = consumeNewMessages(task.sessionID, sortedMessages)
  if (newMessages.length === 0) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

(No new output since last check)`
  }

  // Extract content from ALL messages, not just the last one
  // Tool results may be in earlier messages while the final message is empty
  const extractedContent: string[] = []
  
  for (const message of newMessages) {
    for (const part of message.parts ?? []) {
      // Handle both "text" and "reasoning" parts (thinking models use "reasoning")
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text)
      } else if (part.type === "tool_result") {
        // Tool results contain the actual output from tool calls
        const toolResult = part as { content?: string | Array<{ type: string; text?: string }> }
        if (typeof toolResult.content === "string" && toolResult.content) {
          extractedContent.push(toolResult.content)
        } else if (Array.isArray(toolResult.content)) {
          // Handle array of content blocks
          for (const block of toolResult.content) {
            // Handle both "text" and "reasoning" parts (thinking models use "reasoning")
            if ((block.type === "text" || block.type === "reasoning") && block.text) {
              extractedContent.push(block.text)
            }
          }
        }
      }
    }
  }
  
  const textContent = extractedContent
    .filter((text) => text.length > 0)
    .join("\n\n")

  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent || "(No text output)"}`
}

function extractToolResultText(part: FullSessionMessagePart): string[] {
  if (typeof part.content === "string" && part.content.length > 0) {
    return [part.content]
  }

  if (Array.isArray(part.content)) {
    const blocks = part.content
      .filter((block) => (block.type === "text" || block.type === "reasoning") && block.text)
      .map((block) => block.text as string)
    if (blocks.length > 0) return blocks
  }

  if (part.output && part.output.length > 0) {
    return [part.output]
  }

  return []
}

async function formatFullSession(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: {
    includeThinking: boolean
    messageLimit?: number
    sinceMessageId?: string
    includeToolResults: boolean
    thinkingMaxChars?: number
  }
): Promise<string> {
  if (!task.sessionID) {
    return formatTaskStatus(task)
  }

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return `Error fetching messages: ${errorMessage}`
  }

  const rawMessages = extractMessages(messagesResult)
  if (!Array.isArray(rawMessages)) {
    return "Error fetching messages: invalid response"
  }

  const sortedMessages = [...(rawMessages as FullSessionMessage[])].sort((a, b) => {
    const timeA = String(a.info?.time ?? "")
    const timeB = String(b.info?.time ?? "")
    return timeA.localeCompare(timeB)
  })

  let filteredMessages = sortedMessages

  if (options.sinceMessageId) {
    const index = filteredMessages.findIndex((message) => message.id === options.sinceMessageId)
    if (index === -1) {
      return `Error: since_message_id not found: ${options.sinceMessageId}`
    }
    filteredMessages = filteredMessages.slice(index + 1)
  }

  const includeThinking = options.includeThinking
  const includeToolResults = options.includeToolResults
  const thinkingMaxChars = options.thinkingMaxChars ?? THINKING_MAX_CHARS

  const normalizedMessages: FullSessionMessage[] = []
  for (const message of filteredMessages) {
    const parts = (message.parts ?? []).filter((part) => {
      if (part.type === "thinking" || part.type === "reasoning") {
        return includeThinking
      }
      if (part.type === "tool_result") {
        return includeToolResults
      }
      return part.type === "text"
    })

    if (parts.length === 0) {
      continue
    }

    normalizedMessages.push({ ...message, parts })
  }

  const limit = typeof options.messageLimit === "number"
    ? Math.min(options.messageLimit, MAX_MESSAGE_LIMIT)
    : undefined
  const hasMore = limit !== undefined && normalizedMessages.length > limit
  const visibleMessages = limit !== undefined
    ? normalizedMessages.slice(0, limit)
    : normalizedMessages

  const lines: string[] = []
  lines.push("# Full Session Output")
  lines.push("")
  lines.push(`Task ID: ${task.id}`)
  lines.push(`Description: ${task.description}`)
  lines.push(`Status: ${task.status}`)
  lines.push(`Session ID: ${task.sessionID}`)
  lines.push(`Total messages: ${normalizedMessages.length}`)
  lines.push(`Returned: ${visibleMessages.length}`)
  lines.push(`Has more: ${hasMore ? "true" : "false"}`)
  lines.push("")
  lines.push("## Messages")

  if (visibleMessages.length === 0) {
    lines.push("")
    lines.push("(No messages found)")
    return lines.join("\n")
  }

  for (const message of visibleMessages) {
    const role = message.info?.role ?? "unknown"
    const agent = message.info?.agent ? ` (${message.info.agent})` : ""
    const time = formatMessageTime(message.info?.time)
    const idLabel = message.id ? ` id=${message.id}` : ""
    lines.push("")
    lines.push(`[${role}${agent}] ${time}${idLabel}`)

    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) {
        lines.push(part.text.trim())
      } else if (part.type === "thinking" && part.thinking) {
        lines.push(`[thinking] ${truncateText(part.thinking, thinkingMaxChars)}`)
      } else if (part.type === "reasoning" && part.text) {
        lines.push(`[thinking] ${truncateText(part.text, thinkingMaxChars)}`)
      } else if (part.type === "tool_result") {
        const toolTexts = extractToolResultText(part)
        for (const toolText of toolTexts) {
          lines.push(`[tool result] ${toolText}`)
        }
      }
    }
  }

  return lines.join("\n")
}

export function createBackgroundOutput(manager: BackgroundOutputManager, client: BackgroundOutputClient): ToolDefinition {
  return tool({
    description: BACKGROUND_OUTPUT_DESCRIPTION,
    args: {
      task_id: tool.schema.string().describe("Task ID to get output from"),
      block: tool.schema.boolean().optional().describe("Wait for completion (default: false). System notifies when done, so blocking is rarely needed."),
      timeout: tool.schema.number().optional().describe("Max wait time in ms (default: 60000, max: 600000)"),
      full_session: tool.schema.boolean().optional().describe("Return full session messages with filters (default: false)"),
      include_thinking: tool.schema.boolean().optional().describe("Include thinking/reasoning parts in full_session output (default: false)"),
      message_limit: tool.schema.number().optional().describe("Max messages to return (capped at 100)"),
      since_message_id: tool.schema.string().optional().describe("Return messages after this message ID (exclusive)"),
      include_tool_results: tool.schema.boolean().optional().describe("Include tool results in full_session output (default: false)"),
      thinking_max_chars: tool.schema.number().optional().describe("Max characters for thinking content (default: 2000)"),
    },
    async execute(args: BackgroundOutputArgs) {
      try {
        const task = manager.getTask(args.task_id)
        if (!task) {
          return `Task not found: ${args.task_id}`
        }

        if (args.full_session === true) {
          return await formatFullSession(task, client, {
            includeThinking: args.include_thinking === true,
            messageLimit: args.message_limit,
            sinceMessageId: args.since_message_id,
            includeToolResults: args.include_tool_results === true,
            thinkingMaxChars: args.thinking_max_chars,
          })
        }

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)

        // Already completed: return result immediately (regardless of block flag)
        if (task.status === "completed") {
          return await formatTaskResult(task, client)
        }

        // Error or cancelled: return status immediately
        if (task.status === "error" || task.status === "cancelled") {
          return formatTaskStatus(task)
        }

        // Non-blocking and still running: return status
        if (!shouldBlock) {
          return formatTaskStatus(task)
        }

        // Blocking: poll until completion or timeout
        const startTime = Date.now()

        while (Date.now() - startTime < timeoutMs) {
          await delay(1000)

          const currentTask = manager.getTask(args.task_id)
          if (!currentTask) {
            return `Task was deleted: ${args.task_id}`
          }

          if (currentTask.status === "completed") {
            return await formatTaskResult(currentTask, client)
          }

          if (currentTask.status === "error" || currentTask.status === "cancelled") {
            return formatTaskStatus(currentTask)
          }
        }

        // Timeout exceeded: return current status
        const finalTask = manager.getTask(args.task_id)
        if (!finalTask) {
          return `Task was deleted: ${args.task_id}`
        }
        return `Timeout exceeded (${timeoutMs}ms). Task still ${finalTask.status}.\n\n${formatTaskStatus(finalTask)}`
      } catch (error) {
        return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}

export function createBackgroundCancel(manager: BackgroundManager, client: BackgroundCancelClient): ToolDefinition {
  return tool({
    description: BACKGROUND_CANCEL_DESCRIPTION,
    args: {
      taskId: tool.schema.string().optional().describe("Task ID to cancel (required if all=false)"),
      all: tool.schema.boolean().optional().describe("Cancel all running background tasks (default: false)"),
    },
    async execute(args: BackgroundCancelArgs, toolContext) {
      try {
        const cancelAll = args.all === true

        if (!cancelAll && !args.taskId) {
          return `[ERROR] Invalid arguments: Either provide a taskId or set all=true to cancel all running tasks.`
        }

        if (cancelAll) {
          const tasks = manager.getAllDescendantTasks(toolContext.sessionID)
          const cancellableTasks = tasks.filter(t => t.status === "running" || t.status === "pending")

          if (cancellableTasks.length === 0) {
            return `No running or pending background tasks to cancel.`
          }

          const cancelledInfo: Array<{
            id: string
            description: string
            status: string
            sessionID?: string
          }> = []

          for (const task of cancellableTasks) {
            const originalStatus = task.status
            const cancelled = await manager.cancelTask(task.id, {
              source: "background_cancel",
              abortSession: originalStatus === "running",
              skipNotification: true,
            })
            if (!cancelled) continue
            cancelledInfo.push({
              id: task.id,
              description: task.description,
              status: originalStatus === "pending" ? "pending" : "running",
              sessionID: task.sessionID,
            })
          }

          const tableRows = cancelledInfo
            .map(t => `| \`${t.id}\` | ${t.description} | ${t.status} | ${t.sessionID ? `\`${t.sessionID}\`` : "(not started)"} |`)
            .join("\n")

           const resumableTasks = cancelledInfo.filter(t => t.sessionID)
           const resumeSection = resumableTasks.length > 0
             ? `\n## Continue Instructions

To continue a cancelled task, use:
\`\`\`
task(session_id="<session_id>", prompt="Continue: <your follow-up>")
\`\`\`

Continuable sessions:
${resumableTasks.map(t => `- \`${t.sessionID}\` (${t.description})`).join("\n")}`
             : ""

          return `Cancelled ${cancelledInfo.length} background task(s):

| Task ID | Description | Status | Session ID |
|---------|-------------|--------|------------|
${tableRows}
${resumeSection}`
        }

        const task = manager.getTask(args.taskId!)
        if (!task) {
          return `[ERROR] Task not found: ${args.taskId}`
        }

        if (task.status !== "running" && task.status !== "pending") {
          return `[ERROR] Cannot cancel task: current status is "${task.status}".
Only running or pending tasks can be cancelled.`
        }

        const cancelled = await manager.cancelTask(task.id, {
          source: "background_cancel",
          abortSession: task.status === "running",
          skipNotification: true,
        })
        if (!cancelled) {
          return `[ERROR] Failed to cancel task: ${task.id}`
        }

        if (task.status === "pending") {
          return `Pending task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
        }

        return `Task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Session ID: ${task.sessionID}
Status: ${task.status}`
      } catch (error) {
        return `[ERROR] Error cancelling task: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
function formatMessageTime(value: unknown): string {
  if (typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  if (typeof value === "object" && value !== null) {
    if ("created" in value) {
      const created = (value as { created?: number }).created
      if (typeof created === "number") {
        return new Date(created).toISOString()
      }
    }
  }
  return "Unknown time"
}
