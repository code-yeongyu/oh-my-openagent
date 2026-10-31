import { frozenCopy } from "../crypto/frozen.ts"
import { verifyRecordSig } from "../crypto/signatures.ts"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import type { SyncOperationOptions } from "../operation-authority.ts"
import { signedAppend } from "../recovery/keyring-append.ts"
import { GenesisBuildError, type GenesisAppend, type GenesisPrepared } from "./types.ts"
import { validatePrepared } from "./validate.ts"

/**
 * Finish a native-prepared genesis through this device's typed signer. No private keys,
 * network calls, consent changes or trust-pin writes: the coordinator owns those boundaries.
 */
export const buildGenesis = async (
  account: string,
  keyring: DeviceKeyring,
  input: GenesisPrepared,
  operation: SyncOperationOptions = {},
): Promise<{ readonly request: GenesisAppend; readonly digest: string }> => {
  const prepared = frozenCopy(input, () => false)
  const { body, wraps } = prepared
  if (body.account !== account || body.bootstrap.account !== account) throw new GenesisBuildError("account_mismatch")
  const own = keyring.principal()
  const keys = keyring.publicKeys()
  const first = body.bootstrap.first_device
  if (own.kind !== first.kind || own.id !== first.id ||
      keys.sealing !== first.sealing_public_key || keys.signing !== first.signing_public_key) {
    throw new GenesisBuildError("principal_mismatch")
  }
  await validatePrepared(prepared)
  const digest = await sha256B64(jcsBytes(body))
  const signed = await signedAppend(keyring, { seq: 0, link: "", keyring_link: "" }, body, wraps, operation)
  if (!await verifyRecordSig(keys.signing, { ...signed, account, epoch: 1, digest })) throw new GenesisBuildError("bad_signature")
  return frozenCopy({ request: { ...signed, record: body, base_seq: 0, wraps }, digest }, () => false)
}
