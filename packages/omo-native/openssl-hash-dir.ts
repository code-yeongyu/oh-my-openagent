import { X509Certificate } from "node:crypto"

/** Open must follow links; stat and readFile operate on that same opened object. */
export interface HashDirectory {
  entries(): Promise<readonly string[]>
  open(path: string): Promise<{
    stat(): Promise<{ readonly size: number; isFile(): boolean }>
    readFile(): Promise<Uint8Array>
    close(): Promise<void>
  }>
}

export interface HashDirectoryDiagnostic {
  readonly path: string
  readonly code:
    | "openssl-default-dir-malformed"
    | "openssl-default-dir-not-regular"
    | "openssl-default-dir-unreadable"
    | "openssl-default-dir-cap"
    | "openssl-default-aux-dropped"
  readonly narrowing: true
}

export interface HashDirectorySelection {
  readonly candidates: readonly X509Certificate[]
  /** Also subtract these identities from the default-file source when wiring the importer. */
  readonly excludedFingerprints: readonly string[]
  readonly diagnostics: readonly HashDirectoryDiagnostic[]
}

export class HashDirectoryRuntimeError extends Error {
  override readonly name = "HashDirectoryRuntimeError"
}

const MAX_BYTES = 8 * 1024 * 1024
const MAX_SUFFIXES = 4096

/**
 * Strict canonical PEM is a deliberate narrowing, not a second permissive PEM parser.
 * In particular it cannot overlook a BEGIN hidden inside a long BIO_gets line, headers,
 * empty labels, non-ASCII bytes, or malformed blocks of an otherwise skipped type.
 */
function parseFile(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1").replaceAll("\r\n", "\n")
  const certificates: X509Certificate[] = []
  const excluded: string[] = []
  let auxiliary = false
  let count = 0
  let offset = 0
  const block = /-----BEGIN ([A-Z0-9][A-Z0-9 ]{0,63})-----\n((?:[A-Za-z0-9+/=]{1,64}\n)+)-----END \1-----(?:\n|$)/y
  while (offset < text.length) {
    const whitespace = /^\n*/.exec(text.slice(offset))?.[0] ?? ""
    offset += whitespace.length
    if (offset === text.length) break
    block.lastIndex = offset
    const match = block.exec(text)
    if (!match) return { certificates, excluded, auxiliary, loaded: false, malformed: true }
    const [, label, body] = match
    if (label === undefined || body === undefined) throw new HashDirectoryRuntimeError("PEM capture contract failed")
    const lines = body.trimEnd().split("\n")
    const encoded = lines.join("")
    const decoded = Buffer.from(encoded, "base64")
    if (decoded.toString("base64") !== encoded || lines.slice(0, -1).some((line) => line.length !== 64)) {
      return { certificates, excluded, auxiliary, loaded: false, malformed: true }
    }
    offset = block.lastIndex
    switch (label) {
      case "CERTIFICATE":
      case "X509 CERTIFICATE":
      case "TRUSTED CERTIFICATE": {
        let certificate: X509Certificate
        // d2i_X509_AUX reads an AUX trailer after the certificate under every certificate label, so
        // identify the certificate itself; a plain copy elsewhere must not shed the trailer's restrictions.
        let certificateDer = decoded
        if (decoded[0] === 0x30) {
          const length = decoded[1]
          if (length !== undefined && length < 0x80) certificateDer = decoded.subarray(0, 2 + length)
          else if (length !== undefined && length > 0x80 && length <= 0x84 && decoded.length >= 2 + length - 0x80) {
            const octets = length - 0x80
            certificateDer = decoded.subarray(0, 2 + octets + decoded.readUIntBE(2, octets))
          }
        }
        try {
          // Bun's X509Certificate uses the engine's BoringSSL full-certificate parser.
          certificate = new X509Certificate(certificateDer)
        } catch (error) {
          if (!(error instanceof Error)) throw error
          return { certificates, excluded, auxiliary, loaded: false, malformed: true }
        }
        const hasTrailer = !certificate.raw.equals(decoded)
        if (label === "TRUSTED CERTIFICATE" || (hasTrailer && certificate.raw.equals(certificateDer))) {
          auxiliary = true
          excluded.push(certificate.fingerprint256)
        }
        // AUX trailers need a separate decoder. Drop rather than continue past an
        // invalid AUX that could make Bun stop before the next suffix.
        if (hasTrailer) {
          return { certificates, excluded, auxiliary, loaded: false, malformed: true }
        }
        count++
        if (label !== "TRUSTED CERTIFICATE") certificates.push(certificate)
        break
      }
      case "X509 CRL":
        auxiliary = true
        break
      default:
        // Unknown PEM types are decoded, then skipped by PEM_read_bio_X509_AUX.
        break
    }
  }
  return { certificates, excluded, auxiliary, loaded: count > 0, malformed: false }
}

/**
 * Select the reachable envelope, not one request's or one warm store's contents.
 * Every successful file is transactional; a failing file contributes no candidates.
 * Missing canonical paths normally terminate a walk and are not diagnostics.
 */
export async function selectOpenSslHashDirectory(directory: HashDirectory): Promise<HashDirectorySelection> {
  if (!process.versions.bun) throw new HashDirectoryRuntimeError("OpenSSL hash-directory selection requires Bun's BoringSSL parser")
  const hashes = [...new Set((await directory.entries()).flatMap((entry) => {
    const hash = /^[a-fA-F0-9]{8}/.exec(entry)?.[0]
    return hash === undefined ? [] : [hash.toLowerCase()]
  }))].sort()
  // These accumulators are mutable while constructing one immutable selection result.
  const candidates = new Map<string, X509Certificate>()
  const excluded = new Set<string>()
  const diagnostics: HashDirectoryDiagnostic[] = []
  let totalBytes = 0
  for (const hash of hashes) {
    for (let suffix = 0; suffix <= MAX_SUFFIXES; suffix++) {
      const path = `${hash}.${suffix}`
      if (suffix === MAX_SUFFIXES || totalBytes >= MAX_BYTES) {
        diagnostics.push({ path, code: "openssl-default-dir-cap", narrowing: true })
        break
      }
      let bytes: Uint8Array
      try {
        const file = await directory.open(path)
        try {
          const stat = await file.stat()
          if (!stat.isFile()) {
            diagnostics.push({ path, code: "openssl-default-dir-not-regular", narrowing: true })
            break
          }
          if (stat.size > MAX_BYTES - totalBytes) {
            diagnostics.push({ path, code: "openssl-default-dir-cap", narrowing: true })
            break
          }
          bytes = await file.readFile()
        } finally {
          await file.close()
        }
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error)) throw error
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
          diagnostics.push({ path, code: "openssl-default-dir-unreadable", narrowing: true })
        }
        break
      }
      // Recheck actual bytes: the opened file may grow between stat and read.
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_BYTES) {
        diagnostics.push({ path, code: "openssl-default-dir-cap", narrowing: true })
        break
      }
      const parsed = parseFile(bytes)
      for (const fingerprint of parsed.excluded) excluded.add(fingerprint)
      if (parsed.auxiliary) diagnostics.push({ path, code: "openssl-default-aux-dropped", narrowing: true })
      if (parsed.malformed) diagnostics.push({ path, code: "openssl-default-dir-malformed", narrowing: true })
      if (!parsed.loaded) break
      for (const certificate of parsed.certificates) candidates.set(certificate.fingerprint256, certificate)
    }
  }
  return {
    candidates: [...candidates.values()].filter((certificate) => !excluded.has(certificate.fingerprint256)),
    excludedFingerprints: [...excluded].sort(),
    diagnostics,
  }
}
