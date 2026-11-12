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

const MODEL_PROFILE_KEYS = ["model_profile", "model_profiles", "model_pad"] as const
// The loader folds a legacy `[senpi]` block into the canonical `[native]` one (`[native]` wins each key). A client's
// resolver reads the harness block as `[senpi]`, the key users write, so the merged block is sent under that key.
const LEGACY_HARNESS_BLOCK = "[senpi]"
const HARNESS_BLOCK = "[native]"

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null

function flatModelProfileKeys(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const key of MODEL_PROFILE_KEYS) if (config[key] !== undefined) kept[key] = config[key]
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
