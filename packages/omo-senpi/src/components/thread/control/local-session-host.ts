import type { ThreadSummary } from "../contracts"
import { summary } from "../tools/internals"
import type { ThreadHost } from "../tools/ports"
import type { SessionHost } from "./session-host"

/** This device's operator endpoint as a SessionHost: `visible` is the address book this call assembled, `open` the host's `open_session`. */
export function createLocalSessionHost(host: ThreadHost, visible: readonly ThreadSummary[]): SessionHost {
  return {
    visible: async () => visible,
    open: async (request) => ({ kind: "ok", thread: summary(await host.openSession(request)) }),
  }
}
