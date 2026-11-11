// The npm launcher's engine entry for a launch that claims memory sync at boot (#11997, memory-sync-boot.js):
// argv is `<runtime> engine-boot.js <senpi cli> ...engine args`. It drops its own path so the engine sees the argv
// it always has, starts the claim, then runs senpi's CLI in this process. It follows the entry contract in omo-senpi
// desktop-sync/bootClaim.ts with the engine's own modules: cwd guard, filler release, gate, then the capture and claim.
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { launchClaimsMemorySyncAtBoot } from "./memory-sync-boot.js"
import { packageRoot } from "./package-paths.js"

const cliPath = process.argv[2]
process.argv.splice(1, 1)
// The engine ships its CLI pre-bundled under dist/bundle and every module unbundled under dist.
const distDir = basename(dirname(cliPath)) === "bundle" ? dirname(dirname(cliPath)) : dirname(cliPath)
const moduleUrl = (path) => pathToFileURL(path).href
try {
  await import(moduleUrl(join(distDir, "valid-cwd.js")))
  await import(moduleUrl(join(distDir, "private-fd-startup-release.js")))
  const sidecar = await import(moduleUrl(join(packageRoot, "plugin", "extensions", "omo-device-account.js")))
  if (launchClaimsMemorySyncAtBoot(process.argv.slice(2), process.env, sidecar.claimsMemorySyncAtBoot)) {
    const { takeInheritedPrivateChannel } = await import(moduleUrl(join(distDir, "private-fds.js")))
    sidecar.claimMemorySyncAtBoot(takeInheritedPrivateChannel)
  }
} catch (error) {
  // The memory component's registration still selects once when the first session opens.
  process.stderr.write(
    `omo: memory sync could not start at boot: ${error instanceof Error ? error.message : String(error)}\n`,
  )
}
await import(moduleUrl(cliPath))
