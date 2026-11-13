import type { RecoveryTransport } from "./ports.ts"
import { MAX_RECOVERY_KEYS } from "./salt-inputs.ts"

/** A still-enrolled phrase key as the served rows state it, read BEFORE verification: a hint only (contract 6, DI). */
export type PhraseRecoveryHint = {
  readonly credentialId: string
  readonly enrollmentNonce: string
  readonly sealing_public_key: string
  readonly signing_public_key: string
}

export type ServedPhraseHints =
  | { readonly ok: true; readonly hints: ReadonlyArray<PhraseRecoveryHint> }
  | { readonly ok: false; readonly reason: "unavailable" | "too-many-recovery-keys" }

const text = (value: unknown, key: string): string | null => {
  const field: unknown = Reflect.get(Object(value), key)
  return typeof field === "string" && field.length > 0 ? field : null
}

type Served = { readonly credentialId: string; readonly hint: PhraseRecoveryHint | null }

const servedKey = (value: unknown): Served | null => {
  const credentialId = text(value, "credential_id")
  if (credentialId === null) return null
  const enrollmentNonce = text(value, "enrollment_nonce")
  const sealing = text(value, "sealing_public_key")
  const signing = text(value, "signing_public_key")
  const phrase = Reflect.get(Object(value), "survivable") === "phrase"
  return {
    credentialId,
    hint:
      phrase && enrollmentNonce !== null && sealing !== null && signing !== null
        ? { credentialId, enrollmentNonce, sealing_public_key: sealing, signing_public_key: signing }
        : null,
  }
}

const keyOfRow = (row: unknown): Served | null => {
  const body: unknown = Reflect.get(Object(row), "body")
  const kind: unknown = Reflect.get(Object(body), "kind")
  if (kind === "genesis") return servedKey(Reflect.get(Object(Reflect.get(Object(body), "bootstrap")), "recovery_key"))
  return kind === "recovery-key" ? servedKey(body) : null
}

/**
 * The phrase-kind keys a typed phrase is derived against (at most MAX_RECOVERY_KEYS enrolled keys of BOTH kinds,
 * removals excluded, the same bound as the PRF salts). A wrong hint only yields keys that fail the anchored walk.
 */
export const servedPhraseHints = async (transport: RecoveryTransport): Promise<ServedPhraseHints> => {
  const rows: unknown = await transport.listKeys()
  if (!Array.isArray(rows)) return { ok: false, reason: "unavailable" }
  const found = new Map<string, Served>()
  const removed = new Set<string>()
  for (const row of rows) {
    const body: unknown = Reflect.get(Object(row), "body")
    const removal = Reflect.get(Object(body), "kind") === "recovery-key-removed" ? text(body, "credential_id") : null
    if (removal !== null) removed.add(removal)
    const served = keyOfRow(row)
    if (served !== null && !found.has(served.credentialId)) found.set(served.credentialId, served)
  }
  for (const credentialId of removed) found.delete(credentialId)
  if (found.size > MAX_RECOVERY_KEYS) return { ok: false, reason: "too-many-recovery-keys" }
  return {
    ok: true,
    hints: [...found.values()].flatMap((served) => (served.hint === null ? [] : [served.hint])),
  }
}
