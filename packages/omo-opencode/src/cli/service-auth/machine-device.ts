import { SignInError } from "./protocol"
import { type DeviceServiceHandoff, type Session, SessionEnded } from "./session"
import { terminalText } from "./terminal-text"

/** Sign-in refused because this machine already has, or may have, its one account device (#6503). */
export class MachineAlreadySignedIn extends SignInError {}

/**
 * Attach before mint (#6503 final contract section 5): the machine's one device service holds its account device, and
 * the desktop app and the CLI use it instead of registering devices of their own. Runs before `omo login` asks for a
 * code or generates keys. Only confirmed absence starts a registration: a usable stored sign-in, an uncertain refresh,
 * a locked or unreadable store (it throws through), a device the service holds (parked included) or a service that
 * cannot be read all refuse, keeping every held identity untouched. A stored sign-in the service ended and the store
 * cleared no longer counts.
 */
export async function refuseSecondMachineDevice(session: Session, deviceService: DeviceServiceHandoff | undefined): Promise<void> {
  const stored = await session.accessSnapshot().catch((error: unknown) => {
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
  const held = await deviceService?.machineDevice?.() ?? { kind: "absent" as const }
  if (held.kind === "held") {
    throw new MachineAlreadySignedIn(
      `This computer's OmO device service already holds its device, ${terminalText(held.device.name)}. omo uses that device instead of registering another one: sign in from the OmO desktop app to share it with omo, or run omo logout first to sign this computer in again.`,
    )
  }
  if (held.kind === "unknown") {
    throw new MachineAlreadySignedIn(
      `omo could not read this computer's OmO device service (${terminalText(held.reason)}), so it did not register another device. Make sure the device service is running, then run omo login again.`,
    )
  }
}
