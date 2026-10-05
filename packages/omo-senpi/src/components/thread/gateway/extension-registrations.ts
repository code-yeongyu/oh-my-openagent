/**
 * The persisted half of store extension registrations (`extension_registrations`, schema v10): the
 * descriptor `register()` upserts by name, the session-op declaration rules both `register()` and
 * every reader apply, and the worker's lazy import of a persisted module. An engine process lists
 * session tools from these rows without importing anything; only a call imports the module.
 */
import { existsSync } from "node:fs"
import { extname } from "node:path"
import { fileURLToPath } from "node:url"

import type { StoreContext } from "./store-ops"
import type { DeclaredSessionOp, SessionCallableOp, StoreExtensionRegistration, ToolSessionOp } from "./store-extensions"

export const RESERVED_CALLER_KEYS = ["caller_session_durable_id", "caller_created_target"] as const
export const AWAIT_REQUEST_ID = /^tor_[a-f0-9]{32}$/
export const AWAIT_TIMEOUT_MAX_MS = 120_000
/** The declared short name; the session sees it as `ext_<extension>_<toolName>` (`registeredToolName`). */
const TOOL_NAME = /^[a-z][a-z0-9_]{1,40}$/
/** The longest composed tool name a provider takes as a function name. */
export const REGISTERED_TOOL_NAME_MAX = 64
const WAKE_DIR = /^[a-z0-9][a-z0-9_-]*$/
const WAKE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** What a registration persists: everything a process that never registered it needs to call it. */
export type PersistedDescriptor = Pick<StoreExtensionRegistration, "moduleUrl" | "migrations" | "sessionCallable" | "wakeDir">

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0

/**
 * The name a declared op's tool is registered under: its own namespace, so no declaration can take
 * a core or omo tool's name (none of those starts with `ext_`). Two extensions can still compose the
 * same name (`ab` + `cc_dd`, `ab_cc` + `dd`): `register()` refuses the second, and a session skips
 * a composed name it already has.
 */
export function registeredToolName(extension: string, toolName: string): string {
  return `ext_${extension}_${toolName}`
}

export function isToolSessionOp(entry: SessionCallableOp): entry is ToolSessionOp {
  return entry.internal !== true
}

/** An internal op gets no tool: no name to compose, and no await or wake a tool would run. */
function internalEntryProblem(entry: Readonly<Record<string, unknown>>, op: string): string | undefined {
  if (entry.internal !== true) return `${op}: internal must be true when present`
  for (const field of ["toolName", "await", "wake"] as const) {
    if (entry[field] !== undefined) return `${op}: an internal op registers no tool, so it cannot declare ${field}`
  }
  if (entry.description !== undefined && !nonEmpty(entry.description)) return `${op}: description must be a non-empty string when present`
  return undefined
}

function entryProblem(entry: unknown, extension: string, wakeDir: string | undefined): string | undefined {
  if (!isRecord(entry)) return "a sessionCallable entry must be an object"
  const { op, toolName, description, parameters, targetArg, wake } = entry
  const awaited = entry.await
  if (!nonEmpty(op)) return "op must be a non-empty string"
  const internal = entry.internal !== undefined
  if (internal) {
    const problem = internalEntryProblem(entry, op)
    if (problem !== undefined) return problem
  } else {
    if (typeof toolName !== "string" || !TOOL_NAME.test(toolName)) return `toolName ${String(toolName)} must match ${TOOL_NAME.source}`
    if (registeredToolName(extension, toolName).length > REGISTERED_TOOL_NAME_MAX) return `${registeredToolName(extension, toolName)} is longer than ${REGISTERED_TOOL_NAME_MAX} characters`
    if (!nonEmpty(description)) return `${toolName}: description must be a non-empty string`
  }
  const label = internal ? op : String(toolName)
  if (!isRecord(parameters) || parameters.type !== "object" || parameters.additionalProperties !== false) return `${label}: parameters must be an object schema with additionalProperties: false`
  const properties = parameters.properties ?? {}
  if (!isRecord(properties)) return `${label}: parameters.properties must be an object`
  if (RESERVED_CALLER_KEYS.some((key) => Object.hasOwn(properties, key))) return `${label}: parameters must not declare ${RESERVED_CALLER_KEYS.join(" or ")}; the store stamps them`
  if (targetArg !== undefined && (typeof targetArg !== "string" || !Object.hasOwn(properties, targetArg))) return `${label}: targetArg ${String(targetArg)} must name a field of parameters.properties`
  if (awaited !== undefined) {
    if (!isRecord(awaited) || !nonEmpty(awaited.statusOp) || !nonEmpty(awaited.expireOp)) return `${label}: await needs statusOp and expireOp`
    const timeout = awaited.timeoutMs
    if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > AWAIT_TIMEOUT_MAX_MS) return `${label}: await.timeoutMs must be an integer from 1 to ${AWAIT_TIMEOUT_MAX_MS}`
    if (wakeDir === undefined) return `${label}: await needs the registration's wakeDir`
  }
  if (wake !== undefined && (typeof wake !== "string" || !WAKE_FILE.test(wake))) return `${label}: wake must be a plain file name matching ${WAKE_FILE.source}`
  if (wake !== undefined && wakeDir === undefined) return `${label}: wake needs the registration's wakeDir`
  return undefined
}

/** Why a declaration is invalid, or undefined; `exports` (the imported module) also checks every named op exists. */
export function declarationProblem(descriptor: Pick<StoreExtensionRegistration, "name" | "sessionCallable" | "wakeDir">, exports?: Readonly<Record<string, unknown>>): string | undefined {
  const { name, sessionCallable, wakeDir } = descriptor
  if (wakeDir !== undefined && (typeof wakeDir !== "string" || !WAKE_DIR.test(wakeDir))) return `wakeDir must be one path segment matching ${WAKE_DIR.source}`
  if (sessionCallable === undefined) return undefined
  if (!Array.isArray(sessionCallable)) return "sessionCallable must be an array"
  const names = new Set<string>()
  // The worker resolves a session call by `op`, so a second entry naming the same op would never apply.
  const ops = new Set<string>()
  for (const entry of sessionCallable as readonly unknown[]) {
    const problem = entryProblem(entry, name, wakeDir)
    if (problem !== undefined) return problem
    const op = entry as SessionCallableOp
    if (isToolSessionOp(op)) {
      if (names.has(op.toolName)) return `toolName ${op.toolName} is declared twice`
      names.add(op.toolName)
    }
    if (ops.has(op.op)) return `op ${op.op} is declared twice`
    ops.add(op.op)
    if (exports === undefined) continue
    const awaited = isToolSessionOp(op) ? op.await : undefined
    for (const exported of [op.op, ...(awaited === undefined ? [] : [awaited.statusOp, awaited.expireOp])]) {
      if (!Object.hasOwn(exports, exported) || typeof exports[exported] !== "function") return `${isToolSessionOp(op) ? op.toolName : op.op}: the module exports no operation ${exported}`
    }
  }
  return undefined
}

/** Every op name a declaration reaches (op, statusOp, expireOp): the public channel refuses each. */
export function declaredOpNames(descriptor: Pick<StoreExtensionRegistration, "sessionCallable"> | undefined): ReadonlySet<string> {
  const names = new Set<string>()
  for (const entry of descriptor?.sessionCallable ?? []) {
    names.add(entry.op)
    if (isToolSessionOp(entry) && entry.await !== undefined) for (const name of [entry.await.statusOp, entry.await.expireOp]) names.add(name)
  }
  return names
}

function parse(name: string, json: unknown): PersistedDescriptor | undefined {
  try {
    const value = JSON.parse(String(json)) as unknown
    if (!isRecord(value) || typeof value.moduleUrl !== "string" || !Array.isArray(value.migrations)) return undefined
    const descriptor = value as PersistedDescriptor
    return declarationProblem({ ...descriptor, name }) === undefined ? descriptor : undefined
  } catch {
    return undefined
  }
}

/** The persisted descriptor of one extension; a row that no longer passes the declaration rules reads as none. */
export function readDescriptor(ctx: StoreContext, name: string): PersistedDescriptor | undefined {
  const row = ctx.sql.one(["descriptor_json"], "SELECT descriptor_json FROM extension_registrations WHERE name = ?", [name])
  return row === undefined ? undefined : parse(name, row.descriptor_json)
}

/** Every declared tool op with its registered tool name, in extension-name order; one read, no import. Internal ops get no tool and are not listed. */
export function listSessionOps(ctx: StoreContext): DeclaredSessionOp[] {
  const rows = ctx.sql.all(["name", "descriptor_json"], "SELECT name, descriptor_json FROM extension_registrations", [], "name")
  return rows.flatMap((row) => {
    const extension = String(row.name)
    return (parse(extension, row.descriptor_json)?.sessionCallable ?? []).filter(isToolSessionOp).map((entry) => ({ ...entry, extension, registeredName: registeredToolName(extension, entry.toolName) }))
  })
}

/** Why the registration's tools cannot take their names: another extension already composes one of them. */
export function toolNameTaken(ctx: StoreContext, descriptor: Pick<StoreExtensionRegistration, "name" | "sessionCallable">): string | undefined {
  const mine = new Set((descriptor.sessionCallable ?? []).filter(isToolSessionOp).map((entry) => registeredToolName(descriptor.name, entry.toolName)))
  const taken = listSessionOps(ctx).find((entry) => entry.extension !== descriptor.name && mine.has(entry.registeredName))
  return taken === undefined ? undefined : `tool ${taken.registeredName} is already declared by extension ${taken.extension}`
}

/**
 * Upserts the descriptor (newest registration wins); refuses a tool name another extension already
 * composes. `restoredAt` marks a worker restart replaying a registration made at that time: it never
 * overwrites a row another process registered since. Runs inside the caller's transaction.
 */
export function persistDescriptor(ctx: StoreContext, descriptor: StoreExtensionRegistration, now: number, restoredAt?: number): string | undefined {
  const taken = toolNameTaken(ctx, descriptor)
  if (taken !== undefined) return taken
  const persisted: PersistedDescriptor = {
    moduleUrl: descriptor.moduleUrl,
    migrations: descriptor.migrations,
    ...(descriptor.sessionCallable === undefined ? {} : { sessionCallable: descriptor.sessionCallable }),
    ...(descriptor.wakeDir === undefined ? {} : { wakeDir: descriptor.wakeDir }),
  }
  const newerOnly = restoredAt === undefined ? "" : " WHERE excluded.updated_at >= extension_registrations.updated_at"
  ctx.sql.run(
    `INSERT INTO extension_registrations (name, descriptor_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET descriptor_json = excluded.descriptor_json, updated_at = excluded.updated_at${newerOnly}`,
    [descriptor.name, JSON.stringify(persisted), restoredAt ?? now],
  )
  return undefined
}

/** Imports a compiled extension module: a `file:` URL to .js/.mjs/.cjs only. Throws on any other URL or a failed import. */
export async function importExtensionModule(moduleUrl: string): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(moduleUrl)
  if (url.protocol !== "file:" || ![".js", ".mjs", ".cjs"].includes(extname(url.pathname))) {
    throw new Error("moduleUrl must name a compiled JavaScript file URL.")
  }
  // A module this worker imported before stays in the runtime's cache after its file is gone; a
  // deleted (uninstalled) extension must not keep running from that cache.
  if (!existsSync(fileURLToPath(url))) throw new Error(`The extension module ${moduleUrl} does not exist.`)
  return (await import(moduleUrl)) as Readonly<Record<string, unknown>>
}
