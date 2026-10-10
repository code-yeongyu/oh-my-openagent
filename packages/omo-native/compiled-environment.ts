import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { buildLabel, parseBuildInfo } from "./build-info"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { nearestNodeBin, readJson } from "./bin/lib/package-paths.js"

export function remapSenpiEnvironment(source: NodeJS.ProcessEnv = process.env, execDir: string): NodeJS.ProcessEnv {
  const env = { ...source }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  const agentDir = canonicalAgentDir(env)
  env.OMO_CODING_AGENT_DIR = agentDir
  env.SENPI_CODING_AGENT_DIR = agentDir
  // The engine resolves its package dir from PACKAGE_DIR before falling back to
  // dirname(process.execPath). Provisioning can complete without a re-exec (and the
  // size guard in materializeProvisionedExecutable makes that path common), so
  // execPath may stay at the user's install path while the payload lives under
  // execDir - pin the root explicitly rather than trusting the running image.
  env.OMO_PACKAGE_DIR = execDir
  env.SENPI_PACKAGE_DIR = execDir
  env.OMO_NATIVE = "1"
  env.SENPI_RUNTIME = process.versions.bun ? "bun" : "node"
  let displayVersion = "unknown"
  let devCommand: string | undefined
  let devUpdateCommand: string | undefined
  let changelogVersion: string | undefined
  try {
    const stamped = readJson(join(execDir, "package.json")) as { version?: string; omoBuild?: unknown }
    displayVersion = typeof stamped.version === "string" ? stamped.version : "unknown"
    const info = parseBuildInfo(stamped.omoBuild)
    if (info !== undefined) {
      devCommand = info.command
      devUpdateCommand = `rebuild with: bun run ${info.command}`
      displayVersion = buildLabel(info)
    } else {
      const pluginManifest = readJson(join(execDir, "plugin", "package.json")) as { version?: string }
      changelogVersion = typeof pluginManifest.version === "string" ? pluginManifest.version : undefined
    }
  } catch { /* test fixtures may omit the sibling manifest */ }
  env.SENPI_BRAND = JSON.stringify({
    name: "OmO", command: devCommand ?? "omo", displayVersion,
    configDir: ".omo", flatLayout: false, envPrefix: "OMO", userAgent: "omo", originator: "omo",
    changelog: {
      path: join(execDir, "plugin", "CHANGELOG.md"),
      ...(changelogVersion === undefined ? {} : { version: changelogVersion }),
    },
    update: { packageName: "omo-ai", distTag: displayVersion.includes("-") ? "beta" : "latest", command: devUpdateCommand ?? "omo update", changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
  })
  const binDir = nearestNodeBin(execDir)
  if (binDir) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
    env[pathKey] = env[pathKey] ? `${binDir}${delimiter}${env[pathKey]}` : binDir
    const shim = join(binDir, process.platform === "win32" ? "senpi.cmd" : "senpi")
    if (existsSync(shim)) env.SENPI_BIN = shim
  }
  env.OMO_BIN = join(execDir, process.platform === "win32" ? "omo.exe" : "omo")
  return env
}
