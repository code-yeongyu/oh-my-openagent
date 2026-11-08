import { generateKeyPairSync, sign } from "node:crypto"

// Minimal self-signed X.509 fixture; the generated private key never leaves memory.
export function tlsTestCertificate() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  function der(tag: number, ...parts: readonly Buffer[]): Buffer {
    const body = Buffer.concat(parts)
    const size = body.length
    const length = size < 128 ? [size] : size < 256 ? [0x81, size] : [0x82, size >> 8, size & 255]
    return Buffer.concat([Buffer.from([tag, ...length]), body])
  }
  const algorithm = Buffer.from("300d06092a864886f70d01010b0500", "hex")
  const name = der(0x30, der(0x31, der(0x30, Buffer.from("0603550403", "hex"), der(0x0c, Buffer.from("localhost")))))
  const validity = der(0x30,
    der(0x18, Buffer.from("20200101000000Z")),
    der(0x18, Buffer.from("21000101000000Z")))
  const body = der(0x30, der(0x02, Buffer.from([1])), algorithm, name, validity, name,
    publicKey.export({ format: "der", type: "spki" }))
  const certificate = der(0x30, body, algorithm, der(0x03, Buffer.from([0]), sign("sha256", body, privateKey)))
  return {
    key: privateKey.export({ format: "pem", type: "pkcs8" }),
    cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----`,
  }
}
