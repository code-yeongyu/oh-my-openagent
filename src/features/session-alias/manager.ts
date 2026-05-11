import { getSessionAliasStoragePath, mutateAliasFile, readAliasFile } from "./storage"
import {
  ALIAS_NAME_PATTERN,
  MAX_ALIAS_LENGTH,
  MAX_NOTE_LENGTH,
  SESSION_ID_PREFIX,
  type SessionAliasEntry,
} from "./types"

export interface ManagerOptions {
  directory?: string
}

export type ValidationError = { ok: false; error: string }
export type Ok<T> = { ok: true; value: T }

export function normalizeAlias(input: string): string {
  return input.trim()
}

export function validateAliasName(alias: string): ValidationError | Ok<string> {
  const normalized = normalizeAlias(alias)
  if (!normalized) return { ok: false, error: "Alias name is empty." }
  if (normalized.length > MAX_ALIAS_LENGTH) {
    return { ok: false, error: `Alias name exceeds ${MAX_ALIAS_LENGTH} characters.` }
  }
  if (normalized.toLowerCase().startsWith(SESSION_ID_PREFIX)) {
    return {
      ok: false,
      error: `Alias name cannot start with "${SESSION_ID_PREFIX}" (reserved for real session IDs).`,
    }
  }
  if (!ALIAS_NAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      error:
        "Alias name must contain only letters, digits, dashes, or underscores, and must start/end with a letter or digit.",
    }
  }
  return { ok: true, value: normalized }
}

export function validateSessionId(sessionId: string): ValidationError | Ok<string> {
  const trimmed = sessionId.trim()
  if (!trimmed) return { ok: false, error: "Session ID is empty." }
  if (!trimmed.startsWith(SESSION_ID_PREFIX)) {
    return { ok: false, error: `Session ID must start with "${SESSION_ID_PREFIX}".` }
  }
  if (trimmed.length < SESSION_ID_PREFIX.length + 4) {
    return { ok: false, error: "Session ID is too short." }
  }
  // OpenCode session IDs are alphanumeric after the prefix. Be lenient but reject whitespace/control.
  if (/\s/.test(trimmed)) return { ok: false, error: "Session ID must not contain whitespace." }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { ok: false, error: "Session ID contains invalid characters." }
  }
  return { ok: true, value: trimmed }
}

export function validateNote(note: string | undefined): ValidationError | Ok<string | undefined> {
  if (note === undefined) return { ok: true, value: undefined }
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Note exceeds ${MAX_NOTE_LENGTH} characters.` }
  }
  return { ok: true, value: note }
}

export interface CreateAliasInput {
  alias: string
  session_id: string
  note?: string
  overwrite?: boolean
}

export type CreateAliasResult =
  | { ok: true; entry: SessionAliasEntry; replaced?: SessionAliasEntry }
  | { ok: false; error: string; code: "validation" | "exists" | "lock" }

export async function createAlias(
  input: CreateAliasInput,
  options: ManagerOptions = {},
): Promise<CreateAliasResult> {
  const aliasCheck = validateAliasName(input.alias)
  if (!aliasCheck.ok) return { ok: false, error: aliasCheck.error, code: "validation" }
  const sidCheck = validateSessionId(input.session_id)
  if (!sidCheck.ok) return { ok: false, error: sidCheck.error, code: "validation" }
  const noteCheck = validateNote(input.note)
  if (!noteCheck.ok) return { ok: false, error: noteCheck.error, code: "validation" }

  const path = getSessionAliasStoragePath(options)
  let replaced: SessionAliasEntry | undefined
  let created: SessionAliasEntry | undefined
  let conflictError: string | undefined

  const result = await mutateAliasFile(path, (current) => {
    const existing = current.aliases[aliasCheck.value]
    if (existing && !input.overwrite) {
      conflictError = `Alias "${aliasCheck.value}" already maps to ${existing.session_id}. Pass overwrite=true to replace.`
      return null
    }
    replaced = existing
    created = {
      alias: aliasCheck.value,
      session_id: sidCheck.value,
      created_at: Date.now(),
      note: noteCheck.value,
    }
    return {
      version: 1,
      aliases: { ...current.aliases, [aliasCheck.value]: created },
    }
  })

  if (!result.ok) return { ok: false, error: result.reason, code: "lock" }
  if (conflictError) return { ok: false, error: conflictError, code: "exists" }
  if (!created) {
    // Should not happen, but guard anyway.
    return { ok: false, error: "Internal error: alias was not created.", code: "validation" }
  }
  return { ok: true, entry: created, replaced }
}

export type DeleteAliasResult =
  | { ok: true; removed: SessionAliasEntry }
  | { ok: false; error: string; code: "not_found" | "lock" | "validation" }

export async function deleteAlias(alias: string, options: ManagerOptions = {}): Promise<DeleteAliasResult> {
  const aliasCheck = validateAliasName(alias)
  if (!aliasCheck.ok) return { ok: false, error: aliasCheck.error, code: "validation" }

  const path = getSessionAliasStoragePath(options)
  let removed: SessionAliasEntry | undefined
  let notFound = false

  const result = await mutateAliasFile(path, (current) => {
    const existing = current.aliases[aliasCheck.value]
    if (!existing) {
      notFound = true
      return null
    }
    removed = existing
    const next = { ...current.aliases }
    delete next[aliasCheck.value]
    return { version: 1, aliases: next }
  })

  if (!result.ok) return { ok: false, error: result.reason, code: "lock" }
  if (notFound) return { ok: false, error: `Alias "${aliasCheck.value}" not found.`, code: "not_found" }
  if (!removed) return { ok: false, error: "Internal error: alias not removed.", code: "not_found" }
  return { ok: true, removed }
}

export function listAliases(options: ManagerOptions = {}): SessionAliasEntry[] {
  const path = getSessionAliasStoragePath(options)
  const file = readAliasFile(path)
  return Object.values(file.aliases).sort((a, b) => a.alias.localeCompare(b.alias))
}

export function getAliasEntry(alias: string, options: ManagerOptions = {}): SessionAliasEntry | null {
  const aliasCheck = validateAliasName(alias)
  if (!aliasCheck.ok) return null
  const path = getSessionAliasStoragePath(options)
  const file = readAliasFile(path)
  return file.aliases[aliasCheck.value] ?? null
}

/**
 * Resolve an identifier to a real session ID. If the input already looks like a
 * session ID (starts with "ses_"), it is returned unchanged. Otherwise we try
 * to interpret it as an alias and resolve it. Returns the input as-is when no
 * alias is found, so callers can still produce "session not found" errors with
 * the original token.
 */
export function resolveSessionIdentifier(
  identifier: string,
  options: ManagerOptions = {},
): { session_id: string; resolved_from_alias: boolean; alias?: string } {
  if (typeof identifier !== "string") {
    return { session_id: String(identifier ?? ""), resolved_from_alias: false }
  }
  const trimmed = identifier.trim()
  if (!trimmed) return { session_id: identifier, resolved_from_alias: false }
  if (trimmed.toLowerCase().startsWith(SESSION_ID_PREFIX)) {
    return { session_id: trimmed, resolved_from_alias: false }
  }
  const entry = getAliasEntry(trimmed, options)
  if (entry) {
    // Defensive: validate the stored session ID in case the file was tampered with.
    const sidCheck = validateSessionId(entry.session_id)
    if (!sidCheck.ok) {
      return { session_id: trimmed, resolved_from_alias: false }
    }
    return { session_id: sidCheck.value, resolved_from_alias: true, alias: entry.alias }
  }
  // No alias match — return the trimmed value so downstream "not found" messages
  // are predictable. The original (untrimmed) input is preserved by the caller if needed.
  return { session_id: trimmed, resolved_from_alias: false }
}
