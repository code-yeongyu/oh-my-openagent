import { getSettingPath } from "./config.mjs"

export const STATE_VERSION = 1

export function emptyState() {
  return { version: STATE_VERSION, owner: null, features: {} }
}

export function normalizeState(raw) {
  if (raw === undefined || raw === null) return emptyState()
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("state.json must hold an object")
  return {
    version: STATE_VERSION,
    owner: raw.owner ?? null,
    features: typeof raw.features === "object" && raw.features !== null ? raw.features : {},
  }
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.features)) {
    throw new Error("manifest.json must have schemaVersion 1 and a features array")
  }
  const seen = new Set()
  for (const feature of manifest.features) {
    if (typeof feature.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(feature.id)) throw new Error(`invalid feature id ${JSON.stringify(feature.id)}`)
    if (seen.has(feature.id)) throw new Error(`duplicate feature id ${feature.id}`)
    seen.add(feature.id)
    if (!Number.isInteger(feature.version) || feature.version < 1) throw new Error(`feature ${feature.id} needs an integer version >= 1`)
    if (typeof feature.doc !== "string") throw new Error(`feature ${feature.id} needs a doc path`)
  }
  return manifest
}

function configSnapshot(feature, settings) {
  const snapshot = {}
  for (const key of feature.configKeys ?? []) snapshot[key] = getSettingPath(settings, key)
  return snapshot
}

function sameSnapshot(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])
  for (const key of keys) {
    if ((left ?? {})[key] !== (right ?? {})[key]) return false
  }
  return true
}

/**
 * Compare the shipped manifest with what this user has installed. Only the differences come back, so
 * an existing install never re-runs the whole setup: `install` (never installed), `update` (manifest
 * version moved, or a config key the feature was installed with changed), `remove` (disabled in config
 * or no longer shipped). `current` lists the untouched features.
 */
export function planReconcile({ manifest, state, settings }) {
  const plan = {
    fresh: Object.keys(state.features).length === 0,
    install: [],
    update: [],
    remove: [],
    current: [],
    skipped: [],
  }
  const shipped = new Set()
  for (const feature of manifest.features) {
    shipped.add(feature.id)
    const installed = state.features[feature.id]
    const wanted = feature.enabledBy === undefined || getSettingPath(settings, feature.enabledBy) === true
    const config = configSnapshot(feature, settings)
    const entry = { id: feature.id, version: feature.version, doc: feature.doc, summary: feature.summary ?? "" }
    if (!wanted) {
      if (installed) plan.remove.push({ ...entry, reason: "disabled", data: installed.data ?? {} })
      else plan.skipped.push({ id: feature.id, reason: "disabled" })
    } else if (!installed) {
      plan.install.push({ ...entry, reason: "new", config })
    } else if (installed.version !== feature.version) {
      plan.update.push({ ...entry, reason: "version", from: installed.version, config, data: installed.data ?? {} })
    } else if (!sameSnapshot(installed.config, config)) {
      plan.update.push({ ...entry, reason: "config", from: installed.version, previousConfig: installed.config ?? {}, config, data: installed.data ?? {} })
    } else {
      plan.current.push(feature.id)
    }
  }
  for (const [id, installed] of Object.entries(state.features)) {
    if (!shipped.has(id)) plan.remove.push({ id, version: installed.version, doc: null, summary: "", reason: "retired", data: installed.data ?? {} })
  }
  return plan
}

/** Mark a feature installed at the manifest version, with the config it was installed for. */
export function recordFeature({ manifest, state, settings, id, data = {}, now = new Date() }) {
  const feature = manifest.features.find((candidate) => candidate.id === id)
  if (feature === undefined) throw new Error(`unknown feature ${id}; the manifest ships ${manifest.features.map((f) => f.id).join(", ")}`)
  return {
    ...state,
    features: {
      ...state.features,
      [id]: { version: feature.version, installedAt: now.toISOString(), config: configSnapshot(feature, settings), data },
    },
  }
}

export function forgetFeature({ state, id }) {
  if (!(id in state.features)) throw new Error(`feature ${id} is not installed`)
  const features = { ...state.features }
  delete features[id]
  return { ...state, features }
}

export function hasPendingWork(plan) {
  return plan.install.length + plan.update.length + plan.remove.length > 0
}
