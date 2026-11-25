// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { finding, findingsFromLines } from "./diagnostics-findings.js"
import { fetchNpmDistTagsSync } from "./npm-dist-tags.js"
import { channelDistTagVersion, packageManifest, readJson, resolveSenpi, updateTarget } from "./package-paths.js"
import { sameVersion } from "./same-version.js"

/** @typedef {import("./diagnostics-contract").DiagnosticFinding} DiagnosticFinding */
/** @typedef {import("./diagnostics-contract").DiagnosticCheck} DiagnosticCheck */

/** @type {readonly [DiagnosticCheck, string, string][]} */
const ARTIFACTS = [
  ["artifact.plugin-manifest", "plugin manifest", "plugin/package.json"],
  ["artifact.extension", "extension", "plugin/extensions/omo.js"],
  ["artifact.lsp-daemon-runtime", "lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
]

/** @param {unknown} error */
const messageOf = (error) => /** @type {{ message?: unknown }} */ (error)?.message

/** @param {string} root */
export function artifactFindings(root) {
  return ARTIFACTS.map(([id, label, artifact]) =>
    existsSync(join(root, artifact))
      ? finding(id, "ok", `${label}: ${artifact}`, { path: artifact })
      : // The declared posix-style path, so the finding reads identically on every platform; deriving it
        // back from the joined path yields backslashes on Windows.
        finding(id, "fail", `${label}: missing ${artifact}`, { path: artifact, missing: true }),
  )
}

/** @param {{ packageRoot: string } | undefined} senpi */
function engineVersionOrUnresolved(senpi) {
  // A malformed or unreadable engine manifest must not abort the diagnostics run.
  if (!senpi) return "unresolved"
  try {
    return readJson(join(senpi.packageRoot, "package.json")).version
  } catch {
    return "unresolved"
  }
}

export function engineFindings() {
  /** @type {DiagnosticFinding[]} */
  const findings = []
  /** @type {{ cliPath: string, packageRoot: string } | undefined} */
  let senpi
  try {
    senpi = resolveSenpi()
    findings.push(finding("engine.cli", "ok", `senpi CLI: ${senpi.cliPath}`, { path: senpi.cliPath }))
  } catch (error) {
    findings.push(finding("engine.cli", "fail", `senpi CLI: ${messageOf(error)}`))
  }
  if (senpi) {
    try {
      const expected = packageManifest().dependencies["@code-yeongyu/senpi"]
      const installed = readJson(join(senpi.packageRoot, "package.json")).version
      findings.push(
        sameVersion(installed, expected)
          ? finding("engine.version", "ok", `senpi version ${installed}`, { expected, installed })
          : finding("engine.version", "fail", `senpi version: expected ${expected}, found ${installed}`, {
              expected,
              installed,
            }),
      )
    } catch (error) {
      findings.push(finding("engine.version", "fail", `senpi version: ${messageOf(error)}`))
    }
  }
  return { findings, engine: engineVersionOrUnresolved(senpi) }
}

/** @param {{ fetchDistTags?: () => unknown }} ports */
function readDistTags(ports) {
  try {
    if (Object.hasOwn(ports, "fetchDistTags")) return ports.fetchDistTags?.()
    return fetchNpmDistTagsSync()
  } catch {
    return null
  }
}

/**
 * @param {unknown} distTags
 * @param {string} version
 */
export function latestFromDistTags(distTags, version) {
  return channelDistTagVersion(distTags, version) ?? "could not check"
}

/**
 * @param {string} engine
 * @param {{ fetchDistTags?: () => unknown }} ports
 */
export function npmVersionFindings(engine, ports) {
  const installed = packageManifest().version
  const latest = latestFromDistTags(readDistTags(ports), installed)
  const update = updateTarget().command
  return [
    finding(
      "install.version",
      "notice",
      `omo · Edition: Native · Installed: ${installed} (engine: senpi ${engine}) · Latest: ${latest}`,
      { edition: "native", installed, engine, latest },
    ),
    finding("install.update", "notice", `Update: ${update}`, { command: update }),
  ]
}

export function settingsFindings() {
  const agentDir = canonicalAgentDir()
  const settingsPath = join(agentDir, "settings.json")
  if (!existsSync(settingsPath)) return []

  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch (error) {
    return findingsFromLines("settings.packages", [`WARN could not parse ${settingsPath}: ${messageOf(error)}`])
  }

  const packages = Array.isArray(settings?.packages) ? settings.packages : []
  const duplicate = packages.some(
    /** @param {unknown} entry */ (entry) => {
      if (typeof entry === "string") return entry === "@code-yeongyu/omo-senpi"
      return (
        entry !== null &&
        typeof entry === "object" &&
        /** @type {{ source?: unknown }} */ (entry).source === "@code-yeongyu/omo-senpi"
      )
    },
  )
  return duplicate
    ? [
        finding(
          "settings.packages",
          "warn",
          "duplicate @code-yeongyu/omo-senpi package entry; remove it from the packages array because omo loads the packaged extension",
          { path: settingsPath },
        ),
      ]
    : []
}
