import { X509Certificate } from "node:crypto"

/**
 * Validation of `OMO_EXTRA_CA_CERTIFICATES` for the compiled engine (#10215, #10762).
 *
 * The value is PEM text (never a path) that the desktop validated and its server set for the engine
 * (sisyphuslabs/omo-desktop-app#2760). The engine entry and the launcher trust stage re-validate it
 * here with the same rules, within the size limit below, and a bad value fails closed: the engine
 * refuses to start rather than run with a trust set the caller did not intend. Installing the trust
 * set is the launcher trust stage's job (`runTrustStage`), not this module's.
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
    if (!certificate.ca)
      throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} holds a certificate that is not a CA`)
    certificates.set(certificate.fingerprint256, certificate.toString())
  }
  if (certificates.size === 0 || normalized.replace(PEM_BLOCK, "").trim().length > 0) {
    throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} is not a PEM certificate bundle`)
  }
  return [...certificates.values()]
}
