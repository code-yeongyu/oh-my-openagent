import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { packageManifest, packageRoot } from "./package-paths.js"

export const COMPUTER_USE_RUNTIME = join("plugin", "runtime", "category-coverage", "index.js")

async function loadRuntime() {
  return import(pathToFileURL(join(packageRoot, COMPUTER_USE_RUNTIME)).href)
}

function baseLine(report) {
  return `INFO computer use: enabled=${report.enabled} supported=${report.supported} host=${report.host}`
}

function readyLines(report) {
  const capabilities = report.capabilities
  const displayServer = capabilities.displayServer ? ` (${capabilities.displayServer})` : ""
  const backendLevel = capabilities.backend === "unavailable" ? "WARN" : "PASS"
  const permissionLevel = capabilities.capture && capabilities.input && capabilities.ax ? "PASS" : "WARN"
  const displayLevel = capabilities.displayCount > 0 && !capabilities.screenLocked ? "PASS" : "WARN"
  const stopLevel = capabilities.stopPath === "none" ? "WARN" : "PASS"
  const stopReason = capabilities.stopReason ? ` reason=${capabilities.stopReason}` : ""
  // The engine arms the stop chord only when a session starts input (`stopPath.start`), so a pre-session
  // probe always sees `none` / `no-global-listener`; that is the normal idle state, not a failure.
  const stopLine =
    capabilities.stopPath === "none" && capabilities.stopReason === "no-global-listener"
      ? "INFO computer use stop path: not armed until computer use starts input (checked when a session activates)"
      : `${stopLevel} computer use stop path: ${capabilities.stopPath}${stopReason}`
  return [
    baseLine(report),
    `PASS computer use engine: ${report.enginePath} (version ${report.hello.engineVersion}, ABI ${report.hello.abi}, protocol ${report.hello.protocolVersion})`,
    `${backendLevel} computer use backend: ${capabilities.backend}${displayServer}`,
    `${permissionLevel} computer use permissions: capture=${capabilities.capturePermission} input=${capabilities.inputPermission} accessibility=${capabilities.axPermission}`,
    `${displayLevel} computer use display: count=${capabilities.displayCount} screenLocked=${capabilities.screenLocked}`,
    stopLine,
  ]
}

export function formatComputerUseDoctorLines(report) {
  switch (report.kind) {
    case "ready":
      return readyLines(report)
    case "skipped":
      return [
        baseLine(report),
        report.reason === "disabled"
          ? "INFO computer use probe: skipped because computer.enabled=false"
          : `INFO computer use probe: skipped because ${report.host} is unsupported`,
      ]
    case "unavailable":
      return [
        baseLine(report),
        `FAIL computer use engine: ${report.diagnostic.code}: ${report.diagnostic.message} ${report.diagnostic.cause}`.trimEnd(),
        `INFO computer use engine paths tried: ${report.diagnostic.attemptedPaths.join(", ") || "<none>"}`,
      ]
    case "failed":
      return [
        baseLine(report),
        `FAIL computer use engine: ${report.code}: ${report.message}`,
        `INFO computer use engine path: ${report.enginePath}`,
      ]
    default:
      throw new TypeError(`unknown computer use doctor report kind: ${String(report.kind)}`)
  }
}

export async function doctorComputerUseLines(options = {}) {
  try {
    const runtime = await (options.loadRuntime ?? loadRuntime)()
    const report = await runtime.computerUseDoctorReport({
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      version: packageManifest().version,
      packageRoot,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      timeoutMs: options.timeoutMs,
    })
    return formatComputerUseDoctorLines(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [`WARN computer use: diagnostics unavailable: ${message}`]
  }
}
