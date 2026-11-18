import { threadToolFailure } from "../omo-senpi/src/components/thread/errors"
import { namedDeviceRow } from "../omo-senpi/src/components/thread/remote/address-book"
import { resolveTypedDevice } from "../omo-senpi/src/components/remote/index"
import type {
  RemoteDevice,
  RemoteSessionRow,
  RemoteThreadSurface,
} from "../omo-senpi/src/components/thread/remote/ports"
import type { RemoteSessionTarget } from "./remote-session-args"

type TargetFailure = { readonly kind: "error"; readonly error: ReturnType<typeof threadToolFailure> }

/**
 * The session a remote verb names (omo#13707, folded from #13666). `<device>/<session>` is passed to the device its
 * `<device>` resolves to (the remote module's `resolveTypedDevice`): the device-service port (`attachAddressed`) locates a durable id on that device and attaches on the key it names
 * (a durable id never reaches session.attach), and attaches a listing key directly. A
 * bare durable id has no device, so the account listing names the one device that holds it.
 */
export async function resolveSessionTarget(
  remote: RemoteThreadSurface,
  target: RemoteSessionTarget,
): Promise<
  { readonly kind: "ok"; readonly row: RemoteSessionRow; readonly devices?: readonly RemoteDevice[] } | TargetFailure
> {
  const { device, session } = target
  if (device !== undefined) {
    const named = await resolveTypedDevice(remote.client, device)
    if (named.kind === "error") return named
    return { kind: "ok", row: namedDeviceRow(named.device, session), devices: named.devices }
  }
  const matches: readonly RemoteSessionRow[] = (await remote.sessions.sessions()).filter(
    (row) => row.durable_id === session,
  )
  const [row] = matches
  if (row !== undefined && matches.length === 1) return { kind: "ok", row }
  return {
    kind: "error",
    error: threadToolFailure(
      row === undefined ? "not_found" : "ambiguous_target",
      row === undefined ? `No session ${session} on this account.` : `More than one device holds session ${session}.`,
      row === undefined ? "Run omo remote sessions to see them." : "Address the session as <device>/<session>.",
      { thread: session },
    ),
  }
}
