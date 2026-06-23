import type { Database } from "bun:sqlite"
import type { NewProviderCredentialsInput, ProviderCredentials, ProviderStatus } from "../provider-types"
import {
  decryptAuthConfig,
  encryptAuthConfig,
  getCredentialMasterKey,
  parseEncryptedPayload,
} from "../crypto/credential-encryption"
import { log } from "../../../shared/logger"

export type ProviderCredentialStore = ReturnType<typeof createProviderCredentialStore>

export function createProviderCredentialStore(db: Database) {
  function insert(input: NewProviderCredentialsInput): ProviderCredentials {
    db.run(
      `INSERT INTO provider_credentials
         (id, name, provider_type, base_url, auth_type, auth_config, default_headers,
          rate_limit_rps, rate_limit_rpm, rate_limit_tpm, cooldown_on_429_s,
          supported_models, health_check_url, health_check_interval_s)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      [
        input.id,
        input.name,
        input.provider_type,
        input.base_url,
        input.auth_type,
        encryptAuthJson(JSON.stringify(input.auth_config)),
        input.default_headers ? JSON.stringify(input.default_headers) : null,
        input.rate_limit_rps ?? null,
        input.rate_limit_rpm ?? null,
        input.rate_limit_tpm ?? null,
        input.cooldown_on_429_s ?? 90,
        input.supported_models ? JSON.stringify(input.supported_models) : null,
        input.health_check_url ?? null,
        input.health_check_interval_s ?? 300,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): ProviderCredentials | null {
    return decryptRow(db.query<ProviderCredentials, [string]>(
      "SELECT * FROM provider_credentials WHERE id = ?1",
    ).get(id) ?? null)
  }

  function mustGet(id: string): ProviderCredentials {
    const row = get(id)
    if (!row) throw new Error(`provider not found: ${id}`)
    return row
  }

  function getByName(name: string): ProviderCredentials | null {
    return decryptRow(db.query<ProviderCredentials, [string]>(
      "SELECT * FROM provider_credentials WHERE name = ?1",
    ).get(name) ?? null)
  }

  function list(): ProviderCredentials[] {
    return db.query<ProviderCredentials, []>(
      "SELECT * FROM provider_credentials ORDER BY created_at DESC",
    ).all().map((row) => decryptRow(row)!)
  }

  function updateStatus(id: string, status: ProviderStatus): void {
    db.run(
      "UPDATE provider_credentials SET status = ?2, updated_at = unixepoch() WHERE id = ?1",
      [id, status],
    )
  }

  function updateAuthConfig(id: string, authConfig: Record<string, unknown>): void {
    db.run(
      "UPDATE provider_credentials SET auth_config = ?2, updated_at = unixepoch() WHERE id = ?1",
      [id, encryptAuthJson(JSON.stringify(authConfig))],
    )
  }

  return { insert, get, getByName, list, updateStatus, updateAuthConfig }
}

function encryptAuthJson(plaintext: string): string {
  return JSON.stringify(encryptAuthConfig(plaintext, getCredentialMasterKey()))
}

function decryptRow(row: ProviderCredentials | null): ProviderCredentials | null {
  if (!row) return null
  const payload = parseEncryptedPayload(row.auth_config)
  if (!payload) {
    log("[probe-lab] WARNING: legacy plaintext provider auth_config read; re-save provider to encrypt at rest", { provider_id: row.id })
    return row
  }
  return {
    ...row,
    auth_config: decryptAuthConfig(payload, getCredentialMasterKey()),
  }
}
