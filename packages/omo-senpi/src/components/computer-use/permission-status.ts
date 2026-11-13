import type { DesktopEngineLocatorOptions } from "@oh-my-opencode/senpi-desktop-engine"
import { omoReleaseVersion } from "./engine-source"
import { COMPUTER_USE_DOCTOR_TIMEOUT_MS, probeComputerUseEngine } from "./engine-probe"
import { resolveInstalledEngine } from "./installed-engine"

/** Installed engines support the doctor's passive hello/capabilities path without a session or stop listener. */
export async function describeEnginePermissions(
  enginePath: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  locatorOptions: DesktopEngineLocatorOptions = {},
): Promise<string> {
  const resolved = resolveInstalledEngine(enginePath, env, omoReleaseVersion(env), locatorOptions)
  if (!("path" in resolved)) return "OS permissions: unknown until first use (no usable installed engine)"
  const probed = await probeComputerUseEngine(resolved.path, env, COMPUTER_USE_DOCTOR_TIMEOUT_MS)
  if (!probed.ok) return `OS permissions: unknown (${probed.code}: ${probed.message})`
  const capabilities = probed.value.capabilities
  return `OS permissions: capturePermission=${capabilities.capturePermission} inputPermission=${capabilities.inputPermission} axPermission=${capabilities.axPermission} (passive probe)`
}
