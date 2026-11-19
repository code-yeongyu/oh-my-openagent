import {
  formatAddress,
  HERE,
  idShaped,
  noDevice,
  parseAddress,
  type DeviceRef,
} from "@oh-my-opencode/thread-address-core"
import { threadToolFailure } from "../errors"
import { relayAddressEntry } from "../remote/address-book"
import { rowThreadId, type RemoteDevice, type RemoteThreadSurface } from "../remote/ports"
import { remoteReady } from "../remote/remote-ops"
import { accountDevices, readAccount, readRoster, rosterAccount, type Account, type Ready } from "./account"
import { deviceNameOf, resolveBare, type AccountAttempt } from "./bare"
import { deviceRows, resolveAccountDevice } from "./device"
import { resolveOnDevice } from "./on-device"
import { pinned } from "./probe"
import { asRefusal, toolRefusal, withAddresses, type ThreadRefusal } from "./refusals"
import type { Found, ResolveContext, ResolveOptions, Resolved } from "./types"

const failed = (error: unknown): AccountAttempt => ({ kind: "failed", error })

/** Reads the account at most once per resolution, whichever step asks first, on the resolution's one status round. */
function once(remote: RemoteThreadSurface, ready: () => Promise<Ready>): () => Promise<AccountAttempt> {
  let read: Promise<AccountAttempt> | undefined
  return () => (read ??= readAccount(remote, { ready: ready() }).catch(failed))
}

const refOf = (row: RemoteDevice | undefined, id: string, here: string | null): DeviceRef => ({
  id,
  name: row?.label ?? id,
  online: row?.online ?? true,
  here: id === here,
  listing: row === undefined || row.online ? "listed" : "offline",
})

/** The devices the online check reads: the account's roster when this resolution read one, else one device list. */
async function rosterFor(remote: RemoteThreadSurface, account: Account | undefined, device: string) {
  if (account?.roster !== undefined) return account.roster
  try {
    return (await accountDevices(remote.client)).devices
  } catch (error) {
    return asRefusal(
      threadToolFailure(
        "host_unavailable",
        "This device's device service could not list the account's devices.",
        "Retry when the device service is reachable.",
        { device, reason: error instanceof Error ? error.message : String(error) },
      ),
    )
  }
}

async function finish(
  ctx: ResolveContext,
  hit: Found | ThreadRefusal,
  account: Account | undefined,
  opts: ResolveOptions,
): Promise<Resolved | ThreadRefusal> {
  if (hit.kind === "error") return hit
  const row = hit.entry.transport?.row
  if (row === undefined || ctx.remote === undefined) {
    const self = account?.devices.find((device) => device.device === account.here)
    const device = account?.here == null ? null : refOf(self, account.here, account.here)
    return {
      kind: "ok",
      thread: hit.entry.thread_id,
      address: device === null ? hit.entry.thread_id : formatAddress(device.id, hit.entry.thread_id),
      device,
      where: { kind: "here", entry: hit.entry },
      entry: hit.entry,
      resolution: hit.resolution,
      all_scope: hit.all_scope,
    }
  }
  const roster =
    opts.need === "online" || account === undefined ? await rosterFor(ctx.remote, account, row.device) : account.roster
  if (roster !== undefined && "kind" in roster) return roster
  const listed = roster?.find((device) => device.device === row.device)
  if (opts.need === "online") {
    if (listed === undefined) return toolRefusal(noDevice(row.device, deviceRows(roster ?? [])))
    const online = resolveAccountDevice({ here: account?.here ?? null, devices: [listed] }, row.device, {
      online: true,
    })
    if (online.kind === "error") return online
  }
  const device = {
    ...refOf(listed, row.device, account?.here ?? null),
    ...(account === undefined ? {} : { listing: account.listingOf(row.device) }),
  }
  return {
    kind: "ok",
    thread: hit.entry.thread_id,
    address: formatAddress(row.device, hit.entry.thread_id === "" ? row.session_id : hit.entry.thread_id),
    device,
    where: { kind: "device", row },
    entry: hit.entry,
    resolution: hit.resolution,
    all_scope: hit.all_scope,
  }
}

const ambiguous = (text: string, readings: readonly Found[], account: Account): ThreadRefusal =>
  withAddresses(
    {
      kind: "error",
      ...threadToolFailure(
        "ambiguous_target",
        `"${text}" names a thread on a device and a thread named "${text}"; none was picked.`,
        "Pass the exact thread value of the intended thread from candidates.",
      ),
      candidates: readings.map((reading) => ({
        thread: reading.entry.thread_id,
        name: reading.entry.name,
        cwd: reading.entry.cwd,
        preview: reading.entry.preview ?? "",
        updatedAt: reading.entry.updated_at,
        state: reading.entry.status,
        device: reading.entry.transport?.row.device ?? "here",
      })),
    },
    account.here,
    (device) => account.devices.find((row) => row.device === device)?.label,
  )

/**
 * #14048 (`unique_holder`): the refusal when more than one device lists the resolved thread id, this device's book
 * included, one candidate per device; undefined when one device does. Read from the resolution's own account read.
 */
async function otherHolder(
  ctx: ResolveContext,
  hit: Found,
  read: () => Promise<AccountAttempt>,
): Promise<ThreadRefusal | undefined> {
  const attempt = await read()
  if (attempt.kind === "none") return undefined
  if (attempt.kind === "unavailable") return asRefusal(attempt.error)
  if (attempt.kind === "failed")
    return asRefusal(
      threadToolFailure(
        "host_unavailable",
        "The account's session listing could not be read to confirm the session's device.",
        "Retry when the device service is reachable.",
        { reason: attempt.error instanceof Error ? attempt.error.message : String(attempt.error) },
      ),
    )
  const account = attempt.account
  const thread = hit.entry.thread_id
  const byDevice = new Map(
    [
      ...ctx.local.filter((entry) => entry.thread_id === thread),
      ...account.rows
        .filter((row) => row.device !== account.here && rowThreadId(row) === thread)
        .map((row) => relayAddressEntry(row)),
    ].map((entry) => [entry.transport?.row.device ?? "here", entry] as const),
  )
  if (byDevice.size <= 1) return undefined
  return withAddresses(
    {
      kind: "error",
      ...threadToolFailure(
        "ambiguous_target",
        `Session ${thread} is listed on more than one device and nothing names which one sent it; none was picked.`,
        "Address the session on one device with <device>/<session id>.",
      ),
      candidates: [...byDevice].map(([device, entry]) => ({
        thread,
        name: entry.name,
        cwd: entry.cwd,
        preview: entry.preview ?? "",
        updatedAt: entry.updated_at,
        state: entry.status,
        device,
      })),
    },
    account.here,
    deviceNameOf(account),
  )
}

/**
 * The one resolver (design sections 2-5): `self`, a bare address, or `<device>/<thread>`, over this device's book and
 * the account, read at most once. A device reading is taken only when the first part names a device; when it misses
 * there, or names no device, the whole text is resolved as a bare address (a thread name may contain `/`), and the
 * device's refusal answers only when that also misses. Both readings resolving to different threads is ambiguous.
 */
export async function resolveAddress(
  ctx: ResolveContext,
  text: string,
  opts: ResolveOptions = {},
): Promise<Resolved | ThreadRefusal> {
  if (opts.pin !== undefined) return await finish(ctx, await pinned(ctx.remote, opts.pin), undefined, opts)
  const parsed = parseAddress(text)
  const remote = ctx.remote
  let status: Promise<Ready> | undefined
  const ready = (): Promise<Ready> => (status ??= remote === undefined ? Promise.reject() : remoteReady(remote))
  const read = remote === undefined ? async (): Promise<AccountAttempt> => ({ kind: "none" }) : once(remote, ready)
  const bare = async (address: string, book = ctx) => {
    const resolved = await resolveBare(book, address, opts, read)
    const held =
      opts.unique_holder === true && resolved.result.kind === "ok"
        ? await otherHolder(book, resolved.result, read)
        : undefined
    return await finish(book, held ?? resolved.result, resolved.account, opts)
  }
  if (parsed.kind !== "device") return await bare(text)
  // #12709: the device part is resolved from the roster alone, and the thread part from that one device's reads; the
  // account-wide listing round is read only for the whole text's bare reading.
  const roster = remote === undefined ? undefined : await readRoster(remote, ready()).catch(failed)
  if (remote === undefined || roster?.kind !== "account")
    return parsed.device === HERE
      ? await bare(parsed.thread, { ...ctx, local: ctx.localFor?.(parsed.thread) ?? ctx.local })
      : await bare(text)
  const device = resolveAccountDevice(roster.account, parsed.device, { online: opts.need === "online" })
  if (device.kind === "error") {
    const whole = await resolveBare(ctx, text, opts, read)
    return whole.result.kind === "ok" ? await finish(ctx, whole.result, whole.account, opts) : device
  }
  const one = device.device.here
    ? roster.account
    : await readAccount(remote, { ready: ready(), roster: roster.account.roster, device: device.device.id })
        .then((read) => (read.kind === "account" ? read.account : read))
        .catch((error: unknown) =>
          asRefusal(
            threadToolFailure(
              "host_unavailable",
              "The account's session listing could not be reached.",
              "Retry when the device service is reachable.",
              { reason: error instanceof Error ? error.message : String(error) },
            ),
          ),
        )
  if ("kind" in one) return one.kind === "none" ? await bare(text) : "error" in one ? asRefusal(one.error) : one
  const ref = { ...device.device, listing: one.listingOf(device.device.id) }
  const onDevice = await resolveOnDevice(ctx, remote, one, ref, parsed.thread, opts, ready())
  // An id-shaped thread part reads nothing more when its device answers; a miss there may still be a name with "/".
  if (onDevice.kind === "ok" && idShaped(parsed.thread)) return await finish(ctx, onDevice, one, opts)
  const whole = await resolveBare(ctx, text, opts, read)
  if (onDevice.kind === "ok" && whole.result.kind === "ok" && whole.result.entry.thread_id !== onDevice.entry.thread_id)
    return ambiguous(text, [onDevice, whole.result], one)
  return onDevice.kind === "ok" || whole.result.kind !== "ok"
    ? await finish(ctx, onDevice, one, opts)
    : await finish(ctx, whole.result, whole.account, opts)
}
