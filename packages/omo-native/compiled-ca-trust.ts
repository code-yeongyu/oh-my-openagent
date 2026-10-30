import { X509Certificate } from "node:crypto"
import * as nodeTls from "node:tls"

/**
 * Certificate trust for the compiled engine (#10215).
 *
 * A `bun build --compile` binary trusts only Bun's bundled CA list, and `--use-system-ca` passed to
 * it is inert (it reaches `process.argv` as a plain string). So the engine installs bundled + OS
 * store + extras itself, at the top of every start: `host ensure`, the host daemon it spawns, and
 * the provisioned handoff all run this entry again.
 *
 * Extras come from `OMO_EXTRA_CA_CERTIFICATES`, PEM text (never a path) that the desktop validated
 * and its server set for the engine (sisyphuslabs/omo-desktop-app#2760). It is re-validated here
 * with the same rules and a bad value fails closed: the engine refuses to start rather than run
 * with a trust set the caller did not intend.
 */
export const ENGINE_EXTRA_CA_ENV = "OMO_EXTRA_CA_CERTIFICATES"
/** One environment variable on every OS: Windows caps a variable at 32,767 characters. */
export const MAX_EXTRA_CA_BYTES = 24 * 1024

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----\n([A-Za-z0-9+/=\n]*?)-----END \1-----/g

export class ExtraCaCertificatesError extends Error {
  override readonly name = "ExtraCaCertificatesError"
}

/** PEM `CERTIFICATE` blocks only, each a CA; whitespace is the only other content allowed. */
export function parseExtraCaCertificates(text: string): string[] {
  if (Buffer.byteLength(text, "utf8") > MAX_EXTRA_CA_BYTES) {
    throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} is larger than ${MAX_EXTRA_CA_BYTES / 1024} KiB`)
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const certificates = new Map<string, string>()
  for (const [block, label] of normalized.matchAll(PEM_BLOCK)) {
    if (label !== "CERTIFICATE") throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} contains a ${label} block`)
    let certificate: X509Certificate
    try {
      certificate = new X509Certificate(block)
    } catch {
      throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} holds a certificate that cannot be read`)
    }
    if (!certificate.ca) throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} holds a certificate that is not a CA`)
    certificates.set(certificate.fingerprint256, certificate.toString())
  }
  if (certificates.size === 0 || normalized.replace(PEM_BLOCK, "").trim().length > 0) {
    throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} is not a PEM certificate bundle`)
  }
  return [...certificates.values()]
}

type TrustApi = Pick<typeof nodeTls, "getCACertificates" | "setDefaultCACertificates">

export interface EngineTrustReport {
  readonly installed: boolean
  readonly bundled: number
  readonly system: number
  /** Certificates `NODE_EXTRA_CA_CERTS` loaded. */
  readonly ambient: number
  readonly extra: number
}

/**
 * Installs bundled + OS store + `NODE_EXTRA_CA_CERTS` (which Bun loads natively before this runs) +
 * the validated extras. `NODE_EXTRA_CA_CERTS` is honored because standalone CLI users behind a
 * corporate proxy set it; the desktop strips it from the engines it starts (omo-desktop-app#2766).
 * Those ambient certificates are taken as Node loaded them, without the `CA:TRUE` and strict-parse
 * checks the `OMO_EXTRA_CA_CERTIFICATES` extras get, matching standard Node behaviour.
 * `NODE_USE_SYSTEM_CA=1` makes `BUN_BE_BUN` children, which never run this entry, read the OS store;
 * they also inherit `NODE_EXTRA_CA_CERTS`, but not the `OMO_EXTRA_CA_CERTIFICATES` extras (known limit).
 * `OMO_EXTRA_CA_CERTIFICATES` stays in the environment: the host daemon is a grandchild and needs it.
 */
export function installEngineCaTrust(env: NodeJS.ProcessEnv = process.env, tls: TrustApi = nodeTls): EngineTrustReport {
  const raw = env[ENGINE_EXTRA_CA_ENV]
  const extra = raw === undefined || raw === "" ? [] : parseExtraCaCertificates(raw)
  env.NODE_USE_SYSTEM_CA = "1"
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
    return { installed: false, bundled: 0, system: 0, ambient: 0, extra: 0 }
  }
  const bundled = tls.getCACertificates("bundled")
  const system = tls.getCACertificates("system")
  const ambient = tls.getCACertificates("extra")
  tls.setDefaultCACertificates([...new Set([...bundled, ...system, ...ambient, ...extra])])
  return { installed: true, bundled: bundled.length, system: system.length, ambient: ambient.length, extra: extra.length }
}
