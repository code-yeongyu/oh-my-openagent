import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Set identity before importing senpi: core/brand consumes SENPI_BRAND once, then scrubs it.
// Mirrors omo-native/bin/lib/launcher.js; the isolated agent home is the only substitution.
export function isolatedEnvironment(sandbox, packageRoot) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(OMO_|SENPI_|PI_)/.test(key) || /(_PACKAGE_DIR|API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)$/.test(key)) delete env[key]
  }
  const nativeRoot = join(packageRoot, "../omo-native")
  const manifest = JSON.parse(readFileSync(join(nativeRoot, "package.json"), "utf8"))
  const changelogPath = join(nativeRoot, "plugin/CHANGELOG.md")
  const brand = {
    name: "OmO", command: "omo", displayVersion: manifest.version, configDir: ".omo", flatLayout: false,
    envPrefix: "OMO", userAgent: "omo", originator: "omo",
    update: { packageName: "omo-ai", distTag: "beta", command: "npm i -g omo-ai@beta", changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
  }
  if (existsSync(changelogPath)) {
    const { version } = JSON.parse(readFileSync(join(nativeRoot, "plugin/package.json"), "utf8"))
    brand.changelog = { path: changelogPath, version }
  }
  for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) env[key] = join(sandbox, "home")
  env.OMO_CODING_AGENT_DIR = join(sandbox, "agent")
  env.SENPI_CODING_AGENT_DIR = env.OMO_CODING_AGENT_DIR
  env.OMO_NATIVE = "1"
  env.SENPI_RUNTIME = process.versions.bun ? "bun" : "node"
  env.SENPI_BRAND = JSON.stringify(brand)
  env.OMO_BIN = join(nativeRoot, "bin/omo.js")
  for (const key of ["TMPDIR", "TMP", "TEMP"]) env[key] = join(sandbox, "tmp")
  env.PI_OFFLINE = "1"
  env.DO_NOT_TRACK = "1"
  return env
}

export function processGroupMembers(groupId) {
  return execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" })
    .trim().split("\n").filter(line => Number(line.trim().split(/\s+/)[2]) === groupId)
}
