import type { EpochChanged, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol"
import type { Events, StopPath } from "./facade"
import type { Link } from "./link"
import { parseStopPathStatus } from "./validate"

/** `computer.epoch`: frames and refs taken before an event no longer hold after it. */
export function epochEvents(link: Link): Events<EpochChanged> {
  return { on: (listener) => link.on("epoch.changed", listener) }
}

/** `computer.stop`: the stop path's state now, and every change. */
export function stopPath(link: Link): StopPath {
  return {
    status: (): Promise<StopPathStatus> => link.read("stopPath.status", {}, parseStopPathStatus),
    on: (listener) => link.on("stopPath.changed", listener),
  }
}
