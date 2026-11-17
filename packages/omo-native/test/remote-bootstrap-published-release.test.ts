import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEVICE_SERVICE_VERSION } from "../../device-service-core/src/index.ts"
import { parseChecksums, parseManifest } from "../../device-service-core/src/release/release-assets.ts"
import {
  DEVICE_SERVICE_RELEASE_KEYS,
  releaseKeySetBytes,
  verifyReleaseSignature,
} from "../../device-service-core/src/release/release-signature.ts"
import { compareVersions } from "../../device-service-core/src/release/version.ts"
import packageJson from "../package.json" with { type: "json" }
import { deviceServiceBootstrapSetup } from "../remote-bootstrap"

// The signed entry files of the published device-service-v0.1.40 release (omo-relay-daemon), downloaded once from the
// GitHub release and committed byte for byte. The binaries (90-116 MB each) are not fixtures; their digests are.
const FIXTURE_DIR = join(import.meta.dir, "fixtures", "device-service-0.1.40")
const PUBLISHED_CHECKSUMS_SHA256 = "ba55767cf53f51e988e2dd0dec5a33dec4d92588f69d8f7276cea4ace156af8d"
const PUBLISHED_BINARY_SHA256 = {
  "omo-device-service-darwin-arm64": "5b5970aa36c206d188972478eb49d0c685f48f21d9b70967472f8681a5b99a5b",
  "omo-device-service-darwin-x64": "f8234268468c126bd0623af08d117b09d67912b2c0b05a53688369d467f7765d",
  "omo-device-service-linux-x64": "52e9ff4398448aaa8a4d2f5412506fc302a154dfdcba29b47d6879724cc6e26e",
  "omo-device-service-linux-arm64": "cc9d410941329f90a06603346c5ac0964fbbc8b630a68f097c77878c8dfbbdc5",
}
const SIGNED_ENTRY_FILES = ["checksums.txt", "checksums.txt.sig", "latest.json"] as const

const published = (name: (typeof SIGNED_ENTRY_FILES)[number]): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURE_DIR, name)))
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const dirs: string[] = []
const servers: { stop: (force?: boolean) => unknown }[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("the pinned device service release is the published 0.1.40", () => {
  test("its published checksums.txt verifies under this build's compiled-in release key and names this pin", async () => {
    // given the published release's signed entry files
    const checksums = published("checksums.txt")
    const latest = published("latest.json")

    // when they are checked with this build's own key set and parsers
    const keys = releaseKeySetBytes(DEVICE_SERVICE_RELEASE_KEYS)
    const verdict =
      keys === undefined ? undefined : await verifyReleaseSignature(keys, published("checksums.txt.sig"), checksums)
    const digests = parseChecksums(checksums)
    const manifest = parseManifest(latest)

    // then the signature holds, the checksums cover latest.json and the published binaries, and latest.json names the pin
    expect(sha256(checksums)).toBe(PUBLISHED_CHECKSUMS_SHA256)
    expect(verdict).toEqual({ ok: true })
    expect(digests?.get("latest.json")).toBe(sha256(latest))
    for (const [name, digest] of Object.entries(PUBLISHED_BINARY_SHA256)) expect(digests?.get(name)).toBe(digest)
    expect(manifest).toEqual({ version: DEVICE_SERVICE_VERSION, min_engine_version: "5.1.62" })
    expect(
      compareVersions(manifest?.min_engine_version ?? "", packageJson.dependencies["@code-yeongyu/senpi"]),
    ).toBeLessThanOrEqual(0)
  })

  test("the start-up install fetches the pinned release and passes its signature check before asking for the binary", async () => {
    // given a local origin serving the published 0.1.40 entry files, and no binary
    const requested: string[] = []
    const prefix = "/stable/device-service/0.1.40/"
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        requested.push(path)
        const name = SIGNED_ENTRY_FILES.find((file) => path === `${prefix}${file}`)
        return name === undefined ? new Response("not found", { status: 404 }) : new Response(published(name))
      },
    })
    servers.push(server)
    const stateDir = mkdtempSync(join(tmpdir(), "pin-0140-"))
    chmodSync(stateDir, 0o700)
    dirs.push(stateDir)
    const runs: (readonly string[])[] = []
    const setup = deviceServiceBootstrapSetup({
      stateDir,
      binaryPath: "/opt/omo/bin/omo",
      agentDir: "/home/user/.omo/agent",
      platform: "linux",
      arch: "x64",
      release: {
        origin: server.url.origin,
        run: async (argv) => {
          runs.push(argv)
          return { exitCode: 0, output: "" }
        },
      },
    })

    // when the bootstrap's install runs with this build's compiled-in release key
    const outcome = await setup.install()

    // then it asked for the binary and latest.json, which acquire requests only after checksums.txt.sig verified and
    // checksums.txt named both; the binary is not served here, so it stops there, writing and running nothing
    expect(requested.toSorted()).toEqual(
      ["checksums.txt", "checksums.txt.sig", "latest.json", "omo-device-service-linux-x64"].map(
        (file) => `${prefix}${file}`,
      ),
    )
    expect(setup.pinVersion).toBe("0.1.40")
    expect(outcome).toEqual({
      ok: false,
      state: "service_degraded",
      action: "Could not download the OmO device service. Check the connection and try again.",
    })
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })
})
