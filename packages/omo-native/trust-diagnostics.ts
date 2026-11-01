import { constants } from "node:fs"
import * as fs from "node:fs/promises"
import { join } from "node:path"

import type { Diagnostic as PolicyDiagnostic } from "./engine-trust-policy"
import type { LinuxBundleRead, LinuxBundleSelection } from "./linux-trust-bundle"
import type { DropCause as DefaultFileDropCause } from "./openssl-default-file"
import type { HashDirectoryDiagnostic } from "./openssl-hash-dir"

/** 6.2: each fallback reason, mapped to its one 6.6 catalog action. */
const FALLBACK_ACTIONS = {
  "helper-missing": "reinstall-omo",
  "helper-wrong-arch": "reinstall-omo",
  "helper-signature": "reinstall-omo",
  "helper-timeout": "retry-after-store-ready",
  "access-denied": "check-store-access",
  "negatives-incomplete": "check-store-access",
  "helper-crash": "report-helper-failure",
  "helper-malformed-output": "report-helper-failure",
  "linux-bundle-unreadable": "regenerate-system-bundle",
  "linux-bundle-malformed": "regenerate-system-bundle",
} as const
export type FallbackReason = keyof typeof FALLBACK_ACTIONS

/** 6.7 item 2a: catalog identifiers only, never captured output. */
const VERIFY_PATTERNS = [
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "unable to verify the first certificate",
  "unable to get local issuer certificate",
  "unable to get issuer certificate",
  "self-signed certificate in certificate chain",
  "self signed certificate in certificate chain",
  "self-signed certificate",
  "self signed certificate",
  "certificate not trusted",
] as const
export type VerifyPattern = (typeof VERIFY_PATTERNS)[number]

const REFUSAL_CODES = ["trust-load-mismatch", "trust-exec-loop", "trust-user-extras-unrecoverable", "trust-path-unrepresentable"] as const

/** The section 4 importer modules own the codes they emit; their exported types are the source of truth. */
type ModuleCode =
  | PolicyDiagnostic
  | Extract<LinuxBundleSelection["kind"] | LinuxBundleRead["kind"], `linux-bundle-${string}`>
  | DefaultFileDropCause
  | HashDirectoryDiagnostic["code"]
/** The runtime allow-list for ModuleCode; the assertion below fails to compile when the two differ either way. */
const MODULE_CODES = [
  "negative-sources-incomplete",
  "macos-policy-unreadable",
  "scoped-deny-applied-globally",
  "lower-priority-deny-applied",
  "linux-bundle-absent",
  "linux-bundle-unreadable",
  "linux-bundle-too-large",
  "linux-bundle-replaced",
  "pem-noncanonical",
  "pem-read-error",
  "recognized-block-has-headers",
  "aux-block-unverified",
  "ordinary-block-not-indexable",
  "ordinary-block-unparseable",
  "openssl-default-dir-malformed",
  "openssl-default-dir-not-regular",
  "openssl-default-dir-unreadable",
  "openssl-default-dir-cap",
  "openssl-default-aux-dropped",
] as const satisfies readonly ModuleCode[]
type Assert<T extends true> = T
type ModuleCodesListed = Assert<[Exclude<ModuleCode, (typeof MODULE_CODES)[number]>] extends [never] ? true : false>

/** 5.3 codes that carry no field, plus the 6.2 reasons, the design-only default-file code and the module codes. */
const PLAIN_CODES = [
  ...REFUSAL_CODES,
  "trust-marker-foreign",
  "trust-dir-unsafe",
  "trust-lease-failed",
  "trust-generation-recognized",
  "trust-standalone-opt-in",
  ...(Object.keys(FALLBACK_ACTIONS) as FallbackReason[]),
  "openssl-default-file-malformed",
  ...MODULE_CODES,
] as const
const KINDS = ["static", "long-lived", "short-host-cli", "one-shot-network"] as const
const ACTIONS = ["adopt", "import-exec", "refuse", "ensure"] as const
/** 5.2: the adoption check a `trust-load-mismatch` refusal failed. */
const LOAD_CHECKS = ["file", "loaded-set", "provenance", "extras"] as const

type FallbackStatus = {
  [R in FallbackReason]: {
    readonly code: "trust-tls-failed-under-fallback" | "trust-import-degraded"
    readonly reason: R
    readonly action: (typeof FALLBACK_ACTIONS)[R]
  }
}[FallbackReason]
export type TrustDiagnosticEntry =
  | { readonly code: (typeof PLAIN_CODES)[number] }
  | FallbackStatus
  | { readonly code: "tls-verify-text-in-output"; readonly heuristic: true; readonly pattern: VerifyPattern }
export type TrustDiagnosticCode = TrustDiagnosticEntry["code"]
type Common = {
  readonly kind: (typeof KINDS)[number]
  readonly generation: string | null
  readonly codes: readonly TrustDiagnosticEntry[]
}
export type TrustDiagnosticInput =
  | Common & { readonly action: "adopt" | "import-exec" | "ensure" }
  | Common & { readonly action: "refuse"; readonly check: (typeof LOAD_CHECKS)[number] | null }

export interface TrustDiagnosticsFs {
  open(path: string, flags: number, mode: number): Promise<{
    stat(): Promise<{ readonly size: number; readonly mode: number; readonly uid: number; isFile(): boolean }>
    chmod(mode: number): Promise<void>
    write(buffer: Uint8Array, offset: number, length: number): Promise<{ readonly bytesWritten: number }>
    close(): Promise<void>
  }>
  rename(from: string, to: string): Promise<void>
}

export class TrustDiagnosticRecordError extends TypeError {
  override readonly name = "TrustDiagnosticRecordError"
}
class TrustDiagnosticsFileError extends Error {
  override readonly name = "TrustDiagnosticsFileError"
}

export const TRUST_DIAGNOSTICS_MAX_BYTES = 256 * 1024
const FILE = "diagnostics.jsonl"
const ROTATED = "diagnostics.1.jsonl"
// Windows has no O_NOFOLLOW; its trust directory is under the per-user profile ACL (5.3).
const FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)

function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T
  throw new TrustDiagnosticRecordError(`trust diagnostic ${field} is not in the closed set`)
}
function keys(value: object, allowed: readonly string[], field: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TrustDiagnosticRecordError(`trust diagnostic ${field} has a field outside the record schema`)
  }
}

/** Rebuilds every entry from closed-set values, so nothing a caller attaches can reach the file. */
function entry(value: unknown): TrustDiagnosticEntry {
  if (typeof value !== "object" || value === null) throw new TrustDiagnosticRecordError("trust diagnostic code is not an object")
  const code = (value as { code?: unknown }).code
  switch (code) {
    case "trust-tls-failed-under-fallback":
    case "trust-import-degraded": {
      keys(value, ["code", "reason", "action"], "status")
      const { reason, action } = value as { reason?: unknown; action?: unknown }
      const known = oneOf(Object.keys(FALLBACK_ACTIONS) as FallbackReason[], reason, "reason")
      if (action !== FALLBACK_ACTIONS[known]) throw new TrustDiagnosticRecordError("trust diagnostic action is not the reason's catalog action")
      return { code, reason: known, action: FALLBACK_ACTIONS[known] } as FallbackStatus
    }
    case "tls-verify-text-in-output": {
      keys(value, ["code", "heuristic", "pattern"], "hint")
      const { heuristic, pattern } = value as { heuristic?: unknown; pattern?: unknown }
      if (heuristic !== true) throw new TrustDiagnosticRecordError("trust diagnostic hint must carry heuristic: true")
      return { code, heuristic: true, pattern: oneOf(VERIFY_PATTERNS, pattern, "pattern") }
    }
    default:
      keys(value, ["code"], "code")
      return { code: oneOf(PLAIN_CODES, code, "code") }
  }
}

function serialize(input: TrustDiagnosticInput, at: Date, pid: number): string {
  const refuse = input.action === "refuse"
  keys(input, refuse ? ["kind", "action", "generation", "codes", "check"] : ["kind", "action", "generation", "codes"], "record")
  const kind = oneOf(KINDS, input.kind, "kind")
  const action = oneOf(ACTIONS, input.action, "action")
  if (input.generation !== null && (typeof input.generation !== "string" || !/^[0-9a-f]{64}$/.test(input.generation))) {
    throw new TrustDiagnosticRecordError("trust diagnostic generation is not a SHA-256 digest")
  }
  if (!Array.isArray(input.codes)) throw new TrustDiagnosticRecordError("trust diagnostic codes is not an array")
  const codes = input.codes.map(entry)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TrustDiagnosticRecordError("trust diagnostic pid is not a process id")
  const refusals = codes.filter((item) => (REFUSAL_CODES as readonly string[]).includes(item.code))
  const record: Record<string, unknown> = { v: 1, at: at.toISOString(), pid, kind, action, generation: input.generation, codes }
  if (refuse) {
    // 5.2: each refusal writes one record, and only a load mismatch names the failed adoption check.
    const [refusal, ...extra] = refusals
    if (refusal === undefined || extra.length > 0) throw new TrustDiagnosticRecordError("a refusal record carries exactly one refusal code")
    const check = input.check === null ? null : oneOf(LOAD_CHECKS, input.check, "check")
    if ((refusal.code === "trust-load-mismatch") !== (check !== null)) {
      throw new TrustDiagnosticRecordError("only trust-load-mismatch carries an adoption check")
    }
    record.check = check
  } else if (codes.some((item) => item.code === "trust-load-mismatch" || item.code === "trust-exec-loop")) {
    throw new TrustDiagnosticRecordError("a launch refusal code appears only in a refusal record")
  }
  return `${JSON.stringify(record)}\n`
}

const nodeFs: TrustDiagnosticsFs = {
  open: (path, flags, mode) => fs.open(path, flags, mode),
  rename: (from, to) => fs.rename(from, to),
}

/**
 * Appends one record to `<directory>/diagnostics.jsonl` (design 5.3) in one append-mode write.
 * The caller owns the trust directory, its creation and its lstat checks; this never creates it.
 * At 256 KiB the file is renamed over `diagnostics.1.jsonl` before the write.
 */
export async function appendTrustDiagnostic(
  directory: string,
  input: TrustDiagnosticInput,
  clock: { readonly now: () => Date; readonly pid: number } = { now: () => new Date(), pid: process.pid },
  io: TrustDiagnosticsFs = nodeFs,
): Promise<void> {
  const bytes = Buffer.from(serialize(input, clock.now(), clock.pid), "utf8")
  const path = join(directory, FILE)
  const opened = async () => {
    const handle = await io.open(path, FLAGS, 0o600)
    try {
      return { handle, stat: await handle.stat() }
    } catch (error) {
      await handle.close()
      throw error
    }
  }
  let file = await opened()
  if (file.stat.size >= TRUST_DIAGNOSTICS_MAX_BYTES) {
    await file.handle.close()
    await io.rename(path, join(directory, ROTATED))
    file = await opened()
  }
  const { handle, stat } = file
  try {
    if (!stat.isFile()) throw new TrustDiagnosticsFileError("diagnostics.jsonl is not a regular file")
    if (process.platform !== "win32") {
      if (stat.uid !== process.getuid?.()) throw new TrustDiagnosticsFileError("diagnostics.jsonl is not owned by this user")
      if ((stat.mode & 0o777) !== 0o600) await handle.chmod(0o600)
    }
    const { bytesWritten } = await handle.write(bytes, 0, bytes.length)
    if (bytesWritten !== bytes.length) throw new TrustDiagnosticsFileError("diagnostics.jsonl record was written partially")
  } finally {
    await handle.close()
  }
}
