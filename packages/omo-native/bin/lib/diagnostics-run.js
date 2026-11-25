// @ts-check
// `diagnostics.run`: every check `omo doctor` reports, as findings, in the order the command prints them.
// The npm launcher and the compiled binary run different section lists; both are composed here, so the
// command of each binary and the SDK call share this one body.
import { statSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { doctorCoverageFindings } from "./category-coverage.js"
import { doctorComputerUseFindings } from "./computer-use-doctor.js"
import { doctorConfigFindings } from "./config-doctor.js"
import { daemonFindings } from "./daemon.js"
import { finding } from "./diagnostics-findings.js"
import { artifactFindings, engineFindings, npmVersionFindings, settingsFindings } from "./diagnostics-install-checks.js"
import {
  memoryRuntimeDiscardResolver,
  memoryRuntimeMaxBytesResolver,
  memoryRuntimeReport,
  memoryRuntimeUnavailable,
} from "./doctor-memory-runtime.js"
import { migrationReport } from "./doctor-migration.js"
import { piConfigReport } from "./doctor-pi-config.js"
import { reflectionLockReport } from "./doctor-reflection-lock.js"
import {
  classifyEngineProcesses,
  classifyRetiredPayloadEngines,
  retiredPayloadFindings,
  staleEngineFindings,
} from "./engine-processes.js"
import { keychainHelperFindings } from "./keychain-helper-doctor.js"
import { launchSpecFindings } from "./launch-spec-mode.js"
import { memoryIdentityFindings } from "./memory-identities.js"
import { packageRoot, updateTarget } from "./package-paths.js"
import { listProcesses } from "./process-list.js"
import { detectHarnesses, needsSetupSuggestion } from "./setup-detect.js"

/** @typedef {import("./diagnostics-contract").DiagnosticFinding} DiagnosticFinding */
/** @typedef {import("./diagnostics-contract").DiagnosticCheck} DiagnosticCheck */
/** @typedef {import("./diagnostics-contract").DiagnosticsCalls} DiagnosticsCalls */
/** @typedef {import("./diagnostics-contract").Inventory} Inventory */
/** @typedef {import("./diagnostics-contract").RunPorts} RunPorts */
/** @typedef {Extract<import("./diagnostics-contract").DiagnosticsInstall, { kind: "compiled" }>} CompiledInstall */

/** A FAIL from one of these fails `omo doctor`; a FAIL any other section reports does not. */
const BLOCKING = new Set([
  "artifact.plugin-manifest",
  "artifact.extension",
  "artifact.lsp-daemon-runtime",
  "engine.cli",
  "engine.version",
  "launch-spec",
  "computer-use",
])

/** @returns {Promise<readonly DiagnosticFinding[]>} */
function npmMemoryRuntime() {
  const pluginRoot = join(packageRoot, "plugin")
  return memoryRuntimeReport({
    maxBytesFor: memoryRuntimeMaxBytesResolver({ pluginRoot }),
    discardFor: memoryRuntimeDiscardResolver({ pluginRoot }),
  }).then((report) => report.findings, memoryRuntimeUnavailable)
}

/** @param {RunPorts} ports */
function processFindings(ports) {
  const entries = (ports.list ?? listProcesses)()
  const payloadMtimeMs =
    ports.payloadMtimeMs ??
    /** @param {string} payloadDir */ ((payloadDir) => {
      try {
        return statSync(join(payloadDir, "extensions", "omo.js")).mtimeMs
      } catch {
        return undefined
      }
    })
  const nowMs = (ports.now ?? Date.now)()
  return {
    stale: staleEngineFindings(classifyEngineProcesses(entries).stale),
    retired: retiredPayloadFindings(classifyRetiredPayloadEngines(entries, { payloadMtimeMs, nowMs })),
  }
}

/**
 * @param {RunPorts} ports
 * @param {string} pluginRoot
 */
function daemonSection(ports, pluginRoot) {
  if (ports.daemon !== undefined) return ports.daemon()
  if (ports.daemonEngine === undefined) return []
  return daemonFindings({
    engine: ports.daemonEngine,
    pluginRoot,
    agentDir: canonicalAgentDir(),
    env: process.env,
    platform: process.platform,
  })
}

/** @param {Inventory} inventory */
function setupFindings(inventory) {
  return needsSetupSuggestion(inventory)
    ? [finding("setup.credentials", "notice", "no credentials found; run omo setup to review sibling stores")]
    : []
}

/**
 * @param {RunPorts} ports
 * @returns {Promise<DiagnosticFinding[]>}
 */
async function npmFindings(ports) {
  const pluginRoot = join(packageRoot, "plugin")
  const [config, reflectionLock, memoryRuntime, computerUse, coverage, inventory] = await Promise.all([
    (ports.configDiagnostics ?? doctorConfigFindings)(),
    (ports.reflectionLock ?? reflectionLockReport)(),
    (ports.memoryRuntime ?? npmMemoryRuntime)(),
    (ports.computerUse ?? doctorComputerUseFindings)(),
    (ports.categoryCoverage ?? (() => doctorCoverageFindings({ agentDir: canonicalAgentDir() })))(),
    ports.inventory ?? detectHarnesses(),
  ])
  const engine = engineFindings()
  const processes = processFindings(ports)
  return [
    ...artifactFindings(packageRoot),
    ...engine.findings,
    ...npmVersionFindings(engine.engine, ports),
    ...migrationReport(ports, updateTarget().command),
    ...settingsFindings(),
    ...config,
    ...piConfigReport({ env: ports.env, homeDir: ports.homeDir }),
    ...processes.stale,
    ...processes.retired,
    ...memoryIdentityFindings(ports),
    ...reflectionLock,
    ...memoryRuntime,
    ...launchSpecFindings(ports.pluginRoot ?? pluginRoot, ports.launchSpecIo),
    ...(ports.keychainHelper ?? (() => keychainHelperFindings({ packageRoot })))(),
    ...daemonSection(ports, pluginRoot),
    ...computerUse,
    ...coverage,
    ...setupFindings(inventory),
  ]
}

/**
 * @param {CompiledInstall} install
 * @param {RunPorts} ports
 * @returns {Promise<DiagnosticFinding[]>}
 */
async function compiledFindings(install, ports) {
  const { sources } = install
  const pluginRoot = join(install.execDir, "plugin")
  const [trust, computerUse, coverage, memoryRuntime, inventory] = await Promise.all([
    sources.trust(),
    sources.computerUse(),
    sources.coverage(),
    sources.memoryRuntime(),
    ports.inventory ?? detectHarnesses(),
  ])
  return [
    ...artifactFindings(install.execDir),
    ...install.versionText.split("\n").map((line) => finding("install.version", "notice", line)),
    finding("install.update", "notice", `Update: ${install.updateCommand}`, { command: install.updateCommand }),
    ...launchSpecFindings(pluginRoot),
    ...sources.keychainHelper(),
    ...daemonSection(ports, pluginRoot),
    ...migrationReport({ ...ports, standalone: true }, null),
    ...settingsFindings(),
    ...sources.config(),
    ...piConfigReport({ env: ports.env, homeDir: ports.homeDir }),
    ...processFindings({ list: ports.list }).stale,
    ...memoryIdentityFindings({ env: ports.env ?? process.env }),
    ...trust,
    ...computerUse,
    ...sources.claudeCode(),
    ...coverage,
    ...memoryRuntime,
    ...setupFindings(inventory),
  ]
}

/** @type {DiagnosticsCalls["run"]} */
export async function run(_input = {}, ports = {}) {
  const install = ports.install ?? { kind: "npm" }
  const findings = install.kind === "compiled" ? await compiledFindings(install, ports) : await npmFindings(ports)
  const failed = findings.some((entry) => entry.level === "fail" && BLOCKING.has(entry.check))
  return { kind: "ok", value: { findings, failed } }
}
