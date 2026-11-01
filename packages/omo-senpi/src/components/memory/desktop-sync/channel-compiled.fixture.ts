// Compiled by channel-compiled.test.ts with `bun build --compile`: the engine's own capture of the private
// descriptor table (senpi private-fds) feeding the memory component's startup selection exactly as index.ts
// wires it, so the handoff is proven in a Bun-compiled executable rather than a source runtime.
import { claimInheritedDesktopSync } from "./desktopClaim"
import { selectHostMemorySyncSource } from "./hostSelection"
import { serveWorkerPort } from "./workerPort"

// The same launch classification omo.js's account-runtime loader uses: the table senpi's capture left on its global
// symbol, else the launcher's table still in this process's env (the claim then captures it).
const captured = (globalThis as { [key: symbol]: { readonly present?: unknown } | undefined })[Symbol.for("senpi.private-fds.v3")]
const selection = await selectHostMemorySyncSource({
  declared: () => (captured ? captured.present === true : Boolean(process.env.SENPI_PRIVATE_FDS)),
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
