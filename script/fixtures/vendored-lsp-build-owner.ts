import { ensureVendoredLspDaemonBuilt } from "../ensure-vendored-lsp-daemon"

const [packageDir, outputPath, lockRoot] = process.argv.slice(2)
if (!packageDir || !outputPath || !lockRoot) {
  throw new Error("packageDir, outputPath, and lockRoot are required")
}

await ensureVendoredLspDaemonBuilt({
  packageDir,
  outputPath,
  lockRoot,
  log: () => {},
  runCommand: async (_command, args) => {
    if (args[0] === "ci") {
      console.log("OWNER_READY")
      await new Promise<never>(() => {})
    }
    return 0
  },
})
