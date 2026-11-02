import type { KeyringBody } from "./entry.ts"
import type { JsonValue } from "./vendor/sync-format/jcs.ts"

export type Principal = {
  readonly kind: "device"
  readonly id: string
  readonly sealing_public_key: string
  readonly signing_public_key: string
}

export type RecoveryKey = {
  readonly credential_id: string
  readonly rp_id: string
  readonly enrollment_nonce: string
  readonly sealing_public_key: string
  readonly signing_public_key: string
  readonly survivable: "synced" | "roaming"
}

export type ParsedBody =
  | {
      readonly kind: "genesis"
      readonly firstDevice: Principal
      readonly recoveryKey: RecoveryKey
      readonly bootstrap: JsonValue
      readonly custodyRoot: string
      readonly countersign: string
      readonly wrapsDigest: string
    }
  | {
      readonly kind: "recovery-key"
      readonly key: RecoveryKey
      readonly countersign: string
      readonly wrapsDigest: string
    }
  | { readonly kind: "recovery-key-removed"; readonly credentialId: string }
  | {
      readonly kind: "approval"
      readonly principal: Principal
      readonly wrapsDigest: string
      readonly commitment: string
      readonly joiningNonce: string
    }
  | {
      readonly kind: "rotation"
      readonly members: ReadonlyArray<Principal>
      readonly wrapsDigest: string
      readonly forkResolution: number | null
    }
  | {
      readonly kind: "recovery-join"
      readonly keyringHead: string
      readonly principal: Principal
      readonly credentialId: string
    }
  | { readonly kind: "recovery-join-vetoed"; readonly joinDigest: string }
  | {
      readonly kind: "fork-resolution"
      readonly members: ReadonlyArray<Principal>
      readonly recoveryKeys: ReadonlyArray<RecoveryKey>
      readonly epoch: number
    }

export type JsonObject = { readonly [key: string]: JsonValue }

export const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasExactly = (value: JsonObject, keys: ReadonlyArray<string>): boolean => {
  const own = Object.keys(value).sort()
  const want = [...keys].sort()
  return own.length === want.length && own.every((key, index) => key === want[index])
}

const text = (value: JsonObject, key: string): string | null => {
  const field = value[key]
  return typeof field === "string" && field.length > 0 ? field : null
}

const COMMON = ["kind", "account", "epoch"]
const PRINCIPAL_KEYS = ["kind", "id", "sealing_public_key", "signing_public_key"]
const RECOVERY_KEYS = [
  "credential_id",
  "rp_id",
  "enrollment_nonce",
  "sealing_public_key",
  "signing_public_key",
  "survivable",
]

export const parsePrincipal = (value: JsonValue | undefined): Principal | null => {
  if (!isObject(value) || !hasExactly(value, PRINCIPAL_KEYS) || value["kind"] !== "device") {
    return null
  }
  const id = text(value, "id")
  const sealing = text(value, "sealing_public_key")
  const signing = text(value, "signing_public_key")
  if (id === null || sealing === null || signing === null) return null
  return { kind: "device", id, sealing_public_key: sealing, signing_public_key: signing }
}

const readRecoveryKey = (value: JsonObject): RecoveryKey | null => {
  const survivable = value["survivable"]
  if (survivable !== "synced" && survivable !== "roaming") return null
  const fields = RECOVERY_KEYS.slice(0, 5).map((key) => text(value, key))
  const [credentialId, rpId, nonce, sealing, signing] = fields
  if (fields.some((field) => field === null)) return null
  return {
    credential_id: credentialId ?? "",
    rp_id: rpId ?? "",
    enrollment_nonce: nonce ?? "",
    sealing_public_key: sealing ?? "",
    signing_public_key: signing ?? "",
    survivable,
  }
}

const parseGenesis = (body: JsonObject): ParsedBody | null => {
  if (!hasExactly(body, [...COMMON, "bootstrap", "custody_root", "countersign", "wraps_digest"])) {
    return null
  }
  const bootstrap = body["bootstrap"]
  if (!isObject(bootstrap)) return null
  if (!hasExactly(bootstrap, ["account", "custody_nonce", "first_device", "recovery_key"])) return null
  if (bootstrap["account"] !== body["account"] || text(bootstrap, "custody_nonce") === null) return null
  const firstDevice = parsePrincipal(bootstrap["first_device"])
  const recoveryValue = bootstrap["recovery_key"]
  if (!isObject(recoveryValue) || !hasExactly(recoveryValue, RECOVERY_KEYS)) return null
  const recoveryKey = readRecoveryKey(recoveryValue)
  const custodyRoot = text(body, "custody_root")
  const countersign = text(body, "countersign")
  const wrapsDigest = text(body, "wraps_digest")
  if (firstDevice === null || recoveryKey === null) return null
  if (custodyRoot === null || countersign === null || wrapsDigest === null) return null
  return { kind: "genesis", firstDevice, recoveryKey, bootstrap, custodyRoot, countersign, wrapsDigest }
}

const parseRecoveryKeyRecord = (body: JsonObject): ParsedBody | null => {
  if (!hasExactly(body, [...COMMON, ...RECOVERY_KEYS, "countersign", "wraps_digest"])) return null
  const key = readRecoveryKey(body)
  const countersign = text(body, "countersign")
  const wrapsDigest = text(body, "wraps_digest")
  if (key === null || countersign === null || wrapsDigest === null) return null
  return { kind: "recovery-key", key, countersign, wrapsDigest }
}

const parseApproval = (body: JsonObject): ParsedBody | null => {
  if (!hasExactly(body, [...COMMON, "principal", "wraps_digest", "pairing"])) return null
  const pairing = body["pairing"]
  if (!isObject(pairing)) return null
  if (!hasExactly(pairing, ["commitment", "joining_nonce", "approver_nonce"])) return null
  const principal = parsePrincipal(body["principal"])
  const wrapsDigest = text(body, "wraps_digest")
  const commitment = text(pairing, "commitment")
  const joiningNonce = text(pairing, "joining_nonce")
  if (principal === null || wrapsDigest === null || commitment === null || joiningNonce === null) {
    return null
  }
  if (text(pairing, "approver_nonce") === null) return null
  return { kind: "approval", principal, wrapsDigest, commitment, joiningNonce }
}

const parseRotation = (body: JsonObject): ParsedBody | null => {
  if (!hasExactly(body, [...COMMON, "members", "wraps_digest", "fork_resolution"])) return null
  const fork = body["fork_resolution"]
  const forkResolution = fork === null ? null : typeof fork === "number" && Number.isSafeInteger(fork) && fork >= 1 ? fork : undefined
  if (forkResolution === undefined) return null
  const membersValue = body["members"]
  const wrapsDigest = text(body, "wraps_digest")
  if (!Array.isArray(membersValue) || wrapsDigest === null) return null
  const members = membersValue.map((member: JsonValue) => parsePrincipal(member))
  const parsed = members.filter((member): member is Principal => member !== null)
  if (parsed.length !== members.length || parsed.length === 0) return null
  return { kind: "rotation", members: parsed, wrapsDigest, forkResolution }
}

const parseJoin = (body: JsonObject): ParsedBody | null => {
  if (!hasExactly(body, [...COMMON, "keyring_head", "principal", "credential_id"])) return null
  const principal = parsePrincipal(body["principal"])
  const keyringHead = text(body, "keyring_head")
  const credentialId = text(body, "credential_id")
  if (principal === null || keyringHead === null || credentialId === null) return null
  return { kind: "recovery-join", keyringHead, principal, credentialId }
}

/** The authority a fork-resolution states; its evidence is proven by the vendored receiver. */
const parseForkResolution = (body: JsonObject): ParsedBody | null => {
  const keys = ["fork_set", "evidence", "continuation", "state", "merged_digest"]
  const state = body["state"]
  if (!hasExactly(body, [...COMMON, ...keys]) || !isObject(state)) return null
  if (!hasExactly(state, ["members", "recovery_keys", "epoch"])) return null
  const membersValue = state["members"]
  const keysValue = state["recovery_keys"]
  const epoch = state["epoch"]
  if (!Array.isArray(membersValue) || !Array.isArray(keysValue)) return null
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 1) return null
  const members = membersValue.map((member: JsonValue) => parsePrincipal(member))
  const recoveryKeys = keysValue.map((key: JsonValue) =>
    isObject(key) && hasExactly(key, RECOVERY_KEYS) ? readRecoveryKey(key) : null,
  )
  const parsedMembers = members.filter((member): member is Principal => member !== null)
  const parsedKeys = recoveryKeys.filter((key): key is RecoveryKey => key !== null)
  if (parsedMembers.length !== members.length || parsedKeys.length !== recoveryKeys.length) return null
  return { kind: "fork-resolution", members: parsedMembers, recoveryKeys: parsedKeys, epoch }
}

/**
 * Parses one keyring record body against the closed per-kind schema of sync-design
 * section 8 (unknown or missing fields reject). Unparseable bodies are refused, never folded.
 */
export const parseBody = (body: KeyringBody): ParsedBody | null => {
  if (typeof body.account !== "string" || !Number.isSafeInteger(body.epoch) || body.epoch < 1) {
    return null
  }
  switch (body.kind) {
    case "genesis":
      return parseGenesis(body)
    case "recovery-key":
      return parseRecoveryKeyRecord(body)
    case "recovery-key-removed": {
      const credentialId = text(body, "credential_id")
      if (!hasExactly(body, [...COMMON, "credential_id"]) || credentialId === null) return null
      return { kind: "recovery-key-removed", credentialId }
    }
    case "approval":
      return parseApproval(body)
    case "rotation":
      return parseRotation(body)
    case "recovery-join":
      return parseJoin(body)
    case "recovery-join-vetoed": {
      const joinDigest = text(body, "join_digest")
      if (!hasExactly(body, [...COMMON, "join_digest"]) || joinDigest === null) return null
      return { kind: "recovery-join-vetoed", joinDigest }
    }
    case "fork-resolution":
      return parseForkResolution(body)
    default:
      return null
  }
}
