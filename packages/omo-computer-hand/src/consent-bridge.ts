import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { consentSaveEvent, newestSegment, type AuthorityAudit } from "./audit-chain.ts"
import { writeHostLatch, type HostLatch } from "./host-latch.ts"

export interface ConsentFiles {
  readonly consent: string
  /** `{fingerprint, lineHash}`: the fingerprint the host last wrote or a human acknowledged, bound to its audit line. */
  readonly sidecar: string
  readonly hostLatch: string
  readonly audit: string
}

export type ConsentVerdict =
  | { readonly kind: "clean"; readonly chainOk: true; readonly fingerprint: string }
  | { readonly kind: "tampered" }
  | { readonly kind: "rebased" }
  | { readonly kind: "chain_broken" }

export type RotateOutcome =
  | { readonly kind: "rotated"; readonly anchor: string }
  | { readonly kind: "refused"; readonly code: "Unavailable"; readonly reason: "audit_unavailable" }

interface Sidecar {
  readonly fingerprint: string
  readonly lineHash: string
}

function readJson(path: string): unknown {
  try {
    if (!lstatSync(path).isFile()) return undefined
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error)) return undefined
    throw error
  }
}

function readSidecar(path: string): Sidecar | undefined {
  const value = readJson(path)
  const fingerprint: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "fingerprint") : undefined
  const lineHash: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "lineHash") : undefined
  return typeof fingerprint === "string" && typeof lineHash === "string" ? { fingerprint, lineHash } : undefined
}

function writeOwnerOnly(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
}

function lineFingerprint(line: Readonly<Record<string, unknown>>): string | undefined {
  const grant: unknown = line.grant
  const consent: unknown = typeof grant === "object" && grant !== null ? Reflect.get(grant, "consent") : undefined
  const fingerprint: unknown =
    typeof consent === "object" && consent !== null ? Reflect.get(consent, "fingerprint") : undefined
  return typeof fingerprint === "string" ? fingerprint : undefined
}

/**
 * Consent tamper evidence across host restarts (K8): the fingerprint covers `consent.json` and every
 * admission key; the sidecar binds it to an audit line (`{fingerprint, lineHash}`); at host start
 * the newest segment is verified and the sidecar must resolve inside it. A file edited outside the
 * UI reads `tampered`; a fingerprint that moved with no audited `consent_save` reads `rebased`; a
 * sidecar that resolves to no verified line reads `chain_broken`. Only a clean start re-points the
 * sidecar, so a bad verdict survives restarts until a UI save.
 */
export class ConsentBridge {
  readonly #files: ConsentFiles
  readonly #keys: readonly string[]
  readonly #settings: () => Readonly<Record<string, unknown>>
  readonly #audit: AuthorityAudit | undefined
  readonly #latch: () => HostLatch

  constructor(deps: {
    readonly files: ConsentFiles
    /** The engine's admission-key rows (`computer.*`), every one of them fingerprinted. */
    readonly admissionKeys: readonly string[]
    readonly settings: () => Readonly<Record<string, unknown>>
    /** The authority host's writer; absent on a host that may not rotate. */
    readonly audit: AuthorityAudit | undefined
    readonly latch: () => HostLatch
  }) {
    this.#files = deps.files
    this.#keys = deps.admissionKeys
    this.#settings = deps.settings
    this.#audit = deps.audit
    this.#latch = deps.latch
  }

  fingerprintNow(): string {
    const settings = this.#settings()
    const admitted = Object.fromEntries(this.#keys.map((key) => [key, settings[key] ?? null]))
    return createHash("sha256")
      .update(JSON.stringify({ consent: readJson(this.#files.consent) ?? null, admissionKeys: admitted }))
      .digest("hex")
      .slice(0, 16)
  }

  verify(): ConsentVerdict {
    const sidecar = readSidecar(this.#files.sidecar)
    const segment = newestSegment(this.#files.audit)
    if (sidecar === undefined)
      return segment === undefined && readJson(this.#files.consent) === undefined
        ? { kind: "clean", chainOk: true, fingerprint: this.fingerprintNow() }
        : { kind: "tampered" }
    const target = segment?.findIndex((line) => line.lineHash === sidecar.lineHash) ?? -1
    const line = segment?.[target]
    if (segment === undefined || line === undefined) return { kind: "chain_broken" }
    const now = this.fingerprintNow()
    if (now !== sidecar.fingerprint) {
      const saved = segment.slice(target + 1).some((later) => lineFingerprint(later) === now)
      return saved ? { kind: "clean", chainOk: true, fingerprint: now } : { kind: "tampered" }
    }
    return lineFingerprint(line) === sidecar.fingerprint
      ? { kind: "clean", chainOk: true, fingerprint: now }
      : { kind: "rebased" }
  }

  /**
   * Host start: verify, and on a CLEAN verdict open this host's segment and re-point the sidecar and
   * the latch. A non-clean start opens nothing: a new segment would leave the sidecar's line outside
   * the newest segment, so the next start would read chain_broken instead of the verdict itself. The
   * next UI save opens the segment (`save`).
   */
  verifyAndAnchor(): ConsentVerdict {
    const verdict = this.verify()
    if (this.#audit === undefined || verdict.kind !== "clean") return verdict
    this.#point(verdict.fingerprint, this.#audit.open({ fingerprint: verdict.fingerprint, ...this.#latch() }))
    return verdict
  }

  /** A save in the consent UI: the file, an audited `consent_save`, then the sidecar. */
  save(consent: Readonly<Record<string, unknown>>): string {
    const audit = this.#authority()
    if (!audit.isOpen)
      audit.open({ fingerprint: readSidecar(this.#files.sidecar)?.fingerprint ?? "", ...this.#latch() })
    writeOwnerOnly(this.#files.consent, consent)
    const fingerprint = this.fingerprintNow()
    writeOwnerOnly(this.#files.sidecar, { fingerprint, lineHash: audit.append(consentSaveEvent(fingerprint)) })
    return fingerprint
  }

  /** Only the authority host rotates; the new file opens with the anchor and the sidecar and latch point at it. */
  rotate(): RotateOutcome {
    if (this.#audit === undefined) return { kind: "refused", code: "Unavailable", reason: "audit_unavailable" }
    const verdict = this.verify()
    const fingerprint =
      verdict.kind === "clean" ? verdict.fingerprint : (readSidecar(this.#files.sidecar)?.fingerprint ?? "")
    const anchor = this.#audit.rotate({ fingerprint, ...this.#latch() })
    if (verdict.kind === "clean") this.#point(fingerprint, anchor)
    return { kind: "rotated", anchor }
  }

  #authority(): AuthorityAudit {
    if (this.#audit === undefined) throw new Error("a consent save needs the authority host's audit writer")
    return this.#audit
  }

  #point(fingerprint: string, anchor: string): void {
    writeOwnerOnly(this.#files.sidecar, { fingerprint, lineHash: anchor })
    writeHostLatch(this.#files.hostLatch, this.#latch(), anchor)
  }
}
