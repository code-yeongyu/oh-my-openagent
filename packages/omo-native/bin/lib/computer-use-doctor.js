import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { finding } from "./diagnostics-findings.js"
import { packageManifest, packageRoot } from "./package-paths.js"

export const COMPUTER_USE_RUNTIME = join("plugin", "runtime", "category-coverage", "index.js")

async function loadRuntime() {
  return import(pathToFileURL(join(packageRoot, COMPUTER_USE_RUNTIME)).href)
}

const level = (ok) => (ok ? "ok" : "warn")

function base(report) {
  return finding(
    "computer-use",
    "notice",
    `computer use: enabled=${report.enabled} supported=${report.supported} host=${report.host}`,
    {
      enabled: report.enabled,
      supported: report.supported,
      host: report.host,
    },
  )
}

const note = (message, details) => finding("computer-use", "notice", message, details)

function readyFindings(report) {
  const capabilities = report.capabilities
  const displayServer = capabilities.displayServer ? ` (${capabilities.displayServer})` : ""
  const displayAsleep = capabilities.displayAsleep === true
  const stopReason = capabilities.stopReason ? ` reason=${capabilities.stopReason}` : ""
  // The engine arms the stop chord only when a session starts input (`stopPath.start`), so a pre-session
  // probe always sees `none` / `no-global-listener`; that is the normal idle state, not a failure.
  const stop =
    capabilities.stopPath === "none" && capabilities.stopReason === "no-global-listener"
      ? note("computer use stop path: not armed until computer use starts input (checked when a session activates)", {
          stop_path: "none",
          armed: false,
        })
      : finding(
          "computer-use",
          level(capabilities.stopPath !== "none"),
          `computer use stop path: ${capabilities.stopPath}${stopReason}`,
          { stop_path: capabilities.stopPath, reason: capabilities.stopReason },
        )
  return [
    base(report),
    finding(
      "computer-use",
      "ok",
      `computer use engine: ready (${report.engineSource}) ${report.enginePath} (version ${report.hello.engineVersion}, ABI ${report.hello.abi}, protocol ${report.hello.protocolVersion})`,
      { state: "ready", source: report.engineSource, path: report.enginePath, version: report.hello.engineVersion },
    ),
    ...(report.launchedEnginePath
      ? [note(`computer use launched executable: ${report.launchedEnginePath}`, { path: report.launchedEnginePath })]
      : []),
    finding(
      "computer-use",
      level(capabilities.backend !== "unavailable"),
      `computer use backend: ${capabilities.backend}${displayServer}`,
      {
        backend: capabilities.backend,
        display_server: capabilities.displayServer,
      },
    ),
    finding(
      "computer-use",
      level(capabilities.capture && capabilities.input && capabilities.ax),
      `computer use permissions: capture=${capabilities.capturePermission} input=${capabilities.inputPermission} accessibility=${capabilities.axPermission}`,
      {
        capture: capabilities.capturePermission,
        input: capabilities.inputPermission,
        accessibility: capabilities.axPermission,
      },
    ),
    finding(
      "computer-use",
      level(capabilities.displayCount > 0 && !capabilities.screenLocked && !displayAsleep),
      `computer use display: count=${capabilities.displayCount} screenLocked=${capabilities.screenLocked} displayAsleep=${displayAsleep}`,
      { count: capabilities.displayCount, screen_locked: capabilities.screenLocked, display_asleep: displayAsleep },
    ),
    stop,
    note(
      "computer use stop persistence: a stop survives an engine restart only on the macOS XPC agent; a --serve daemon (--oneshot, --mcp) starts unstopped",
    ),
  ]
}

export function computerUseFindings(report) {
  switch (report.kind) {
    case "ready":
      return readyFindings(report)
    case "skipped":
      return [
        base(report),
        report.reason === "disabled"
          ? note("computer use probe: skipped because computer.enabled=false", { state: "skipped", reason: "disabled" })
          : note(`computer use probe: skipped because ${report.host} is unsupported`, {
              state: "skipped",
              reason: "unsupported",
            }),
      ]
    case "unavailable":
      return [
        base(report),
        finding(
          "computer-use",
          "fail",
          `computer use engine: ${report.diagnostic.code}: ${report.diagnostic.message} ${report.diagnostic.cause}`.trimEnd(),
          { state: "unavailable", code: report.diagnostic.code },
        ),
        note(`computer use engine paths tried: ${report.diagnostic.attemptedPaths.join(", ") || "<none>"}`, {
          paths: report.diagnostic.attemptedPaths,
        }),
      ]
    case "not-installed":
      return [
        base(report),
        note("computer use engine: not installed yet; it is downloaded the first time computer use starts", {
          state: "not_installed",
        }),
        note(`computer use engine paths checked: ${report.attemptedPaths.join(", ") || "<none>"}`, {
          paths: report.attemptedPaths,
        }),
      ]
    case "failed":
      return [
        base(report),
        finding("computer-use", "fail", `computer use engine: ${report.code}: ${report.message}`, {
          state: "failed",
          code: report.code,
        }),
        note(`computer use engine path: ${report.enginePath}`, { path: report.enginePath }),
        note(`computer use engine source: ${report.engineSource}`, { source: report.engineSource }),
        ...(report.launchedEnginePath
          ? [
              note(`computer use launched executable: ${report.launchedEnginePath}`, {
                path: report.launchedEnginePath,
              }),
            ]
          : []),
      ]
    default:
      throw new TypeError(`unknown computer use doctor report kind: ${String(report.kind)}`)
  }
}

export async function doctorComputerUseFindings(options = {}) {
  try {
    const runtime = await (options.loadRuntime ?? loadRuntime)()
    const report = await runtime.computerUseDoctorReport({
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      version: options.version ?? packageManifest().version,
      packageRoot: options.packageRoot ?? packageRoot,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      timeoutMs: options.timeoutMs,
    })
    return computerUseFindings(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      finding("computer-use", "warn", `computer use: diagnostics unavailable: ${message}`, {
        state: "diagnostics_unavailable",
        reason: message,
      }),
    ]
  }
}
