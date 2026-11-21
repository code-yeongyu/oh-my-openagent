// Reads and checks the code signature of a darwin release artifact without trusting any external tool (#13921).
// Thin 64-bit and fat Mach-O files are split into slices. Each slice's CodeDirectory must hash every byte before
// the signature (pages) and its requirements/entitlements blobs (special slots). The CMS blob is returned for
// operator-darwin-cms.ts, which proves who signed that CodeDirectory.
import { createHash } from "node:crypto"

export class Refusal extends Error {}
export function refuse(reason: string): never {
  throw new Refusal(reason)
}

export type SliceSignature = {
  /** File offset of the slice and the end of the bytes its CodeDirectory hashes. */
  readonly start: number
  readonly hashedEnd: number
  readonly identifier: string
  readonly team: string
  readonly runtime: boolean
  /** Mach-O cputype of the slice (0x0100000c arm64, 0x01000007 x86_64). */
  readonly cpuType: number
  /** Mach-O cpusubtype without the capability bits (0 ARM64_ALL, 2 arm64e, 3 X86_ALL). */
  readonly cpuSubtype: number
  /** sha256 hex of the requirements blob (the designated requirement), "" when the slice has none. */
  readonly requirementsSha256: string
  /** True when the slice carries an entitlements or DER entitlements blob. */
  readonly entitlements: boolean
  /** Hex of the first 20 bytes of the CodeDirectory's sha256: the cdhash Apple's ticket service is keyed by. */
  readonly cdhash: string
  readonly codeDirectory: Uint8Array
  /** DER of the CMS SignedData, or null when the CMS blob is empty (ad-hoc). */
  readonly cms: Uint8Array | null
}

const CODE_DIRECTORY = 0
const CMS = 0x10000
const SPECIAL_BLOBS = new Map([
  [2, "requirements"],
  [5, "entitlements"],
  [7, "DER entitlements"],
])
const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest())
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index])

function sliceRanges(bytes: Uint8Array): Array<{ start: number; end: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 32) refuse("not a Mach-O file")
  if (view.getUint32(0, false) === 0xcafebabe) {
    const count = view.getUint32(4, false)
    if (count < 1 || count > 4) refuse(`unexpected fat slice count ${count}`)
    return Array.from({ length: count }, (_, index) => {
      const start = view.getUint32(8 + index * 20 + 8, false)
      const end = start + view.getUint32(8 + index * 20 + 12, false)
      if (end > bytes.byteLength) refuse("fat slice exceeds the file")
      return { start, end }
    })
  }
  if (view.getUint32(0, true) !== 0xfeedfacf) refuse("not a 64-bit Mach-O file")
  return [{ start: 0, end: bytes.byteLength }]
}

function cString(bytes: Uint8Array, at: number): string {
  const end = bytes.indexOf(0, at)
  if (at <= 0 || end < 0) refuse("malformed CodeDirectory string")
  return new TextDecoder().decode(bytes.subarray(at, end))
}

function readSlice(bytes: Uint8Array, range: { start: number; end: number }): SliceSignature {
  const slice = bytes.subarray(range.start, range.end)
  const le = new DataView(slice.buffer, slice.byteOffset, slice.byteLength)
  if (le.getUint32(0, true) !== 0xfeedfacf) refuse("slice is not a 64-bit Mach-O")
  let signatureOffset = -1
  let signatureSize = 0
  for (let index = 0, command = 32, count = le.getUint32(16, true); index < count; index++) {
    if (command + 16 > slice.byteLength) refuse("load commands exceed the slice")
    if (le.getUint32(command, true) === 0x1d) {
      signatureOffset = le.getUint32(command + 8, true)
      signatureSize = le.getUint32(command + 12, true)
    }
    const size = le.getUint32(command + 4, true)
    if (size < 8) refuse("malformed load command")
    command += size
  }
  if (signatureOffset < 0) refuse("no code signature")
  if (signatureOffset + signatureSize > slice.byteLength) refuse("code signature exceeds the slice")
  const blobs = new Map<number, Uint8Array>()
  const superblob = slice.subarray(signatureOffset, signatureOffset + signatureSize)
  const be = new DataView(superblob.buffer, superblob.byteOffset, superblob.byteLength)
  if (be.getUint32(0, false) !== 0xfade0cc0) refuse("no embedded signature superblob")
  for (let index = 0, count = be.getUint32(8, false); index < count; index++) {
    const type = be.getUint32(12 + index * 8, false)
    const offset = be.getUint32(16 + index * 8, false)
    if (offset + 8 > superblob.byteLength) refuse("signature blob exceeds the superblob")
    const length = be.getUint32(offset + 4, false)
    if (offset + length > superblob.byteLength || blobs.has(type)) refuse("malformed signature blob index")
    if (type !== CODE_DIRECTORY && type !== CMS && !SPECIAL_BLOBS.has(type))
      refuse(`unsupported signature blob type 0x${type.toString(16)} (alternate CodeDirectories are refused)`)
    blobs.set(type, superblob.subarray(offset, offset + length))
  }
  const cd = blobs.get(CODE_DIRECTORY) ?? refuse("no CodeDirectory")
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  if (cd.byteLength < 52 || cdv.getUint32(0, false) !== 0xfade0c02) refuse("malformed CodeDirectory")
  const version = cdv.getUint32(8, false)
  const hashOffset = cdv.getUint32(16, false)
  const special = cdv.getUint32(24, false)
  const slots = cdv.getUint32(28, false)
  const codeLimit = cdv.getUint32(32, false)
  const pageShift = cd[39] ?? 0
  if (cd[36] !== 32 || cd[37] !== 2) refuse("CodeDirectory is not sha256")
  if (version >= 0x20300 && cdv.getBigUint64(56, false) !== 0n) refuse("64-bit code limit is not supported")
  if (codeLimit !== signatureOffset) refuse("CodeDirectory does not cover every byte before the signature")
  if (pageShift < 9 || pageShift > 16 || slots !== Math.ceil(codeLimit / 2 ** pageShift)) refuse("bad page layout")
  if (hashOffset - special * 32 < 0 || hashOffset + slots * 32 > cd.byteLength)
    refuse("hash slots exceed the CodeDirectory")
  for (let page = 0; page < slots; page++) {
    const from = page * 2 ** pageShift
    const actual = sha256(slice.subarray(from, Math.min(from + 2 ** pageShift, codeLimit)))
    if (!equal(actual, cd.subarray(hashOffset + page * 32, hashOffset + page * 32 + 32)))
      refuse(`code page ${page} does not match its hash`)
  }
  for (let slot = 1; slot <= Math.max(special, 7); slot++) {
    const recorded =
      slot <= special ? cd.subarray(hashOffset - slot * 32, hashOffset - slot * 32 + 32) : new Uint8Array(32)
    const blob = blobs.get(slot)
    const expected = blob ? sha256(blob) : new Uint8Array(32)
    if (!equal(recorded, expected))
      refuse(`special slot ${slot} (${SPECIAL_BLOBS.get(slot) ?? "unsupported"}) does not match`)
  }
  const teamOffset = version >= 0x20200 ? cdv.getUint32(48, false) : 0
  const cms = blobs.get(CMS)
  const requirements = blobs.get(2)
  return {
    start: range.start,
    hashedEnd: range.start + codeLimit,
    identifier: cString(cd, cdv.getUint32(20, false)),
    team: teamOffset === 0 ? "" : cString(cd, teamOffset),
    runtime: (cdv.getUint32(12, false) & 0x10000) !== 0,
    cpuType: le.getUint32(4, true),
    cpuSubtype: le.getUint32(8, true) & 0x00ffffff,
    requirementsSha256: requirements ? hex(sha256(requirements)) : "",
    entitlements: blobs.has(5) || blobs.has(7),
    cdhash: hex(sha256(cd).subarray(0, 20)),
    codeDirectory: cd,
    cms: cms && cms.byteLength > 8 ? cms.subarray(8) : null,
  }
}

/** Every slice's verified signature layout; refuses unsigned files and any byte the CodeDirectory does not cover. */
export function readSignatures(bytes: Uint8Array): SliceSignature[] {
  return sliceRanges(bytes).map((range) => readSlice(bytes, range))
}

/** The operator build stamp section `__OMO_META,__build` of a thin 64-bit Mach-O, with its file range. */
export function readBuildMeta(bytes: Uint8Array): { text: string; end: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 32 || view.getUint32(0, true) !== 0xfeedfacf) return null
  const name = (offset: number) => new TextDecoder().decode(bytes.subarray(offset, offset + 16)).replace(/\0.*$/s, "")
  let command = 32
  for (let index = 0, count = view.getUint32(16, true); index < count; index++) {
    if (command + 8 > bytes.byteLength) return null
    const size = view.getUint32(command + 4, true)
    if (view.getUint32(command, true) === 0x19 && name(command + 8) === "__OMO_META") {
      for (let section = 0, sections = view.getUint32(command + 64, true); section < sections; section++) {
        const at = command + 72 + section * 80
        if (name(at) !== "__build" || name(at + 16) !== "__OMO_META") continue
        const length = Number(view.getBigUint64(at + 40, true))
        const offset = view.getUint32(at + 48, true)
        if (offset + length > bytes.byteLength) return null
        return { text: new TextDecoder().decode(bytes.subarray(offset, offset + length)), end: offset + length }
      }
    }
    if (size === 0) return null
    command += size
  }
  return null
}
