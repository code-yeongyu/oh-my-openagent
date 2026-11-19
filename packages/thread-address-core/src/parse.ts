// A leaf: remote/seams.ts (the published omo-ai/remote types) imports this file, so it imports nothing.

/** A thread id: the session's durable id. */
export const THREAD_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A session id: a host routing id (`rpc-N`) or another device's listing key. */
export const SESSION_ID_SHAPE = /^(?:rpc-\d+|[A-Za-z0-9_-]{16,})$/
/** The shortest text that names a thread by a prefix of its id: 8 hex characters, hyphens allowed after. */
export const ID_PREFIX_SHAPE = /^[0-9a-f]{8}[0-9a-f-]*$/i
/** The shortest device id prefix a device part accepts: shorter would match most of an account's ids by chance. */
export const DEVICE_PREFIX_MIN = 6
/** The device part that names this device. */
export const HERE = "here"

export type ParsedAddress =
  | { readonly kind: "self" }
  | { readonly kind: "bare"; readonly text: string }
  | { readonly kind: "device"; readonly device: string; readonly thread: string; readonly text: string }

const DEVICE_THREAD = /^([^/]+)\/([^/]+)$/
const DRIVE_LETTER = /^[A-Za-z]:$/
const PATH_SEGMENT = /^[.~]/

/**
 * The one reading of an address text (design section 2). `<device>/<thread>` splits on its single `/` unless the text is
 * a path: a first part starting with `.` or `~`, a drive letter, or a `.jsonl` file. Any other text is a bare address.
 * A thread name may contain `/` itself, so the resolver still tries the whole text when the device reading misses.
 */
export function parseAddress(input: string): ParsedAddress {
  const text = input.trim()
  if (text === "self") return { kind: "self" }
  const match = DEVICE_THREAD.exec(text)
  const device = match?.[1]
  const thread = match?.[2]
  if (
    device === undefined ||
    thread === undefined ||
    /\.jsonl$/i.test(text) ||
    DRIVE_LETTER.test(device) ||
    PATH_SEGMENT.test(device)
  )
    return { kind: "bare", text }
  return { kind: "device", device, thread, text }
}

/** `<device id>/<thread>`: the address every tool accepts for a thread on a known device. */
export const formatAddress = (deviceId: string, thread: string): string => `${deviceId}/${thread}`
