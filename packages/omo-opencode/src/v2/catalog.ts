import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import type { AdapterState } from "./adapter-state"
import { activeSessions, listSessions, resolveServeOrigin, SessionHttpError } from "./serve-http"
import { sessionsFromDatabase } from "./session-db"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rowsFrom(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord)
  return []
}

export function agentsFrom(value: unknown): { data: Array<Record<string, unknown>> } {
  return {
    data: rowsFrom(value).map((agent) => ({
      name: typeof agent.name === "string" ? agent.name : agent.id,
      mode: agent.mode,
      hidden: agent.hidden,
      ...(agent.model !== undefined ? { model: agent.model } : {}),
    })),
  }
}

export function modelsFrom(value: unknown): { data: Array<{ provider: string; id: string }> } {
  return {
    data: rowsFrom(value).flatMap((model) => {
      const provider = typeof model.providerID === "string" ? model.providerID : typeof model.provider === "string" ? model.provider : undefined
      const id = typeof model.modelID === "string" ? model.modelID : typeof model.id === "string" ? model.id : undefined
      return provider && id ? [{ provider, id }] : []
    }),
  }
}

export function providersFrom(providers: unknown, models: unknown): {
  data: { connected: string[]; all: Array<{ id: string; models: Record<string, { id: string }> }> }
} {
  const grouped = new Map<string, Record<string, { id: string }>>()
  for (const model of modelsFrom(models).data) {
    const current = grouped.get(model.provider) ?? {}
    current[model.id] = { id: model.id }
    grouped.set(model.provider, current)
  }
  const all = rowsFrom(providers).flatMap((provider) => {
    if (typeof provider.id !== "string") return []
    return [{ id: provider.id, models: grouped.get(provider.id) ?? {}, activation: provider.activation }]
  })
  return {
    data: {
      connected: all.filter((provider) => provider.activation === "enabled" || provider.activation === "auto").map((provider) => provider.id),
      all: all.map(({ id, models: providerModels }) => ({ id, models: providerModels })),
    },
  }
}

export function skillsFrom(value: unknown): { data: Array<Record<string, unknown>> } {
  return {
    data: rowsFrom(value).map((skill) => ({
      name: skill.name,
      description: typeof skill.description === "string" ? skill.description : "",
      location: typeof skill.path === "string" ? skill.path : skill.location,
      content: typeof skill.content === "string" ? skill.content : "",
    })),
  }
}

function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
}

export function configData(directory = getOpenCodeConfigDir({ binary: "opencode" })): { data: Record<string, unknown> } {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = join(directory, name)
    if (!existsSync(file)) continue
    const parsed = JSON.parse(stripJsonc(readFileSync(file, "utf8")))
    if (!isRecord(parsed)) return { data: {} }
    const model = parsed.model
    if (isRecord(model) && typeof model.providerID === "string" && typeof model.model === "string") {
      return { data: { ...parsed, model: `${model.providerID}/${model.model}` } }
    }
    return { data: parsed }
  }
  return { data: {} }
}

export async function sessionCatalog(input: {
  origin: string | undefined
  fetchImpl: typeof fetch
  state: AdapterState
  known: Array<Record<string, unknown>>
  databaseFile?: string
}): Promise<Array<Record<string, unknown>>> {
  const merged = new Map<string, Record<string, unknown>>()
  for (const session of input.known) rememberSession(merged, session)
  if (!input.origin) {
    for (const session of await sessionsFromDatabase(input.databaseFile)) rememberSession(merged, session)
    return [...merged.values()]
  }
  try {
    const listed = await listSessions(input.origin, input.fetchImpl)
    for (const session of listed) {
      rememberSession(merged, session)
      input.state.noteSession(session)
    }
    return [...merged.values()]
  } catch (error) {
    if (error instanceof SessionHttpError && error.status === 401) throw error
    for (const session of await sessionsFromDatabase(input.databaseFile)) rememberSession(merged, session)
    return [...merged.values()]
  }
}

export function presentSession(session: Record<string, unknown>): Record<string, unknown> {
  const location = isRecord(session.location) ? session.location : undefined
  const directory = typeof session.directory === "string"
    ? session.directory
    : location && typeof location.directory === "string" ? location.directory : undefined
  const time = isRecord(session.time) ? { ...session.time } : {}
  if (typeof time.created !== "number" && typeof session.created === "number") time.created = session.created
  if (typeof time.updated !== "number") {
    const updated = typeof session.updated === "number" ? session.updated : time.created
    if (typeof updated === "number") time.updated = updated
  }
  const parentID = typeof session.parentID === "string" ? session.parentID : undefined
  const presented: Record<string, unknown> = {
    ...session,
    ...(directory ? { directory, location: { ...(location ?? {}), directory } } : {}),
    ...(typeof time.created === "number" || typeof time.updated === "number" ? { time } : {}),
  }
  if (parentID) presented.parentID = parentID
  else delete presented.parentID
  return presented
}

function rememberSession(merged: Map<string, Record<string, unknown>>, session: Record<string, unknown>): void {
  const presented = presentSession(session)
  if (typeof presented.id !== "string") return
  const current = merged.get(presented.id)
  if (!current) {
    merged.set(presented.id, presented)
    return
  }
  const metadata = {
    ...(isRecord(current.metadata) ? current.metadata : {}),
    ...(isRecord(presented.metadata) ? presented.metadata : {}),
  }
  merged.set(presented.id, presentSession({
    ...current,
    ...presented,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    parentID: presented.parentID ?? current.parentID,
  }))
}

export async function sessionStatusMap(input: {
  origin: string | undefined
  fetchImpl: typeof fetch
  state: AdapterState
}): Promise<Record<string, { type: string }>> {
  if (!input.origin) {
    const status: Record<string, { type: string }> = {}
    for (const session of await sessionsFromDatabase()) {
      if (typeof session.id === "string") status[session.id] = { type: "idle" }
    }
    return { ...status, ...Object.fromEntries(input.state.status) }
  }
  try {
    const [active, listed] = await Promise.all([
      activeSessions(input.origin, input.fetchImpl),
      listSessions(input.origin, input.fetchImpl),
    ])
    const status: Record<string, { type: string }> = {}
    for (const session of listed) {
      if (typeof session.id === "string") status[session.id] = { type: "idle" }
    }
    for (const session of input.state.sessions.values()) {
      if (typeof session.id === "string" && status[session.id] === undefined) status[session.id] = { type: "idle" }
    }
    Object.assign(status, active)
    for (const [sessionID, value] of input.state.status) {
      if (value.type === "retry") status[sessionID] = value
    }
    return status
  } catch (error) {
    if (error instanceof SessionHttpError && error.status === 401) throw error
    return Object.fromEntries(input.state.status)
  }
}

export async function serveOrigin(argv: readonly string[], listenPort: () => Promise<number | undefined>): Promise<string | undefined> {
  return resolveServeOrigin({ argv, listenPort })
}
