import type { OpencodeClient } from "./constants"
import type { BackgroundTask, ResumeAnchor } from "./types"
import { stripInternalInitiatorMarkers } from "../../shared/internal-initiator-marker"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { isRecord } from "../../shared/record-type-guard"
import { messagesInDirectory } from "../../shared/session-route"
import { withTimeout } from "../../shared/with-timeout"
import { isTerminalSessionStatus } from "./session-status-classifier"

const SESSION_READ_TIMEOUT_MS = 5_000

type SessionMessage = {
  readonly info?: { readonly id?: string; readonly role?: string }
  readonly parts?: readonly { readonly type?: string; readonly text?: string; readonly content?: string | readonly unknown[] }[]
}

function readWithin<T>(read: Promise<T>): Promise<T> {
  return withTimeout(read, SESSION_READ_TIMEOUT_MS, `Session read timed out after ${SESSION_READ_TIMEOUT_MS}ms`)
}

async function readMessages(client: OpencodeClient, sessionID: string, directory: string): Promise<readonly SessionMessage[]> {
  const response = await readWithin(messagesInDirectory(client, { path: { id: sessionID } }, directory))
  const messages = normalizeSDKResponse<unknown>(response, undefined)
  if (!Array.isArray(messages)) throw new Error(`Could not read the messages of session ${sessionID}`)
  return messages
}

function isNew(anchor: ResumeAnchor, message: SessionMessage): boolean {
  const id = message.info?.id
  return id !== undefined && !anchor.messageIDs.has(id)
}

function isContinuationPrompt(anchor: ResumeAnchor, message: SessionMessage): boolean {
  return isNew(anchor, message) && message.info?.role === "user" &&
    (message.parts?.some((part) => part.type === "text" && stripInternalInitiatorMarkers(part.text ?? "") === anchor.prompt) ?? false)
}

function isOutput(message: SessionMessage): boolean {
  if (message.info?.role !== "assistant" && message.info?.role !== "tool") return false
  return message.parts?.some((part) =>
    ((part.type === "text" || part.type === "reasoning") && Boolean(part.text?.trim())) ||
    part.type === "tool" ||
    (part.type === "tool_result" && Boolean(typeof part.content === "string" ? part.content.trim() : part.content?.length))) ?? false
}

/**
 * Records the messages a session has before a continuation is sent. Throws when they cannot be
 * read; an empty history counts as unread, since a resumed session has already run.
 */
export async function captureResumeAnchor(
  client: OpencodeClient, sessionID: string, directory: string, prompt: string,
): Promise<ResumeAnchor> {
  const messages = await readMessages(client, sessionID, directory)
  if (messages.length === 0) throw new Error(`Session ${sessionID} returned no messages to resume from`)
  return {
    sessionID,
    messageIDs: new Set(messages.flatMap((message) => message.info?.id ? [message.info.id] : [])),
    prompt: stripInternalInitiatorMarkers(prompt),
  }
}

/**
 * Whether a resumed task's continuation has finished: the session holds the continuation's own
 * user message, new assistant or tool output after it, the session is idle now, and the task
 * still runs on it. Output that precedes the continuation's message never counts. Unreadable
 * state counts as unfinished. Tasks without an anchor for their current session pass.
 */
export async function resumedTurnFinished(client: OpencodeClient, task: BackgroundTask, directory: string): Promise<boolean> {
  const anchor = task.resumeAnchor
  if (anchor === undefined || anchor.sessionID !== task.sessionId) return true
  try {
    const messages = await readMessages(client, anchor.sessionID, directory)
    const prompt = messages.findIndex((message) => isContinuationPrompt(anchor, message))
    if (prompt < 0 || !messages.slice(prompt + 1).some((message) => isNew(anchor, message) && isOutput(message))) return false
    const statuses = normalizeSDKResponse<unknown>(await readWithin(client.session.status({ query: { directory } })), undefined)
    if (!isRecord(statuses)) return false
    const status = statuses[anchor.sessionID]
    const idle = status === undefined ||
      (isRecord(status) && typeof status.type === "string" && (status.type === "idle" || isTerminalSessionStatus(status.type)))
    return idle && task.sessionId === anchor.sessionID
  } catch {
    // SDK failures are untyped; an unreadable session never proves the continuation finished.
    return false
  }
}
