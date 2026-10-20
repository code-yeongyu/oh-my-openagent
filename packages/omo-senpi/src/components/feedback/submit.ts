import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { FeedbackDraft, FeedbackKind, UploadRedactor } from "./draft"

export const FEEDBACK_REDACTOR_VERSION = "1"

export interface ReportClient {
  readonly app: string
  readonly omo: string
  readonly senpi: string
  readonly os: string
  readonly arch: string
  readonly locale: string
  readonly channel: string
  readonly deviceName?: string
}

export type ReportTransport = (url: string, init: RequestInit) => Promise<Response>

export type SubmitResult =
  | { readonly kind: "sent"; readonly reportId: string }
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "already-sent" }
  | { readonly kind: "refused"; readonly reason: "secret-detected" | "too-large" | "rate-limited" | "unavailable" }

export interface SubmitOptions {
  readonly draft: FeedbackDraft
  readonly kind: FeedbackKind
  readonly description: string
  readonly redact: UploadRedactor
  readonly client: ReportClient
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stateDir: string
  readonly apiOrigin: string
  readonly accessToken: string | null
  readonly transport: ReportTransport
  readonly installHash?: string
  readonly sessionHash?: string
  /**
   * The key of an earlier send whose answer was lost (kept by the caller across restarts). Retrying a fresh draft under
   * it lets the intake keep one report: the same body answers the first receipt, and another body is a 409 conflict,
   * which here means the first send already landed.
   */
  readonly idempotencyKey?: string
}

/** Keys this component issues (`feedback-<draftId>`); anything else from a caller is ignored. */
export const FEEDBACK_IDEMPOTENCY_KEY = /^feedback-[A-Za-z0-9_-]{4,96}$/

const isOn = (value: string | undefined): boolean =>
  value !== undefined && !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase())

export const feedbackUploadsDisabled = (env: Readonly<Record<string, string | undefined>>): boolean =>
  isOn(env.OMO_DISABLE_FEEDBACK)

const firstLine = (text: string): string => (text.split("\n").find((line) => line.trim() !== "") ?? "").trim().slice(0, 120)

const privateWrite = (path: string, contents: string): void => {
  writeFileSync(path, contents, { mode: 0o600 })
  chmodSync(path, 0o600)
}

const feedbackDir = (stateDir: string): string => {
  const dir = join(stateDir, "feedback")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

interface SentEntry {
  readonly id: string
  readonly deleteToken: string
  readonly createdAt: string
}

const rememberDeleteToken = (stateDir: string, entry: SentEntry): void => {
  const path = join(feedbackDir(stateDir), "sent.json")
  let entries: SentEntry[] = []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (Array.isArray(parsed)) entries = parsed.filter((value): value is SentEntry => typeof value?.id === "string")
  } catch {
    entries = []
  }
  privateWrite(path, JSON.stringify([...entries.filter((value) => value.id !== entry.id), entry], null, 2))
}

const refusalFor = (status: number, code: unknown): SubmitResult => {
  if (code === "secret_detected") return { kind: "refused", reason: "secret-detected" }
  if (status === 413) return { kind: "refused", reason: "too-large" }
  if (status === 429) return { kind: "refused", reason: "rate-limited" }
  return { kind: "refused", reason: "unavailable" }
}

/**
 * Sends the draft as one report: the description is redacted here (it is the only text the user wrote after the
 * draft was built), and every other section goes exactly as the draft shows it. With OMO_DISABLE_FEEDBACK set the
 * same body is written to a private file instead, and nothing is sent.
 */
export async function submitReport(options: SubmitOptions): Promise<SubmitResult> {
  const description = options.redact(options.description).text
  const sections = options.draft.sections.map((section) =>
    section.id === "description" ? { id: section.id, text: description } : { id: section.id, text: section.text },
  )
  const body = {
    kind: options.kind,
    redactorVersion: FEEDBACK_REDACTOR_VERSION,
    title: firstLine(description),
    client: options.client,
    ...(options.installHash === undefined ? {} : { installHash: options.installHash }),
    ...(options.sessionHash === undefined ? {} : { sessionHash: options.sessionHash }),
    sections,
  }
  const json = JSON.stringify(body)

  if (feedbackUploadsDisabled(options.env)) {
    try {
      const path = join(feedbackDir(options.stateDir), `report-${options.draft.draftId}.json`)
      privateWrite(path, json)
      return { kind: "saved", path }
    } catch {
      return { kind: "refused", reason: "unavailable" }
    }
  }

  const keptKey = options.idempotencyKey !== undefined && FEEDBACK_IDEMPOTENCY_KEY.test(options.idempotencyKey) ? options.idempotencyKey : undefined
  const headers = new Headers({ "content-type": "application/json", "idempotency-key": keptKey ?? `feedback-${options.draft.draftId}` })
  if (options.accessToken !== null) headers.set("authorization", `Bearer ${options.accessToken}`)
  let response: Response
  try {
    response = await options.transport(`${options.apiOrigin.replace(/\/+$/, "")}/v1/reports`, {
      method: "POST",
      headers,
      body: json,
    })
  } catch {
    return { kind: "refused", reason: "unavailable" }
  }
  const answer: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code: unknown = Reflect.get(Object(Reflect.get(Object(answer), "error")), "code")
    if (keptKey !== undefined && response.status === 409 && code === "conflict") return { kind: "already-sent" }
    return refusalFor(response.status, code)
  }
  const reportId: unknown = Reflect.get(Object(answer), "id")
  if (typeof reportId !== "string") return { kind: "refused", reason: "unavailable" }
  const deleteToken: unknown = Reflect.get(Object(answer), "deleteToken")
  if (typeof deleteToken === "string") {
    try {
      rememberDeleteToken(options.stateDir, { id: reportId, deleteToken, createdAt: new Date().toISOString() })
    } catch {
      // The report was accepted; losing the local delete token only means the user deletes it by signing in.
    }
  }
  return { kind: "sent", reportId }
}
