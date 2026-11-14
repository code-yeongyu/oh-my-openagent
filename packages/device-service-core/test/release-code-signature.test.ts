import { describe, expect, test } from "bun:test"
import { codeSignaturePasses, DEVICE_SERVICE_SIGNING_IDENTITY } from "../src/release/release-signature.ts"

// A published release binary to check against, e.g. the darwin-arm64 asset of the pinned version from
// https://get.omo.dev/stable/device-service/<version>/ (verified against its signed checksums.txt first).
const RELEASE_BINARY = process.env.OMO_DEVICE_SERVICE_RELEASE_BINARY

describe("device service code signature", () => {
  // An empty identifier makes every macOS install fail as "failed verification" (#13229): it shipped that way for
  // weeks because nothing failed the build, so this is that check.
  test("the signing identity names the published identifier and team", () => {
    expect(DEVICE_SERVICE_SIGNING_IDENTITY.identifier).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/)
    expect(DEVICE_SERVICE_SIGNING_IDENTITY.team).toMatch(/^[A-Z0-9]{10}$/)
  })

  test.skipIf(process.platform !== "darwin")("a binary Apple signed, not our team, is refused", () => {
    expect(codeSignaturePasses("/bin/ls")).toBe(false)
  })

  test.skipIf(process.platform !== "darwin" || RELEASE_BINARY === undefined)(
    "a published, notarized release binary passes",
    () => {
      expect(codeSignaturePasses(RELEASE_BINARY ?? "")).toBe(true)
    },
  )
})
