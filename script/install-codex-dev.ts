import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const installerEntrypoint = fileURLToPath(
  new URL("../packages/omo-codex/scripts/install-local.mjs", import.meta.url),
)

const args = process.argv.slice(2)
const devVersionArg = args.find((arg) => arg.startsWith("--version="))
const devVersion = devVersionArg?.slice("--version=".length).trim() || "dev"
const skipUninstall = args.includes("--no-uninstall")
const passthrough = args.filter((arg) => arg !== "--no-uninstall" && !arg.startsWith("--version="))

const childEnv = { ...process.env, LAZYCODEX_DEV_VERSION: devVersion }

function runInstaller(installerArgs: readonly string[]): number {
  const result = spawnSync("node", [installerEntrypoint, ...installerArgs], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: childEnv,
    shell: false,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (!skipUninstall) {
  console.log("[install-codex-dev] Removing the current Codex Light install...")
  const uninstallStatus = runInstaller(["uninstall"])
  if (uninstallStatus !== 0) {
    console.error(`[install-codex-dev] uninstall exited with code ${uninstallStatus}`)
    process.exit(uninstallStatus)
  }
}

console.log(`[install-codex-dev] Installing the dev build from ${repositoryRoot} as version "${devVersion}"...`)
const installStatus = runInstaller(["install", "--no-tui", ...passthrough])
if (installStatus !== 0) {
  console.error(`[install-codex-dev] install exited with code ${installStatus}`)
  process.exit(installStatus)
}

console.log(`[install-codex-dev] Done. Installed the dev build stamped as "${devVersion}".`)
console.log('[install-codex-dev] Verify with: omo get-local-version')
