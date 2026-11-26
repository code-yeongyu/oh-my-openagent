import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import type { RequestType } from "../../src/local-api/protocol.ts"
import { isRequestType } from "../../src/local-api/validate.ts"

// The request types omo sends through this package's local-api client: the SDK (device-service.ts), remote-attach.ts,
// the delivery consumer (delivery-consumer.ts) and the vendored client's own sends (client-open.ts). The package entry exposes no raw request, so no other package sends
// through this client. sent-request-types.test.ts holds this list equal to a scan of src/, and LA21 keeps one reply row
// per entry, so a new send fails a test here and then typecheck in LA21 until it has a row.
export const OMO_SENT_REQUEST_TYPES = [
  "authenticate",
  "control.attach.get",
  "control.attach.set",
  "control.session_wake.get",
  "control.session_wake.set",
  "deliveries.serve",
  "delivery.answer",
  "delivery.drained",
  "delivery.held",
  "delivery.pending",
  "device.adopt",
  "device.forget",
  "device.info",
  "devices.list",
  "endpoints.register",
  "peer.admitted",
  "refresher.register",
  "service.set_enabled",
  "session.attach",
  "session.command",
  "session.command_part",
  "session.detach",
  "session.endpoints",
  "session.locate",
  "session.read",
  "sessions.list",
  "status.get",
  "status.subscribe",
] as const satisfies readonly RequestType[]

export type OmoSentRequestType = (typeof OMO_SENT_REQUEST_TYPES)[number]

const SRC = join(import.meta.dir, "../../src")
const LITERAL_SEND = /\brequest(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*"([^"]+)"/g
// A send names its type as the first argument; a method definition (`request<T>(type: T, …)`) is skipped because its
// first argument is a name followed by `:`. Anything else that is not a string literal is reported, whatever follows.
const OTHER_SEND = /\brequest(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*(?!")(?![\w$]+\??\s*:)([^\s,)]+)/g

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith(".ts") ? [path] : []
  })

export type SentScan = {
  readonly sent: readonly RequestType[]
  /** `<file>: <argument>` for each `request(` call (bare or a member) whose type is not a string literal, so the scan cannot see it. */
  readonly unscanned: readonly string[]
}

export const scanSentRequestTypes = (root: string = SRC): SentScan => {
  const sent = new Set<RequestType>()
  const unscanned: string[] = []
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8")
    for (const [, type] of text.matchAll(LITERAL_SEND)) if (isRequestType(type)) sent.add(type)
    for (const [, argument] of text.matchAll(OTHER_SEND))
      unscanned.push(`${relative(root, file).split(sep).join("/")}: ${argument}`)
  }
  // readdir order differs between file systems, so both lists are sorted.
  return { sent: [...sent].toSorted(), unscanned: unscanned.toSorted() }
}
