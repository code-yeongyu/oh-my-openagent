import { join } from "node:path"

import { readJsoncFile } from "@oh-my-opencode/utils"

/**
 * Whether the engine may rotate a provider's stored credential accounts on the first turn.
 *
 * senpi's `ModelRuntime.couldRotateCredentials` never rotates when a runtime API key is set for the
 * provider (`getProviderAuthStatus` reports `source: "runtime"`) or when `models.json` sets
 * `providers.<id>.credentials.rotation: false`; the request then resolves the flat (default)
 * credential only. The rotation policy lives only in `models.json` and the runtime exposes no
 * accessor for it, so it is read from the same file the engine loads: `<agentDir>/models.json`
 * (JSONC, as senpi parses it). An unreadable or absent file is the engine's default: rotation on.
 */
export type CredentialRotationPolicy = (provider: string) => boolean

type AuthStatusSource = { getProviderAuthStatus?(provider: string): unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function rotationDisabledProviders(agentDir: string | undefined): ReadonlySet<string> {
  if (agentDir === undefined) return new Set()
  const parsed = readJsoncFile<unknown>(join(agentDir, "models.json"))
  const providers = isRecord(parsed) ? parsed["providers"] : undefined
  if (!isRecord(providers)) return new Set()
  const disabled = new Set<string>()
  for (const [id, entry] of Object.entries(providers)) {
    const credentials = isRecord(entry) ? entry["credentials"] : undefined
    if (isRecord(credentials) && credentials["rotation"] === false) disabled.add(id)
  }
  return disabled
}

export function credentialRotationPolicy(registry: AuthStatusSource, agentDir: string | undefined): CredentialRotationPolicy {
  const disabled = rotationDisabledProviders(agentDir)
  return (provider) => {
    if (disabled.has(provider)) return false
    if (typeof registry.getProviderAuthStatus !== "function") return true
    const status = registry.getProviderAuthStatus(provider)
    return !(isRecord(status) && status["source"] === "runtime")
  }
}
