import { devicesSilent, noThreadOnDevice, probeUnavailable, sameSession } from "@oh-my-opencode/thread-address-core"
import { threadToolFailure } from "../errors"
import { relayAddressEntry } from "../remote/address-book"
import { endedRow, probeMayBuildEndedRow, rowThreadId, type RemoteDevice, type RemoteThreadSurface } from "../remote/ports"
import { remoteAvailable } from "../remote/remote-ops"
import { accountDevices } from "./account"
import { asRefusal, refusal, toolRefusal, type ThreadRefusal } from "./refusals"
import type { Found } from "./types"

const named = (devices: readonly RemoteDevice[] | undefined, id: string) => ({
  id,
  name: devices?.find((device) => device.device === id)?.label ?? id,
})

/**
 * omo#13037 A4.3.3: a thread id this device and the account listing both miss is looked up with one single-probe query
 * to each ONLINE device other than this one, in parallel (the device service bounds each at 3 s). One holder: its ended
 * row. Several: ambiguous_target. None and a device stayed silent: device_unanswered. None, every device answered:
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
  const holders = answers.flatMap(({ device, answer }) => (answer.kind === "found" ? [{ device, key: answer.key }] : []))
  const [only] = holders
  if (holders.length === 1 && only !== undefined)
    return { kind: "ok", entry: relayAddressEntry(endedRow(only.device, only.key, thread)), resolution: "probe", all_scope: true }
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
  const silent = answers.flatMap(({ device, answer }) => (answer.kind === "silent" ? [named(devices, device)] : []))
  if (silent.length > 0) return toolRefusal(devicesSilent("device_unanswered", silent), thread)
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
 * holds but does not run as an ended row. Each other outcome has its own refusal (#14280).
 */
export async function pinned(
  remote: RemoteThreadSurface | undefined,
  pin: { readonly device: string; readonly thread: string },
): Promise<Found | ThreadRefusal> {
  const roster = async () => (remote === undefined ? undefined : await accountDevices(remote.client).then((read) => read.devices, () => undefined))
  if (remote === undefined) return toolRefusal(noThreadOnDevice(pin.thread, { id: pin.device, name: pin.device }))
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return asRefusal(unavailable.error)
  try {
    const rows = await remote.sessions.sessions({ device: pin.device })
    const row = rows.find((candidate) =>
      sameSession(
        { device: pin.device, thread: pin.thread },
        { device: candidate.device, thread: rowThreadId(candidate), key: candidate.session_id },
      ),
    )
    if (row !== undefined) return { kind: "ok", entry: relayAddressEntry(row), resolution: "id", all_scope: true }
  } catch (error) {
    return refusal(
      "host_unavailable",
      "The account's session listing could not be reached.",
      "Retry when the device service is reachable.",
      { reason: error instanceof Error ? error.message : String(error) },
    )
  }
  const canProbe = remote.sessions.lookup !== undefined && (await probeMayBuildEndedRow(remote.sessions))
  const probed = canProbe ? await remote.sessions.lookup?.(pin.device, pin.thread) : undefined
  if (probed?.kind === "found")
    return {
      kind: "ok",
      entry: relayAddressEntry(endedRow(pin.device, probed.key, pin.thread)),
      resolution: "probe",
      all_scope: true,
    }
  const device = named(await roster(), pin.device)
  if (probed?.kind === "silent") return toolRefusal(devicesSilent("device_unanswered", [device]), pin.thread)
  if (probed?.kind === "none") return toolRefusal(noThreadOnDevice(pin.thread, device))
  return toolRefusal(probeUnavailable(pin.thread, device))
}
