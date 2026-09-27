import { accessSync, constants, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import {
  acquireDesktopEngine,
  getDesktopEngineHost,
  isQuarantinedFile,
  locateDesktopEngine,
  type DesktopEngineLocateDiagnostic,
} from "@oh-my-opencode/senpi-desktop-engine"
import type { DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol"
import { isSupportedHost } from "@oh-my-opencode/senpi-desktop-tool"
import { resolveOmoComputerSettings } from "../omo-senpi/src/components/computer-use/settings"
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
      }
    })
  | (ComputerUseDoctorBase & {
      readonly kind: "failed"
      readonly enginePath: string
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

function explicitPathDiagnostic(
  enginePath: string,
  host: string,
  platform: string,
): DesktopEngineLocateDiagnostic | undefined {
  if (!existsSync(enginePath)) {
    return {
      code: "native-unavailable",
      host,
      attemptedPaths: [enginePath],
      message: `No senpi-desktop-engine binary is available for ${host}.`,
      cause: `${enginePath}: missing`,
    }
  }
  if (isQuarantinedFile(enginePath, platform)) {
    return {
      code: "quarantined",
      host,
      attemptedPaths: [enginePath],
      message: `The senpi-desktop-engine binary for ${host} is quarantined by macOS Gatekeeper: ${enginePath}.`,
      cause: `${enginePath}: blocked because com.apple.quarantine is present (macOS Gatekeeper)`,
    }
  }
  try {
    accessSync(enginePath, constants.X_OK)
    return undefined
  } catch (error) {
    if (!(error instanceof Error && "code" in error)) throw error
    return {
      code: "native-unavailable",
      host,
      attemptedPaths: [enginePath],
      message: `No senpi-desktop-engine binary is available for ${host}.`,
      cause: `${enginePath}: not executable (chmod +x)`,
    }
  }
}

async function resolveEnginePath(
  input: ComputerUseDoctorInput,
  enginePath: string | undefined,
): Promise<{ readonly path: string } | { readonly diagnostic: DesktopEngineLocateDiagnostic }> {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const host = getDesktopEngineHost(platform, arch)
  if (enginePath !== undefined) {
    const diagnostic = explicitPathDiagnostic(enginePath, host, platform)
    return diagnostic === undefined ? { path: enginePath } : { diagnostic }
  }

  const locatorOptions = {
    platform,
    arch,
    runtimeDir: input.env.OMO_PACKAGE_DIR,
    execDir: dirname(process.execPath),
    packageDir: resolve(input.packageRoot, "..", "senpi-desktop-engine"),
    repoRoot: resolve(input.packageRoot, "..", ".."),
  }
  const located = locateDesktopEngine(locatorOptions)
  if (located.path !== null) return { path: located.path }
  if (located.diagnostic.code === "quarantined") return { diagnostic: located.diagnostic }

  const timeoutMs = input.timeoutMs ?? COMPUTER_USE_DOCTOR_TIMEOUT_MS
  const boundedFetch = Object.assign(
    (request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(request, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
    { preconnect: fetch.preconnect },
  )
  const acquired = await acquireDesktopEngine({
    version: input.version,
    host,
    fetch: boundedFetch,
    locatorOptions,
  })
  return acquired.path === null ? { diagnostic: acquired.diagnostic } : { path: acquired.path }
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

  const resolved = await resolveEnginePath(input, settings.enginePath)
  if ("diagnostic" in resolved) return unavailable(base, resolved.diagnostic)
  const probed = await probeComputerUseEngine(
    resolved.path,
    input.env,
    input.timeoutMs ?? COMPUTER_USE_DOCTOR_TIMEOUT_MS,
    input.launchEngine,
  )
  if (!probed.ok) {
    return { ...base, kind: "failed", enginePath: resolved.path, code: probed.code, message: probed.message }
  }
  return {
    ...base,
    kind: "ready",
    enginePath: resolved.path,
    hello: probed.value.hello,
    capabilities: probed.value.capabilities,
  }
}
