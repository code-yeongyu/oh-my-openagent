import { SignInError } from "./protocol"
import { type DeviceServiceHandoff, type Session, SessionEnded } from "./session"
import { terminalText } from "./terminal-text"

/** Sign-in refused because this machine already has its one account device (#6503). */
export class MachineAlreadySignedIn extends SignInError {}

/**
 * One account device per physical machine (#6503): the machine's device service holds it, and the desktop app and the
 * CLI on that machine use it instead of registering devices of their own. Runs before `omo login` mints keys: a usable
 * stored sign-in, or a device the running device service already holds, refuses a new device. A stored sign-in the
 * service has ended no longer counts, so the machine may enroll again.
 */
export async function refuseSecondMachineDevice(session: Session, deviceService: DeviceServiceHandoff | undefined): Promise<void> {
  const stored = await session.accessSnapshot().catch((error: unknown) => {
    if (error instanceof SessionEnded) return null
    throw error
  })
  if (stored !== null) {
    throw new MachineAlreadySignedIn(
      `This computer is already signed in to OmO as ${terminalText(stored.device.name)}, and omo uses that device. Run omo logout first to sign in again.`,
    )
  }
  const held = await deviceService?.machineDevice?.()
  if (held !== undefined && held !== null) {
    throw new MachineAlreadySignedIn(
      `This computer is already signed in to OmO through its device service as ${terminalText(held.name)}. omo uses that device instead of registering another one; sign in from the OmO desktop app to share it with omo, or run omo logout first to sign this computer in again.`,
    )
  }
}
