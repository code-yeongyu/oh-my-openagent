import { readFileSync } from "node:fs"
import { join } from "node:path"

import { KNOWN_PROVIDERS, maskProviderAndModel } from "./product-identity"

export type OmoNativeInventoryDiagnostic = {
  readonly event: "omo_native_inventory_read_failed"
  readonly error: unknown
  readonly source: "omo-native-session"
}

/** The engine's connected-model inventory, reduced to counts plus the masked default pair. */
export type OmoNativeInventory = {
  readonly defaultModel?: string
  readonly defaultProvider?: string
  readonly modelCount: number
  readonly providerCount: number
  readonly providers: string
}

/**
 * Read `models.json` + `settings.json` from the agent home. Provider ids ship only when they are in
 * the known vocabulary, the default pair is masked, and no model name a user configured privately
 * leaves the machine. A missing or malformed inventory reports one diagnostic and yields zeroes -
 * inventory is a nice-to-have, never a reason to fail session telemetry.
 */
export function readOmoNativeInventory(
  agentDir: string,
  diagnostics?: (input: OmoNativeInventoryDiagnostic) => void,
): OmoNativeInventory {
  try {
    const models = readObject(join(agentDir, "models.json"))
    const settings = readObject(join(agentDir, "settings.json"))
    const providers = Reflect.get(models, "providers")
    if (!isRecord(providers)) throw new Error("models.json providers must be an object")

    let modelCount = 0
    for (const provider of Object.values(providers)) {
      if (!isRecord(provider)) throw new Error("models.json provider must be an object")
      const modelsValue = Reflect.get(provider, "models")
      if (modelsValue !== undefined && !Array.isArray(modelsValue)) {
        throw new Error("models.json provider models must be an array")
      }
      modelCount += modelsValue?.length ?? 0
    }

    const providerIds = Object.keys(providers)
    const defaultProvider = stringProperty(settings, "defaultProvider")
    const defaultModel = stringProperty(settings, "defaultModel")
    const masked = defaultProvider !== undefined && defaultModel !== undefined
      ? maskProviderAndModel(defaultProvider, defaultModel)
      : undefined
    return {
      providerCount: providerIds.length,
      modelCount,
      providers: providerIds.filter((id) => isKnownProvider(id)).sort().join(","),
      ...(masked === undefined ? {} : {
        defaultProvider: masked.provider,
        defaultModel: masked.model_id,
      }),
    }
  } catch (error) {
    diagnostics?.({ event: "omo_native_inventory_read_failed", error, source: "omo-native-session" })
    return { providerCount: 0, modelCount: 0, providers: "" }
  }
}

function readObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path} must contain an object`)
  return parsed
}

function isKnownProvider(value: string): boolean {
  return KNOWN_PROVIDERS.some((provider) => provider === value)
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const property = Reflect.get(value, key)
  return typeof property === "string" && property.length > 0 ? property : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
