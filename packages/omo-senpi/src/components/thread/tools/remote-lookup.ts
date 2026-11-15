import type { ThreadAddressEntry, ThreadResolveResult } from "../addressing"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { relayAddressEntry } from "../remote/address-book"
import {
  endedRow,
  probeMayBuildEndedRow,
  rowThreadId,
  type RemoteSessionRow,
  type RemoteSessionsPort,
} from "../remote/ports"
import { remoteAvailable } from "../remote/remote-ops"
import type { ThreadToolSurfaceOptions } from "./ports"

// Ships in the thread client sidecar (`#omo-thread-client-runtime`) and loads through `../remote/lazy-ops`, so `omo.js`
// carries none of the cross-device reply and lookup resolution.

/**
 * A session found only by a probe (no file path: its device holds it but runs it nowhere) is no existing thread to open
 * (omo#13037 A4.4): today's answer for a holder that cannot be reached, and no open is sent. A listed ended thread still
 * opens from its file, as before.
 */
export function probedOnlyRefusal(entry: ThreadAddressEntry): ThreadToolFailure | undefined {
  const row = entry.transport?.kind === "relay" ? entry.transport.row : undefined
  if (row === undefined || row.state !== "ended" || row.path !== "") return undefined
  return threadToolFailure(
    "not_found",
    `Thread ${entry.thread_id} on device ${row.device} is not running there.`,
    "Call thread_list with all_scope to find the live thread.",
    { device: row.device, thread_id: entry.thread_id },
  )
}

/** holderTarget's probe answer (omo#13037 A4.3.2): an ended row only while this device's service can carry the wake. */
export async function holderEndedRow(
  sessions: Pick<RemoteSessionsPort, "canWake">,
  device: string,
  key: string,
  durableId: string,
): Promise<RemoteSessionRow | undefined> {
  return (await probeMayBuildEndedRow(sessions)) ? endedRow(device, key, durableId) : undefined
}

/**
 * Amendment A4.3.1 of #13037: an approved reply to a sender whose delivery came from another device resolves on THAT
 * device and nowhere else: its listing row for that id when it lists one (a read of that one device, never the whole
 * account), else one probe of that device, which finds a session it holds but does not run as an `ended` row (A4.2).
 * No row there is not_found naming the device; a probe that got no answer is host_unavailable naming it.
 */
export async function replyOnDevice(
  options: ThreadToolSurfaceOptions,
  sender: { readonly session_id: string; readonly device: string },
): Promise<ThreadResolveResult> {
  const missing = (): ThreadResolveResult =>
    ({
      kind: "error",
      ...threadToolFailure(
        "not_found",
        `The sender ${sender.session_id} is not listed on device ${sender.device}, the device its delivery came from.`,
        "Retry when that session is running on its device, or send to another thread as a normal send.",
        { thread_id: sender.session_id, device: sender.device },
      ),
    }) as ThreadResolveResult
  const remote = options.remote
  if (remote === undefined) return missing()
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "error", ...unavailable.error } as ThreadResolveResult
  let rows: readonly RemoteSessionRow[]
  try {
    rows = await remote.sessions.sessions({ device: sender.device })
  } catch (error) {
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        "The account's session listing could not be reached.",
        "Retry when the device service is reachable.",
        { reason: error instanceof Error ? error.message : String(error) },
      ),
    } as ThreadResolveResult
  }
  const row = rows.find(
    (candidate) => candidate.device === sender.device && rowThreadId(candidate) === sender.session_id,
  )
  if (row !== undefined) return { kind: "ok", entry: relayAddressEntry(row), resolution: "id" }
  // One rule for a probe-built ended row (probeMayBuildEndedRow): no probe while the wake cannot be carried.
  const probed = (await probeMayBuildEndedRow(remote.sessions))
    ? await remote.sessions.lookup?.(sender.device, sender.session_id)
    : undefined
  if (probed?.kind === "found")
    return {
      kind: "ok",
      entry: relayAddressEntry(endedRow(sender.device, probed.key, sender.session_id)),
      resolution: "id",
    }
  if (probed?.kind === "silent")
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        `Device ${sender.device}, where the sender's delivery came from, did not answer whether it holds ${sender.session_id}.`,
        "Retry when that device answers.",
        { thread_id: sender.session_id, device: sender.device, reason: probed.reason },
      ),
    } as ThreadResolveResult
  return missing()
}

/** A durable session id: the only address the account-wide lookup of A4.3.3 is made for. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * omo#13037 A4.3.3: a session id that this device and the account listing both miss is looked up with one single-probe
 * query to each ONLINE device of the account other than this one, in parallel (the device service bounds each at 3 s).
 * One device holds it: its ended row. None and every device answered: not_found. None and a device stayed silent:
 * host_unavailable naming it. Several: ambiguous_target naming the devices. Undefined when this device's service makes
 * no single probe: the caller answers as before. Never a background scan; nothing is cached.
 */
export async function lookupAcross(
  remote: NonNullable<ThreadToolSurfaceOptions["remote"]>,
  address: string,
): Promise<ThreadResolveResult | undefined> {
  if (!SESSION_ID.test(address)) return undefined
  // The capability first, from this device's own connection: with the probe off nothing is read for a lookup and the
  // answer stays today's. A device round that fails leaves today's answer too.
  const probe = remote.sessions.lookup
  if (probe === undefined || (await remote.sessions.canLookup?.().catch(() => false)) !== true) return undefined
  if (!(await probeMayBuildEndedRow(remote.sessions))) return undefined
  let online: readonly { readonly device: string; readonly online: boolean }[]
  try {
    const here = await remote.sessions.thisDevice()
    online = (await remote.sessions.devices()).filter((device) => device.online && device.device !== here)
  } catch {
    return undefined
  }
  const answers = await Promise.all(
    online.map(async (device) => ({ device: device.device, answer: await probe(device.device, address) })),
  )
  if (answers.some(({ answer }) => answer.kind === "unavailable")) return undefined
  // Found over silent, by choice: one device holding the id is used even when another did not answer within the bound or
  // the client's cap. A device that hangs must not block a send another device can take; the silent one is not asked
  // again, and two copies of one id behind a silent device is the residual A4.3.5 names, never ambiguous_target.
  const holders = answers.flatMap(({ device, answer }) =>
    answer.kind === "found" ? [{ device, key: answer.key }] : [],
  )
  const [only] = holders
  if (holders.length === 1 && only !== undefined)
    return { kind: "ok", entry: relayAddressEntry(endedRow(only.device, only.key, address)), resolution: "id" }
  if (holders.length > 1) {
    const candidates = holders.map((holder) => ({
      id: address,
      name: "",
      cwd: "",
      preview: "",
      updatedAt: null,
      state: "resumable" as const,
      device: holder.device,
    }))
    return {
      kind: "error",
      ...threadToolFailure(
        "ambiguous_target",
        `Session ${address} is held on more than one device; none was picked.`,
        "Address the session on one device with <device>/<session id>.",
        { candidates },
      ),
      candidates,
    } as ThreadResolveResult
  }
  const silent = answers.flatMap(({ device, answer }) => (answer.kind === "silent" ? [device] : []))
  if (silent.length > 0)
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        `No device that answered holds session ${address}, and ${silent.join(", ")} did not answer.`,
        "Retry when that device answers.",
        { thread_id: address, devices: silent },
      ),
    } as ThreadResolveResult
  return {
    kind: "error",
    ...threadToolFailure(
      "not_found",
      `No online device of this account holds session ${address}.`,
      "The session may live on a device that is offline: retry when that device is online, or call thread_list.",
      { thread_id: address },
    ),
  } as ThreadResolveResult
}
