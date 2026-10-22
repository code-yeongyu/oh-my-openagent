import { describe, expect, test } from "bun:test"
import { X509Certificate, createPrivateKey } from "node:crypto"

import { generateCaTrustMaterial } from "./ca-trust-certificates"

describe("generateCaTrustMaterial (#10403)", () => {
  const material = generateCaTrustMaterial()
  const ca = new X509Certificate(material.ca)
  const leaf = new X509Certificate(material.leaf)

  test("#given the generated CA #then it is a CA", () => {
    expect(ca.ca).toBe(true)
  })

  test("#given the generated leaf #then it chains to the CA and serves localhost and 127.0.0.1", () => {
    expect(leaf.ca).toBe(false)
    expect(leaf.checkIssued(ca)).toBe(true)
    expect(leaf.verify(ca.publicKey)).toBe(true)
    expect(leaf.checkHost("localhost")).toBe("localhost")
    expect(leaf.checkIP("127.0.0.1")).toBe("127.0.0.1")
  })

  test("#given the leaf key #then it belongs to the leaf certificate", () => {
    const key = createPrivateKey(material.leafKey)
    expect(leaf.checkPrivateKey(key)).toBe(true)
  })

  test("#given the not-CA certificate #then it is not a CA", () => {
    expect(new X509Certificate(material.notCa).ca).toBe(false)
  })

  test("#given two generations #then no material is reused", () => {
    expect(generateCaTrustMaterial().leafKey).not.toBe(material.leafKey)
  })
})
