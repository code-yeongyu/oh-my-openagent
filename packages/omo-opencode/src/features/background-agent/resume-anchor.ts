import type { OpencodeClient } from "./constants"
import type { BackgroundTask, ResumeAnchor } from "./types"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { isRecord } from "../../shared/record-type-guard"
import { messagesInDirectory } from "../../shared/session-route"
import { isTerminalSessionStatus } from "./session-status-classifier"

const SESSION_READ_TIMEOUT_MS = 5_000

type SessionMessage = {
  readonly info?: { readonly id?: string; readonly role?: string }
  readonly parts?: readonly { readonly type?: string; readonly text?: string; readonly content?: string | readonly unknown[] }[]
}

async function withDeadline<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Session read timed out after ${SESSION_READ_TIMEOUT_MS}ms`)), SESSION_READ_TIMEOUT_MS)
  })
  try {
    return await Promise.race([read, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function readMessages(client: OpencodeClient, sessionID: string, directory: string): Promise<readonly SessionMessage[]> {
  const response = await withDeadline(messagesInDirectory(client, { path: { id: sessionID } }, directory))
  const messages = normalizeSDKResponse<unknown>(response, undefined)
  if (!Array.isArray(messages)) throw new Error(`Could not read the messages of session ${sessionID}`)
  return messages
}

function isOutputAfter(anchor: ResumeAnchor, message: SessionMessage): boolean {
  const id = message.info?.id
  if (id === undefined || anchor.messageIDs.has(id)) return false
  if (message.info?.role !== "assistant" && message.info?.role !== "tool") return false
  return message.parts?.some((part) =>
    ((part.type === "text" || part.type === "reasoning") && Boolean(part.text?.trim())) ||
    part.type === "tool" ||
    (part.type === "tool_result" && Boolean(typeof part.content === "string" ? part.content.trim() : part.content?.length))) ?? false
}

/** Records the messages a session has before a continuation is sent. Throws when they cannot be read. */
export async function captureResumeAnchor(client: OpencodeClient, sessionID: string, directory: string): Promise<ResumeAnchor> {
  const messages = await readMessages(client, sessionID, directory)
  return { sessionID, messageIDs: new Set(messages.flatMap((message) => message.info?.id ? [message.info.id] : [])) }
}

/**
 * Whether a resumed task's continuation has finished: its session holds assistant or tool output
 * that was not there at the resume, the session is idle now, and the task still runs on it.
 * Unreadable state counts as unfinished. Tasks without an anchor for their current session pass.
 */
export async function resumedTurnFinished(client: OpencodeClient, task: BackgroundTask, directory: string): Promise<boolean> {
  const anchor = task.resumeAnchor
  if (anchor === undefined || anchor.sessionID !== task.sessionId) return true
  try {
    const messages = await readMessages(client, anchor.sessionID, directory)
    if (!messages.some((message) => isOutputAfter(anchor, message))) return false
    const statuses = normalizeSDKResponse<unknown>(await withDeadline(client.session.status({ query: { directory } })), undefined)
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
