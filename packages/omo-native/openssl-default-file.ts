import { X509Certificate } from "node:crypto"

type Candidate = { readonly der: Buffer; readonly index: number }
export type DropCause = "pem-noncanonical" | "pem-read-error" | "recognized-block-has-headers" | "aux-block-unverified"
  | "ordinary-block-not-indexable" | "ordinary-block-unparseable"
type DefaultFileCandidates =
  | { readonly kind: "kept"; readonly certificates: readonly Candidate[] }
  | { readonly kind: "dropped"; readonly cause: DropCause; readonly blockIndex: number; readonly narrowing: boolean }
type Element = { readonly tag: number; readonly bytes: Buffer }

class DerReadError extends Error {}
class BunRequiredError extends Error {
  readonly name = "BunRequiredError"
  constructor() { super("The OpenSSL default-file importer requires Bun's BoringSSL parser") }
}

// A cursor is deliberately mutable: each read consumes exactly one definite, minimal TLV.
class DerReader {
  private offset = 0
  private readonly bytes: Buffer
  constructor(bytes: Buffer) { this.bytes = bytes }
  get remaining(): number { return this.bytes.length - this.offset }
  private byte(): number {
    const value = this.bytes[this.offset++]
    if (value === undefined) throw new DerReadError()
    return value
  }
  element(expected?: number): Element {
    const tag = this.byte()
    if ((tag & 0xc0) === 0 && (tag & 0x1f) === 0) throw new DerReadError()
    if ((tag & 0x1f) === 0x1f) {
      let number = 0
      let next = this.byte()
      if ((next & 0x7f) === 0) throw new DerReadError()
      for (;;) {
        number = number * 128 + (next & 0x7f)
        if (number > 0x1fffffff) throw new DerReadError()
        if ((next & 0x80) === 0) break
        next = this.byte()
      }
      if (number < 31) throw new DerReadError()
    }
    const first = this.byte()
    let length = first
    if (first >= 0x80) {
      const count = first & 0x7f
      if (count === 0 || count > 4) throw new DerReadError()
      length = 0
      for (let i = 0; i < count; i++) {
        const next = this.byte()
        if (i === 0 && next === 0) throw new DerReadError()
        length = length * 256 + next
      }
      if (length < 128) throw new DerReadError()
    }
    if (length > this.remaining || (expected !== undefined && tag !== expected)) throw new DerReadError()
    const bytes = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return { tag, bytes }
  }
}

function checkCodePoint(point: number | undefined): void {
  // BoringSSL 41bf9b59 crypto/bytestring/unicode.cc: is_valid_code_point.
  if (point === undefined || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
    || (point & 0xfffe) === 0xfffe || (point >= 0xfdd0 && point <= 0xfdef)) throw new DerReadError()
}

function checkName(subject: Buffer): void {
  const name = new DerReader(subject)
  while (name.remaining > 0) {
    const rdn = new DerReader(name.element(0x31).bytes)
    if (rdn.remaining === 0) throw new DerReadError()
    while (rdn.remaining > 0) {
      const attribute = new DerReader(rdn.element(0x30).bytes)
      attribute.element(6)
      const value = attribute.element()
      if (attribute.remaining !== 0) throw new DerReadError()
      // These are ASN.1 tags, not variants of a closed union. All other values are opaque.
      switch (value.tag) {
        case 12:
          try {
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value.bytes)
            for (const character of decoded) checkCodePoint(character.codePointAt(0))
          } catch (error) {
            if (!(error instanceof TypeError)) throw error
            throw new DerReadError()
          }
          break
        case 30:
        case 28: {
          const width = value.tag === 30 ? 2 : 4
          if (value.bytes.length % width !== 0) throw new DerReadError()
          for (let i = 0; i < value.bytes.length; i += width) {
            const point = value.bytes.readUIntBE(i, width)
            checkCodePoint(point)
          }
          break
        }
        default: break
      }
    }
  }
}

function isIndexable(der: Buffer): boolean {
  try {
    const input = new DerReader(der)
    const certificate = new DerReader(input.element(0x30).bytes)
    if (input.remaining !== 0) throw new DerReadError()
    const tbs = new DerReader(certificate.element(0x30).bytes)
    const first = tbs.element()
    if (first.tag === 0xa0) tbs.element(2)
    else if (first.tag !== 2) throw new DerReadError()
    tbs.element(0x30) // signature
    tbs.element(0x30) // issuer
    tbs.element(0x30) // validity
    const subject = tbs.element(0x30).bytes
    checkName(subject)
    return true
  } catch (error) {
    if (!(error instanceof DerReadError)) throw error
    return false
  }
}

/**
 * Select ordinary certificates atomically, matching the OpenSSL default-file loader, not the
 * hash-directory loader's good-prefix semantics. Indices include decoded unknown blocks.
 * (d) mirror-only rejections cannot be distinguished at runtime; their flag is still false.
 */
export function readDefaultFileCandidates(
  bytes: Uint8Array,
  isBundledRoot: (der: Buffer) => boolean,
): DefaultFileCandidates {
  // Cause (e) is sound only when node:crypto uses Bun's BoringSSL, never Node's OpenSSL.
  if (process.versions.bun === undefined) throw new BunRequiredError()
  // Bun's loader reads raw bytes; latin1 maps each byte to one character, so a BOM or any non-ASCII byte
  // reaches the canonical gate instead of being stripped by a text decoder.
  const lines = Buffer.from(bytes).toString("latin1").split("\n").map((line) => line.replace(/\r$/, ""))
  const certificates: Candidate[] = []
  let blockIndex = 0
  const drop = (cause: DropCause, index = blockIndex): DefaultFileCandidates => ({
    kind: "dropped", cause, blockIndex: index,
    narrowing: {
      "pem-noncanonical": true, "pem-read-error": false, "recognized-block-has-headers": false,
      "ordinary-block-not-indexable": false, "ordinary-block-unparseable": true, "aux-block-unverified": true,
    }[cause],
  })
  let label: string | undefined
  let headerEnd = -1
  for (let line = 0; line < lines.length; line++) {
    const current = lines[line] ?? ""
    // ASCII makes characters equal bytes; the cap prevents BIO_gets' 253-byte splitting.
    if (current.length > 200 || /[^\x20-\x7e]/.test(current)) return drop("pem-noncanonical")
    const boundary = /^-----(BEGIN|END) ([A-Z0-9][A-Z0-9 ]*)-----$/.exec(current)
    if (label === undefined) {
      if (boundary?.[1] === "BEGIN") {
        label = boundary[2]
        const separator = lines.indexOf("", line + 1)
        const end = lines.indexOf(`-----END ${label}-----`, line + 1)
        // Preserve cause (b) for short, printable recognized header sections and their separator.
        headerEnd = ["CERTIFICATE", "X509 CERTIFICATE", "TRUSTED CERTIFICATE", "X509 CRL"].includes(label ?? "")
          && separator > line + 1 && separator < end ? separator : -1
      } else if (current.includes("-----")) return drop("pem-noncanonical")
    } else if (boundary?.[1] === "END" && boundary[2] === label) {
      label = undefined
      blockIndex++
    } else if (current.includes("-----") || /^ +$/.test(current)
      || (line > headerEnd && !/^[A-Za-z0-9+/=]+$/.test(current))) {
      // A space-only line is a blank line to PEM_read_bio's right-strip but not to the header split below.
      return drop("pem-noncanonical")
    }
  }
  if (label !== undefined) return drop("pem-noncanonical")
  blockIndex = 0
  for (let line = 0; line < lines.length; line++) {
    const begin = /^-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----$/.exec(lines[line] ?? "")
    if (begin === null) continue // PEM_read_bio ignores text outside blocks.
    const label = begin[1]
    const body: string[] = []
    let ended = false
    for (line++; line < lines.length; line++) {
      const current = lines[line] ?? ""
      if (current === `-----END ${label}-----`) { ended = true; break }
      body.push(current)
    }
    if (!ended) return drop("pem-read-error")
    // PEM_read_bio reads to the first blank line as headers, regardless of their syntax.
    // Without a blank line, those same bytes are the base64 body instead.
    const separator = body.indexOf("")
    const headers = separator > 0
    const payload = separator < 0 ? body : body.slice(separator + 1)
    const base64 = payload.join("").replace(/[ \t]/g, "")
    // Buffer.from silently ignores invalid characters; check framing before decoding.
    if (base64.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      return drop("pem-read-error")
    }
    const der = Buffer.from(base64, "base64")
    switch (label) {
      case "CERTIFICATE":
      case "X509 CERTIFICATE":
        if (headers) return drop("recognized-block-has-headers")
        if (!isBundledRoot(der)) certificates.push({ der, index: blockIndex })
        break
      case "TRUSTED CERTIFICATE":
      case "X509 CRL":
        if (headers) return drop("recognized-block-has-headers")
        // No exact d2i_X509_AUX / d2i_X509_CRL decoder is exposed, so a decodable block (which Bun keeps the
        // file for) cannot be told from cause (c). Drop the file and mark it a narrowing; never grant from it.
        return drop("aux-block-unverified")
      default: break // Open PEM labels: skip only after their complete PEM decode succeeded.
    }
    blockIndex++
  }
  // Bun finishes the PEM transaction before building the lazy set from ordinary blocks.
  for (const { der, index } of certificates) {
    if (!isIndexable(der)) return drop("ordinary-block-not-indexable", index)
  }
  for (const { der, index } of certificates) {
    try {
      new X509Certificate(der)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return drop("ordinary-block-unparseable", index)
    }
  }
  return { kind: "kept", certificates }
}
