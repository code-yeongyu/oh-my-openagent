/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { verifyDeveloperIdSigner } from "../.github/workflows/operator-darwin-cms.ts"
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
})
