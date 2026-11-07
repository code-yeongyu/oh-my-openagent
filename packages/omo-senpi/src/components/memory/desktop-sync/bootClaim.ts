// The engine's boot-time memory-sync claim (#11997). A `--mode rpc --multi-session --listen` host (what
// `omo host ensure` starts) loads extensions only when a session opens or the host is warmed, while the desktop
// opens nothing until it has answered the bootstrap frame. An entry therefore starts the process's one selection
// here, before senpi's CLI is imported; the memory component's registration later reads the same memoized
// selection (hostSelection.ts) and only provides each session Worker its port.
//
// ENTRY CONTRACT. Every entry that starts an engine in its own process (omo-native's compile-entry.ts and
// bin/lib/engine-boot.js, the desktop's desktop-omo-entry.ts) runs these steps right before it imports senpi's CLI.
// Steps 1, 2 and 4 use the RUNNING ENGINE'S OWN senpi modules (the copy whose dist/cli.js it imports next, never a
// second copy under omo's node_modules), each resolved the way that entry resolves senpi; paths are relative to that
// senpi's dist/:
//   gate: import the device-account sidecar (`extensions/omo-device-account.js` in the plugin dir; importing it
//      captures nothing) and call `claimsMemorySyncAtBoot(engineArgs, process.env)` with the args senpi's CLI will
//      see. It is pure, so it may run before or after steps 1-2, but always before step 4. The entry may add its own
//      launcher checks (omo-native excludes its one-shot engine commands). If it answers false, skip steps 3-4.
//   1. import `valid-cwd.js` (the cwd guard);
//   2. import `private-fd-startup-release.js` (releases a coordinated start's filler pipes while the
//      private-descriptor table is still in the environment);
//   3. import `private-fds.js` (`@code-yeongyu/senpi/private-fds`), which captures the table;
//   4. call the sidecar's `claimMemorySyncAtBoot(takeInheritedPrivateChannel)` with step 3's export;
//   then import `cli.js`.
// Steps 1-3 each run once per process, so senpi's CLI reuses them. The gate must precede step 3: the capture removes
// SENPI_PRIVATE_FDS from the environment the gate reads. The sidecar bundles its own copy of senpi's private-fds module,
// which is why the take is a parameter. A failure anywhere leaves the claim to the memory component's registration,
// which still selects once when the first session opens.

import type { Duplex } from "node:stream"
import { attachDesktopSyncChannel } from "./channel"
import { claimDesktopSync } from "./desktopClaim"
import { selectHostMemorySyncSource } from "./hostSelection"
import { launchCarriedPrivateTable } from "./launchClassification"
import { serveWorkerPort } from "./workerPort"

/** The running engine's private-channel take (senpi's `takeInheritedPrivateChannel`). */
export type TakeInheritedPrivateChannel = (name: string) => Duplex | undefined

/**
 * Starts this process's one memory-sync selection over the running engine's own `take` (required); a failed claim settles unavailable
 * and never throws. See the entry contract above for when and how an entry calls it.
 */
export function claimMemorySyncAtBoot(take: TakeInheritedPrivateChannel): void {
  selectHostMemorySyncSource({
    declared: launchCarriedPrivateTable,
    sidecar: async () => ({
      claimInheritedDesktopSync: () => claimDesktopSync({ take, attach: attachDesktopSyncChannel }),
      serveWorkerPort,
    }),
  })
}
