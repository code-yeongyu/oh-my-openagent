import { loadOmoConfig, type OmoConfigEnv, resolveOmoProfileName } from "@oh-my-opencode/omo-config-core"

import { projectConfigPath } from "./project-config-path"

/** Only the keys a model-profile resolver reads leave the machine; the rest of a config file (servers, secrets) never does. */
export type ModelProfileLayer = Readonly<Record<string, unknown>>

export type ProjectModelProfileViewReply =
  | {
      readonly kind: "ok"
      readonly layers: {
        readonly user: ModelProfileLayer
        readonly project?: ModelProfileLayer
        readonly activeProfile?: string
      }
    }
  | { readonly kind: "refused"; readonly code: "no_session"; readonly message: string }

// The loader folds a legacy `[senpi]` block into the canonical `[native]` one (`[native]` wins each key). A client's
// resolver reads the harness block as `[senpi]`, the key users write, so the merged block is sent under that key.
const LEGACY_HARNESS_BLOCK = "[senpi]"
const HARNESS_BLOCK = "[native]"

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null

// Exactly the fields a client's resolver reads. A `models[]` entry may carry `provider_options` (API keys, auth
// headers, credentialed base URLs), so every level is rebuilt from this allowlist instead of copied.
const PROFILE_TEXT_KEYS = ["display_name", "description", "caution", "family", "tier"] as const
const MODEL_ENTRY_KEYS = ["model", "reasoning"] as const
const PAD_LABEL_KEYS = ["daily", "geeky", "normal", "heavy"] as const

function pickStrings(record: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") kept[key] = value
  }
  return kept
}

function modelEntry(entry: unknown): unknown {
  if (typeof entry === "string") return entry
  const record = asRecord(entry)
  return record === null ? null : pickStrings(record, MODEL_ENTRY_KEYS)
}

function modelProfiles(value: unknown): Record<string, unknown> | undefined {
  const profiles = asRecord(value)
  if (profiles === null) return undefined
  const kept: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(profiles)) {
    const profile = asRecord(raw)
    if (profile === null) continue
    const models = profile["models"]
    kept[name] = {
      ...pickStrings(profile, PROFILE_TEXT_KEYS),
      ...(Array.isArray(models) ? { models: models.map(modelEntry).filter((entry) => entry !== null) } : {}),
    }
  }
  return kept
}

function modelPad(value: unknown): Record<string, unknown> | undefined {
  const pad = asRecord(value)
  if (pad === null) return undefined
  const labels = asRecord(pad["labels"])
  return labels === null ? {} : { labels: pickStrings(labels, PAD_LABEL_KEYS) }
}

function flatModelProfileKeys(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  const active = config["model_profile"]
  if (typeof active === "string") kept["model_profile"] = active
  const profiles = modelProfiles(config["model_profiles"])
  if (profiles !== undefined) kept["model_profiles"] = profiles
  const pad = modelPad(config["model_pad"])
  if (pad !== undefined) kept["model_pad"] = pad
  return kept
}

// A harness block holds only flat model-profile keys, so it is read one level deep and never walked further.
function modelProfileKeys(config: Readonly<Record<string, unknown>>, withProfiles: boolean): Record<string, unknown> {
  const kept = flatModelProfileKeys(config)
  const harness = { ...(asRecord(config[LEGACY_HARNESS_BLOCK]) ?? {}), ...(asRecord(config[HARNESS_BLOCK]) ?? {}) }
  const harnessKeys = flatModelProfileKeys(harness)
  if (Object.keys(harnessKeys).length > 0) kept[LEGACY_HARNESS_BLOCK] = harnessKeys
  const profiles = withProfiles ? asRecord(config["profiles"]) : null
  if (profiles !== null) {
    const keptProfiles: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(profiles)) {
      const profile = asRecord(value)
      if (profile === null) continue
      const inner = modelProfileKeys(profile, false)
      if (Object.keys(inner).length > 0) keptProfiles[name] = inner
    }
    if (Object.keys(keptProfiles).length > 0) kept["profiles"] = keptProfiles
  }
  return kept
}

export function viewProjectModelProfile(
  session: { readonly cwd: string } | undefined,
  deps: { readonly env?: OmoConfigEnv } = {},
): ProjectModelProfileViewReply {
  if (session === undefined) return { kind: "refused", code: "no_session", message: "No session is bound to answer for a folder." }
  const env = deps.env ?? process.env
  const loaded = loadOmoConfig({ cwd: session.cwd, env })
  const userLayer = loaded.layers.find((layer) => layer.source.scope === "user")
  const projectPath = projectConfigPath(session.cwd)
  // A home folder's file is the user layer; the loader never also lists it as a project layer.
  const projectLayer = loaded.layers.find(
    (layer) => layer.source.scope === "project" && layer.source.path === projectPath && layer.source.path !== userLayer?.source.path,
  )
  const activeProfile = resolveOmoProfileName({ env })
  return {
    kind: "ok",
    layers: {
      user: modelProfileKeys(userLayer?.config ?? {}, true),
      ...(projectLayer === undefined ? {} : { project: modelProfileKeys(projectLayer.config, true) }),
      ...(activeProfile === undefined ? {} : { activeProfile }),
    },
  }
}
