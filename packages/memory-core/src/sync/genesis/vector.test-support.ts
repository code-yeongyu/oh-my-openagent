import { createPublicKey, createPrivateKey } from "node:crypto"
import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import type { KeyringEntry } from "../crypto/entry.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { deviceIdOf } from "../crypto/signatures.ts"
import { b64urlEncode, jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { signFramed } from "../crypto/vendor/sync-format/keys.ts"
import { createDeviceKeyring, type DeviceKeyring } from "../keyring-port.ts"
import { deriveRecoveryKeys, publicKeyText } from "../recovery/derive.ts"
import type { KeyringAppendRequest } from "../recovery/ports.ts"
import { buildGenesis } from "./build.ts"
import { prepareGenesis } from "./prepare.ts"
import { bytes, deterministicSeal, privateDer } from "./seal.test-support.ts"

export const ACCOUNT = "genesis-vector-account"
export const EMPTY_HEAD = { seq: 0, link: "", keyring_link: "" } as const

export const deviceKeyring = async (seed = 1): Promise<DeviceKeyring> => {
  const signingPrivatePkcs8 = privateDer("ed25519", bytes(32, seed)).toString("base64url")
  const sealingPrivatePkcs8 = privateDer("x25519", bytes(32, seed + 1)).toString("base64url")
  const publicKey = createPublicKey(createPrivateKey({ key: Buffer.from(signingPrivatePkcs8, "base64url"), format: "der", type: "pkcs8" })).export({ format: "jwk" }).x
  const id = await deviceIdOf(publicKey ?? "")
  if (id === null) throw new Error("invalid test signing key")
  return createDeviceKeyring(id, { signingPrivatePkcs8, sealingPrivatePkcs8 })
}

export const vector = async () => {
  const keyring = await deviceKeyring()
  const recovery = await deriveRecoveryKeys(bytes(32, 3), bytes(32, 4))
  const bootstrap = {
    account: ACCOUNT,
    custody_nonce: b64urlEncode(bytes(16, 5)),
    first_device: {
      ...keyring.principal(),
      sealing_public_key: keyring.publicKeys().sealing,
      signing_public_key: keyring.publicKeys().signing,
    },
    recovery_key: {
      credential_id: b64urlEncode(bytes(16, 6)),
      rp_id: "recovery.omo.dev",
      enrollment_nonce: b64urlEncode(bytes(32, 4)),
      ...publicKeyText(recovery),
      survivable: "synced" as const,
    },
  }
  const capabilities = {
    seal: deterministicSeal,
    countersign: (payload: Parameters<typeof signFramed>[1]) =>
      signFramed("omo-sync/v1/recovery-countersign", payload, recovery.signSeed),
  }
  const prepared = await prepareGenesis(bootstrap, capabilities)
  const built = await buildGenesis(ACCOUNT, keyring, prepared)
  return { keyring, recovery, bootstrap, capabilities, prepared, built }
}

export const entryOf = async (request: KeyringAppendRequest, keyring: DeviceKeyring): Promise<KeyringEntry> => ({
  seq: 1, kind: "keyring", account: request.record.account, epoch: request.record.epoch,
  author: { ...keyring.principal(), sealing_public_key: keyring.publicKeys().sealing, signing_public_key: keyring.publicKeys().signing },
  body: request.record, digest: await sha256B64(jcsBytes(request.record)),
  base_seq: request.base_seq, link: request.link, keyring_link: request.keyring_link,
  record_sig: request.record_sig, wraps: request.wraps,
})

export const walk = async (request: KeyringAppendRequest, signer: DeviceKeyring, anchor = signer) =>
  appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, anchor)), [await entryOf(request, signer)], createRejectionCounter())
