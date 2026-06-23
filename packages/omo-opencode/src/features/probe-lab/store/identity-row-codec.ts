import { log } from "../../../shared/logger"
import {
  decryptAuthConfig,
  encryptAuthConfig,
  getCredentialMasterKey,
  parseEncryptedPayload,
} from "../crypto/credential-encryption"
import type { Identity } from "../types"

export function encryptIdentityConfig(config: unknown): string {
  return JSON.stringify(encryptAuthConfig(JSON.stringify(config), getCredentialMasterKey()))
}

export function decryptIdentityRow(row: Identity | null): Identity | null {
  if (!row) return null
  const payload = parseEncryptedPayload(row.config)
  if (!payload) {
    log("[probe-lab] WARNING: legacy plaintext identity config read; re-save identity to encrypt at rest", { identity_id: row.id })
    return row
  }
  return {
    ...row,
    config: decryptAuthConfig(payload, getCredentialMasterKey()),
  }
}
