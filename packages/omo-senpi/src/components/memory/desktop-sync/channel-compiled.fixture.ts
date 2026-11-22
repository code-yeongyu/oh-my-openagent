// Compiled by channel-compiled.test.ts with `bun build --compile`: omo.js's launch classification and the sidecar's
// claim feed the memory component's startup selection the way account-runtime-loader.ts wires it, so the private
// descriptor handoff is proven in a Bun-compiled executable rather than a source runtime.
import { claimInheritedDesktopSync } from "./desktopClaim"
import { selectHostMemorySyncSource } from "./hostSelection"
import { launchCarriedPrivateTable } from "./launchClassification"
import { serveWorkerPort } from "./workerPort"

const selection = await selectHostMemorySyncSource({
  declared: launchCarriedPrivateTable,
  sidecar: async () => ({ claimInheritedDesktopSync, serveWorkerPort }),
}).selection
let line: string
if (selection.kind === "desktop") {
  const reply = await selection.channel.request({ op: "descriptor" })
  selection.channel.close()
  line = JSON.stringify({ kind: "desktop", reply })
} else {
  line = JSON.stringify(selection)
}
process.stdout.write(`${line}\n`, () => process.exit(0))
