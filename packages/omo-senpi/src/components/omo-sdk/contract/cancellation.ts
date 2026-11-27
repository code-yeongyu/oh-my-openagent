import type { ROOT_CALLS } from "./calls"
import type { RootCallKey } from "./root"

// Whether the core that answers each call that can wait honours signal and deadline_ms today (design lane ruling on
// review 6061342489 H4). `honoured`: the core takes both today, the remote module's members (R/types.ts Opts:
// signal and deadlineMs). `gap`: the type promises the options and the core ignores them; the row stays in
// unresolved.json until the slice that wires them adds a cancellation scenario and a deadline scenario.
type WaitingCallKey = {
  [Key in RootCallKey]: (typeof ROOT_CALLS)[Key]["waits"] extends true ? Key : never
}[RootCallKey]

const HONOURED = new Set<string>([
  "threads.resolve",
  "threads.entries",
  "threads.get",
  "threads.wait",
  "threads.follow",
  "threads.sendAndFollow",
  "threads.aliases.resolve",
  "threads.aliases.set",
  "threads.aliases.clear",
  "devices.resolve",
  "deviceService.status",
  "deviceService.info",
  "deviceService.enable",
  "deviceService.disable",
  "deviceService.control",
  "deviceService.setControl",
  "deviceService.wake",
  "deviceService.setWake",
  "deviceService.bootstrap",
])

export type Cancellation = "honoured" | "gap"

export const cancellationOf = (key: WaitingCallKey): Cancellation => (HONOURED.has(key) ? "honoured" : "gap")

export const HONOURED_CALLS: readonly WaitingCallKey[] = [...HONOURED] as WaitingCallKey[]
