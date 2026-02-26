import type { BackgroundTask } from "../../features/background-agent"
import { COUNCIL_MEMBER_KEY_PREFIX } from "../../agents/builtin-agents/council-member-agents"
import type { BackgroundOutputClient } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"

const OPENING_TAG = "<COUNCIL_MEMBER_RESPONSE>"
const CLOSING_TAG = "</COUNCIL_MEMBER_RESPONSE>"

export interface CouncilTaskResult {
  has_response: boolean
  response_complete: boolean
  result: string | null
  session_id: string | null
}

export function isCouncilTask(task: BackgroundTask): boolean {
  return task.agent?.startsWith(COUNCIL_MEMBER_KEY_PREFIX) ?? false
}

function getTimeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function extractCouncilResponse(fullText: string): CouncilTaskResult & { session_id: null } {
  const lastOpenIdx = fullText.lastIndexOf(OPENING_TAG)
  if (lastOpenIdx === -1) {
    return { has_response: false, response_complete: false, result: null, session_id: null }
  }

  const contentStart = lastOpenIdx + OPENING_TAG.length
  const closingAfterLastOpen = fullText.indexOf(CLOSING_TAG, contentStart)

  if (closingAfterLastOpen === -1) {
    const partial = fullText.slice(contentStart).trim()
    return { has_response: true, response_complete: false, result: partial || null, session_id: null }
  }

  const content = fullText.slice(contentStart, closingAfterLastOpen).trim()
  return { has_response: true, response_complete: true, result: content, session_id: null }
}

export async function formatCouncilTaskResult(
  task: BackgroundTask,
  client: BackgroundOutputClient,
): Promise<CouncilTaskResult> {
  if (!task.sessionID) {
    return { has_response: false, response_complete: false, result: null, session_id: null }
  }

  const messagesResult = await client.session.messages({ path: { id: task.sessionID } })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return { has_response: false, response_complete: false, result: null, session_id: task.sessionID }
  }

  const messages = extractMessages(messagesResult)
  if (!Array.isArray(messages) || messages.length === 0) {
    return { has_response: false, response_complete: false, result: null, session_id: task.sessionID }
  }

  const assistantMessages = messages.filter((m) => m.info?.role === "assistant")
  const sorted = [...assistantMessages].sort((a, b) => {
    const timeA = getTimeString(a.info?.time)
    const timeB = getTimeString(b.info?.time)
    return timeA.localeCompare(timeB)
  })

  const textParts: string[] = []
  for (const message of sorted) {
    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        textParts.push(part.text)
      }
    }
  }

  const fullText = textParts.join("\n\n")
  const extracted = extractCouncilResponse(fullText)

  return { ...extracted, session_id: task.sessionID }
}
