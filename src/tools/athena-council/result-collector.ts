import type { BackgroundManager } from "../../features/background-agent"
import type { CouncilLaunchedMember } from "../../agents/athena/types"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult } from "../background-task/clients"
import { extractMessages, getErrorMessage } from "../background-task/session-messages"

const POLL_INTERVAL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000

export interface CollectedMemberResult {
  name: string
  model: string
  taskId: string
  status: "completed" | "error" | "cancelled" | "timeout"
  content: string
}

export interface CollectedCouncilResults {
  results: CollectedMemberResult[]
  allCompleted: boolean
}

/**
 * Waits for all launched council members to complete, then fetches their
 * session messages and returns extracted text content.
 *
 * This replaces the previous flow where Athena had to manually poll
 * background_output for each member, which created excessive UI noise.
 */
export async function collectCouncilResults(
  launched: CouncilLaunchedMember[],
  manager: BackgroundManager,
  client: BackgroundOutputClient,
  abort?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CollectedCouncilResults> {
  const pendingIds = new Set(launched.map((m) => m.taskId))
  const completedMap = new Map<string, "completed" | "error" | "cancelled">()
  const deadline = Date.now() + timeoutMs

  while (pendingIds.size > 0 && Date.now() < deadline) {
    if (abort?.aborted) break

    for (const taskId of pendingIds) {
      const task = manager.getTask(taskId)
      if (!task) {
        completedMap.set(taskId, "error")
        pendingIds.delete(taskId)
        continue
      }
      if (task.status === "completed") {
        completedMap.set(taskId, "completed")
        pendingIds.delete(taskId)
      } else if (task.status === "error" || task.status === "cancelled" || task.status === "interrupt") {
        completedMap.set(taskId, task.status === "interrupt" ? "cancelled" : task.status)
        pendingIds.delete(taskId)
      }
    }

    if (pendingIds.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  const results: CollectedMemberResult[] = []

  for (const entry of launched) {
    const memberName = entry.member.name ?? entry.member.model
    const status = completedMap.get(entry.taskId) ?? "timeout"

    if (status !== "completed") {
      results.push({ name: memberName, model: entry.member.model, taskId: entry.taskId, status, content: "" })
      continue
    }

    const content = await fetchMemberContent(entry.taskId, manager, client)
    results.push({ name: memberName, model: entry.member.model, taskId: entry.taskId, status, content })
  }

  return {
    results,
    allCompleted: pendingIds.size === 0,
  }
}

async function fetchMemberContent(
  taskId: string,
  manager: BackgroundManager,
  client: BackgroundOutputClient
): Promise<string> {
  const task = manager.getTask(taskId)
  if (!task?.sessionID) return "(No session available)"

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMsg = getErrorMessage(messagesResult)
  if (errorMsg) return `(Error fetching results: ${errorMsg})`

  const messages = extractMessages(messagesResult)
  if (!Array.isArray(messages) || messages.length === 0) return "(No messages found)"

  const assistantMessages = messages.filter((m) => m.info?.role === "assistant")
  if (assistantMessages.length === 0) return "(No assistant response found)"

  const textParts: string[] = []
  for (const message of assistantMessages) {
    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        textParts.push(part.text)
      }
    }
  }

  return textParts.join("\n\n") || "(No text content)"
}
