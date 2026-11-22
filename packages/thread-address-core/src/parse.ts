// A leaf: remote/seams.ts (the published omo-ai/remote types) imports this file, so it imports nothing.

/** A thread id: the session's durable id. */
export const THREAD_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A session id: a host routing id (`rpc-N`) or another device's listing key. */
export const SESSION_ID_SHAPE = /^(?:rpc-\d+|[A-Za-z0-9_-]{16,})$/
/** The shortest text that names a thread by a prefix of its id: 8 hex characters, hyphens allowed after. */
const ROUTING_ID_SHAPE = /^rpc-\d+$/
/** A device-service listing key: exactly 22 characters of base64url. */
const LISTING_KEY_SHAPE = /^[A-Za-z0-9_-]{22}$/

/**
 * A thread id, a host routing id (`rpc-N`) or a device-service listing key: a text a device can be asked for without
 * listing it first (#13748). Narrower than SESSION_ID_SHAPE, so an unlisted hyphenated name ("release-planner-2") is
 * never passed through. Residual: a name of exactly 22 characters with no spaces reads as a listing key.
 */
export const idShaped = (text: string): boolean =>
  THREAD_ID_SHAPE.test(text) || ROUTING_ID_SHAPE.test(text) || LISTING_KEY_SHAPE.test(text)

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
