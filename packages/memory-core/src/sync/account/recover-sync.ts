import type { SyncOperationOptions } from "../operation-authority.ts"
import { type RecoverInput, type RecoverOutcome, recoverOnFreshDevice } from "../recovery/recover.ts"
import { turnDeviceSyncOn } from "./device-switch.ts"
import { pairingOperation } from "./operation-ports.ts"
import type { PairingHttp } from "./pairing-http.ts"

export type RecoverSyncInput = RecoverInput &
  SyncOperationOptions & {
    readonly serviceDeviceId: string
    readonly pairing: PairingHttp
    /** Sees the error when recovery succeeded but a switch could not be turned on; the answer is then `sync: "off"`. */
    readonly onSwitchFailed?: (error: unknown) => void
  }

export type RecoverSyncOutcome =
  | Exclude<RecoverOutcome, { readonly ok: true }>
  | (Extract<RecoverOutcome, { readonly ok: true }> & { readonly sync: "on" | "off" })

/**
 * Recovery on a fresh device, then sync turned on for it (D12 section 1, the staging finding on #14122): the service
 * gates every sync read on the device's own switch, which a freshly signed-in device holds off. The switches change
 * only after recovery succeeded, in enable's order and through the same operation-scoped ports; a refusal or a
 * cancel leaves both untouched. A recovery whose switch call fails is still complete and answers `sync: "off"`.
 */
export async function recoverAndTurnOnSync(input: RecoverSyncInput): Promise<RecoverSyncOutcome> {
  const outcome = await recoverOnFreshDevice(input)
  if (!outcome.ok) return outcome
  const pairing = pairingOperation(input.pairing, input)
  try {
    await pairing.setAccountSync(true)
    await turnDeviceSyncOn({
      account: input.account,
      serviceDeviceId: input.serviceDeviceId,
      pinDir: input.stateDir,
      pairing,
    })
    return { ...outcome, sync: "on" }
  } catch (error) {
    input.onSwitchFailed?.(error)
    return { ...outcome, sync: "off" }
  }
}
