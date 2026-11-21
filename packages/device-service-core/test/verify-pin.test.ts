import { describe, expect, test } from "bun:test"
import { verifyDeviceServicePin } from "../src/release/verify-pin.ts"
import {
  buildRelease,
  PIN_VERSION,
  RELEASE_ORIGIN,
  releaseKey,
  serveRelease,
} from "./release-fixture.ts"

const HOST = "linux-x64"

// Authoring gate (see .omo/rules/test-discipline.md):
// 1. Contract: the pre-publish gate passes only when the pinned device service release is served
//    with a valid signature, and blocks the release when the pin is unpublished or the signature
//    does not verify (the 5.1.61-5.1.68 regression: pins 0.1.0/0.1.3 shipped while the origin 404d).
// 2. Regression: a pin bump to an unserved version, or a future refactor that drops the signature
//    check, must fail the release instead of shipping the warning every user hits on start.
// 3. Existing coverage: acquire.test.ts owns the full download-and-install path; no existing test
//    calls verifyDeviceServicePin, so this file is the owner test for the gate's refusal contract.
// 4. Production seam: the gate is called by the real CLI script/verify-device-service-pin.ts,
//    run by publish.yml before npm publish; fetch is injected the same way acquire does.

describe("pre-publish device service pin gate", () => {
  test("served release with a valid signature passes", async () => {
    // given a served release signed by a known key
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const served = serveRelease(release)

    // when the gate checks the pinned version against the mocked origin
    const result = await verifyDeviceServicePin({
      version: PIN_VERSION,
      origin: RELEASE_ORIGIN,
      releaseKeys: [key.publicHex],
      fetch: served.fetch,
    })

    // then it passes and names the version
    expect(result).toEqual({ ok: true, version: PIN_VERSION })
    expect(served.requested).toEqual([
      `${RELEASE_ORIGIN}/stable/device-service/${PIN_VERSION}/checksums.txt`,
      `${RELEASE_ORIGIN}/stable/device-service/${PIN_VERSION}/checksums.txt.sig`,
    ])
  })

  test("both signed index files 404ing fails as not_published and names the version", async () => {
    // given an origin serving nothing for the pinned version
    const key = releaseKey()
    const served = serveRelease(new Map())

    // when the gate checks the pinned version
    const result = await verifyDeviceServicePin({
      version: PIN_VERSION,
      origin: RELEASE_ORIGIN,
      releaseKeys: [key.publicHex],
      fetch: served.fetch,
    })

    // then it blocks the release and names the unpublished version
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal).toBe("not_published")
      expect(result.message).toContain(PIN_VERSION)
    }
  })

  test("a signature over other bytes fails as signature and names the version", async () => {
    // given a served release whose signature covers bytes other than checksums.txt
    const key = releaseKey()
    const release = buildRelease({
      key,
      host: HOST,
      signedBytes: () => new TextEncoder().encode("not the checksums"),
    })
    const served = serveRelease(release)

    // when the gate checks the pinned version
    const result = await verifyDeviceServicePin({
      version: PIN_VERSION,
      origin: RELEASE_ORIGIN,
      releaseKeys: [key.publicHex],
      fetch: served.fetch,
    })

    // then it blocks the release and names the version
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal).toBe("signature")
      expect(result.message).toContain(PIN_VERSION)
    }
  })

  test("checksums.txt 404ing while the signature is served fails as download_failed", async () => {
    // given an origin serving the signature but no checksums.txt
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    release.delete("checksums.txt")
    const served = serveRelease(release)

    // when the gate checks the pinned version
    const result = await verifyDeviceServicePin({
      version: PIN_VERSION,
      origin: RELEASE_ORIGIN,
      releaseKeys: [key.publicHex],
      fetch: served.fetch,
    })

    // then it blocks the release as a broken release, not as unpublished
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal).toBe("download_failed")
      expect(result.message).toContain(PIN_VERSION)
    }
  })
})
