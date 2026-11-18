// The compiled entry's boot-time memory-sync claim (#11997), run right before senpi's CLI is imported. It follows the
// entry contract in omo-senpi desktop-sync/bootClaim.ts with the engine modules the CLI imports (each runs once per
// process): cwd guard, filler release, the shared gate, then senpi's private-fds capture and the claim over its take.
// The specifiers are relative literals for the reasons compile-entry.ts gives for the CLI import: the exports map
// omits these modules, and Bun's bundler only traces literal import() arguments.
import { claimsMemorySyncAtBoot } from "../omo-senpi/src/components/memory/desktop-sync/bootGate"
import { launchClaimsMemorySyncAtBoot } from "./bin/lib/memory-sync-boot.js"

export async function claimMemorySyncAtBoot(args: string[]): Promise<void> {
  try {
    await import("../../node_modules/@code-yeongyu/senpi/dist/valid-cwd.js")
    await import("../../node_modules/@code-yeongyu/senpi/dist/private-fd-startup-release.js")
    if (!launchClaimsMemorySyncAtBoot(args, process.env, claimsMemorySyncAtBoot)) return
    const { takeInheritedPrivateChannel } = await import("../../node_modules/@code-yeongyu/senpi/dist/private-fds.js")
    const { claimMemorySyncAtBoot: claim } = await import("../omo-senpi/src/components/memory/desktop-sync/bootClaim")
    claim(takeInheritedPrivateChannel)
  } catch (error) {
    // The memory component's registration still selects once when the first session opens.
    process.stderr.write(
      `omo: memory sync could not start at boot: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
}
