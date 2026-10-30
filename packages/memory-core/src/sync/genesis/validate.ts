import { parseBody, parsePrincipal } from "../crypto/parse.ts"
import { decodeB64, deviceIdOf, isStrongKeyText, taggedHash, verifyTagged } from "../crypto/signatures.ts"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { GenesisBuildError, type GenesisBootstrap, type GenesisPrepared } from "./types.ts"

const exact = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const text = (value: string): boolean => typeof value === "string" && value.length > 0 && value.normalize("NFC") === value

/** Public native input, checked before either sealing or recovery signing. */
export const validateBootstrap = async (bootstrap: GenesisBootstrap): Promise<void> => {
  const first = bootstrap.first_device
  const recovery = bootstrap.recovery_key
  if (!exact(bootstrap, ["account", "custody_nonce", "first_device", "recovery_key"]) ||
      !text(bootstrap.account) || decodeB64(bootstrap.custody_nonce, 16) === null ||
      parsePrincipal(first) === null || decodeB64(first.id, 16) === null ||
      decodeB64(first.sealing_public_key, 32) === null || !isStrongKeyText(first.signing_public_key) ||
      !exact(recovery, ["credential_id", "rp_id", "enrollment_nonce", "sealing_public_key", "signing_public_key", "survivable"]) ||
      decodeB64(recovery.credential_id) === null || !text(recovery.rp_id) ||
      decodeB64(recovery.enrollment_nonce, 32) === null ||
      decodeB64(recovery.sealing_public_key, 32) === null || !isStrongKeyText(recovery.signing_public_key) ||
      (recovery.survivable !== "synced" && recovery.survivable !== "roaming") ||
      await deviceIdOf(first.signing_public_key) !== first.id) {
    throw new GenesisBuildError("bad_bootstrap")
  }
}

/** Recheck the public bridge result; the bridge cannot supply a trusted root or wrap digest. */
export const validatePrepared = async ({ body, wraps }: GenesisPrepared): Promise<void> => {
  if (parseBody(body)?.kind !== "genesis" || body.epoch !== 1) throw new GenesisBuildError("bad_record")
  await validateBootstrap(body.bootstrap)
  const expected = [`device:${body.bootstrap.first_device.id}`, `recovery:${body.bootstrap.recovery_key.credential_id}`]
  if (wraps.length !== 2 || !wraps.every((wrap, index) =>
    exact(wrap, ["epoch", "id", "wrap"]) && wrap.epoch === 1 && wrap.id === expected[index] && decodeB64(wrap.wrap) !== null)) {
    throw new GenesisBuildError("bad_wrap_set")
  }
  if (await taggedHash("omo-sync/v1/custody-root", body.bootstrap) !== body.custody_root) {
    throw new GenesisBuildError("bad_custody_root")
  }
  if (await sha256B64(jcsBytes(wraps)) !== body.wraps_digest) throw new GenesisBuildError("wraps_digest_mismatch")
  const payload = {
    t: "omo-sync/v1/recovery-countersign",
    account: body.account, custody_root: body.custody_root, predecessor: "", wraps_digest: body.wraps_digest,
  }
  if (!await verifyTagged(payload.t, payload, body.bootstrap.recovery_key.signing_public_key, body.countersign)) {
    throw new GenesisBuildError("bad_countersign")
  }
}
