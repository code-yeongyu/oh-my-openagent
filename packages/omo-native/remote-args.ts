import {
  SESSION_ROW_STATES,
  type SessionFilter,
  type SessionRowState,
} from "../device-service-core/src/device-service.ts"
import { UsageError } from "./remote-exit"
import { isSessionVerb, parseSession, type SessionArgs } from "./remote-session-args"

// `omo remote` argument parsing, split out of remote-local.ts (#13783 review LOW: file size).
const CONTROL_VALUES = ["on", "off"] as const
type ControlValue = (typeof CONTROL_VALUES)[number]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some((v) => v === value)

// omo#13037 A7.2.5: the wake switch also takes "default", which removes the stored value.
const WAKE_VALUES = ["on", "off", "default"] as const
type WakeValue = (typeof WAKE_VALUES)[number]
const isWakeValue = (value: string | undefined): value is WakeValue => WAKE_VALUES.some((v) => v === value)
export const storedWake = (value: WakeValue): boolean | null => (value === "default" ? null : value === "on")

export type Parsed = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly wake?: WakeValue
  readonly session?: SessionArgs
}

const isRowState = (value: string): value is SessionRowState =>
  (SESSION_ROW_STATES as readonly string[]).includes(value)

export function parse(args: readonly string[]): Parsed {
  const [command = "", ...rest] = args
  if (isSessionVerb(command)) return { command, filter: {}, control: undefined, ...parseSession(command, rest) }
  let json = false
  const filter: { device?: string; project?: string; state?: SessionRowState } = {}
  let control: ControlValue | undefined
  let wake: WakeValue | undefined
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === "--json") {
      json = true
      continue
    }
    if (command === "control") {
      if (control !== undefined || !isControlValue(flag))
        throw new UsageError("omo remote control: the value is on or off")
      control = flag
      continue
    }
    if (command === "wake") {
      if (wake !== undefined || !isWakeValue(flag))
        throw new UsageError("omo remote wake: the value is on, off or default")
      wake = flag
      continue
    }
    if (command !== "sessions" || (flag !== "--device" && flag !== "--project" && flag !== "--state"))
      throw new UsageError(`omo remote ${command}: unknown argument ${flag}`)
    const value = rest[++index]
    if (value === undefined || value === "") throw new UsageError(`omo remote sessions: ${flag} needs a value`)
    if (flag === "--device") filter.device = value
    else if (flag === "--project") filter.project = value
    else if (isRowState(value)) filter.state = value
    else throw new UsageError(`omo remote sessions: --state is one of ${SESSION_ROW_STATES.join(", ")}`)
  }
  return { command, json, filter, control, ...(wake === undefined ? {} : { wake }) }
}
