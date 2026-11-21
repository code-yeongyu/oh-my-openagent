#!/usr/bin/env bun
/**
 * Release gate for the pinned device service (refs #13062): before an omo release publishes, check
 * that get.omo.dev serves the version pinned in packages/device-service-core/src/pin.ts with a valid
 * signature. Fails the release when the pin names a version the origin does not serve, when either
 * signed index file cannot be fetched, or when the signature does not verify.
 *
 * Usage: bun run script/verify-device-service-pin.ts [--version <v>] [--origin <url>] [--channel <name>]
 * Defaults come from the pinned version, https://get.omo.dev, and the stable channel. The flags exist
 * only so the gate can be exercised against a fixture origin without touching the pin.
 */
import { DEVICE_SERVICE_VERSION } from "../packages/device-service-core/src/pin.ts"
import { DEVICE_SERVICE_RELEASE_KEYS } from "../packages/device-service-core/src/release/release-signature.ts"
import { verifyDeviceServicePin } from "../packages/device-service-core/src/release/verify-pin.ts"

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined
}

const version = flag("--version") ?? DEVICE_SERVICE_VERSION
const origin = flag("--origin")
const channel = flag("--channel")

const result = await verifyDeviceServicePin({
  version,
  ...(origin !== undefined ? { origin } : {}),
  ...(channel !== undefined ? { channel } : {}),
  releaseKeys: DEVICE_SERVICE_RELEASE_KEYS,
})

if (!result.ok) {
  console.error(`::error::${result.message}`)
  process.exit(1)
}
console.log(
  `verify-device-service-pin: device service ${result.version} is served and its checksums.txt signature verifies.`,
)
