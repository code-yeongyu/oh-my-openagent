import { CredentialStoreError, InvalidCredentialState } from "./keystore"
import { SignInError } from "./protocol"
import { type DeviceServiceHandoff, type Session, SessionEnded } from "./session"
import { terminalText } from "./terminal-text"

/** Sign-in refused because this machine already has, or may have, its one account device (#6503). */
export class MachineAlreadySignedIn extends SignInError {}

/** Sign-in refused because the credential store could not be read, so this machine's device cannot be ruled out. */
export class MachineCredentialUnreadable extends SignInError {}

/**
 * Attach before mint (#6503 final contract section 5): the machine's one device service holds its account device, and
 * the desktop app and the CLI use it instead of registering devices of their own. Runs before `omo login` asks for a
 * code or generates keys. Only confirmed absence starts a registration: a usable stored sign-in, an uncertain refresh,
 * a locked or unreadable store (it throws through), a device the service holds (parked included) or a service that
 * cannot be read all refuse, keeping every held identity untouched. A stored sign-in the service ended and the store
 * cleared no longer counts.
 */
export async function refuseSecondMachineDevice(
  session: Pick<Session, "accessSnapshot">,
  deviceService: DeviceServiceHandoff | undefined,
  options: { readonly newDevice?: boolean } = {},
): Promise<void> {
  const stored = await session.accessSnapshot().catch((error: unknown) => {
    // A locked or unreadable store is not "nothing stored": its item may be this machine's device. Only the person's
    // explicit --new-device registers another one; it never skips a device the service holds (checked below).
    if (error instanceof CredentialStoreError || error instanceof InvalidCredentialState) {
      if (options.newDevice === true) return null
      throw new MachineCredentialUnreadable(
        `omo could not read this computer's OmO sign-in (${terminalText(error.message)}), so it did not register another device. Unlock or repair the credential store and run omo login again, or run omo login --new-device to register a new device anyway.`,
      )
    }
    if (!(error instanceof SessionEnded)) throw error
    // An uncertain refresh keeps its credential and keys: held, not absent (#12948 recovery).
    if (error.code === "refresh_recovery_expired") {
      throw new MachineAlreadySignedIn(
        "This computer's OmO sign-in has a refresh whose outcome is unknown. omo kept its credential and keys and did not register another device. Run omo logout to end that sign-in, then run omo login again.",
      )
    }
    return null
  })
  if (stored !== null) {
    throw new MachineAlreadySignedIn(
      `This computer is already signed in to OmO as ${terminalText(stored.device.name)}, and omo uses that device. Run omo logout first to sign in again.`,
    )
  }
  const held = (await deviceService?.machineDevice?.()) ?? { kind: "absent" as const }
  if (held.kind === "held") {
    throw new MachineAlreadySignedIn(
      `This computer's OmO device service already holds its device, ${terminalText(held.device.name)}. omo uses that device instead of registering another one: sign in from the OmO desktop app to share it with omo, or run omo logout first to sign this computer in again.`,
    )
  }
  if (held.kind === "unknown") {
    throw new MachineAlreadySignedIn(
      `This computer's OmO device service is installed but did not answer (${terminalText(held.reason)}), so omo did not register another device. Start the device service, then run omo login again.`,
    )
  }
}
