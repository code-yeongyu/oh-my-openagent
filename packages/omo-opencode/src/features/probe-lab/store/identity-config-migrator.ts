import type { Database } from "bun:sqlite"
import type { Identity, NewIdentityInput } from "../types"

export function readIncomingFingerprintProfileId(input: NewIdentityInput): string | null {
  const raw = input.config
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>).fingerprint_profile_id
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

export function stripFingerprintFromConfig(config: unknown): unknown {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const copy = { ...(config as Record<string, unknown>) }
    delete copy.fingerprint_profile_id
    return copy
  }
  return config
}

export function migrateLegacyFingerprintInline(db: Database, row: Identity | null): Identity | null {
  if (!row) return null
  if (row.fingerprint_profile_id) return row
  const legacyId = readLegacyFingerprintIdFromConfig(row.config)
  if (!legacyId) return row
  db.run(
    "UPDATE identities SET fingerprint_profile_id = ?2 WHERE id = ?1",
    [row.id, legacyId],
  )
  return { ...row, fingerprint_profile_id: legacyId }
}

function readLegacyFingerprintIdFromConfig(configJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(configJson)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const value = (parsed as Record<string, unknown>).fingerprint_profile_id
    return typeof value === "string" && value.length > 0 ? value : null
  } catch {
    return null
  }
}
