import { createLocalSessionHost } from "../thread/control/local-session-host"
import type { SessionOpenRequest } from "../thread/control/session-host"
import type { ThreadToolFailure } from "../thread/errors"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost } from "../thread/tools/ports"
import { probing, wireFailure, type WireProbe } from "./local-wire"
import type { RemoteFailure } from "./types"

/** This device's operator endpoint, reached as the `omo thread` SDK reaches it: no extension context needed. */
export const defaultLocalThreadHost = async (connect: ThreadSocketConnect): Promise<ThreadHost> =>
  (await import("#omo-thread-client-runtime")).createLiveThreadSurface(undefined, { connect })

export type LocalOpen =
  | { readonly kind: "ok"; readonly key: string }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }
  | RemoteFailure

const OPEN: ReadonlySet<string> = new Set(["open_session"])

/**
 * An open on this device takes the local leg (#13787): thread_create's local SessionHost on this device's own operator
 * endpoint, never the relay to itself, judged by the wire when it fails (local-wire.ts).
 */
export async function openOnThisDevice(
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: string,
  request: SessionOpenRequest,
): Promise<LocalOpen> {
  const probe: WireProbe = { sent: false }
  let opened: Awaited<ReturnType<ReturnType<typeof createLocalSessionHost>["open"]>>
  try {
    opened = await createLocalSessionHost(await hostOn(probing(probe, OPEN)), []).open(request)
  } catch (error) {
    return wireFailure(probe, error, self, "opened a session")
  }
  // A typed failure after the open was written (a worktree open whose open failed and whose worktree could not be
  // removed) may still have made a session: it is judged by the wire too, naming what was left (#13787 review L5).
  if (opened.kind === "error" && probe.sent) {
    const judged = wireFailure(probe, new Error(opened.error.message), self, "opened a session")
    return { ...judged, details: { ...judged.details, left: opened.error } }
  }
  if (opened.kind === "error") return opened
  // The session's durable id is its handle: this device's own endpoint serves every member on it by that id, while the
  // service's listing (which may not carry this device's sessions at all) and its relay never reach it.
  return { kind: "ok", key: opened.thread.thread_id }
}
