import { resolve } from "node:path"

import { storedMessagesToV1 } from "./message-shape"
import type { AdapterState } from "./adapter-state"
import { SessionHttpError } from "./serve-http"
import { AGENT_RECOVERY_PROMPT } from "../hooks/compaction-context-injector/constants"
import { log } from "../shared/logger"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function sessionIDFrom(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.sessionID === "string") return input.sessionID
  if (isRecord(input.path) && typeof input.path.id === "string") return input.path.id
  return undefined
}

function bodyOf(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  return isRecord(input.body) ? input.body : input
}

function textFromPrompt(input: unknown): string {
  const body = bodyOf(input)
  if (typeof body.text === "string") return body.text
  if (!Array.isArray(body.parts)) return ""
  return body.parts
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n")
}

export type PromptFile = { uri: string; name?: string; description?: string }

// V1 callers (look_at, delegate-task) attach images and documents as `{ type: "file", url, filename }` parts.
// V2 takes them as `files: [{ uri, name }]` and materializes `file:` and `data:` URIs at prompt admission.
export function filesFromPrompt(input: unknown): PromptFile[] {
  const body = bodyOf(input)
  const files: PromptFile[] = []
  const add = (uri: unknown, name: unknown, description?: unknown) => {
    if (typeof uri !== "string" || uri.length === 0) return
    files.push({
      uri,
      ...(typeof name === "string" && name.length > 0 ? { name } : {}),
      ...(typeof description === "string" && description.length > 0 ? { description } : {}),
    })
  }
  if (Array.isArray(body.files)) {
    for (const file of body.files) if (isRecord(file)) add(file.uri, file.name, file.description)
  }
  if (Array.isArray(body.parts)) {
    for (const part of body.parts) {
      if (!isRecord(part) || part.type !== "file") continue
      add(typeof part.url === "string" ? part.url : part.uri, typeof part.filename === "string" ? part.filename : part.name)
    }
  }
  return files
}

function promptDelivery(input: unknown): "steer" | "queue" | undefined {
  const body = bodyOf(input)
  const delivery = isRecord(input) && (input.delivery === "steer" || input.delivery === "queue") ? input.delivery : body.delivery
  return delivery === "steer" || delivery === "queue" ? delivery : undefined
}

function modelRef(value: unknown, variant: unknown): { id: string; providerID: string; variant?: string } | undefined {
  if (!isRecord(value) || typeof value.providerID !== "string") return undefined
  const id = typeof value.modelID === "string" ? value.modelID : typeof value.id === "string" ? value.id : undefined
  if (!id) return undefined
  const resolvedVariant = typeof variant === "string" ? variant : typeof value.variant === "string" ? value.variant : undefined
  return { id, providerID: value.providerID, ...(resolvedVariant ? { variant: resolvedVariant } : {}) }
}

function permissionsFrom(value: unknown): Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> {
  if (!Array.isArray(value)) return []
  const rules: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.permission !== "string" || typeof entry.pattern !== "string") continue
    const effect = entry.action
    if (effect !== "allow" && effect !== "deny" && effect !== "ask") continue
    rules.push({ action: entry.permission, resource: entry.pattern, effect })
  }
  return rules
}

function toolDenies(value: unknown): Array<{ action: string; resource: string; effect: "deny" }> {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([action, enabled]) => (enabled === false ? [{ action, resource: "*", effect: "deny" as const }] : []))
}

type SessionApi = {
  get: (input: { sessionID: string }) => Promise<Record<string, unknown>>
  context: (input: { sessionID: string }) => Promise<unknown>
  prompt: (input: { sessionID: string; text: string; delivery?: "steer" | "queue"; files?: PromptFile[] }) => Promise<unknown>
  create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  interrupt: (input: { sessionID: string }) => Promise<unknown>
  switchAgent: (input: { sessionID: string; agent: string }) => Promise<unknown>
  switchModel: (input: { sessionID: string; model: { id: string; providerID: string; variant?: string } }) => Promise<unknown>
  synthetic: (input: { sessionID: string; text: string; resume?: boolean }) => Promise<unknown>
  update: (input: { sessionID: string; permissions?: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> }) => Promise<unknown>
  remove?: (input: { sessionID: string }) => Promise<unknown>
  compact?: (input: { sessionID: string }) => Promise<unknown>
  move?: (input: { sessionID: string; directory: string }) => Promise<unknown>
}

export function withParent(session: Record<string, unknown>, state: AdapterState): Record<string, unknown> {
  const id = typeof session.id === "string" ? session.id : undefined
  const recorded = id ? state.parentOf(id) : undefined
  const metadata = isRecord(session.metadata) ? session.metadata : {}
  const fromMetadata = typeof metadata.omoParentID === "string" ? metadata.omoParentID : undefined
  const parentID = typeof session.parentID === "string" ? session.parentID : recorded ?? fromMetadata
  return parentID ? { ...session, parentID, directory: directoryOf(session) } : { ...session, directory: directoryOf(session) }
}

function directoryOf(session: Record<string, unknown>): unknown {
  if (typeof session.directory === "string") return session.directory
  return isRecord(session.location) ? session.location.directory : undefined
}

function sameDirectory(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = resolve(value).replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

export function childSessions(sessions: Array<Record<string, unknown>>, parentID: string, state: AdapterState): Array<Record<string, unknown>> {
  const links = state.parents()
  return sessions.filter((session) => {
    const id = typeof session.id === "string" ? session.id : undefined
    const metadata = isRecord(session.metadata) ? session.metadata : {}
    return session.parentID === parentID || metadata.omoParentID === parentID || (id !== undefined && links[id] === parentID)
  }).map((session) => withParent(session, state))
}

export async function createSession(api: SessionApi, input: unknown, state: AdapterState, directory: string): Promise<Record<string, unknown>> {
  const body = bodyOf(input)
  const query = isRecord(input) && isRecord(input.query) ? input.query : {}
  const parentID = typeof body.parentID === "string" ? body.parentID : undefined
  const metadata = {
    ...(isRecord(body.metadata) ? body.metadata : {}),
    ...(parentID ? { omoParentID: parentID } : {}),
  }
  const model = modelRef(body.model, body.variant)
  const permissions = permissionsFrom(body.permission)
  const requestedDirectory = typeof query.directory === "string" ? query.directory : directory
  const created = await api.create({
    ...(parentID ? { parentID } : {}),
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
    ...(model ? { model } : {}),
    location: { directory: requestedDirectory },
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(permissions.length > 0 ? { permissions } : {}),
  })
  let record = isRecord(created) ? created : {}
  const placed = directoryOf(record)
  // The native host creates a child at its parent's location, so a child asked to run elsewhere is moved after creation.
  if (parentID && typeof record.id === "string" && typeof placed === "string" && !sameDirectory(placed, requestedDirectory) && api.move) {
    await api.move({ sessionID: record.id, directory: requestedDirectory })
    const location = { ...(isRecord(record.location) ? record.location : {}), directory: requestedDirectory }
    record = typeof record.directory === "string" ? { ...record, directory: requestedDirectory, location } : { ...record, location }
  }
  const session = withParent(record, state)
  if (typeof session.id === "string" && parentID) state.recordParent(session.id, parentID)
  if (typeof session.id === "string") state.noteSession(session)
  return session
}

export async function sendPrompt(api: SessionApi, input: unknown): Promise<unknown> {
  const sessionID = sessionIDFrom(input)
  if (!sessionID) return undefined
  const body = bodyOf(input)
  if (typeof body.agent === "string") await api.switchAgent({ sessionID, agent: body.agent })
  const model = modelRef(body.model, body.variant)
  if (model) await api.switchModel({ sessionID, model })
  if (typeof body.system === "string" && body.system.length > 0) await api.synthetic({ sessionID, text: body.system })
  const denies = toolDenies(body.tools)
  if (denies.length > 0) await api.update({ sessionID, permissions: denies })
  const text = textFromPrompt(input)
  const files = filesFromPrompt(input)
  if (body.noReply === true) {
    // V2 configuration is persistent control-plane state. The v1 recovery
    // sentinel is not a user request or context for the model/tool bridge.
    if (text.startsWith(AGENT_RECOVERY_PROMPT) && text.includes("<!-- OMO_INTERNAL_NOREPLY -->")) {
      return api.get({ sessionID })
    }
    // Synthetic context has no attachment field; say so instead of losing the files silently.
    if (files.length > 0) log("[oh-my-openagent] v2 noReply prompt cannot carry attachments; files not delivered", { sessionID, files: files.map((file) => file.name ?? file.uri.slice(0, 64)) })
    return api.synthetic({ sessionID, text, resume: false })
  }
  const delivery = promptDelivery(input)
  return api.prompt({ sessionID, text, ...(delivery ? { delivery } : {}), ...(files.length > 0 ? { files } : {}) })
}

export async function readMessages(api: SessionApi, input: unknown): Promise<ReturnType<typeof storedMessagesToV1>> {
  const sessionID = sessionIDFrom(input)
  if (!sessionID) return []
  return storedMessagesToV1(await api.context({ sessionID }), sessionID)
}

export async function readMessage(api: SessionApi, input: unknown): Promise<ReturnType<typeof storedMessagesToV1>[number] | undefined> {
  const messageID = isRecord(input) && isRecord(input.path) && typeof input.path.messageID === "string" ? input.path.messageID : undefined
  const messages = await readMessages(api, input)
  return messages.find((message) => message.info.id === messageID)
}

export { SessionHttpError }
