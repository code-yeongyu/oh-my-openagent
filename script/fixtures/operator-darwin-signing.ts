// Builds forged and synthetic code signatures for the operator-darwin signature tests (#13921). Minimal DER
// encoding for X.509 certificates and CMS SignedData signed with keys generated here, plus thin Mach-O files
// with a real CodeDirectory, so each test can forge exactly one property of a signature.
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { readFileSync } from "node:fs"

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let at = 0
  for (const part of parts) out.set(part, at), (at += part.byteLength)
  return out
}
const length = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255])
const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = concat(parts)
  return concat([Uint8Array.of(tag, ...length(body.byteLength)), body])
}
const seq = (...parts: Uint8Array[]) => der(0x30, ...parts)
const set = (...parts: Uint8Array[]) => der(0x31, ...parts)
const octets = (bytes: Uint8Array) => der(0x04, bytes)
const utf8 = (text: string) => der(0x0c, new TextEncoder().encode(text))
const NULL = Uint8Array.of(0x05, 0x00)
function oid(dotted: string): Uint8Array {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number)
  const bytes = [first * 40 + second]
  for (const arc of rest) {
    const groups = [arc & 0x7f]
    for (let value = arc >> 7; value > 0; value >>= 7) groups.unshift((value & 0x7f) | 0x80)
    bytes.push(...groups)
  }
  return der(0x06, Uint8Array.from(bytes))
}
const SHA256_RSA = seq(oid("1.2.840.113549.1.1.11"), NULL)

/** One TLV and its children: just enough DER reading to lift names and serials out of real certificates. */
function element(bytes: Uint8Array, at: number) {
  let size = bytes[at + 1] ?? 0
  let body = at + 2
  if (size & 0x80) {
    const count = size & 0x7f
    size = 0
    for (let index = 0; index < count; index++) size = size * 256 + (bytes[body++] ?? 0)
  }
  return { start: at, body, end: body + size }
}
function fields(bytes: Uint8Array, at: number) {
  const parent = element(bytes, at)
  const items = []
  for (let cursor = parent.body; cursor < parent.end; cursor = element(bytes, cursor).end) items.push(element(bytes, cursor))
  return items
}
/** Raw serial, issuer and subject DER of a certificate. */
export function certificateNames(certificate: Uint8Array) {
  const tbs = fields(certificate, fields(certificate, 0)[0]?.start ?? 0)
  const raw = (index: number) => certificate.subarray(tbs[index]?.start ?? 0, tbs[index]?.end ?? 0)
  return { serial: raw(1), issuer: raw(3), subject: raw(5) }
}

export const fixtureFile = (name: string) => new Uint8Array(readFileSync(new URL(`./operator-darwin/${name}`, import.meta.url)))

export type Issued = { readonly certificate: Uint8Array; readonly key: KeyObject }

/** An RSA certificate for `subject` ([oid, value] pairs), issued under the raw `issuer` name and signed by `issuerKey`. */
export function issue(options: {
  subject: ReadonlyArray<readonly [string, string]>
  issuer?: Uint8Array
  issuerKey?: KeyObject
  serial: number
  developerIdApplication?: boolean
}): Issued {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const subject = seq(...options.subject.map(([type, value]) => set(seq(oid(type), utf8(value)))))
  const extensions = options.developerIdApplication
    ? [der(0xa3, seq(seq(oid("2.5.29.37"), octets(seq(oid("1.3.6.1.5.5.7.3.3")))), seq(oid("1.2.840.113635.100.6.1.13"), octets(NULL))))]
    : []
  const tbs = seq(
    der(0xa0, der(0x02, Uint8Array.of(2))),
    der(0x02, Uint8Array.of(options.serial)),
    SHA256_RSA,
    options.issuer ?? subject,
    seq(der(0x17, new TextEncoder().encode("260101000000Z")), der(0x17, new TextEncoder().encode("360101000000Z"))),
    subject,
    new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
    ...extensions,
  )
  const signature = sign("sha256", tbs, options.issuerKey ?? privateKey)
  return { certificate: seq(tbs, SHA256_RSA, der(0x03, Uint8Array.of(0), signature)), key: privateKey }
}

/** Detached CMS SignedData over `signedOver`, signed by `key`, naming `signer` (issuer+serial) as the signer. */
export function signedData(options: {
  signedOver: Uint8Array
  key: KeyObject
  signer: Uint8Array
  certificates: readonly Uint8Array[]
  signerInfos?: number
}): Uint8Array {
  const names = certificateNames(options.signer)
  const attributes = [
    seq(oid("1.2.840.113549.1.9.3"), set(oid("1.2.840.113549.1.7.1"))),
    seq(oid("1.2.840.113549.1.9.4"), set(octets(new Uint8Array(createHash("sha256").update(options.signedOver).digest())))),
  ]
  const signature = sign("sha256", set(...attributes), options.key)
  const signerInfo = seq(
    der(0x02, Uint8Array.of(1)),
    seq(names.issuer, names.serial),
    seq(oid("2.16.840.1.101.3.4.2.1")),
    der(0xa0, ...attributes),
    seq(oid("1.2.840.113549.1.1.1"), NULL),
    octets(signature),
  )
  const signerInfos = Array.from({ length: options.signerInfos ?? 1 }, () => signerInfo)
  return seq(
    oid("1.2.840.113549.1.7.2"),
    der(0xa0, seq(der(0x02, Uint8Array.of(1)), set(seq(oid("2.16.840.1.101.3.4.2.1"))), seq(oid("1.2.840.113549.1.7.1")), der(0xa0, ...options.certificates), set(...signerInfos))),
  )
}

const be32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)
const blob = (magic: number, body: Uint8Array) => concat([be32(magic), be32(8 + body.byteLength), body])
const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest())

/**
 * A thin 64-bit Mach-O: header + LC_CODE_SIGNATURE + `code`, then a superblob with a sha256 CodeDirectory
 * (4 KiB pages), a requirements blob and a CMS blob. `extraBlobs` adds raw (type, blob) entries.
 */
export function machoSigned(options: {
  code: Uint8Array
  identifier?: string
  team?: string
  runtime?: boolean
  /** Mach-O header cputype and cpusubtype (capability bits included); arm64 ARM64_ALL by default. */
  cpu?: readonly [cpuType: number, cpuSubtype: number]
  cms?: Uint8Array
  /** Signs the finished CodeDirectory; its CMS length must not depend on the CodeDirectory's bytes. */
  sign?: (codeDirectory: Uint8Array) => Uint8Array
  extraBlobs?: ReadonlyArray<readonly [number, Uint8Array]>
}): { file: Uint8Array; codeDirectory: Uint8Array } {
  if (options.sign) {
    const placeholder = options.sign(new Uint8Array(1))
    const { codeDirectory } = machoSigned({ ...options, sign: undefined, cms: placeholder })
    const cms = options.sign(codeDirectory)
    if (cms.byteLength !== placeholder.byteLength) throw new Error("fixture CMS length depends on the CodeDirectory")
    return machoSigned({ ...options, sign: undefined, cms })
  }
  const requirements = blob(0xfade0c01, new Uint8Array(4))
  const cms = blob(0xfade0b01, options.cms ?? new Uint8Array())
  const ident = new TextEncoder().encode(`${options.identifier ?? "ai.sisyphuslabs.fixture"}\0`)
  const team = new TextEncoder().encode(`${options.team ?? "523JNR86LZ"}\0`)
  const special = 2
  const hashOffset = 52 + ident.byteLength + team.byteLength + special * 32
  const codeEnd = 48 + options.code.byteLength
  const pageCount = Math.ceil(codeEnd / 4096)
  const extras = options.extraBlobs ?? []
  const signatureSize = 12 + (3 + extras.length) * 8 + hashOffset + pageCount * 32 + requirements.byteLength + cms.byteLength + extras.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0)
  const header = new Uint8Array(48)
  const le = new DataView(header.buffer)
  le.setUint32(0, 0xfeedfacf, true)
  le.setUint32(4, options.cpu?.[0] ?? 0x0100000c, true)
  le.setUint32(8, options.cpu?.[1] ?? 0, true)
  le.setUint32(16, 1, true)
  le.setUint32(20, 16, true)
  le.setUint32(32, 0x1d, true)
  le.setUint32(36, 16, true)
  le.setUint32(40, codeEnd, true)
  le.setUint32(44, signatureSize, true)
  const body = concat([header, options.code])
  const pages = Math.ceil(body.byteLength / 4096)
  const cd = new Uint8Array(hashOffset + pages * 32)
  const cdv = new DataView(cd.buffer)
  cdv.setUint32(0, 0xfade0c02)
  cdv.setUint32(4, cd.byteLength)
  cdv.setUint32(8, 0x20200)
  cdv.setUint32(12, options.runtime === false ? 0 : 0x10000)
  cdv.setUint32(16, hashOffset)
  cdv.setUint32(20, 52)
  cdv.setUint32(24, special)
  cdv.setUint32(28, pages)
  cdv.setUint32(32, body.byteLength)
  cd.set([32, 2, 0, 12], 36)
  cdv.setUint32(48, 52 + ident.byteLength)
  cd.set(ident, 52)
  cd.set(team, 52 + ident.byteLength)
  cd.set(sha256(requirements), hashOffset - 2 * 32)
  for (let page = 0; page < pages; page++) cd.set(sha256(body.subarray(page * 4096, Math.min((page + 1) * 4096, body.byteLength))), hashOffset + page * 32)
  const entries: Array<readonly [number, Uint8Array]> = [[0, cd], [2, requirements], [0x10000, cms], ...extras]
  let offset = 12 + entries.length * 8
  const index = entries.map(([type, bytes]) => {
    const entry = concat([be32(type), be32(offset)])
    offset += bytes.byteLength
    return entry
  })
  const superblob = concat([be32(0xfade0cc0), be32(offset), be32(entries.length), ...index, ...entries.map(([, bytes]) => bytes)])
  if (superblob.byteLength !== signatureSize) throw new Error("fixture superblob size mismatch")
  return { file: concat([body, superblob]), codeDirectory: cd }
}
