import {
  accountDevices,
  accountState,
  asFailure,
  resolveAccountDevice,
  resolveAddress,
  type Resolved,
} from "../thread/address"
import { threadToolFailure, type ThreadToolFailure } from "../thread/errors"
import { rowThreadId, type RemoteDevice, type RemoteThreadSurface } from "../thread/remote/ports"
import { parseAddress } from "@oh-my-opencode/thread-address-core"
import { UNKNOWN_CALLER } from "../thread/tools/ports"
import type { RemoteClient } from "./client"

/**
 * The device a person typed - its id, `here`, the name the device table prints, or a unique id prefix - through the one
 * device resolver (thread address module, #14305), with the account's device list it read. Every omo remote verb needs
 * the device online (attach would otherwise start work on an offline device), so an offline device is device_offline
 * here by every form.
 */
export async function resolveTypedDevice(
  client: RemoteClient,
  typed: string,
): Promise<
  | { readonly kind: "ok"; readonly device: string; readonly devices: readonly RemoteDevice[] }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }
> {
  let listed: Awaited<ReturnType<typeof accountDevices>>
  try {
    listed = await accountDevices(client)
  } catch (error) {
    return {
      kind: "error",
      error: threadToolFailure(
        "host_unavailable",
        "This device's device service could not list the account's devices.",
        "Retry when the device service is reachable.",
        { device: typed, reason: error instanceof Error ? error.message : String(error) },
      ),
    }
  }
  const resolved = resolveAccountDevice(listed, typed, { online: true })
  return resolved.kind === "ok"
    ? { kind: "ok", device: resolved.device.id, devices: listed.devices }
    : { kind: "error", error: asFailure(resolved) }
}

/**
 * Seam 4 (#14305, design section 2): the only resolver for a typed thread address, the one a person typed at this
 * device. No caller identity (a terminal is no thread) and no local book (`omo remote` commands other devices'
 * sessions): every form resolves over the account the surface reads - a bare thread id, name, alias or 8-hex id
 * prefix, and `<device id | device name | 6+ char device id prefix | here>/<any of those>`. A refusal passes through
 * typed, in the same shape `resolveTypedDevice` answers a device.
 *
 * A person's verb never picks one holder of a durable id: two other devices are the module's ambiguous_target
 * (`unique_holder`), and so is this device plus one other, which the module cannot see with no local book (the copy a
 * thread brought here leaves behind). A thread this device holds (an account alias held here) is outside omo remote's
 * scope: not_found, with `on_this_device` in its details.
 */
export async function resolveTypedAddress(
  remote: RemoteThreadSurface,
  typed: string,
  opts: { readonly need: "address" | "online" },
): Promise<RemoteResolved | { readonly kind: "error"; readonly error: ThreadToolFailure }> {
  const read = readOnce(remote)
  const resolved = await resolveAddress(
    { remote: read, callerWorkspaceRoot: "", local: [], callerId: UNKNOWN_CALLER },
    typed,
    { all_scope: true, probe: true, unique_holder: true, need: opts.need },
  )
  if (resolved.kind !== "ok") return { kind: "error", error: asFailure(resolved) }
  const { where, thread } = resolved
  if (where.kind !== "device")
    return {
      kind: "error",
      error: threadToolFailure(
        "not_found",
        `Session ${thread} is on this device; omo remote commands the other devices' sessions.`,
        `Reach it with omo thread send ${thread}.`,
        { kind: "thread", thread, on_this_device: true },
      ),
    }
  const here = parseAddress(typed).kind === "bare" && thread !== "" ? await copyHere(read, thread) : undefined
  if (here === undefined) return { ...resolved, where }
  return {
    kind: "error",
    error: threadToolFailure(
      "ambiguous_target",
      `Session ${thread} is listed on this device and on ${where.row.device}; none was picked.`,
      "Address the session on one device with <device>/<session id>.",
      {
        kind: "thread",
        candidates: [
          { thread, device: where.row.device, address: resolved.address },
          { thread, device: here, address: `${here}/${thread}` },
        ],
      },
    ),
  }
}

/**
 * The surface one resolution reads: the relay status and the account-wide listing are each asked once, so the holder
 * check below answers from what the resolution already read and makes no request of its own.
 */
function readOnce(remote: RemoteThreadSurface): RemoteThreadSurface {
  const { client, sessions } = remote
  let status: ReturnType<typeof client.service.status> | undefined
  let rows: ReturnType<typeof sessions.sessions> | undefined
  let listed: ReturnType<NonNullable<typeof sessions.listing>> | undefined
  const { listing } = sessions
  return {
    ...remote,
    client: { ...client, service: { ...client.service, status: () => (status ??= client.service.status()) } },
    sessions: {
      ...sessions,
      sessions: (filter) => (filter?.device === undefined ? (rows ??= sessions.sessions()) : sessions.sessions(filter)),
      ...(listing === undefined
        ? {}
        : {
            listing: (filter?: { readonly device?: string }) =>
              filter?.device === undefined ? (listed ??= listing()) : listing(filter),
          }),
    },
  }
}

/** This device's id when the account listing the resolution read shows `thread` on this device too. */
async function copyHere(read: RemoteThreadSurface, thread: string): Promise<string | undefined> {
  const [state, rows] = await Promise.all([
    accountState(read.client),
    read.sessions.listing === undefined
      ? read.sessions.sessions()
      : read.sessions.listing().then((round) => round.rows),
  ])
  const here = "kind" in state ? null : state.here
  return here !== null && rows.some((row) => row.device === here && rowThreadId(row) === thread) ? here : undefined
}

/** A resolved address on another device: the only kind an `omo remote` verb acts on. */
type RemoteResolved = Resolved & { readonly where: Extract<Resolved["where"], { readonly kind: "device" }> }
