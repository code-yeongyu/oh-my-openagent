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
  /** Distinct providers usable this session: signed in (auth.json) or configured (models.json). */
  readonly providerCount: number
  readonly signedInProviderCount: number
  readonly configuredProviderCount: number
  /** Sorted provider kinds; any id outside KNOWN_PROVIDERS is folded into one `custom`. */
  readonly providers: string
}

/** Subscription ids the engine renamed; installs that predate the rename still carry the old key. */
export const RETIRED_PROVIDER_IDS: Readonly<Record<string, string>> = Object.freeze({
  "claude-sdk-oauth": "anthropic-subscription",
  "openai-codex": "chatgpt-subscription",
})

const EMPTY: OmoNativeInventory = Object.freeze({
  providerCount: 0, signedInProviderCount: 0, configuredProviderCount: 0, modelCount: 0, providers: "",
})

/**
 * Read `models.json` + `settings.json` (+ the top-level KEYS of `auth.json`, never a value) from the agent
 * home. A provider counts when the user signed into it or configured it (#10887). Provider ids ship only when they are in
 * the known vocabulary, the default pair is masked, and no model name a user configured privately
 * leaves the machine. A missing or malformed models/settings inventory reports one diagnostic and yields zero
 * configured providers (the signed-in ones still count); a malformed auth.json reports one diagnostic -
 * inventory is a nice-to-have, never a reason to fail session telemetry.
 */
export function readOmoNativeInventory(
  agentDir: string,
  diagnostics?: (input: OmoNativeInventoryDiagnostic) => void,
): OmoNativeInventory {
  const signedIn = readSignedInProviders(agentDir, diagnostics)
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

    const configured = Object.keys(providers).map(canonicalProvider)
    const usable = [...new Set([...configured, ...signedIn])]
    const defaultProvider = stringProperty(settings, "defaultProvider")
    const defaultModel = stringProperty(settings, "defaultModel")
    const masked = defaultProvider !== undefined && defaultModel !== undefined
      ? maskProviderAndModel(defaultProvider, defaultModel)
      : undefined
    return {
      providerCount: usable.length,
      signedInProviderCount: new Set(signedIn).size,
      configuredProviderCount: new Set(configured).size,
      modelCount,
      providers: providerKinds(usable),
      ...(masked === undefined ? {} : {
        defaultProvider: masked.provider,
        defaultModel: masked.model_id,
      }),
    }
  } catch (error) {
    // A parse error's message can quote the start of an apiKey in models.json: report a fixed one instead.
    const reported = error instanceof SyntaxError ? new Error("models.json or settings.json is not valid JSON") : error
    diagnostics?.({ event: "omo_native_inventory_read_failed", error: reported, source: "omo-native-session" })
    // The configured inventory is unreadable; the providers the user signed into still count.
    return signedIn.length === 0 ? EMPTY : {
      ...EMPTY,
      providerCount: new Set(signedIn).size,
      signedInProviderCount: new Set(signedIn).size,
      providers: providerKinds([...new Set(signedIn)]),
    }
  }
}

/** auth.json provider keys; a missing file is no sign-in, a malformed one reports a diagnostic and counts none. */
function readSignedInProviders(
  agentDir: string,
  diagnostics: ((input: OmoNativeInventoryDiagnostic) => void) | undefined,
): string[] {
  try {
    return Object.keys(readObject(join(agentDir, "auth.json"))).map(canonicalProvider)
  } catch (error) {
    if (Reflect.get(Object(error), "code") !== "ENOENT") {
      // A fixed error: a JSON parse message can quote the start of a credential.
      diagnostics?.({ event: "omo_native_inventory_read_failed", error: new Error("auth.json is unreadable or not a JSON object"), source: "omo-native-session" })
    }
    return []
  }
}

function canonicalProvider(id: string): string {
  return RETIRED_PROVIDER_IDS[id] ?? id
}

function providerKinds(ids: readonly string[]): string {
  const known = ids.filter((id) => isKnownProvider(id)).sort()
  return (known.length === ids.length ? known : [...known, "custom"]).join(",")
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
