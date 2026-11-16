/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { X509Certificate } from "node:crypto"
import { type TrustAnchors, verifyDeveloperIdSigner } from "../.github/workflows/operator-darwin-cms.ts"
import { certificateNames, fixtureFile, issue, signedData } from "./fixtures/operator-darwin-signing"

/**
 * Release security contract (#13921, review M1): the team of an operator-built darwin artifact is the team of the
 * certificate that ACTUALLY signed its CodeDirectory, and that certificate must chain to Apple's Developer ID CA
 * (pinned) under the Apple Root CA (pinned). The GREEN control is a real CodeDirectory and CMS taken from a
 * notarized 5.1.73 keychain helper. Each RED row forges one property with keys generated here.
 */

const realCodeDirectory = fixtureFile("keychain-helper-slice0.codedirectory")
const realCms = fixtureFile("keychain-helper-slice0.cms")
const realLeaf = fixtureFile("developer-id-leaf.cer")
const realWwdr = fixtureFile("apple-wwdr-g3.cer")
const refusal = (run: () => unknown) => {
  try {
    run()
    return "ACCEPTED"
  } catch (error) {
    return `REFUSED: ${(error as Error).message}`
  }
}
const OU = "2.5.4.11"
const CN = "2.5.4.3"

describe("operator darwin CMS signer", () => {
  test("accepts the real Developer ID signature and reads the team from the signing certificate", () => {
    expect(verifyDeveloperIdSigner(realCodeDirectory, realCms)).toEqual({ team: "523JNR86LZ" })
  })

  test("M1 probe (a): a foreign-team signer with the real team's certificate pasted into the list is refused", () => {
    const g2 = certificateNames(realLeaf).issuer
    const foreign = issue({
      subject: [
        [CN, "Developer ID Application: Attacker (ATTACKER99)"],
        [OU, "ATTACKER99"],
      ],
      issuer: g2,
      serial: 7,
      developerIdApplication: true,
    })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: foreign.key,
      signer: foreign.certificate,
      certificates: [realLeaf, foreign.certificate],
    })
    const outcome = refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))
    console.log(`M1 probe (a) @ head: ${outcome}`)
    expect(outcome).toBe("REFUSED: signing certificate is not issued by Apple's Developer ID Certification Authority")
  })

  test("M1 probe (a'): a foreign key naming the real team certificate as its signer is refused", () => {
    const foreign = issue({ subject: [[CN, "Attacker"]], serial: 8 })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: foreign.key,
      signer: realLeaf,
      certificates: [realLeaf],
    })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: CMS signature does not verify with the signing certificate",
    )
  })

  test("(b) a valid signature over a different CodeDirectory is refused", () => {
    const other = realCodeDirectory.slice()
    other[other.byteLength - 1] = (other[other.byteLength - 1] ?? 0) ^ 1
    expect(refusal(() => verifyDeveloperIdSigner(other, realCms))).toBe(
      "REFUSED: the CMS signature covers a different CodeDirectory",
    )
  })

  test("(c) a chain to a non-Developer-ID Apple CA (WWDR G3, under the real Apple root) is refused", () => {
    const leaf = issue({
      subject: [
        [CN, "Developer ID Application: Yeongyu Kim (523JNR86LZ)"],
        [OU, "523JNR86LZ"],
      ],
      issuer: certificateNames(realWwdr).subject,
      serial: 9,
      developerIdApplication: true,
    })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: leaf.key,
      signer: leaf.certificate,
      certificates: [leaf.certificate, realWwdr],
    })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: signing certificate is not issued by Apple's Developer ID Certification Authority",
    )
  })

  test("a look-alike Developer ID CA and Apple root (same names, other keys) is refused", () => {
    const fakeRoot = issue({ subject: [[CN, "Apple Root CA"]], serial: 1 })
    const fakeCa = issue({
      subject: [
        [CN, "Developer ID Certification Authority"],
        [OU, "G2"],
      ],
      issuer: certificateNames(fakeRoot.certificate).subject,
      issuerKey: fakeRoot.key,
      serial: 2,
    })
    const leaf = issue({
      subject: [
        [CN, "Developer ID Application: Yeongyu Kim (523JNR86LZ)"],
        [OU, "523JNR86LZ"],
      ],
      issuer: certificateNames(realLeaf).issuer,
      issuerKey: fakeCa.key,
      serial: 3,
      developerIdApplication: true,
    })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: leaf.key,
      signer: leaf.certificate,
      certificates: [leaf.certificate, fakeCa.certificate, fakeRoot.certificate],
    })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: signing certificate is not issued by Apple's Developer ID Certification Authority",
    )
  })

  test("an ad-hoc or unsigned slice (no CMS) is refused", () => {
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, null))).toBe(
      "REFUSED: no Developer ID signature (unsigned or ad-hoc)",
    )
  })

  test("two signers are refused", () => {
    const foreign = issue({ subject: [[CN, "Attacker"]], serial: 10 })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: foreign.key,
      signer: foreign.certificate,
      certificates: [foreign.certificate],
      signerInfos: 2,
    })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: CMS has 2 signers; exactly one is required",
    )
  })

  test("a signer certificate missing from the CMS list is refused", () => {
    const foreign = issue({ subject: [[CN, "Attacker"]], serial: 11 })
    const cms = signedData({
      signedOver: realCodeDirectory,
      key: foreign.key,
      signer: foreign.certificate,
      certificates: [realLeaf],
    })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: the signing certificate is not exactly one certificate in the CMS",
    )
  })

  describe("with a generated root and Developer ID CA (test-only trust anchors)", () => {
    const root = issue({ subject: [[CN, "Test Root CA"]], serial: 20 })
    const ca = issue({
      subject: [[CN, "Test Developer ID CA"]],
      issuer: certificateNames(root.certificate).subject,
      issuerKey: root.key,
      serial: 21,
    })
    const caName = certificateNames(ca.certificate).subject
    const anchors: TrustAnchors = {
      root: new X509Certificate(root.certificate),
      developerIdCa: new X509Certificate(ca.certificate),
    }
    const ours = issue({
      subject: [
        [CN, "Developer ID Application: Ours (523JNR86LZ)"],
        [OU, "523JNR86LZ"],
      ],
      issuer: caName,
      issuerKey: ca.key,
      serial: 22,
      developerIdApplication: true,
    })
    const foreign = issue({
      subject: [
        [CN, "Developer ID Application: Attacker (ATTACKER99)"],
        [OU, "ATTACKER99"],
      ],
      issuer: caName,
      issuerKey: ca.key,
      serial: 23,
      developerIdApplication: true,
    })

    test("control: our CA-valid leaf signing is accepted with our team", () => {
      const cms = signedData({
        signedOver: realCodeDirectory,
        key: ours.key,
        signer: ours.certificate,
        certificates: [ours.certificate],
      })
      expect(verifyDeveloperIdSigner(realCodeDirectory, cms, anchors)).toEqual({ team: "523JNR86LZ" })
    })

    test("review NIT-1: a CA-VALID foreign signer with our leaf PREPENDED to the list reads the foreign team", () => {
      const cms = signedData({
        signedOver: realCodeDirectory,
        key: foreign.key,
        signer: foreign.certificate,
        certificates: [ours.certificate, foreign.certificate],
      })
      // The team comes from the certificate that signed, never from the first one in the list; the verifier then
      // refuses any team other than 523JNR86LZ (publish-operator-darwin-verify.test.ts, "signed by team").
      expect(verifyDeveloperIdSigner(realCodeDirectory, cms, anchors)).toEqual({ team: "ATTACKER99" })
    })
  })

  test("#13964 LOW-1: a signing certificate OpenSSL cannot parse is a typed refusal, not a thrown OpenSSL error", () => {
    // Same issuer and serial as the real leaf, so it is selected as the signer; its public-key BIT STRING tag is
    // corrupted, which makes X509Certificate throw (measured: OPENSSL NO_START_LINE).
    const broken = realLeaf.slice()
    const rsa = Buffer.from(broken).indexOf(
      Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
    )
    broken[rsa + 13] = 0x04
    const foreign = issue({ subject: [[CN, "Attacker"]], serial: 12 })
    const cms = signedData({ signedOver: realCodeDirectory, key: foreign.key, signer: broken, certificates: [broken] })
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, cms))).toBe(
      "REFUSED: the signing certificate is not a valid X.509 certificate",
    )
  })

  test("#13964 L7: 32 nested indefinite-length levels are parsed, even with an element inside; 33 are refused", () => {
    const nested = (levels: number, inner: number[] = []) =>
      Uint8Array.from([
        ...Array.from({ length: levels }, () => [0x30, 0x80]).flat(),
        ...inner,
        ...new Array(levels * 2).fill(0),
      ])
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, nested(32)))).not.toContain("DER nesting exceeds")
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, nested(32, [0x05, 0x00])))).not.toContain(
      "DER nesting exceeds",
    )
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, nested(33)))).toBe(
      "REFUSED: DER nesting exceeds 32 indefinite-length levels",
    )
  })

  test("review NIT-2: 200k nested indefinite-length elements are a typed refusal, not a stack overflow", () => {
    const bomb = new Uint8Array(400_000)
    for (let index = 0; index < bomb.length; index += 2) bomb.set([0x30, 0x80], index)
    expect(refusal(() => verifyDeveloperIdSigner(realCodeDirectory, bomb))).toBe(
      "REFUSED: DER nesting exceeds 32 indefinite-length levels",
    )
  })
})
