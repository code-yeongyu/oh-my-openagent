import type { Database } from "bun:sqlite"
import type { FingerprintProfile, NewFingerprintProfileInput } from "../fingerprint-types"

export type FingerprintProfileStore = ReturnType<typeof createFingerprintProfileStore>

export function createFingerprintProfileStore(db: Database) {
  function insert(input: NewFingerprintProfileInput): FingerprintProfile {
    db.run(
      `INSERT INTO fingerprint_profiles
         (id, name, engine, tls_fingerprint, http_version, user_agent, sec_ch_ua,
          sec_ch_ua_platform, accept_language, header_order, extra_headers,
          proxy_required, browser_profile)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      [
        input.id,
        input.name,
        input.engine,
        input.tls_fingerprint ?? null,
        input.http_version ?? "HTTP/2",
        input.user_agent,
        input.sec_ch_ua ?? null,
        input.sec_ch_ua_platform ?? null,
        input.accept_language ?? "en-US,en;q=0.9",
        input.header_order ? JSON.stringify(input.header_order) : null,
        input.extra_headers ? JSON.stringify(input.extra_headers) : null,
        input.proxy_required ? 1 : 0,
        input.browser_profile ?? null,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): FingerprintProfile | null {
    return db.query<FingerprintProfile, [string]>(
      "SELECT * FROM fingerprint_profiles WHERE id = ?1",
    ).get(id) ?? null
  }

  function mustGet(id: string): FingerprintProfile {
    const row = get(id)
    if (!row) throw new Error(`fingerprint profile not found: ${id}`)
    return row
  }

  function getByName(name: string): FingerprintProfile | null {
    return db.query<FingerprintProfile, [string]>(
      "SELECT * FROM fingerprint_profiles WHERE name = ?1",
    ).get(name) ?? null
  }

  function list(): FingerprintProfile[] {
    return db.query<FingerprintProfile, []>(
      "SELECT * FROM fingerprint_profiles ORDER BY created_at DESC",
    ).all()
  }

  function updateLastVerifiedAt(id: string, atSeconds: number): void {
    db.run(
      "UPDATE fingerprint_profiles SET last_verified_at = ?2 WHERE id = ?1",
      [id, atSeconds],
    )
  }

  function recordDetectionScore(id: string, score: number): void {
    db.run(
      "UPDATE fingerprint_profiles SET detection_score = ?2 WHERE id = ?1",
      [id, score],
    )
  }

  return { insert, get, getByName, list, updateLastVerifiedAt, recordDetectionScore }
}
