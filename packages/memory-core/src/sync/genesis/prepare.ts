import { frozenCopy } from "../crypto/frozen.ts"
import { taggedHash } from "../crypto/signatures.ts"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import type { GenesisBootstrap, GenesisCapabilities, GenesisPrepared } from "./types.ts"
import { validateBootstrap, validatePrepared } from "./validate.ts"

/**
 * G1 preparation, without custody or entropy policy: the injected native capabilities own all
 * secret material. Device then recovery is the ASCII order of the two epoch-1 recipients.
 */
export const prepareGenesis = async (
  input: GenesisBootstrap,
  capabilities: GenesisCapabilities,
): Promise<GenesisPrepared> => {
  const bootstrap = frozenCopy(input, () => false)
  await validateBootstrap(bootstrap)
  const account = bootstrap.account
  const custodyRoot = await taggedHash("omo-sync/v1/custody-root", bootstrap)
  const device = Object.freeze({ account, epoch: 1, id: `device:${bootstrap.first_device.id}` })
  const recovery = Object.freeze({ account, epoch: 1, id: `recovery:${bootstrap.recovery_key.credential_id}` })
  const wraps = Object.freeze([
    Object.freeze({ epoch: 1, id: device.id, wrap: await capabilities.seal(device, bootstrap.first_device.sealing_public_key) }),
    Object.freeze({ epoch: 1, id: recovery.id, wrap: await capabilities.seal(recovery, bootstrap.recovery_key.sealing_public_key) }),
  ] as const)
  // Genesis countersigns ALL wraps, not merely the recovery recipient's entry.
  const wrapsDigest = await sha256B64(jcsBytes(wraps))
  const countersign = await capabilities.countersign(Object.freeze({
    t: "omo-sync/v1/recovery-countersign",
    account, custody_root: custodyRoot, predecessor: "", wraps_digest: wrapsDigest,
  }))
  const prepared: GenesisPrepared = {
    body: { kind: "genesis", account, epoch: 1, bootstrap, custody_root: custodyRoot, countersign, wraps_digest: wrapsDigest },
    wraps,
  }
  await validatePrepared(prepared)
  return frozenCopy(prepared, () => false)
}
