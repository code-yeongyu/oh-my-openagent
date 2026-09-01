#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { ensureBunBinShim } from "./lib/bun-bin-shim.js"
import { maybeReexecUnderBun } from "./lib/bun-runtime.js"
import { runLauncher } from "./lib/launcher.js"
import { runSetup } from "./lib/setup-import.js"

try {
  // A `bun add -g omo-ai` install is reached through a symlink in ~/.bun/bin, and node resolves the
  // main module to its real path, so this URL already points inside the bun global tree. Handing
  // that install back to bun keeps the engine on the runtime the user installed it with; every
  // other install, and an explicit OMO_RUNTIME=node, stays on node.
  const scriptPath = fileURLToPath(import.meta.url)
  // That same symlink makes node boot before every re-exec, so POSIX bun-global installs pay for
  // node on every launch. This keeps the user-facing bin a tiny sh shim that execs bun directly;
  // it is quiet and fail-open by contract, and Windows/npm installs never enter it. The shebang
  // above and the bin mapping in package.json are all Windows shims ever read, and both stay.
  ensureBunBinShim({ scriptPath })
  const reexeced = await maybeReexecUnderBun({ scriptPath })
  if (!reexeced) {
    if (process.argv[2] === "setup") await runSetup(process.argv.slice(3))
    else await runLauncher()
  }
} catch (error) {
  console.error(`omo: ${error.message}`)
  process.exitCode = 1
}
