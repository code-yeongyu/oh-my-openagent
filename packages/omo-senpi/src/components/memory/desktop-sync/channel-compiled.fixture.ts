// Compiled by channel-compiled.test.ts with `bun build --compile`: the engine's own capture of the private
// descriptor table (senpi private-fds) feeding the memory component's startup selection exactly as index.ts
// wires it, so the handoff is proven in a Bun-compiled executable rather than a source runtime.
import { privateChannelDeclared, privateTablePresent } from "@code-yeongyu/senpi/private-fds"
import { claimInheritedDesktopSync } from "./desktopClaim"
import { selectHostMemorySyncSource } from "./hostSelection"
import { serveDesktopWorker } from "./workerPort"

const selection = await selectHostMemorySyncSource({
  inherited: { declared: privateChannelDeclared, tablePresent: privateTablePresent },
  claim: claimInheritedDesktopSync,
  serveDesktop: serveDesktopWorker,
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
