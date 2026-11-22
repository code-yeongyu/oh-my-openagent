import { CredentialStoreError, InvalidCredentialState } from "./keystore"
import { SignInError } from "./protocol"
import { type DeviceServiceHandoff, type Session, SessionEnded } from "./session"
import { terminalText } from "./terminal-text"

/** Sign-in refused because this machine already has, or may have, its one account device (#6503). */
export class MachineAlreadySignedIn extends SignInError {}

/** Sign-in refused because the credential store could not be read, so this machine's device cannot be ruled out. */
export class MachineCredentialUnreadable extends SignInError {}

/** A stored sign-in omo can no longer use: its recovery depends on what the device service holds (#13265 design gate). */
const DAMAGED = Symbol("damaged stored sign-in")

const START_OVER =
  "To start over, remove this computer's device on the Devices page if it is still listed, then run omo account forget, then sign in again. omo account forget ends this computer's local sign-in and has its device service forget the device, without signing the device out on the OmO service."

const UNCERTAIN_REFRESH =
  "This computer's OmO sign-in has a refresh whose outcome is unknown. omo kept its credential and keys and did not register another device."

/** What the start-over steps also end when the device service holds the device: forget has it forget the device too. */
const heldCost = (name: string): string =>
  ` This computer's OmO device service holds that device, ${terminalText(name)}, so these steps also sign out the device service, and the OmO desktop app if it is installed, on this computer.`

/**
 * The refusal for an unreadable stored sign-in (#13265 design gate, A2 corrected). It states the reason in its own words:
 * the store's own sentence orders a different recovery, so printing it would give two disagreeing orders. A device
 * service that holds the device adds what the steps cost, because forgetting also ends that device here.
 */
function unreadableRefusal(heldDeviceName: string | undefined): MachineCredentialUnreadable {
  const cost = heldDeviceName === undefined ? "" : heldCost(heldDeviceName)
  return new MachineCredentialUnreadable(
    `omo could not read this computer's stored OmO sign-in, so it did not register another device. ${START_OVER}${cost}`,
  )
}

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
): Promise<void> {
  let damaged: "unreadable" | "uncertain" | undefined
  const stored = await session.accessSnapshot().catch((error: unknown) => {
    // A locked or unreadable store is not "nothing stored": its item may be this machine's device, and the service keeps
    // one device per machine (a second registration over it is refused, or leaves two live devices for a row enrolled
    // before machine binding), so neither case registers another device.
    if (error instanceof CredentialStoreError) {
      throw new MachineCredentialUnreadable(
        `omo could not read this computer's OmO sign-in (${terminalText(error.message)}), so it did not register another device. Unlock the credential store, then sign in again.`,
      )
    }
    // An unreadable item's recovery depends on whether the device service holds the device (#13265 design gate A2).
    if (error instanceof InvalidCredentialState) {
      damaged = "unreadable"
      return DAMAGED
    }
    if (!(error instanceof SessionEnded)) throw error
    // An uncertain refresh keeps its credential and keys: held, not absent (#12948 recovery). Its recovery waits for the
    // device-service state, because forget would also end a device the device service holds.
    if (error.code === "refresh_recovery_expired") {
      damaged = "uncertain"
      return DAMAGED
    }
    return null
  })
  if (stored !== null && stored !== DAMAGED) {
    throw new MachineAlreadySignedIn(
      `This computer is already signed in to OmO as ${terminalText(stored.device.name)}, and omo uses that device. Run omo logout first to sign in again.`,
    )
  }
  const held = (await deviceService?.machineDevice?.()) ?? { kind: "absent" as const }
  if (damaged === "unreadable" && held.kind !== "unknown") {
    throw unreadableRefusal(held.kind === "held" ? held.device.name : undefined)
  }
  // The share from the desktop app comes first: forget would also end the device the device service holds. The share
  // replaces an uncertain item of the same device only; for another device the desktop keeps the stored item
  // (#13265 design gate), so the start-over steps follow as the fallback, with their cost.
  if (damaged === "uncertain" && held.kind === "held") {
    throw new MachineAlreadySignedIn(
      `${UNCERTAIN_REFRESH} This computer's OmO device service holds its device, ${terminalText(held.device.name)}: sign in from the OmO desktop app to share it with omo. If this refusal still appears afterwards, ${START_OVER.charAt(0).toLowerCase()}${START_OVER.slice(1)}${heldCost(held.device.name)}`,
    )
  }
  if (damaged === "uncertain" && held.kind === "absent") {
    throw new MachineAlreadySignedIn(`${UNCERTAIN_REFRESH} ${START_OVER}`)
  }
  if (held.kind === "held") {
    throw new MachineAlreadySignedIn(
      `This computer's OmO device service already holds its device, ${terminalText(held.device.name)}. omo uses that device instead of registering another one: sign in from the OmO desktop app to share it with omo, or run omo logout first to sign this computer in again.`,
    )
  }
  if (held.kind === "unknown") {
    throw new MachineAlreadySignedIn(
      `This computer's OmO device service is installed but did not answer (${terminalText(held.reason)}), so omo did not register another device. Start the device service (opening the OmO desktop app starts it), then sign in again.${held.endpoint === undefined ? "" : ` If the device service was removed, delete its leftover file ${terminalText(held.endpoint)} first.`}`,
    )
  }
}
