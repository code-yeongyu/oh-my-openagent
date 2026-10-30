import { createHash } from "node:crypto"

import type { CertificateId, EngineTrustFacts, EnhancedKeyUsage, TrustChain, WindowsCertificate, WindowsLocation } from "./engine-trust-policy"

/** Shared with the helper (`crates/omo-engine-trust-helper/src/document.rs`); anything larger is malformed output. */
export const WINDOWS_TRUST_HELPER_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
/** Shared with `document.rs` and `windows_document.rs`. */
export const WINDOWS_TRUST_HELPER_EXIT = { badStdin: 65, outputCap: 74, watchdog: 75 } as const

export type WindowsFacts = Extract<EngineTrustFacts, { readonly os: "windows" }>
export type WindowsSourceStore = "ROOT" | "CA" | "TrustedPeople" | "Disallowed"
/** Distinct per-store outcomes (design 4.2 item 3), the same set as the macOS helper's. */
export type WindowsSourceOutcome = "read" | "absent" | "access-denied" | "enumeration-failed"
export type WindowsTrustSource = {
  readonly store: WindowsSourceStore
  readonly location: WindowsLocation
  /** null when the system store itself could not be opened or its physical stores listed. */
  readonly physicalStore: string | null
  readonly outcome: WindowsSourceOutcome
  /** The Win32 error the helper saw; 0 when read. */
  readonly status: number
}
/** `unsupported-entry-length`: an entry's length is not one its subject algorithm defines (design 4.2 item 2). */
export type WindowsCtlOutcome =
  | "read" | "absent" | "unreadable" | "undecodable" | "unsupported-subject-algorithm" | "unsupported-entry-length"
export type WindowsTrustHelperDocument = {
  readonly facts: WindowsFacts
  /** Certificate bytes of every positive candidate, by DER SHA-256, for the generation writer. */
  readonly der: ReadonlyMap<string, Uint8Array>
  readonly sources: readonly WindowsTrustSource[]
  readonly ctl: WindowsCtlOutcome
}
export type WindowsTrustMalformed = {
  readonly kind: "helper-malformed-output"
  readonly check:
    | "oversize" | "encoding" | "syntax" | "unknown-field" | "missing-field" | "wrong-type" | "invalid-value"
    | "unparseable-certificate" | "inconsistent-complete"
  /** JSON path of the offending value. */
  readonly path: string
}
export type WindowsTrustDecodeResult = { readonly kind: "decoded"; readonly document: WindowsTrustHelperDocument } | WindowsTrustMalformed

const LOCATIONS: readonly WindowsLocation[] = [
  "CURRENT_USER", "LOCAL_MACHINE", "CURRENT_USER_GROUP_POLICY", "LOCAL_MACHINE_GROUP_POLICY",
  "LOCAL_MACHINE_ENTERPRISE", "CURRENT_SERVICE", "SERVICE_SID", "USER_SID",
]
const POSITIVE_STORES = ["ROOT", "CA", "TrustedPeople"] as const
const SOURCE_STORES: readonly WindowsSourceStore[] = [...POSITIVE_STORES, "Disallowed"]
const OUTCOMES: readonly WindowsSourceOutcome[] = ["read", "absent", "access-denied", "enumeration-failed"]
const CTL_OUTCOMES: readonly WindowsCtlOutcome[] = [
  "read", "absent", "unreadable", "undecodable", "unsupported-subject-algorithm", "unsupported-entry-length",
]
const OID = /^[0-2](?:\.(?:0|[1-9][0-9]*))+$/
const SHA256 = /^[0-9a-f]{64}$/
const SHA1 = /^[0-9a-f]{40}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

class Malformed extends Error {
  constructor(readonly check: WindowsTrustMalformed["check"], readonly path: string) {
    super(`${check} at ${path}`)
  }
}

type Json = Record<string, unknown>
function object(value: unknown, path: string, fields: readonly string[], optional: readonly string[] = []): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Malformed("wrong-type", path)
  const record = value as Json
  for (const key of Object.keys(record)) {
    if (!fields.includes(key) && !optional.includes(key)) throw new Malformed("unknown-field", `${path}.${key}`)
  }
  for (const key of fields) if (!Object.hasOwn(record, key)) throw new Malformed("missing-field", `${path}.${key}`)
  return record
}
function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Malformed("wrong-type", path)
  return value
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Malformed("wrong-type", path)
  return value
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Malformed("wrong-type", path)
  return value
}
function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = string(value, path)
  if (!(allowed as readonly string[]).includes(text)) throw new Malformed("invalid-value", path)
  return text as T
}
function matching(value: unknown, path: string, pattern: RegExp): string {
  const text = string(value, path)
  if (!pattern.test(text)) throw new Malformed("invalid-value", path)
  return text
}
function physicalStore(value: unknown, path: string): string {
  const text = string(value, path)
  if (text.length === 0 || text.length > 256) throw new Malformed("invalid-value", path)
  return text
}

function win32Status(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Malformed("wrong-type", path)
  if (value < 0 || value > 0xffff_ffff) throw new Malformed("invalid-value", path)
  return value
}

/** Canonical base64 of exactly one DER SEQUENCE with no trailing bytes. */
function der(value: unknown, path: string): Uint8Array {
  const text = string(value, path)
  if (text.length === 0 || !BASE64.test(text)) throw new Malformed("unparseable-certificate", path)
  const bytes = new Uint8Array(Buffer.from(text, "base64"))
  if (bytes[0] !== 0x30 || bytes.length < 2) throw new Malformed("unparseable-certificate", path)
  const first = bytes[1] ?? 0
  let length = first
  let header = 2
  if (first >= 0x80) {
    const count = first & 0x7f
    if (count === 0 || count > 4 || bytes.length < 2 + count) throw new Malformed("unparseable-certificate", path)
    length = 0
    for (let index = 0; index < count; index++) length = length * 256 + (bytes[2 + index] ?? 0)
    if (length < 0x80 || (count > 1 && bytes[2] === 0)) throw new Malformed("unparseable-certificate", path)
    header = 2 + count
  }
  if (header + length !== bytes.length) throw new Malformed("unparseable-certificate", path)
  return bytes
}
function identityOf(bytes: Uint8Array): CertificateId {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), sha1: createHash("sha1").update(bytes).digest("hex") }
}
function identity(value: unknown, path: string): CertificateId {
  const record = object(value, path, ["sha256", "sha1"])
  return { sha256: matching(record.sha256, `${path}.sha256`, SHA256), sha1: matching(record.sha1, `${path}.sha1`, SHA1) }
}
function eku(value: unknown, path: string): EnhancedKeyUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Malformed("wrong-type", path)
  const kind = (value as Json).kind
  if (kind === "oids") {
    const record = object(value, path, ["kind", "oids"])
    const oids = array(record.oids, `${path}.oids`).map((oid, index) => matching(oid, `${path}.oids[${index}]`, OID))
    if (oids.length === 0) throw new Malformed("invalid-value", `${path}.oids`)
    return { kind, oids }
  }
  object(value, path, ["kind"])
  return { kind: oneOf(kind, `${path}.kind`, ["unrestricted", "none", "error"] as const) }
}
const same = (left: CertificateId | undefined, right: CertificateId): boolean =>
  left !== undefined && left.sha256 === right.sha256 && left.sha1 === right.sha1
/** A chain describes its own certificate: a non-empty path starts at `own`, and an anchor is the path's last member. */
function chain(value: unknown, path: string, own: CertificateId): TrustChain {
  const record = object(value, path, ["anchor", "path", "explicitDistrust"])
  const anchor = record.anchor === null ? null : identity(record.anchor, `${path}.anchor`)
  const members = array(record.path, `${path}.path`).map((entry, index) => identity(entry, `${path}.path[${index}]`))
  if (members.length > 0 && !same(members[0], own)) throw new Malformed("invalid-value", `${path}.path[0]`)
  if (anchor !== null && !same(members.at(-1), anchor)) throw new Malformed("invalid-value", `${path}.anchor`)
  return { anchor, path: members, explicitDistrust: boolean(record.explicitDistrust, `${path}.explicitDistrust`) }
}

function decode(document: unknown): WindowsTrustHelperDocument {
  const root = object(document, "$", ["schema", "os", "complete", "sources", "ctl", "certificates", "disallowed", "ctlSha1", "bundledRoots"])
  if (root.schema !== 1) throw new Malformed(typeof root.schema === "number" ? "invalid-value" : "wrong-type", "$.schema")
  oneOf(root.os, "$.os", ["windows"] as const)
  const complete = boolean(root.complete, "$.complete")
  const sources = array(root.sources, "$.sources").map((entry, index): WindowsTrustSource => {
    const path = `$.sources[${index}]`
    const record = object(entry, path, ["store", "location", "physicalStore", "outcome", "status"])
    return {
      store: oneOf(record.store, `${path}.store`, SOURCE_STORES),
      location: oneOf(record.location, `${path}.location`, LOCATIONS),
      physicalStore: record.physicalStore === null ? null : physicalStore(record.physicalStore, `${path}.physicalStore`),
      outcome: oneOf(record.outcome, `${path}.outcome`, OUTCOMES),
      status: win32Status(record.status, `${path}.status`),
    }
  })
  const ctl = oneOf(root.ctl, "$.ctl", CTL_OUTCOMES)
  const bytes = new Map<string, Uint8Array>()
  const certificates = array(root.certificates, "$.certificates").map((entry, index): WindowsCertificate => {
    const path = `$.certificates[${index}]`
    const record = object(entry, path, ["der", "store", "location", "physicalStore", "selfSigned", "ca", "eku"], ["chain"])
    const encoded = der(record.der, `${path}.der`)
    const id = identityOf(encoded)
    bytes.set(id.sha256, encoded)
    const certificate: WindowsCertificate = {
      ...id,
      store: oneOf(record.store, `${path}.store`, POSITIVE_STORES),
      location: oneOf(record.location, `${path}.location`, LOCATIONS),
      physicalStore: physicalStore(record.physicalStore, `${path}.physicalStore`),
      selfSigned: boolean(record.selfSigned, `${path}.selfSigned`),
      ca: boolean(record.ca, `${path}.ca`),
      eku: eku(record.eku, `${path}.eku`),
    }
    return record.chain === undefined ? certificate : { ...certificate, chain: chain(record.chain, `${path}.chain`, id) }
  })
  const disallowed = array(root.disallowed, "$.disallowed").map((entry, index) => {
    const path = `$.disallowed[${index}]`
    const record = object(entry, path, ["der", "location", "physicalStore"])
    return {
      ...identityOf(der(record.der, `${path}.der`)),
      location: oneOf(record.location, `${path}.location`, LOCATIONS),
      physicalStore: physicalStore(record.physicalStore, `${path}.physicalStore`),
    }
  })
  const ctlSha1 = array(root.ctlSha1, "$.ctlSha1").map((entry, index) => matching(entry, `$.ctlSha1[${index}]`, SHA1))
  const bundledRoots = array(root.bundledRoots, "$.bundledRoots").map((entry, index) => identity(entry, `$.bundledRoots[${index}]`))
  // complete:false is always accepted (it fails closed); complete:true must agree with every negative source.
  const unreadNegative = sources.some((source) => source.store === "Disallowed"
    && (source.outcome === "access-denied" || source.outcome === "enumeration-failed"))
  if (complete && (unreadNegative || (ctl !== "read" && ctl !== "absent"))) throw new Malformed("inconsistent-complete", "$.complete")
  return { facts: { os: "windows", complete, certificates, disallowed, ctlSha1, bundledRoots }, der: bytes, sources, ctl }
}

/** Strict, bounded decoder of the Windows fact helper's stdout into the policy's facts (design 4.1, 4.2). */
export function decodeWindowsTrustHelperOutput(stdout: Uint8Array): WindowsTrustDecodeResult {
  if (stdout.length > WINDOWS_TRUST_HELPER_MAX_OUTPUT_BYTES) return { kind: "helper-malformed-output", check: "oversize", path: "$" }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stdout)
  } catch (error) {
    if (error instanceof TypeError) return { kind: "helper-malformed-output", check: "encoding", path: "$" }
    throw error
  }
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "helper-malformed-output", check: "syntax", path: "$" }
    throw error
  }
  try {
    return { kind: "decoded", document: decode(document) }
  } catch (error) {
    if (error instanceof Malformed) return { kind: "helper-malformed-output", check: error.check, path: error.path }
    throw error
  }
}

/** Bun's bundled roots `B` for the helper's stdin: the DER certificates back to back (design 4.2 item 5). */
export function encodeBundledRootsForHelper(roots: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(roots.reduce((size, root) => size + root.length, 0))
  let offset = 0
  for (const root of roots) {
    out.set(root, offset)
    offset += root.length
  }
  return out
}

/** The helper's explicit environment (design 6.2): only SystemRoot, which Windows system DLLs need; nothing that steers trust. */
export function windowsTrustHelperEnvironment(arrival: Readonly<Record<string, string | undefined>>): Record<string, string> {
  for (const [name, value] of Object.entries(arrival)) {
    if (name.toUpperCase() === "SYSTEMROOT" && value !== undefined) return { SystemRoot: value }
  }
  return {}
}
