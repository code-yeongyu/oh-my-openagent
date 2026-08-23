#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { maybeReexecUnderBun } from "./lib/bun-runtime.js"
import { runLauncher } from "./lib/launcher.js"
import { runSetup } from "./lib/setup-import.js"

try {
  // A `bun add -g omo-ai` install is reached through a symlink in ~/.bun/bin, and node resolves the
  // main module to its real path, so this URL already points inside the bun global tree. Handing
  // that install back to bun keeps the engine on the runtime the user installed it with; every
  // other install, and an explicit OMO_RUNTIME=node, stays on node.
  const reexeced = maybeReexecUnderBun({ scriptPath: fileURLToPath(import.meta.url) })
  if (!reexeced) {
    if (process.argv[2] === "setup") await runSetup(process.argv.slice(3))
    else await runLauncher()
  }
} catch (error) {
  console.error(`omo: ${error.message}`)
  process.exitCode = 1
}
