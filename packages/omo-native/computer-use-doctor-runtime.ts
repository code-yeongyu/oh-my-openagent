import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import {
  getDesktopEngineHost,
  launchDesktopEngine,
  type DesktopEngineLocateDiagnostic,
} from "@oh-my-opencode/senpi-desktop-engine"
import type { DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol"
import { isSupportedHost } from "@oh-my-opencode/senpi-desktop-tool"
import { resolveOmoComputerSettings } from "../omo-senpi/src/components/computer-use/settings"
import { resolveInstalledEngine } from "../omo-senpi/src/components/computer-use/installed-engine"
import {
  COMPUTER_USE_DOCTOR_TIMEOUT_MS,
  type EngineLauncher,
  probeComputerUseEngine,
} from "./computer-use-engine-probe"

export type ComputerUseDoctorBase = {
  readonly enabled: boolean
  readonly supported: boolean
  readonly host: string
}

export type ComputerUseDoctorReport =
  | (ComputerUseDoctorBase & {
      readonly kind: "ready"
      readonly enginePath: string
      readonly engineSource: string
      readonly launchedEnginePath?: string
      readonly hello: {
        readonly protocolVersion: string
        readonly engineVersion: string
        readonly buildSha: string
        readonly abi: string
      }
      readonly capabilities: DesktopCapabilities
    })
  | (ComputerUseDoctorBase & {
      readonly kind: "skipped"
      readonly reason: "disabled" | "unsupported"
    })
  | (ComputerUseDoctorBase & {
      readonly kind: "unavailable"
      readonly diagnostic: {
        readonly code: "native-unavailable" | "quarantined"
        readonly message: string
        readonly cause: string
        readonly attemptedPaths: readonly string[]
        readonly reason?: "no-release-asset"
      }
    })
  | (ComputerUseDoctorBase & {
      /** No engine is installed yet and none is configured; it is downloaded on first use. */
      readonly kind: "not-installed"
      readonly attemptedPaths: readonly string[]
    })
  | (ComputerUseDoctorBase & {
      readonly kind: "failed"
      readonly enginePath: string
      readonly engineSource: string
      readonly launchedEnginePath?: string
      readonly code: "abi-mismatch" | "handshake-failed" | "timeout"
      readonly message: string
    })

export type ComputerUseDoctorInput = {
  readonly cwd: string
  readonly env: OmoConfigEnv
  readonly version: string
  readonly packageRoot: string
  readonly platform?: string
  readonly arch?: string
  readonly timeoutMs?: number
  /** How the selected engine is started; defaults to executing it as a native binary. */
  readonly launchEngine?: EngineLauncher
}

function unavailable(
  base: ComputerUseDoctorBase,
  diagnostic: DesktopEngineLocateDiagnostic,
): ComputerUseDoctorReport {
  return { ...base, kind: "unavailable", diagnostic }
}


export async function computerUseDoctorReport(input: ComputerUseDoctorInput): Promise<ComputerUseDoctorReport> {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const host = getDesktopEngineHost(platform, arch)
  const supported = isSupportedHost(platform)
  const { config } = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "native" })
  const settings = resolveOmoComputerSettings(config.computer, platform)
  const base = { enabled: settings.enabled, supported, host }
  if (!supported) return { ...base, kind: "skipped", reason: "unsupported" }
  if (!settings.enabled) return { ...base, kind: "skipped", reason: "disabled" }

  const locatorOptions = {
    platform, arch,
    runtimeDir: input.env.OMO_PACKAGE_DIR ?? "",
    execDir: dirname(process.execPath),
    packageDir: resolve(input.packageRoot, "..", "senpi-desktop-engine"),
    repoRoot: resolve(input.packageRoot, "..", ".."),
  }
  const resolved = resolveInstalledEngine(settings.enginePath, input.env, input.version, locatorOptions)
  if ("notInstalled" in resolved) return { ...base, kind: "not-installed", attemptedPaths: resolved.notInstalled.attemptedPaths }
  if ("diagnostic" in resolved) return unavailable(base, resolved.diagnostic)
  const probe = (path: string) => ({ probe: probeComputerUseEngine(
    path,
    input.env,
    input.timeoutMs ?? COMPUTER_USE_DOCTOR_TIMEOUT_MS,
    input.launchEngine,
  ) })
  const home = input.env.HOME ?? homedir()
  const launched = settings.enginePath !== undefined && "path" in resolved
    ? { path: resolved.path, value: probe(resolved.path) }
    : await launchDesktopEngine({
      version: input.version,
      host,
      allowDownload: false,
      cacheDir: join(home, ".omo", "cache", "senpi-desktop-engine"),
      installDir: join(home, ".omo", "engines", "senpi-desktop-engine"),
      locatorOptions,
    }, probe)
  if (launched.path === null) {
    return unavailable(base, launched.diagnostic)
  }
  const probed = await launched.value.probe
  const location = {
    enginePath: resolved.path,
    engineSource: resolved.source,
    ...(launched.path === resolved.path ? {} : { launchedEnginePath: launched.path }),
  }
  if (!probed.ok) {
    return { ...base, ...location, kind: "failed", code: probed.code, message: probed.message }
  }
  return {
    ...base,
    kind: "ready",
    ...location,
    hello: probed.value.hello,
    capabilities: probed.value.capabilities,
  }
}
