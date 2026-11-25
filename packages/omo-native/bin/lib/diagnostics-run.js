// @ts-check
// `diagnostics.run`: every check `omo doctor` reports, as findings, in the order the command prints them.
// The npm launcher and the compiled binary run different section lists; both are composed here, so the
// command of each binary and the SDK call share this one body.
import { statSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { doctorCoverageLines } from "./category-coverage.js"
import { doctorComputerUseLines } from "./computer-use-doctor.js"
import { doctorConfigLines } from "./config-doctor.js"
import { daemonReportLines } from "./daemon.js"
import { finding, findingsFromLines } from "./diagnostics-findings.js"
import { artifactFindings, engineFindings, npmVersionFindings, settingsFindings } from "./diagnostics-install-checks.js"
import {
  memoryRuntimeDiscardResolver,
  memoryRuntimeMaxBytesResolver,
  memoryRuntimeReport,
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
import { keychainHelperDoctorLines } from "./keychain-helper-doctor.js"
import { launchSpecDoctorLines } from "./launch-spec-mode.js"
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

/** @param {unknown} error */
function memoryRuntimeUnavailable(error) {
  return [`WARN memory runtime: unavailable: ${error instanceof Error ? error.message : String(error)}`]
}

/** @returns {Promise<readonly string[]>} */
function npmMemoryRuntime() {
  const pluginRoot = join(packageRoot, "plugin")
  return memoryRuntimeReport({
    maxBytesFor: memoryRuntimeMaxBytesResolver({ pluginRoot }),
    discardFor: memoryRuntimeDiscardResolver({ pluginRoot }),
  }).then(/** @param {{ lines: string[] }} report */ (report) => report.lines, memoryRuntimeUnavailable)
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
function daemonLines(ports, pluginRoot) {
  if (ports.daemon !== undefined) return ports.daemon()
  if (ports.daemonEngine === undefined) return []
  return daemonReportLines({
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
    (ports.configDiagnostics ?? doctorConfigLines)(),
    (ports.reflectionLock ?? reflectionLockReport)(),
    (ports.memoryRuntime ?? npmMemoryRuntime)(),
    (ports.computerUse ?? doctorComputerUseLines)(),
    (ports.categoryCoverage ?? (() => doctorCoverageLines({ agentDir: canonicalAgentDir() })))(),
    ports.inventory ?? detectHarnesses(),
  ])
  const engine = engineFindings()
  const processes = processFindings(ports)
  return [
    ...artifactFindings(packageRoot),
    ...engine.findings,
    ...npmVersionFindings(engine.engine, ports),
    ...findingsFromLines("install.migration", migrationReport(ports, updateTarget().command)),
    ...settingsFindings(),
    ...findingsFromLines("config.diagnostics", config),
    ...findingsFromLines("config.directory", piConfigReport({ env: ports.env, homeDir: ports.homeDir })),
    ...processes.stale,
    ...processes.retired,
    ...memoryIdentityFindings(ports),
    ...findingsFromLines("memory.reflection-lock", reflectionLock),
    ...findingsFromLines("memory.runtime", memoryRuntime),
    ...findingsFromLines("launch-spec", launchSpecDoctorLines(ports.pluginRoot ?? pluginRoot, ports.launchSpecIo)),
    ...findingsFromLines(
      "keychain-helper",
      (ports.keychainHelper ?? (() => keychainHelperDoctorLines({ packageRoot })))(),
    ),
    ...findingsFromLines("daemon", daemonLines(ports, pluginRoot)),
    ...findingsFromLines("computer-use", computerUse),
    ...findingsFromLines("task-categories", coverage),
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
    ...findingsFromLines("launch-spec", launchSpecDoctorLines(pluginRoot)),
    ...findingsFromLines("keychain-helper", sources.keychainHelper()),
    ...findingsFromLines("daemon", daemonLines(ports, pluginRoot)),
    ...findingsFromLines("install.migration", migrationReport({ ...ports, standalone: true }, null)),
    ...settingsFindings(),
    ...findingsFromLines("config.diagnostics", sources.config()),
    ...findingsFromLines("config.directory", piConfigReport({ env: ports.env, homeDir: ports.homeDir })),
    ...processFindings({ list: ports.list }).stale,
    ...memoryIdentityFindings({ env: ports.env ?? process.env }),
    ...findingsFromLines("engine.trust", trust),
    ...findingsFromLines("computer-use", computerUse),
    ...findingsFromLines("claude-code", sources.claudeCode()),
    ...findingsFromLines("task-categories", coverage),
    ...findingsFromLines("memory.runtime", memoryRuntime),
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
