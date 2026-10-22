import type { OpencodeClient } from "./constants"
import type { BackgroundTask } from "./types"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { messagesInDirectory } from "../../shared/session-route"
import { isRecord } from "../../shared/record-type-guard"
import { isTerminalSessionStatus } from "./session-status-classifier"

export const RESUME_ANCHOR_READ_TIMEOUT_MS = 5_000

type ResumeMessage = {
  readonly info?: { readonly id?: string; readonly role?: string }
  readonly parts?: readonly { readonly type?: string; readonly text?: string; readonly content?: string | readonly unknown[] }[]
}

async function readBeforeDeadline<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), RESUME_ANCHOR_READ_TIMEOUT_MS)
      }),
    ])
  } catch {
    // SDK rejections are untyped; none can establish a completion signal.
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function readResumeMessages(client: OpencodeClient, task: BackgroundTask, directory: string) {
  if (!task.sessionId) return undefined
  const sessionID = task.sessionId
  const response = await readBeforeDeadline(() => messagesInDirectory(client, {
    path: { id: sessionID },
  }, task.cwd ?? directory))
  const messages = normalizeSDKResponse<ResumeMessage[] | undefined>(response, undefined)
  return Array.isArray(messages) ? messages : undefined
}

export async function captureResumeAnchor(client: OpencodeClient, task: BackgroundTask, directory: string) {
  const messages = await readResumeMessages(client, task, directory)
  if (!messages) return undefined
  return {
    anchorMessageCount: messages.length,
    anchorMessageID: messages.at(-1)?.info?.id,
    capturedMessageIDs: messages.flatMap((message) => message.info?.id ? [message.info.id] : []),
  }
}

export async function sessionHasResumedOutput(client: OpencodeClient, task: BackgroundTask, directory: string): Promise<boolean> {
  if (task.resumeAnchorPending) return false
  const anchor = task.resumeAnchor
  if (!anchor) return true
  const messages = await readResumeMessages(client, task, directory)
  if (!messages || task.resumeAnchor !== anchor || task.status !== "running") return false
  const anchorIndex = anchor.anchorMessageID === undefined
    ? anchor.anchorMessageCount - 1
    : messages.findIndex((message) => message.info?.id === anchor.anchorMessageID)
  const candidates = anchorIndex >= 0 ? messages.slice(anchorIndex + 1) : messages.filter((message) =>
    message.info?.id !== undefined && anchor.capturedMessageIDs?.includes(message.info.id) === false)
  const hasOutput = candidates.some((message) =>
    (message.info?.role === "assistant" || message.info?.role === "tool") &&
    message.parts?.some((part) =>
      ((part.type === "text" || part.type === "reasoning") && Boolean(part.text?.trim())) ||
      part.type === "tool" ||
      (part.type === "tool_result" && Boolean(typeof part.content === "string" ? part.content.trim() : part.content?.length))))
  if (!hasOutput) return false
  const response = await readBeforeDeadline(() => client.session.status({ query: { directory: task.cwd ?? directory } }))
  const statuses = normalizeSDKResponse<unknown>(response, undefined)
  if (!isRecord(statuses) || task.resumeAnchor !== anchor || task.status !== "running") return false
  const status = statuses[task.sessionId ?? ""]
  return status === undefined || (isRecord(status) && typeof status.type === "string" &&
    (status.type === "idle" || isTerminalSessionStatus(status.type)))
}
