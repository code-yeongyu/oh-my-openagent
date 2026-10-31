// Compiled by channel-compiled.test.ts with `bun build --compile`: the engine's own capture of the private
// descriptor table (senpi private-fds) feeding the memory component's startup selection exactly as index.ts
// wires it, so the handoff is proven in a Bun-compiled executable rather than a source runtime.
import { privateChannelDeclared, privateTablePresent, takeInheritedPrivateChannel } from "@code-yeongyu/senpi/private-fds"
import { attachDesktopSyncChannel } from "./channel"
import { selectHostMemorySyncSource } from "./hostSelection"

const selection = await selectHostMemorySyncSource({
  inherited: { declared: privateChannelDeclared, tablePresent: privateTablePresent, take: takeInheritedPrivateChannel },
  attach: attachDesktopSyncChannel,
}).selection
if (selection.kind === "desktop") {
  const reply = await selection.channel.request({ op: "descriptor" })
  selection.channel.close()
  process.stdout.write(`${JSON.stringify({ kind: "desktop", reply })}\n`)
} else {
  process.stdout.write(`${JSON.stringify(selection)}\n`)
}
process.exit(0)
