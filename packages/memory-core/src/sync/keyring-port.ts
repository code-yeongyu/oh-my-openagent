import { Buffer } from "node:buffer"
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
} from "node:crypto"
import { canonicalizeJson, CanonicalJsonError, type CanonicalJsonViolation, requireCanonicalJson } from "./canonical-json"
import { openHpkeSealedBox } from "./hpke-sealed-box"

/**
 * DeviceKeyring is the sync engine's only path to this device's private keys
 * (work-plan todo 14; custody model in `docs/sync-design.md` §7 of omo-service).
 *
 * A device principal owns two key pairs generated on the device itself:
 *  - an Ed25519 signing pair, which signs every sync batch and keyring record;
 *  - an X25519 sealing pair, to which the account epoch keys are wrapped.
 *
 * The private halves never leave an implementation: they are never returned,
 * never serialized to logs or errors, and callers see only the principal
 * identity, the public keys, and the two operations.
 */
export type DeviceKeyringSignRequest =
  | {
      /** SHA-256 of the batch object up to (excluding) its signature field. */
      readonly purpose: "object-digest"
      /** Exactly 32 bytes. */
      readonly digest: Uint8Array
    }
  | {
      /** A keyring-record preimage. */
      readonly purpose: "record"
      /** RFC 8785 canonical JSON whose top-level "t" starts with "omo-sync/v1/". */
      readonly canonicalJson: Uint8Array
    }
  | {
      /** A compaction snapshot preimage (spec §6): `{t, account, author, covers_seq, digest, link, keyring_head}`. */
      readonly purpose: "snapshot"
      /** RFC 8785 canonical JSON whose top-level "t" is exactly "omo-sync/v1/snapshot". */
      readonly canonicalJson: Uint8Array
    }

/**
 * Refusal for any sign request outside the three typed purposes above. A
 * DeviceKeyring is never a raw-bytes signing oracle: it signs exactly the
 * given digest or canonical JSON, and only after the request validates.
 */
export class DeviceKeyringSignError extends Error {
  readonly name = "DeviceKeyringSignError"
  constructor(
    readonly reason:
      | "unknown-purpose"
      | "digest-length"
      | "record-json"
      | "record-prefix"
      | "record-canonical-duplicate-key"
      | "record-canonical-number"
      | "record-canonical-order"
      | "record-canonical-escape"
      | "record-canonical-whitespace"
      | "record-canonical-encoding"
      | "snapshot-prefix",
    message: string,
  ) {
    super(message)
  }
}

/**
 * Domain separation tags (Opus delta review of desktop #2665, tag names
 * corrected): every device or recovery signature is Ed25519 over
 * `tag || 0x00 || payload`. No signature is ever made over untagged bytes,
 * so a signature minted for one purpose can never be replayed as another.
 */
const SIGNING_DOMAIN_TAGS: Record<DeviceKeyringSignRequest["purpose"], string> = {
  "object-digest": "omo-sync/v1/object-digest",
  record: "omo-sync/v1/record",
  snapshot: "omo-sync/v1/snapshot",
}

function domainSeparatedMessage(purpose: DeviceKeyringSignRequest["purpose"], payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(SIGNING_DOMAIN_TAGS[purpose], "ascii"), Buffer.from([0]), Buffer.from(payload)])
}

const CANONICAL_REASONS: Record<CanonicalJsonViolation, DeviceKeyringSignError["reason"]> = {
  json: "record-json",
  "duplicate-key": "record-canonical-duplicate-key",
  number: "record-canonical-number",
  order: "record-canonical-order",
  escape: "record-canonical-escape",
  whitespace: "record-canonical-whitespace",
  encoding: "record-canonical-encoding",
}

function parseCanonical(bytes: Uint8Array, what: "record" | "snapshot"): unknown {
  try {
    return requireCanonicalJson(bytes)
  } catch (error) {
    if (!(error instanceof CanonicalJsonError)) throw error
    throw new DeviceKeyringSignError(CANONICAL_REASONS[error.violation], `sign: ${what} preimage is not RFC 8785 canonical JSON: ${error.message}`)
  }
}

function validateSignRequest(request: DeviceKeyringSignRequest): Uint8Array {
  if (typeof request !== "object" || request === null) {
    throw new DeviceKeyringSignError("unknown-purpose", "sign: request must be a typed sign request")
  }
  if (request.purpose === "object-digest") {
    if (!(request.digest instanceof Uint8Array) || request.digest.length !== 32) {
      throw new DeviceKeyringSignError("digest-length", "sign: object-digest needs exactly 32 bytes (SHA-256 of the batch object)")
    }
    return request.digest
  }
  if (request.purpose === "record") {
    if (!(request.canonicalJson instanceof Uint8Array)) {
      throw new DeviceKeyringSignError("record-json", "sign: record needs RFC 8785 canonical JSON bytes")
    }
    const parsed = parseCanonical(request.canonicalJson, "record")
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof (parsed as { t?: unknown }).t !== "string") {
      throw new DeviceKeyringSignError("record-json", 'sign: record preimage needs a top-level "t" string')
    }
    const t = (parsed as { t: string }).t
    if (!t.startsWith("omo-sync/v1/")) {
      throw new DeviceKeyringSignError("record-prefix", 'sign: record "t" must start with "omo-sync/v1/"')
    }
    // A record never carries another purpose's tag as its type: snapshots sign under
    // their own purpose, and the object-digest tag names no record.
    if (t === SIGNING_DOMAIN_TAGS["object-digest"] || t === SIGNING_DOMAIN_TAGS.snapshot) {
      throw new DeviceKeyringSignError("record-prefix", 'sign: record "t" must name a keyring record type, not another purpose\'s tag')
    }
    return request.canonicalJson
  }
  if (request.purpose === "snapshot") {
    if (!(request.canonicalJson instanceof Uint8Array)) {
      throw new DeviceKeyringSignError("record-json", "sign: snapshot needs RFC 8785 canonical JSON bytes")
    }
    const parsed = parseCanonical(request.canonicalJson, "snapshot")
    const t = typeof parsed === "object" && parsed !== null ? (parsed as { t?: unknown }).t : undefined
    if (t !== SIGNING_DOMAIN_TAGS.snapshot) {
      throw new DeviceKeyringSignError("snapshot-prefix", 'sign: snapshot preimage "t" must be exactly "omo-sync/v1/snapshot"')
    }
    return request.canonicalJson
  }
  throw new DeviceKeyringSignError("unknown-purpose", `sign: unsupported purpose ${JSON.stringify((request as { purpose?: unknown }).purpose ?? null)}`)
}

export interface DeviceKeyring {
  /** The keyring principal identity used in batch headers and record signatures. */
  principal(): { kind: "device"; id: string }
  /** Raw 32-byte public keys, base64url-encoded (Ed25519 `x`, X25519 `x`). */
  publicKeys(): {
    /** Ed25519 raw public key, base64url. */
    signing: string
    /** X25519 raw public key, base64url. */
    sealing: string
  }
  /**
   * Ed25519 signature (64 bytes) over exactly the bytes of the request: the
   * 32-byte object digest, or the record's or snapshot's canonical JSON. Never a
   * raw-bytes oracle: anything outside the three typed purposes is refused with a
   * DeviceKeyringSignError before any signing happens.
   */
  sign(request: DeviceKeyringSignRequest): Promise<Uint8Array>
  /**
   * Opens a sealed wrap addressed to this device's sealing key and returns the
   * plaintext envelope (spec §8.1, omo-service docs/sync-design.md @21e0757).
   *
   * Construction: RFC 9180 HPKE, base mode (mode 0), suite
   * DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
   * (KEM 0x0020, KDF 0x0001, AEAD 0x0002), single-shot single-recipient
   * (`SetupBaseR`/`Open`, no psk). `info` is UTF-8 `"omo-sync/v1/wrap"`
   * followed by one 0x00 byte; AAD is the RFC 8785 canonical JSON
   * `{"account":...,"epoch":...,"id":...}` of the verified wrap entry, so a
   * genuine ciphertext moved to another account, epoch or recipient refuses
   * at the AEAD. Wire form: `enc (32 bytes) || ciphertext || 16-byte tag`.
   */
  unseal(wrap: Uint8Array, binding: WrapBinding): Promise<Uint8Array>
}

/** The verified wrap entry an `unseal` binds to: account, epoch, recipient id. */
export type WrapBinding = { readonly account: string; readonly epoch: number; readonly id: string }

/** §8.1 wrap `info`: UTF-8 "omo-sync/v1/wrap" followed by one NUL byte. */
const WRAP_INFO = Buffer.concat([Buffer.from("omo-sync/v1/wrap", "ascii"), Buffer.from([0])])

const wrapAad = (binding: WrapBinding): Uint8Array => {
  if (!Number.isSafeInteger(binding.epoch) || binding.epoch < 0) throw new Error("unseal: the wrap epoch must be a non-negative integer")
  return canonicalizeJson({ account: binding.account, epoch: binding.epoch, id: binding.id })
}

export { openHpkeSealedBox } from "./hpke-sealed-box"

interface DeviceKeyMaterial {
  /** PKCS#8 DER of the Ed25519 private key, base64url. */
  readonly signingPrivatePkcs8: string
  /** PKCS#8 DER of the X25519 private key, base64url. */
  readonly sealingPrivatePkcs8: string
}

/**
 * Generates a fresh Ed25519 + X25519 pair. PKCS#8 DER is the only portable
 * private-key form in this runtime: raw-scalar JWK imports require a matching
 * `x` field, which DER already carries internally.
 */
export function generateDeviceKeyMaterial(): DeviceKeyMaterial & { publicKeys: { signing: string; sealing: string } } {
  const signing = generateKeyPairSync("ed25519")
  const sealing = generateKeyPairSync("x25519")
  const signingPublic = signing.publicKey.export({ format: "jwk" }).x
  const sealingPublic = sealing.publicKey.export({ format: "jwk" }).x
  if (!signingPublic || !sealingPublic) throw new Error("device key generation produced invalid key material")
  return {
    signingPrivatePkcs8: signing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    sealingPrivatePkcs8: sealing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeys: { signing: signingPublic, sealing: sealingPublic },
  }
}

/**
 * Builds a DeviceKeyring from PKCS#8 material it then owns. The private keys
 * stay inside the returned closures; the object exposes only the port surface.
 */
export function createDeviceKeyring(id: string, material: DeviceKeyMaterial): DeviceKeyring {
  const signingPrivateKey = createPrivateKey({ key: Buffer.from(material.signingPrivatePkcs8, "base64url"), format: "der", type: "pkcs8" })
  const sealingPrivateKey = createPrivateKey({ key: Buffer.from(material.sealingPrivatePkcs8, "base64url"), format: "der", type: "pkcs8" })
  const signingPublic = createPublicKey(signingPrivateKey).export({ format: "jwk" }).x
  const sealingPublic = createPublicKey(sealingPrivateKey).export({ format: "jwk" }).x
  if (!signingPublic || !sealingPublic) throw new Error("invalid device key material")
  const sealingPrivateJwk = sealingPrivateKey.export({ format: "jwk" })
  const sealingPrivateRaw = Buffer.from(sealingPrivateJwk.d ?? "", "base64url")
  const sealingPublicRaw = Buffer.from(sealingPublic, "base64url")
  if (sealingPrivateRaw.length !== 32 || sealingPublicRaw.length !== 32) throw new Error("invalid device key material")
  const publicKeys = { signing: signingPublic, sealing: sealingPublic }
  return {
    principal: () => ({ kind: "device", id }),
    publicKeys: () => ({ ...publicKeys }),
    sign: async request => {
      const payload = validateSignRequest(request)
      return ed25519Sign(null, domainSeparatedMessage(request.purpose, payload), signingPrivateKey)
    },
    unseal: async (wrap, binding) => openHpkeSealedBox(sealingPrivateRaw, sealingPublicRaw, wrap, WRAP_INFO, wrapAad(binding)),
  }
}

/**
 * In-memory DeviceKeyring for tests and fixtures: generates fresh keys per
 * instance. A process restart is a new principal.
 */
export function createInMemoryDeviceKeyring(id: string): DeviceKeyring {
  return createDeviceKeyring(id, generateDeviceKeyMaterial())
}
