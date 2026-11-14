import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { RequestType } from "../../src/local-api/protocol.ts"
import { isRequestType } from "../../src/local-api/validate.ts"

// The request types omo sends through this package's local-api client: the SDK (device-service.ts), remote-attach.ts and
// the vendored client's own sends (client-open.ts). The package entry exposes no raw request, so no other package sends
// through this client. sent-request-types.test.ts holds this list equal to a scan of src/, and LA21 keeps one reply row
// per entry, so a new send fails a test here and then typecheck in LA21 until it has a row.
export const OMO_SENT_REQUEST_TYPES = [
  "authenticate",
  "control.attach.get",
  "control.attach.set",
  "device.adopt",
  "device.forget",
  "device.info",
  "devices.list",
  "endpoints.register",
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
const LITERAL_SEND = /\brequest\(\s*"([^"]+)"/g
const OTHER_SEND = /\.request\(\s*(?!")([^\s,)]+)/g

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith(".ts") ? [path] : []
  })

export type SentScan = {
  readonly sent: readonly RequestType[]
  /** `<file>: <argument>` for each `.request(` call whose type is not a string literal, so the scan cannot see it. */
  readonly unscanned: readonly string[]
}

export const scanSentRequestTypes = (): SentScan => {
  const sent = new Set<RequestType>()
  const unscanned: string[] = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8")
    for (const [, type] of text.matchAll(LITERAL_SEND)) if (isRequestType(type)) sent.add(type)
    for (const [, argument] of text.matchAll(OTHER_SEND)) unscanned.push(`${relative(SRC, file)}: ${argument}`)
  }
  return { sent: [...sent].toSorted(), unscanned }
}
