#!/usr/bin/env node
import "./lib/private-fds.js"
import { fileURLToPath } from "node:url"
import { ensureBunBinShim } from "./lib/bun-bin-shim.js"
import { maybeReexecUnderBun } from "./lib/bun-runtime.js"
import { runAttachTui, runLauncher } from "./lib/launcher.js"
import { removeLegacyServiceCredentials } from "./lib/legacy-service-credentials.js"
import { runRemoteAttachLaunch } from "./lib/remote-attach-launch.js"
import { runSetup } from "./lib/setup-import.js"

try {
  // A machine that has bun runs omo on bun, whichever package manager installed it. A `bun add -g`
  // install is reached through a symlink in ~/.bun/bin, and node resolves the main module to its
  // real path, so this URL already points inside the bun global tree. Every bun is held to the
  // engine's floor (BUN_MIN_VERSION): a bun the user chose (that tree, or OMO_RUNTIME=bun) that is
  // too old stops with an upgrade message, any other old bun leaves the launch on node (#9563).
  // Only an explicit OMO_RUNTIME=node, or a machine without a usable bun, stays on node.
  const scriptPath = fileURLToPath(import.meta.url)
  // Prepare this package-owned entrypoint for a direct Bun boot on POSIX Bun-global installs.
  // Keep Bun's bin symlinks, restoring only our legacy marked wrappers before commands run.
  // Windows/npm retain the shipped Node shebang and package.json bin mapping.
  ensureBunBinShim({ scriptPath })
  const reexeced = await maybeReexecUnderBun({ scriptPath })
  if (!reexeced) {
    // The #10697 plaintext file goes before ANY command runs: several verbs return before runLauncher.
    removeLegacyServiceCredentials()
    if (["login", "logout", "whoami"].includes(process.argv[2])) {
      const { runServiceAuthCommand } = await import("./lib/service-auth.generated.js")
      await runServiceAuthCommand(process.argv.slice(2))
    } else if (process.argv[2] === "sync") {
      const { runSyncCommand } = await import("./lib/service-auth.generated.js")
      await runSyncCommand(process.argv.slice(2))
    } else if (process.argv[2] === "account") {
      const { runAccountCommand } = await import("./lib/service-auth.generated.js")
      await runAccountCommand(process.argv.slice(2))
    } else if (process.argv[2] === "remote" && process.argv[3] === "attach") {
      await runRemoteAttachLaunch({
        prepare: async () => {
          const { runRemoteAttachCommand } = await import("./lib/service-auth.generated.js")
          return runRemoteAttachCommand(process.argv.slice(2))
        },
        runTui: runAttachTui,
        reportError: error => {
          console.error(`omo: ${error.message}`)
          process.exitCode = 1
        },
        exit: () => process.exit(),
      })
    } else if (process.argv[2] === "remote") {
      const { runRemoteCommand } = await import("./lib/service-auth.generated.js")
      await runRemoteCommand(process.argv.slice(2))
    } else if (process.argv[2] === "setup") await runSetup(process.argv.slice(3))
    else await runLauncher()
  }
} catch (error) {
  console.error(`omo: ${error.message}`)
  process.exitCode = 1
}
