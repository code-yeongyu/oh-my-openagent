import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { resolve } from "node:path"

const MAX_HEADER_BYTES = 64 * 1024

export interface DagSessionStartEvent {
  readonly reason: string
  readonly previousSessionFile: string | undefined
}

export interface DagSessionHeader {
  readonly id: string
  readonly parentSession: string | undefined
}

export type DagForkSourceResolution =
  | { readonly kind: "source"; readonly sessionId: string }
  | { readonly kind: "own-only"; readonly diagnostic: string | undefined }

interface ResolveDagForkSourceInput {
  readonly event: unknown
  readonly currentSessionId: string
  readonly currentSessionFile: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export function parseDagSessionStartEvent(event: unknown): DagSessionStartEvent | undefined {
  if (!isRecord(event)) return undefined
  const reason = nonEmptyString(event["reason"])
  if (reason === undefined) return undefined
  return { reason, previousSessionFile: nonEmptyString(event["previousSessionFile"]) }
}

export async function readDagSessionHeader(sessionFile: string): Promise<DagSessionHeader> {
  const file = await open(sessionFile, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    if (!(await file.stat()).isFile()) throw new Error("session file is not a regular file")
    const buffer = Buffer.alloc(MAX_HEADER_BYTES + 1)
    let length = 0
    let end = -1
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      end = buffer.indexOf(10, length)
      length += bytesRead
      if (end >= 0 && end < length) break
    }
    const headerLength = end >= 0 ? end : length
    if (headerLength > MAX_HEADER_BYTES) throw new Error("session header exceeds the read limit")
    const header: unknown = JSON.parse(buffer.toString("utf8", 0, headerLength))
    if (!isRecord(header) || header["type"] !== "session") throw new Error("session file has no session header")
    const id = nonEmptyString(header["id"])
    if (id === undefined) throw new Error("session header has no identity")
    return { id, parentSession: nonEmptyString(header["parentSession"]) }
  } finally {
    await file.close()
  }
}

async function canonicalSessionPath(path: string): Promise<string> {
  let canonical = resolve(path)
  try {
    canonical = await realpath(canonical)
  } catch {
    // A path that does not exist keeps its resolved form; the header read reports it afterwards.
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical
}

// The forked session's own persisted header names its immediate parent. That declaration, not the
// event payload, authorizes source adoption: the payload may confirm it but can never widen it.
export async function resolveDagForkSource(input: ResolveDagForkSourceInput): Promise<DagForkSourceResolution> {
  const event = parseDagSessionStartEvent(input.event)
  if (event === undefined || event.reason !== "fork") return { kind: "own-only", diagnostic: undefined }
  if (input.currentSessionFile === undefined) {
    return { kind: "own-only", diagnostic: "fork session has no session file to declare its parent" }
  }
  let declaredParent: string | undefined
  try {
    declaredParent = (await readDagSessionHeader(input.currentSessionFile)).parentSession
  } catch (error) {
    return { kind: "own-only", diagnostic: `fork session header unreadable: ${errorMessage(error)}` }
  }
  if (declaredParent === undefined) {
    return { kind: "own-only", diagnostic: "fork session header declares no parent session" }
  }
  if (event.previousSessionFile !== undefined) {
    const [declared, offered] = await Promise.all([
      canonicalSessionPath(declaredParent),
      canonicalSessionPath(event.previousSessionFile),
    ])
    if (declared !== offered) {
      return { kind: "own-only", diagnostic: "fork event source does not match the session's declared parent" }
    }
  }
  try {
    const source = await readDagSessionHeader(declaredParent)
    if (source.id === input.currentSessionId) {
      return { kind: "own-only", diagnostic: "fork source header carries the forked session's own identity" }
    }
    return { kind: "source", sessionId: source.id }
  } catch (error) {
    return { kind: "own-only", diagnostic: `fork source unreadable: ${errorMessage(error)}` }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
