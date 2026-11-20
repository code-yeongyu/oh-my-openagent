// Proves who signed a CodeDirectory (#13921). It does not pick a certificate from the signer-supplied list.
// - the CMS must carry exactly one SignerInfo, identified by issuer and serial;
// - the leaf it names must be in the list, and its RSA signature over the signed attributes must verify;
// - the signed messageDigest must equal the sha256 of the CodeDirectory computed here;
// - the leaf must be a Developer ID Application certificate issued by the PINNED Developer ID CA (G2), which is
//   itself verified against the PINNED Apple Root CA;
// - the team is read from that leaf's subject OU.
// Intermediates in the CMS list are never trusted.
import { createHash, verify as verifySignature, X509Certificate } from "node:crypto"
import {
  APPLE_ROOT_CA_DER,
  APPLE_ROOT_CA_SHA256,
  DEVELOPER_ID_G2_CA_DER,
  DEVELOPER_ID_G2_CA_SHA256,
} from "./operator-darwin-anchors.ts"
import { refuse } from "./operator-darwin-macho.ts"

// `end` is past the element; `stop` is where its content ends (before the end-of-contents octets of a BER
// indefinite-length element, which codesign uses for the outer CMS layers).
type Tlv = {
  readonly tag: number
  readonly start: number
  readonly body: number
  readonly stop: number
  readonly end: number
}

// Deeper nesting than any CMS needs is refused, so a crafted blob cannot exhaust the stack.
const MAX_INDEFINITE_DEPTH = 32

// `open` counts the indefinite-length elements already open around this one; only indefinite-length elements
// count, so 32 such levels parse whatever they contain and a 33rd is refused.
function tlv(bytes: Uint8Array, at: number, open = 0): Tlv {
  const tag = bytes[at] ?? refuse("truncated DER")
  let length = bytes[at + 1] ?? refuse("truncated DER")
  let body = at + 2
  if (length === 0x80) {
    if (open + 1 > MAX_INDEFINITE_DEPTH) refuse(`DER nesting exceeds ${MAX_INDEFINITE_DEPTH} indefinite-length levels`)
    if (!(tag & 0x20)) refuse("indefinite length on a primitive element")
    let cursor = body
    while (bytes[cursor] !== 0 || bytes[cursor + 1] !== 0) {
      if (cursor >= bytes.byteLength) refuse("unterminated indefinite-length element")
      cursor = tlv(bytes, cursor, open + 1).end
    }
    return { tag, start: at, body, stop: cursor, end: cursor + 2 }
  }
  if (length & 0x80) {
    const count = length & 0x7f
    if (count < 1 || count > 4) refuse("unsupported DER length")
    length = 0
    for (let index = 0; index < count; index++) length = length * 256 + (bytes[body++] ?? refuse("truncated DER"))
  }
  if (body + length > bytes.byteLength) refuse("DER element exceeds its container")
  return { tag, start: at, body, stop: body + length, end: body + length }
}

function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const items: Tlv[] = []
  for (let at = parent.body; at < parent.stop;) {
    const item = tlv(bytes, at)
    if (item.end > parent.stop) refuse("DER element exceeds its parent")
    items.push(item)
    at = item.end
  }
  return items
}

function oid(bytes: Uint8Array, node: Tlv | undefined): string {
  if (!node || node.tag !== 0x06) refuse("expected an OID")
  const raw = bytes.subarray(node.body, node.stop)
  const parts = [Math.floor((raw[0] ?? 0) / 40), (raw[0] ?? 0) % 40]
  let value = 0
  for (const byte of raw.subarray(1)) {
    value = value * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) (parts.push(value), (value = 0))
  }
  return parts.join(".")
}

const raw = (bytes: Uint8Array, node: Tlv) => Buffer.from(bytes.subarray(node.start, node.end))
const content = (bytes: Uint8Array, node: Tlv) => Buffer.from(bytes.subarray(node.body, node.stop))
const at = <T>(items: readonly T[], index: number, what: string): T => items[index] ?? refuse(`missing ${what}`)

const SIGNED_DATA = "1.2.840.113549.1.7.2"
const DATA = "1.2.840.113549.1.7.1"
const CONTENT_TYPE = "1.2.840.113549.1.9.3"
const MESSAGE_DIGEST = "1.2.840.113549.1.9.4"
const SHA256 = "2.16.840.1.101.3.4.2.1"
const RSA_SIGNATURES = new Set(["1.2.840.113549.1.1.1", "1.2.840.113549.1.1.11"])
const ORGANIZATIONAL_UNIT = "2.5.4.11"
const DEVELOPER_ID_APPLICATION = "1.2.840.113635.100.6.1.13"
const CODE_SIGNING_USAGE = "1.3.6.1.5.5.7.3.3"

function anchor(der: string, fingerprint: string): X509Certificate {
  const certificate = new X509Certificate(Buffer.from(der, "base64"))
  if (certificate.fingerprint256 !== fingerprint) refuse("pinned trust anchor does not match its fingerprint")
  return certificate
}
/** The CAs a signing certificate must chain to. Production uses Apple's; tests pass a generated pair. */
export type TrustAnchors = { readonly root: X509Certificate; readonly developerIdCa: X509Certificate }
const APPLE_ANCHORS: TrustAnchors = {
  root: anchor(APPLE_ROOT_CA_DER, APPLE_ROOT_CA_SHA256),
  developerIdCa: anchor(DEVELOPER_ID_G2_CA_DER, DEVELOPER_ID_G2_CA_SHA256),
}

/** The parts of an X.509 certificate this check reads: tbs issuer/serial/subject, extension OIDs. */
function certificateParts(bytes: Uint8Array, certificate: Tlv) {
  const tbs = children(bytes, at(children(bytes, certificate), 0, "tbsCertificate"))
  const offset = tbs[0]?.tag === 0xa0 ? 1 : 0
  const extensions = tbs.find((node) => node.tag === 0xa3)
  const extensionOids: string[] = []
  const valueOf = new Map<string, Tlv>()
  for (const extension of extensions ? children(bytes, at(children(bytes, extensions), 0, "extensions")) : []) {
    const fields = children(bytes, extension)
    extensionOids.push(oid(bytes, fields[0]))
    valueOf.set(oid(bytes, fields[0]), at(fields, fields.length - 1, "extension value"))
  }
  const subjectOus: string[] = []
  for (const rdn of children(bytes, at(tbs, offset + 4, "subject")))
    for (const attribute of children(bytes, rdn)) {
      const [type, value] = children(bytes, attribute)
      if (oid(bytes, type) === ORGANIZATIONAL_UNIT && value) subjectOus.push(content(bytes, value).toString("utf8"))
    }
  const usage = valueOf.get("2.5.29.37")
  const usages = usage ? children(bytes, tlv(bytes, usage.body)).map((node) => oid(bytes, node)) : []
  return {
    serial: raw(bytes, at(tbs, offset, "serial")),
    issuer: raw(bytes, at(tbs, offset + 2, "issuer")),
    subjectOus,
    extensionOids,
    usages,
  }
}

/** Verifies the signer of `codeDirectory` and returns the team of the Developer ID Application certificate. */
export function verifyDeveloperIdSigner(
  codeDirectory: Uint8Array,
  cms: Uint8Array | null,
  anchors: TrustAnchors = APPLE_ANCHORS,
): { team: string } {
  if (!anchors.developerIdCa.verify(anchors.root.publicKey)) refuse("Developer ID CA is not signed by the pinned root")
  if (cms === null) refuse("no Developer ID signature (unsigned or ad-hoc)")
  const info = children(cms, tlv(cms, 0))
  if (oid(cms, info[0]) !== SIGNED_DATA || info[1]?.tag !== 0xa0) refuse("CMS is not SignedData")
  const signed = children(cms, at(children(cms, info[1]), 0, "SignedData"))
  const encapsulated = children(cms, at(signed, 2, "encapContentInfo"))
  if (oid(cms, encapsulated[0]) !== DATA || encapsulated.length !== 1) refuse("CMS must be detached over data")
  const certificates = signed.find((node) => node.tag === 0xa0)
  const signerSet = signed.at(-1) ?? refuse("missing signerInfos")
  if (signerSet.tag !== 0x31) refuse("malformed signerInfos")
  const signerInfos = children(cms, signerSet)
  if (signerInfos.length !== 1) refuse(`CMS has ${signerInfos.length} signers; exactly one is required`)
  const signer = children(cms, at(signerInfos, 0, "signerInfo"))
  const sid = at(signer, 1, "signer identifier")
  if (sid.tag !== 0x30) refuse("signer must be identified by issuer and serial")
  const [sidIssuer, sidSerial] = children(cms, sid)
  if (
    !sidIssuer ||
    !sidSerial ||
    oid(cms, at(children(cms, at(signer, 2, "digestAlgorithm")), 0, "digest OID")) !== SHA256
  )
    refuse("signer must use sha256")
  const attributes = at(signer, 3, "signed attributes")
  if (attributes.tag !== 0xa0) refuse("CMS signer has no signed attributes")
  if (!RSA_SIGNATURES.has(oid(cms, at(children(cms, at(signer, 4, "signatureAlgorithm")), 0, "signature OID"))))
    refuse("unsupported signature algorithm")
  const signature = content(cms, at(signer, 5, "signature"))

  const matching = (certificates ? children(cms, certificates) : []).filter((node) => {
    const parts = certificateParts(cms, node)
    return parts.issuer.equals(raw(cms, sidIssuer)) && parts.serial.equals(raw(cms, sidSerial))
  })
  if (matching.length !== 1) refuse("the signing certificate is not exactly one certificate in the CMS")
  const leafNode = at(matching, 0, "signing certificate")
  let leaf: X509Certificate
  try {
    leaf = new X509Certificate(raw(cms, leafNode))
  } catch {
    return refuse("the signing certificate is not a valid X.509 certificate")
  }
  const parts = certificateParts(cms, leafNode)

  const values = new Map<string, Tlv[]>()
  for (const attribute of children(cms, attributes)) {
    const [type, set] = children(cms, attribute)
    if (!set) refuse("malformed signed attribute")
    values.set(oid(cms, type), children(cms, set))
  }
  if (oid(cms, values.get(CONTENT_TYPE)?.[0]) !== DATA) refuse("signed contentType is not data")
  const digest = values.get(MESSAGE_DIGEST)?.[0] ?? refuse("no signed messageDigest")
  if (!content(cms, digest).equals(createHash("sha256").update(codeDirectory).digest()))
    refuse("the CMS signature covers a different CodeDirectory")
  const signedAttributes = Buffer.from(cms.subarray(attributes.start, attributes.end))
  signedAttributes[0] = 0x31
  if (!verifySignature("sha256", signedAttributes, leaf.publicKey, signature))
    refuse("CMS signature does not verify with the signing certificate")

  if (!leaf.checkIssued(anchors.developerIdCa) || !leaf.verify(anchors.developerIdCa.publicKey))
    refuse("signing certificate is not issued by Apple's Developer ID Certification Authority")
  if (!parts.extensionOids.includes(DEVELOPER_ID_APPLICATION) || !parts.usages.includes(CODE_SIGNING_USAGE))
    refuse("signing certificate is not a Developer ID Application certificate")
  if (parts.subjectOus.length !== 1) refuse("signing certificate must name exactly one team")
  return { team: at(parts.subjectOus, 0, "team") }
}
