import { accountDevices, asFailure, resolveAccountDevice, resolveAddress, type Resolved } from "../thread/address"
import { threadToolFailure, type ThreadToolFailure } from "../thread/errors"
import type { RemoteDevice, RemoteThreadSurface } from "../thread/remote/ports"
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
 * A durable id two devices list is ambiguous_target (`unique_holder`): a person's verb never picks one holder. A thread
 * this device holds (an account alias held here) is outside omo remote's scope: it answers what `here/<thread>` answers,
 * the module's own not_found, with `on_this_device` added to its details.
 */
export async function resolveTypedAddress(
  remote: RemoteThreadSurface,
  typed: string,
  opts: { readonly need: "address" | "online" },
): Promise<RemoteResolved | { readonly kind: "error"; readonly error: ThreadToolFailure }> {
  const resolve = (text: string) =>
    resolveAddress({ remote, callerWorkspaceRoot: "", local: [], callerId: UNKNOWN_CALLER }, text, {
      all_scope: true,
      probe: true,
      unique_holder: true,
      need: opts.need,
    })
  const resolved = await resolve(typed)
  if (resolved.kind !== "ok") return { kind: "error", error: asFailure(resolved) }
  const { where } = resolved
  if (where.kind === "device") return { ...resolved, where }
  // This device's book is empty here, so `here/<thread>` always refuses.
  const here = await resolve(`here/${resolved.thread}`)
  if (here.kind === "ok") throw new Error(`here/${resolved.thread} resolved over an empty local book`)
  const failure = asFailure(here)
  return {
    kind: "error",
    error: { ...failure, details: { ...failure.details, thread: resolved.thread, on_this_device: true } },
  }
}

/** A resolved address on another device: the only kind an `omo remote` verb acts on. */
type RemoteResolved = Resolved & { readonly where: Extract<Resolved["where"], { readonly kind: "device" }> }
