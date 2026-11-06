import { spawn } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import type { EngineTrustFacts, MacCertificate, MacTrustSetting, TrustChain } from "./engine-trust-policy"

/** Shared with the helper (`crates/omo-engine-trust-helper/src/document.rs`). */
export const MAC_TRUST_HELPER_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const MAC_TRUST_HELPER_EXIT = { outputCap: 74, watchdog: 75 } as const

export type MacTrustSourceName = "trust-settings-user" | "trust-settings-admin" | "trust-settings-system" | "keychain-search-list"
export type MacTrustSource = {
  readonly name: MacTrustSourceName
  readonly outcome: "read" | "absent" | "access-denied" | "enumeration-failed"
  /** The OSStatus the helper saw; 0 when read. */
  readonly status: number
}
export type MacTrustHelperDocument = {
  readonly facts: Extract<EngineTrustFacts, { readonly os: "macos" }>
  /** Certificate bytes by `sha256`, for the generation writer. */
  readonly der: ReadonlyMap<string, Uint8Array>
  readonly sources: readonly MacTrustSource[]
}
export type MacTrustMalformed = {
  readonly kind: "helper-malformed-output"
  readonly check:
    | "oversize" | "encoding" | "syntax" | "unknown-field" | "missing-field" | "wrong-type" | "invalid-value"
    | "duplicate-certificate" | "unparseable-certificate"
  /** JSON path of the offending value. */
  readonly path: string
}
export type MacTrustDecodeResult = { readonly kind: "decoded"; readonly document: MacTrustHelperDocument } | MacTrustMalformed

const SSL = "1.2.840.113635.100.1.3"
const SOURCE_NAMES: readonly MacTrustSourceName[] = ["trust-settings-user", "trust-settings-admin", "trust-settings-system", "keychain-search-list"]
const OUTCOMES = ["read", "absent", "access-denied", "enumeration-failed"] as const
const RESULTS = ["TrustRoot", "TrustAsRoot", "Deny", "Unspecified"] as const
const ROLES = ["server", "client", "unknown"] as const
const DOMAINS = ["user", "admin", "system"] as const

class Malformed extends Error {
  constructor(readonly check: MacTrustMalformed["check"], readonly path: string) {
    super(`${check} at ${path}`)
  }
}
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type JsonObject = { readonly [key: string]: Json }

function object(value: Json | undefined, path: string, keys: readonly string[], optional: readonly string[] = []): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Malformed("wrong-type", path)
  const record = value as JsonObject
  for (const key of Object.keys(record)) if (!keys.includes(key) && !optional.includes(key)) throw new Malformed("unknown-field", `${path}.${key}`)
  for (const key of keys) if (!(key in record)) throw new Malformed("missing-field", `${path}.${key}`)
  return record
}
function array(value: Json | undefined, path: string): readonly Json[] {
  if (!Array.isArray(value)) throw new Malformed("wrong-type", path)
  return value
}
function string(value: Json | undefined, path: string): string {
  if (typeof value !== "string") throw new Malformed("wrong-type", path)
  return value
}
function boolean(value: Json | undefined, path: string): boolean {
  if (typeof value !== "boolean") throw new Malformed("wrong-type", path)
  return value
}
function integer(value: Json | undefined, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Malformed("wrong-type", path)
  if (value < min || value > max) throw new Malformed("invalid-value", path)
  return value
}
function member<T extends string>(value: Json | undefined, path: string, allowed: readonly T[]): T {
  const text = string(value, path)
  const found = allowed.find((candidate) => candidate === text)
  if (found === undefined) throw new Malformed("invalid-value", path)
  return found
}
function nullable<T>(value: Json | undefined, read: (value: Json) => T): T | null {
  return value === null || value === undefined ? null : read(value)
}

function identity(value: Json | undefined, path: string) {
  const record = object(value, path, ["sha256", "sha1"])
  const sha256 = string(record.sha256, `${path}.sha256`)
  const sha1 = string(record.sha1, `${path}.sha1`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Malformed("invalid-value", `${path}.sha256`)
  if (!/^[0-9a-f]{40}$/.test(sha1)) throw new Malformed("invalid-value", `${path}.sha1`)
  return { sha256, sha1 }
}

function setting(value: Json | undefined, path: string): MacTrustSetting {
  const record = object(value, path, ["policy", "application", "policyString", "keyUsage", "allowedErrors", "result"])
  const policy = nullable(record.policy, (raw) => {
    const at = `${path}.policy`
    const projected = object(raw, at, ["oid", "role", "nameConstrained"])
    const oid = nullable(projected.oid, (oidValue) => string(oidValue, `${at}.oid`))
    if (oid !== null && !/^\d+(?:\.\d+)+$/.test(oid)) throw new Malformed("invalid-value", `${at}.oid`)
    const role = nullable(projected.role, (roleValue) => member(roleValue, `${at}.role`, ROLES))
    // Design 4.4 item 2: a role exists for the SSL OID only, and an unreadable policy (oid null) is always unknown.
    const consistent = oid === SSL ? role !== null : oid === null ? role === "unknown" : role === null
    if (!consistent) throw new Malformed("invalid-value", `${at}.role`)
    return { oid, role, nameConstrained: boolean(projected.nameConstrained, `${at}.nameConstrained`) }
  })
  return {
    policy,
    application: boolean(record.application, `${path}.application`),
    policyString: nullable(record.policyString, (raw) => string(raw, `${path}.policyString`)),
    // CFNumber values: a key-usage mask may arrive signed (0xffffffff as -1) or unsigned.
    keyUsage: nullable(record.keyUsage, (raw) => integer(raw, `${path}.keyUsage`, -(2 ** 31), 2 ** 32 - 1)),
    allowedErrors: array(record.allowedErrors, `${path}.allowedErrors`).map((raw, index) => integer(raw, `${path}.allowedErrors[${index}]`, -(2 ** 31), 2 ** 32 - 1)),
    result: nullable(record.result, (raw) => member(raw, `${path}.result`, RESULTS)),
  }
}

/**
 * The policy applies the EKU rule only to path members, so a chain must describe its own certificate:
 * a non-empty path starts at `own`, and an anchor is the path's last member.
 */
function chain(value: Json | undefined, path: string, own: { readonly sha256: string; readonly sha1: string }): TrustChain {
  const record = object(value, path, ["anchor", "path", "explicitDistrust"])
  const anchor = nullable(record.anchor, (raw) => identity(raw, `${path}.anchor`))
  const members = array(record.path, `${path}.path`).map((raw, index) => identity(raw, `${path}.path[${index}]`))
  const same = (a: { readonly sha256: string; readonly sha1: string } | undefined, b: { readonly sha256: string; readonly sha1: string }) =>
    a !== undefined && a.sha256 === b.sha256 && a.sha1 === b.sha1
  if (members.length > 0 && !same(members[0], own)) throw new Malformed("invalid-value", `${path}.path[0]`)
  if (anchor !== null && !same(members.at(-1), anchor)) throw new Malformed("invalid-value", `${path}.anchor`)
  return { anchor, path: members, explicitDistrust: boolean(record.explicitDistrust, `${path}.explicitDistrust`) }
}

/** Facts Bun's own BoringSSL parser derives; the engine trusts nothing it cannot parse exactly. */
function parsed(der: Buffer, path: string) {
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(der)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new Malformed("unparseable-certificate", path)
  }
  if (!certificate.raw.equals(der)) throw new Malformed("unparseable-certificate", path)
  // Node's keyUsage property is the extended key usage; absent means unrestricted.
  const eku = certificate.keyUsage === undefined ? { kind: "unrestricted" as const } : { kind: "oids" as const, oids: [...certificate.keyUsage] }
  return {
    sha256: createHash("sha256").update(der).digest("hex"),
    sha1: createHash("sha1").update(der).digest("hex"),
    selfSigned: certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey),
    ca: certificate.ca,
    eku,
  }
}

function decodeDocument(root: Json): MacTrustHelperDocument {
  const record = object(root, "$", ["schema", "os", "complete", "sources", "certificates"])
  if (integer(record.schema, "$.schema", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) !== 1) throw new Malformed("invalid-value", "$.schema")
  if (string(record.os, "$.os") !== "macos") throw new Malformed("invalid-value", "$.os")
  const complete = boolean(record.complete, "$.complete")
  const rawSources = array(record.sources, "$.sources")
  if (rawSources.length !== SOURCE_NAMES.length) throw new Malformed("invalid-value", "$.sources")
  const seen = new Set<MacTrustSourceName>()
  const sources = rawSources.map((raw, index): MacTrustSource => {
    const at = `$.sources[${index}]`
    const source = object(raw, at, ["name", "outcome", "status"])
    const name = member(source.name, `${at}.name`, SOURCE_NAMES)
    if (seen.has(name)) throw new Malformed("invalid-value", `${at}.name`)
    seen.add(name)
    return { name, outcome: member(source.outcome, `${at}.outcome`, OUTCOMES), status: integer(source.status, `${at}.status`, -(2 ** 31), 2 ** 31 - 1) }
  })
  const der = new Map<string, Uint8Array>()
  const certificates = array(record.certificates, "$.certificates").map((raw, index): MacCertificate => {
    const at = `$.certificates[${index}]`
    const entry = object(raw, at, ["der", "source", "settings"], ["chain"])
    const source = member(entry.source, `${at}.source`, ["trust-settings", "keychain"] as const)
    // Only a keychain (intermediate) candidate carries the OS chain verdict (design 4.4 item 3).
    if (("chain" in entry) !== (source === "keychain")) throw new Malformed("invalid-value", `${at}.chain`)
    const encoded = string(entry.der, `${at}.der`)
    const bytes = Buffer.from(encoded, "base64")
    if (bytes.length === 0 || bytes.toString("base64") !== encoded) throw new Malformed("invalid-value", `${at}.der`)
    const settingsRecord = object(entry.settings, `${at}.settings`, DOMAINS)
    const settings = {
      user: nullable(settingsRecord.user, (list) => array(list, `${at}.settings.user`).map((item, i) => setting(item, `${at}.settings.user[${i}]`))),
      admin: nullable(settingsRecord.admin, (list) => array(list, `${at}.settings.admin`).map((item, i) => setting(item, `${at}.settings.admin[${i}]`))),
      system: nullable(settingsRecord.system, (list) => array(list, `${at}.settings.system`).map((item, i) => setting(item, `${at}.settings.system[${i}]`))),
    }
    // Trust-settings candidates carry settings in at least one domain; keychain candidates have none of their own.
    const hasSettings = DOMAINS.some((domain) => settings[domain] !== null)
    if (hasSettings !== (source === "trust-settings")) throw new Malformed("invalid-value", `${at}.settings`)
    const facts = parsed(bytes, `${at}.der`)
    if (der.has(facts.sha256)) throw new Malformed("duplicate-certificate", `${at}.der`)
    der.set(facts.sha256, new Uint8Array(bytes))
    return source === "keychain" ? { ...facts, source, settings, chain: chain(entry.chain, `${at}.chain`, facts) } : { ...facts, source, settings }
  })
  // The importer owns completeness: every trust-settings domain carries Deny facts (design 4.5).
  const negativesRead = sources.every((source) => source.name === "keychain-search-list" || source.outcome === "read" || source.outcome === "absent")
  return { facts: { os: "macos", complete: complete && negativesRead, certificates }, der, sources }
}

/** Strict, bounded decoding of the helper's stdout (design 4.1). Any deviation is `helper-malformed-output`. */
export function decodeMacTrustHelperOutput(bytes: Uint8Array): MacTrustDecodeResult {
  if (bytes.byteLength > MAC_TRUST_HELPER_MAX_OUTPUT_BYTES) return { kind: "helper-malformed-output", check: "oversize", path: "$" }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return { kind: "helper-malformed-output", check: "encoding", path: "$" }
  }
  let root: Json
  try {
    root = JSON.parse(text) as Json
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { kind: "helper-malformed-output", check: "syntax", path: "$" }
  }
  try {
    return { kind: "decoded", document: decodeDocument(root) }
  } catch (error) {
    if (!(error instanceof Malformed)) throw error
    return { kind: "helper-malformed-output", check: error.check, path: error.path }
  }
}

export type MacTrustHelperRun =
  | { readonly kind: "output"; readonly bytes: Uint8Array }
  | { readonly kind: "helper-missing" | "helper-wrong-arch" }
  | { readonly kind: "helper-timeout"; readonly by: "owner" | "watchdog" }
  | { readonly kind: "helper-crash"; readonly exitCode: number | null; readonly signal: string | null }
  | MacTrustMalformed

/**
 * Runs the helper at an absolute path with a clean explicit environment (only HOME, which locates the
 * user's keychains as it does for Bun today), in its own process group, killed at the owner's deadline
 * or once stdout passes the cap (design 6.2). Never waits on the OS service past the deadline.
 */
export function runMacTrustHelper(
  path: string,
  options: { readonly deadlineMs: number; readonly environment: Readonly<Record<string, string | undefined>> },
): Promise<MacTrustHelperRun> {
  const home = options.environment.HOME
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let length = 0
    let settled = false
    const child = spawn(path, [], { env: home === undefined ? {} : { HOME: home }, stdio: ["ignore", "pipe", "ignore"], detached: true })
    const killGroup = () => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        // ESRCH: the group already exited.
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
    }
    const settle = (run: MacTrustHelperRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(run)
    }
    const timer = setTimeout(() => {
      killGroup()
      settle({ kind: "helper-timeout", by: "owner" })
    }, options.deadlineMs)
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.byteLength
      if (length > MAC_TRUST_HELPER_MAX_OUTPUT_BYTES) {
        killGroup()
        settle({ kind: "helper-malformed-output", check: "oversize", path: "$" })
        return
      }
      chunks.push(chunk)
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      switch (error.code) {
        case "ENOENT": case "ENOTDIR": case "EACCES": settle({ kind: "helper-missing" }); break
        case "ENOEXEC": case "EBADARCH": settle({ kind: "helper-wrong-arch" }); break
        default: settle({ kind: "helper-crash", exitCode: null, signal: null })
      }
    })
    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (exitCode === 0) settle({ kind: "output", bytes: new Uint8Array(Buffer.concat(chunks)) })
      else if (exitCode === MAC_TRUST_HELPER_EXIT.watchdog) settle({ kind: "helper-timeout", by: "watchdog" })
      else if (exitCode === MAC_TRUST_HELPER_EXIT.outputCap) settle({ kind: "helper-malformed-output", check: "oversize", path: "$" })
      else settle({ kind: "helper-crash", exitCode, signal })
    })
  })
}
