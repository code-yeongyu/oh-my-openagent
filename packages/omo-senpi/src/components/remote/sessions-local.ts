import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { createLocalSessionHost } from "../thread/control/local-session-host"
import type { SessionOpenRequest } from "../thread/control/session-host"
import { threadToolFailure, type ThreadToolFailure } from "../thread/errors"
import type { ThreadHost } from "../thread/tools/ports"

/** This device's operator endpoint, reached as the `omo thread` SDK reaches it: no extension context needed. */
export const defaultLocalThreadHost = async (): Promise<ThreadHost> =>
  (await import("#omo-thread-client-runtime")).createLiveThreadSurface(undefined)

export type LocalOpen =
  | { readonly kind: "ok"; readonly key: string; readonly warnings: readonly string[] }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }

/**
 * An open on this device takes the local leg (#13787): thread_create's local SessionHost on this device's own operator
 * endpoint, never the relay to itself. The device service then names the key it lists the new session by; when it
 * cannot, the session is answered under its durable id with a warning (the session members resolve that id too).
 */
export async function openOnThisDevice(
  svc: DeviceService,
  host: ThreadHost,
  self: string,
  request: SessionOpenRequest,
): Promise<LocalOpen> {
  let opened: Awaited<ReturnType<ReturnType<typeof createLocalSessionHost>["open"]>>
  try {
    opened = await createLocalSessionHost(host, []).open(request)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: "error",
      error: threadToolFailure(
        "host_unavailable",
        `This device's omo host did not open the session (${reason}).`,
        "Start omo on this device, then retry.",
        { device: self, reason },
      ),
    }
  }
  if (opened.kind === "error") return opened
  const durable = opened.thread.thread_id
  try {
    return { kind: "ok", key: (await svc.locate(self, durable)).key, warnings: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: "ok",
      key: durable,
      warnings: [`This device's service did not name the listing key of session ${durable} (${reason}).`],
    }
  }
}
