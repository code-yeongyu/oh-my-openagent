import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { createDeviceKeyring, generateDeviceKeyMaterial, type DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import type { KeyStore } from "./keystore"

interface StoredDeviceKeys {
  readonly version: 1
  /** Random per-machine device id (UUID v4), generated once at init and never renamed with the keys. */
  readonly deviceId: string
  /** PKCS#8 DER of the Ed25519 private key, base64url. */
  readonly signing: string
  /** PKCS#8 DER of the X25519 private key, base64url. */
  readonly sealing: string
}

/**
 * Generates the device's Ed25519 + X25519 pairs and a fresh random device id,
 * and stores all three in the OS keystore. Idempotent: an existing record is
 * reused untouched, so a repeated `omo account keys init` never rotates keys
 * or renames the principal out from under a synced account. The private
 * halves exist only inside the keystore record and this function's stack
 * frame; they are never logged and never returned.
 */
export async function initializeDeviceKeyring(store: KeyStore): Promise<DeviceKeyring> {
  const existing = await loadDeviceKeyring(store)
  if (existing) return existing
  const material = generateDeviceKeyMaterial()
  const record: StoredDeviceKeys = {
    version: 1,
    deviceId: randomUUID(),
    signing: material.signingPrivatePkcs8,
    sealing: material.sealingPrivatePkcs8,
  }
  await store.write(JSON.stringify(record))
  return createDeviceKeyring(record.deviceId, { signingPrivatePkcs8: record.signing, sealingPrivatePkcs8: record.sealing })
}

/**
 * Reopens the stored device keyring, or null when none exists. A corrupt
 * record throws without ever echoing the stored bytes into the error.
 */
export async function loadDeviceKeyring(store: KeyStore): Promise<DeviceKeyring | null> {
  const raw = await store.read()
  if (raw === null) return null
  let record: StoredDeviceKeys
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== "object" || parsed === null ||
      typeof (parsed as { deviceId?: unknown }).deviceId !== "string" ||
      (parsed as { deviceId: string }).deviceId.length === 0 ||
      typeof (parsed as { signing?: unknown }).signing !== "string" ||
      typeof (parsed as { sealing?: unknown }).sealing !== "string"
    ) {
      throw new Error("shape")
    }
    record = parsed as StoredDeviceKeys
    if (Buffer.from(record.signing, "base64url").length === 0 || Buffer.from(record.sealing, "base64url").length === 0) {
      throw new Error("length")
    }
  } catch {
    throw new Error("omo account keys: the stored device key record is unreadable. Run `omo account keys init` on a fresh keystore entry.")
  }
  return createDeviceKeyring(record.deviceId, { signingPrivatePkcs8: record.signing, sealingPrivatePkcs8: record.sealing })
}
