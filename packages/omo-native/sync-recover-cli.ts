import { turnDeviceSyncOn } from "../memory-core/src/sync/account/index.ts"
import { pairingOperation } from "../memory-core/src/sync/account/operation-ports.ts"
import { createRejectionCounter } from "../memory-core/src/sync/crypto/rejection.ts"
import { createRecoveryBridge } from "../memory-core/src/sync/recovery/bridge.ts"
import type { PasskeyAuthenticator } from "../memory-core/src/sync/recovery/ports.ts"
import { recoverOnFreshDevice } from "../memory-core/src/sync/recovery/recover.ts"
import { EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "./sync-cli"
import type { SyncContext } from "./sync-context"
import {
  agentMarkerSet,
  controllingTerminalAvailable,
  lazyTerminalSurface,
  openControllingTerminal,
} from "./sync-phrase-tty"

const RECOVER_ELSEWHERE =
  "Recovering memory with your passkey runs in the OmO desktop app, which can use the passkey on this computer. " +
  "On a machine without it, approve this device from a device that already syncs: run `omo sync enable` here, then `omo sync approve` there."

// The CLI has no passkey authenticator: phrase recovery is the only key source it can drive.
const noPasskeys: PasskeyAuthenticator = {
  prfSupported: false,
  create: async () => null,
  assert: async () => null,
  discover: async () => null,
  signalRemoved: async () => "unsupported",
}

const RECOVER_YOURSELF = "Run `omo sync recover` yourself in a terminal."
const RECOVERED = "Your memory is recovered on this device and memory sync is on."
// Review LOWs (#14454 @ b2e5a69): the line keeps the cause, and a read-only join is not called a full recovery.
const recoveredSyncOff = (readOnly: boolean, reason: string): string =>
  `${readOnly ? "This device can read your recovered memory" : "Your memory is recovered on this device"}, but memory sync could not be turned on (${reason}). Run \`omo sync enable\` to turn it on.`
const RECOVERED_READ_ONLY =
  "This device can read your recovered memory, but another step is still pending before it can write. Run `omo sync recover` again later."

/**
 * Checker LOW (#13337 @ e6ac0bca): recover refuses under an agent harness, CI or without a controlling terminal
 * BEFORE the signed-in context (credentials, session, device keyring) is loaded.
 */
export const recoverRefused = (dependencies: SyncCommandDependencies): boolean => {
  const env = dependencies.env ?? process.env
  if (!agentMarkerSet(env) && (dependencies.terminalAvailable ?? controllingTerminalAvailable)()) return false
  dependencies.error(RECOVER_YOURSELF)
  dependencies.error(RECOVER_ELSEWHERE)
  return true
}

export async function recover(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const surface = lazyTerminalSurface(dependencies.terminal ?? openControllingTerminal, context.account)
  try {
    const outcome = await recoverOnFreshDevice({
      account: context.account,
      rpId: "",
      keyring: context.keyring,
      bridge: createRecoveryBridge(noPasskeys, context.keyring, { phraseSurface: surface }),
      transport: context.chain,
      rejections: createRejectionCounter(),
      stateDir: context.pinDir,
      method: "phrase",
    })
    if (outcome.ok) {
      // #14453: the service gates every sync read on the account's and this device's switches, as enable sets them.
      const pairing = pairingOperation(context.pairing, context)
      try {
        await pairing.setAccountSync(true)
        await turnDeviceSyncOn({ ...context, pairing })
      } catch (error) {
        // The recovery itself landed; only the switches failed, and enable sets them again (review L2).
        const reason = error instanceof Error ? error.message : "unknown error"
        dependencies.error(recoveredSyncOff(outcome.state !== "recovered", reason))
        return 1
      }
      dependencies.output(outcome.state === "recovered" ? RECOVERED : RECOVERED_READ_ONLY)
      return 0
    }
    switch (outcome.reason) {
      case "cancelled":
        dependencies.error("Recovery was cancelled. Nothing changed.")
        return 1
      case "no-recovery-key":
        dependencies.error(`This account has no recovery phrase. ${RECOVER_ELSEWHERE}`)
        return EXIT_UNSUPPORTED_HERE
      case "history-incomplete":
        dependencies.error(
          "That recovery phrase does not match this account's history. Your account history looks incomplete; check the phrase, or recover from another device.",
        )
        return 1
      default:
        dependencies.error(`Recovery did not complete (${outcome.reason}). Nothing secret was stored.`)
        return 1
    }
  } finally {
    surface.done()
  }
}
