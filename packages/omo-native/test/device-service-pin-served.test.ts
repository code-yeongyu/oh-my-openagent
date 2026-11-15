import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { DEVICE_SERVICE_VERSION } from "../../device-service-core/src/index.ts"
import { parseManifest } from "../../device-service-core/src/release/release-assets.ts"
import { DEVICE_SERVICE_ORIGIN } from "../../device-service-core/src/release/acquire.ts"

// Release contract: every interactive start-up downloads the pinned device service from DEVICE_SERVICE_ORIGIN, so an
// omo release must not ship a pin that origin does not serve on both channels. This test reads the live origin, so it
// is the release gate, not a CI test: it runs only with OMO_RELEASE_GATE=1, which no required CI shard sets.
// Release-gate command: OMO_RELEASE_GATE=1 bun test packages/omo-native/test/device-service-pin-served.test.ts
// With the gate set, a timeout, a fetch error or a 404 is a failure, never a skip.
const RELEASE_GATE = process.env.OMO_RELEASE_GATE === "1"
const SKIP_REASON = "skipped: release gate only, set OMO_RELEASE_GATE=1 to read the live origin"

// sha256 of the published device-service-v0.1.27 checksums.txt; the committed fixture in
// fixtures/device-service-0.1.27/ is the same file (remote-bootstrap-published-release.test.ts).
const PINNED_CHECKSUMS_SHA256 = "4146820d8c021bb174e46272fbf5a4f2ec81441b6e29bc999dea43d4aa63bd7e"
const FETCH_TIMEOUT_MS = 30_000

const download = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

describe("the pinned device service is downloadable from the release origin", () => {
  for (const channel of ["stable", "beta"] as const) {
    test.skipIf(!RELEASE_GATE)(
      RELEASE_GATE ? `${channel} serves the pinned latest.json and checksums.txt` : `${channel}: ${SKIP_REASON}`,
      async () => {
        // given the pinned release's directory on this channel
        const base = `${DEVICE_SERVICE_ORIGIN}/${channel}/device-service/${DEVICE_SERVICE_VERSION}/`

        // when its signed entry files are downloaded
        const [latest, checksums] = await Promise.all([
          download(`${base}latest.json`),
          download(`${base}checksums.txt`),
        ])

        // then latest.json names exactly the pin and checksums.txt is the pinned file
        expect(parseManifest(latest)?.version).toBe(DEVICE_SERVICE_VERSION)
        expect(createHash("sha256").update(checksums).digest("hex")).toBe(PINNED_CHECKSUMS_SHA256)
      },
      FETCH_TIMEOUT_MS * 2,
    )
  }
})
