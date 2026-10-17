import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto"

// Certificates for the CA-trust tests, generated in memory at test time so no private key is ever
// committed (#10403). The DER is hand-built like service-auth's tls-test-certificate.ts.

function der(tag: number, ...parts: readonly Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const size = body.length
  const length = size < 0x80 ? [size] : size < 0x100 ? [0x81, size] : [0x82, size >> 8, size & 0xff]
  return Buffer.concat([Buffer.from([tag, ...length]), body])
}

const SEQUENCE = 0x30
const hex = (value: string) => Buffer.from(value, "hex")
const SHA256_WITH_RSA = hex("300d06092a864886f70d01010b0500")
const commonName = (name: string) => der(SEQUENCE, der(0x31, der(SEQUENCE, hex("0603550403"), der(0x0c, Buffer.from(name)))))
const extension = (oid: string, critical: boolean, value: Buffer) =>
  der(SEQUENCE, hex(oid), ...(critical ? [hex("0101ff")] : []), der(0x04, value))
const keyId = (key: KeyObject) => createHash("sha1").update(key.export({ format: "der", type: "spki" })).digest()

interface Party {
  readonly name: string
  readonly key: { readonly publicKey: KeyObject; readonly privateKey: KeyObject }
}

function certificate(subject: Party, issuer: Party, extensions: readonly Buffer[]): string {
  const serial = Buffer.concat([Buffer.from([0x01]), randomBytes(8)])
  const body = der(SEQUENCE,
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    SHA256_WITH_RSA,
    commonName(issuer.name),
    der(SEQUENCE, der(0x18, Buffer.from("20200101000000Z")), der(0x18, Buffer.from("21000101000000Z"))),
    commonName(subject.name),
    subject.key.publicKey.export({ format: "der", type: "spki" }),
    der(0xa3, der(SEQUENCE, ...extensions)),
  )
  const signed = der(SEQUENCE, body, SHA256_WITH_RSA, der(0x03, Buffer.from([0]), sign("sha256", body, issuer.key.privateKey)))
  return `-----BEGIN CERTIFICATE-----\n${signed.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`
}

export interface CaTrustMaterial {
  /** A private CA: CA:TRUE, keyCertSign. */
  readonly ca: string
  /** A server certificate for localhost and 127.0.0.1, issued by `ca`. */
  readonly leaf: string
  /** The server certificate's private key (PKCS#8 PEM). It exists only in memory. */
  readonly leafKey: string
  /** A self-signed CA:FALSE certificate. */
  readonly notCa: string
}

export function generateCaTrustMaterial(options: { readonly caIsCa?: boolean } = {}): CaTrustMaterial {
  const rsa = () => generateKeyPairSync("rsa", { modulusLength: 2048 })
  const ca: Party = { name: "omo test CA", key: rsa() }
  const leaf: Party = { name: "localhost", key: rsa() }
  const notCa: Party = { name: "omo test not-a-CA", key: rsa() }
  const caIsCa = options.caIsCa ?? true
  return {
    ca: certificate(ca, ca, [
      extension("0603551d13", true, caIsCa ? hex("30030101ff") : hex("3000")),
      extension("0603551d0f", true, hex("03020106")),
      extension("0603551d0e", false, der(0x04, keyId(ca.key.publicKey))),
    ]),
    leaf: certificate(leaf, ca, [
      extension("0603551d13", true, hex("3000")),
      extension("0603551d0f", true, hex("030205a0")),
      extension("0603551d25", false, der(SEQUENCE, hex("06082b06010505070301"))),
      extension("0603551d11", false, der(SEQUENCE, der(0x82, Buffer.from("localhost")), der(0x87, hex("7f000001")))),
      extension("0603551d23", false, der(SEQUENCE, der(0x80, keyId(ca.key.publicKey)))),
    ]),
    leafKey: leaf.key.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    notCa: certificate(notCa, notCa, [extension("0603551d13", true, hex("3000"))]),
  }
}
