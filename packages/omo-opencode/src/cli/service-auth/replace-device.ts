import { type MachineDevice, SignInError } from "./protocol"
import { terminalText } from "./terminal-text"

function earlierDeviceLabel(existing: MachineDevice): string {
  const parts = [
    ...(existing.deviceName === undefined ? [] : [terminalText(existing.deviceName)]),
    ...(existing.deviceId === undefined ? [] : [`id ${terminalText(existing.deviceId)}`]),
  ]
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`
}

/**
 * #14032: whether `omo login` asks the service to replace this computer's earlier device. `--replace` agrees without a
 * prompt; an interactive terminal asks, defaulting to No; a script without the flag keeps the refusal and names the flag.
 */
export function decideReplace(options: {
  readonly replace: boolean
  readonly interactive: boolean
  readonly confirm: (message: string) => Promise<boolean>
  readonly log: (line: string) => void
}): (existing: MachineDevice) => Promise<boolean> {
  return async (existing) => {
    const label = earlierDeviceLabel(existing)
    if (options.replace) {
      options.log(`This computer already has an OmO device${label}. Replacing it with this sign-in.`)
      return true
    }
    if (!options.interactive) {
      throw new SignInError(
        `This computer already has an OmO device${label}. Run omo login --replace to replace it with this sign-in, or use its existing sign-in, or remove that device on the Devices page of your OmO account.`,
      )
    }
    options.log(`This computer already has an OmO device${label}.`)
    return options.confirm("Replace this computer's earlier device? It will be signed out after you approve.")
  }
}
