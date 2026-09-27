import { storedMessagesToV1 } from "./message-shape"
import type { AdapterState } from "./adapter-state"
import { SessionHttpError } from "./serve-http"

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
  prompt: (input: { sessionID: string; text: string; delivery?: "steer" | "queue" }) => Promise<unknown>
  create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  interrupt: (input: { sessionID: string }) => Promise<unknown>
  switchAgent: (input: { sessionID: string; agent: string }) => Promise<unknown>
  switchModel: (input: { sessionID: string; model: { id: string; providerID: string; variant?: string } }) => Promise<unknown>
  synthetic: (input: { sessionID: string; text: string }) => Promise<unknown>
  update: (input: { sessionID: string; permissions?: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> }) => Promise<unknown>
  remove?: (input: { sessionID: string }) => Promise<unknown>
  compact?: (input: { sessionID: string }) => Promise<unknown>
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
  const created = await api.create({
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
    ...(model ? { model } : {}),
    ...(typeof query.directory === "string" ? { location: { directory: query.directory } } : { location: { directory } }),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(permissions.length > 0 ? { permissions } : {}),
  })
  const session = withParent(isRecord(created) ? created : {}, state)
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
  const delivery = promptDelivery(input)
  return api.prompt({ sessionID, text: textFromPrompt(input), ...(delivery ? { delivery } : {}) })
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
