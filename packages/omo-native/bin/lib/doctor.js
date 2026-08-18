import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { packageManifest, packageRoot, readJson, resolveSenpi } from "./package-paths.js"
import { needsSetupSuggestion } from "./setup-detect.js"

const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
]

function pass(lines, message) {
  lines.push(`PASS ${message}`)
}

function fail(lines, message) {
  lines.push(`FAIL ${message}`)
}

function warningsForSettings() {
  const agentDir = canonicalAgentDir()
  const settingsPath = join(agentDir, "settings.json")
  if (!existsSync(settingsPath)) return []

  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch (error) {
    return [`WARN could not parse ${settingsPath}: ${error.message}`]
  }

  const packages = Array.isArray(settings?.packages) ? settings.packages : []
  const duplicate = packages.some((entry) => {
    if (typeof entry === "string") return entry === "@code-yeongyu/omo-senpi"
    return entry !== null && typeof entry === "object" && entry.source === "@code-yeongyu/omo-senpi"
  })
  return duplicate
    ? ["WARN duplicate @code-yeongyu/omo-senpi package entry; remove it from the packages array because omo loads the packaged extension"]
    : []
}

// A malformed or unreadable engine manifest must not abort the diagnostics run.
function engineVersionOrUnresolved(senpi) {
  if (!senpi) return "unresolved"
  try {
    return readJson(join(senpi.packageRoot, "package.json")).version
  } catch {
    return "unresolved"
  }
}

export function runDoctor(inventory) {
  let failed = false
  const lines = []
  for (const [label, artifact] of artifacts) {
    const path = join(packageRoot, artifact)
    if (existsSync(path)) pass(lines, `${label}: ${artifact}`)
    else {
      // Report the declared posix-style artifact path so diagnostics read identically on every platform;
      // deriving it back from the joined path yields backslashes on Windows.
      fail(lines, `${label}: missing ${artifact}`)
      failed = true
    }
  }

  let senpi
  try {
    senpi = resolveSenpi()
    pass(lines, `senpi CLI: ${senpi.cliPath}`)
  } catch (error) {
    fail(lines, `senpi CLI: ${error.message}`)
    failed = true
  }

  if (senpi) {
    try {
      const expected = packageManifest().dependencies["@code-yeongyu/senpi"]
      const installed = readJson(join(senpi.packageRoot, "package.json")).version
      if (installed === expected) pass(lines, `senpi version ${installed}`)
      else {
        fail(lines, `senpi version: expected ${expected}, found ${installed}`)
        failed = true
      }
    } catch (error) {
      fail(lines, `senpi version: ${error.message}`)
      failed = true
    }
  }

  lines.push(`INFO omo ${packageManifest().version} (engine: senpi ${engineVersionOrUnresolved(senpi)})`)
  lines.push(...warningsForSettings())
  if (needsSetupSuggestion(inventory)) {
    lines.push("INFO no credentials found; run omo setup to review sibling stores")
  }
  console.log(lines.join("\n"))
  process.exitCode = failed ? 1 : 0
}
