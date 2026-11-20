import { deviceNotAsked, devicesSilent, noThreadOnDevice, sameSession } from "@oh-my-opencode/thread-address-core"
import { threadToolFailure } from "../errors"
import { deviceListing, relayAddressEntry } from "../remote/address-book"
import {
  endedRow,
  probeMayBuildEndedRow,
  rowThreadId,
  type RemoteDevice,
  type RemoteListing,
  type RemoteThreadSurface,
} from "../remote/ports"
import { remoteReady } from "../remote/remote-ops"
import { accountDevices, type Ready } from "./account"
import { asRefusal, refusal, toolRefusal, type ThreadRefusal } from "./refusals"
import type { Found } from "./types"

const named = (devices: readonly RemoteDevice[] | undefined, id: string) => ({
  id,
  name: devices?.find((device) => device.device === id)?.label ?? id,
})

/**
 * omo#13037 A4.3.3: a thread id this device and the account listing both miss is looked up with one single-probe query
 * to each ONLINE device other than this one, in parallel (the client waits up to 3,500 ms for each locate reply).
 * One holder: its ended row. Several: ambiguous_target. None and a device stayed silent: device_unanswered. None, every device answered:
 * not_found. Undefined when this device's service makes no single probe: the caller answers as before.
 */
export async function probeAcross(
  remote: RemoteThreadSurface,
  thread: string,
  roster: readonly RemoteDevice[] | undefined,
  here: string | null,
): Promise<Found | ThreadRefusal | undefined> {
  const probe = remote.sessions.lookup
  if (probe === undefined || (await remote.sessions.canLookup?.().catch(() => false)) !== true) return undefined
  if (!(await probeMayBuildEndedRow(remote.sessions))) return undefined
  let devices: readonly RemoteDevice[]
  try {
    devices = roster ?? (await accountDevices(remote.client)).devices
  } catch {
    return undefined
  }
  const asked = devices.filter((device) => device.online && device.device !== here)
  const answers = await Promise.all(
    asked.map(async (device) => ({ device: device.device, answer: await probe(device.device, thread) })),
  )
  if (answers.some(({ answer }) => answer.kind === "unavailable")) return undefined
  // Found over silent, by choice: a device that hangs must not block a thread another device can take (A4.3.5).
  const holders = answers.flatMap(({ device, answer }) =>
    answer.kind === "found" ? [{ device, key: answer.key }] : [],
  )
  const [only] = holders
  if (holders.length === 1 && only !== undefined)
    return {
      kind: "ok",
      entry: relayAddressEntry(endedRow(only.device, only.key, thread)),
      resolution: "probe",
      all_scope: true,
    }
  if (holders.length > 1) {
    const candidates = holders.map((holder) => ({
      thread,
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
        `Session ${thread} is held on more than one device; none was picked.`,
        "Address the session on one device with <device>/<session id>.",
        { candidates },
      ),
      candidates,
    }
  }
  const silent = answers.flatMap(({ device, answer }) =>
    answer.kind === "silent" ? [{ ...named(devices, device), reason: answer.reason }] : [],
  )
  // omo#14270: who answered "not held", this device first (its own miss came before the probe), so a miss on the device
  // that really keeps the file shows instead of reading as "wait for the silent one".
  const answered = [
    ...(here === null ? [] : [here]),
    ...answers.flatMap(({ device, answer }) => (answer.kind === "silent" ? [] : [device])),
  ]
  if (silent.length > 0) return toolRefusal(devicesSilent("device_unanswered", silent), thread, answered)
  return refusal(
    "not_found",
    `No online device of this account holds session ${thread}.`,
    "The session may live on a device that is offline: retry when that device is online, or call thread_list (tool.thread_list() in an eval cell).",
    { kind: "thread", thread },
  )
}

/**
 * Amendment A4.3.1 of #13037: an approved reply to a sender whose delivery came from another device resolves on THAT
 * device and nowhere else: its listing row (a read of that one device), else one probe of it, which finds a session it
 * holds but does not run as an ended row. #14280: the listing finds the sender's key; it never decides the sender is gone.
 * A row miss is read again once, and each refusal names its own reason: the device missed the round
 * (`listing_incomplete`), this device cannot reach the account or cannot ask the device (`remote_unavailable`,
 * `wake_unavailable`, `lookup_unavailable`), the probe got no answer (the service's own reason). not_found only when the
 * device answered twice that it lists no such session and its probe answered that it holds none.
 */
export async function pinned(
  remote: RemoteThreadSurface | undefined,
  pin: { readonly device: string; readonly thread: string },
  ready?: Promise<Ready>,
  /** That device's listing and the roster as the resolution already read them: the first pass reads nothing again. */
  known?: { readonly listing: RemoteListing; readonly roster: readonly RemoteDevice[] | undefined },
): Promise<Found | ThreadRefusal> {
  if (remote === undefined)
    return toolRefusal(deviceNotAsked("remote_unavailable", pin.thread, { id: pin.device, name: pin.device }))
  // The resolution's own status round when it already took one: one status read per resolution.
  const status = await (ready ?? remoteReady(remote))
  if ("kind" in status) return asRefusal(status.error)
  const device = async () =>
    named(
      known !== undefined
        ? known.roster
        : await accountDevices(remote.client).then(
            (read) => read.devices,
            () => undefined,
          ),
      pin.device,
    )
  // Every refusal of a pinned reply names the sender and its device.
  const onPin = (refused: ThreadRefusal, extra: Readonly<Record<string, unknown>> = {}): ThreadRefusal => ({
    ...refused,
    details: { ...refused.details, thread: pin.thread, device: pin.device, ...extra },
  })
  // One read of the sender's device: its row, a refusal naming why the read could not tell, or undefined (it answered
  // and lists no such session).
  const listed = async (given?: RemoteListing): Promise<Found | ThreadRefusal | undefined> => {
    let listing: RemoteListing
    try {
      listing = given ?? (await deviceListing(remote, pin.device))
    } catch (error) {
      return refusal(
        "host_unavailable",
        "The account's session listing could not be reached.",
        "Retry when the device service is reachable.",
        { reason: error instanceof Error ? error.message : String(error) },
      )
    }
    const row = listing.rows.find((candidate) =>
      sameSession(
        { device: pin.device, thread: pin.thread },
        { device: candidate.device, thread: rowThreadId(candidate), key: candidate.session_id },
      ),
    )
    if (row !== undefined) return { kind: "ok", entry: relayAddressEntry(row), resolution: "id", all_scope: true }
    if (listing.incomplete.includes(pin.device))
      return onPin(toolRefusal(devicesSilent("listing_incomplete", [await device()])))
    return undefined
  }
  const first = await listed(known?.listing)
  if (first !== undefined) return first
  // One rule for a probe-built ended row (probeMayBuildEndedRow): no probe while the wake cannot be carried.
  const mayProbe = await probeMayBuildEndedRow(remote.sessions)
  const probed = mayProbe ? await remote.sessions.lookup?.(pin.device, pin.thread) : undefined
  if (probed?.kind === "found")
    return {
      kind: "ok",
      entry: relayAddressEntry(endedRow(pin.device, probed.key, pin.thread)),
      resolution: "probe",
      all_scope: true,
    }
  if (probed?.kind === "silent")
    return onPin(
      toolRefusal(devicesSilent("device_unanswered", [{ ...(await device()), reason: probed.reason }]), pin.thread),
      { reason: probed.reason },
    )
  const again = await listed()
  if (again !== undefined) return again
  if (!mayProbe) return toolRefusal(deviceNotAsked("wake_unavailable", pin.thread, await device()))
  if (probed?.kind !== "none") return toolRefusal(deviceNotAsked("lookup_unavailable", pin.thread, await device()))
  return toolRefusal(noThreadOnDevice(pin.thread, await device()))
}
