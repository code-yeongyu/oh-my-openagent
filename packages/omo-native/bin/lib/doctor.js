import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"
import { packageManifest, packageRoot, readJson, resolveSenpi } from "./package-paths.js"
import { needsSetupSuggestion } from "./setup-detect.js"

const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
]

function pass(message) {
  console.log(`PASS ${message}`)
}

function fail(message) {
  console.log(`FAIL ${message}`)
}

function warnForSettings() {
  const agentDir = process.env.SENPI_CODING_AGENT_DIR || join(homedir(), ".senpi", "agent")
  const settingsPath = join(agentDir, "settings.json")
  if (!existsSync(settingsPath)) return

  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch (error) {
    console.log(`WARN could not parse ${settingsPath}: ${error.message}`)
    return
  }

  const packages = Array.isArray(settings?.packages) ? settings.packages : []
  const duplicate = packages.some((entry) => {
    if (typeof entry === "string") return entry === "@code-yeongyu/omo-senpi"
    return entry !== null && typeof entry === "object" && entry.source === "@code-yeongyu/omo-senpi"
  })
  if (duplicate) {
    console.log("WARN duplicate @code-yeongyu/omo-senpi package entry; remove it from the packages array because omo loads the packaged extension")
  }
}

export function runDoctor(inventory) {
  let failed = false
  for (const [label, artifact] of artifacts) {
    const path = join(packageRoot, artifact)
    if (existsSync(path)) pass(`${label}: ${artifact}`)
    else {
      fail(`${label}: missing ${relative(packageRoot, path)}`)
      failed = true
    }
  }

  let senpi
  try {
    senpi = resolveSenpi()
    pass(`senpi CLI: ${senpi.cliPath}`)
  } catch (error) {
    fail(`senpi CLI: ${error.message}`)
    failed = true
  }

  if (senpi) {
    try {
      const expected = packageManifest().dependencies["@code-yeongyu/senpi"]
      const installed = readJson(join(senpi.packageRoot, "package.json")).version
      if (installed === expected) pass(`senpi version ${installed}`)
      else {
        fail(`senpi version: expected ${expected}, found ${installed}`)
        failed = true
      }
    } catch (error) {
      fail(`senpi version: ${error.message}`)
      failed = true
    }
  }

  warnForSettings()
  if (needsSetupSuggestion(inventory)) {
    console.log("INFO senpi has no credentials; run omo setup to review sibling stores")
  }
  process.exitCode = failed ? 1 : 0
}
