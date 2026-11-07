// The engine's boot-time memory-sync claim (#11997). A `--mode rpc --multi-session --listen` host (what
// `omo host ensure` starts) loads extensions only when a session opens or the host is warmed, while the desktop
// opens nothing until it has answered the bootstrap frame. omo's entries therefore start the process's one
// selection here, before senpi's CLI is imported; the memory component's registration later reads the same
// memoized selection (hostSelection.ts) and only provides each session Worker its port.
//
// Importing this module captures senpi's private-descriptor table (desktopClaim.ts -> `#senpi-private-fds`), so an
// entry imports it only after senpi's own cwd guard and startup filler release, in the order senpi's CLI uses.

import { claimInheritedDesktopSync } from "./desktopClaim"
import { selectHostMemorySyncSource } from "./hostSelection"
import { launchCarriedPrivateTable } from "./launchClassification"
import { serveWorkerPort } from "./workerPort"

/** Starts this process's one memory-sync selection; a failed claim settles unavailable and never throws. */
export function claimMemorySyncAtBoot(): void {
  selectHostMemorySyncSource({
    declared: launchCarriedPrivateTable,
    sidecar: async () => ({ claimInheritedDesktopSync, serveWorkerPort }),
  })
}
