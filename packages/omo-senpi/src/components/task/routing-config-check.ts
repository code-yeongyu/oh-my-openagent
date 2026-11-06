import { normalizeLegacyModelFields } from "@oh-my-opencode/omo-config-core"

// The omo config locations that can decide which model a Senpi child runs on, validated in one pass at every spawn
// (#11355), in every layer the loader read (the user layer and each project layer). The loader keeps a layer with a bad
// leaf by dropping that leaf, and a dropped routing leaf silently routes the child on another layer or the defaults.
//
// Locations, in each layer:
//   - the base scope, then its Senpi harness blocks `[senpi]` and `[native]`;
//   - every profile `profiles.<name>` (active or not, so a typo fails before the day the profile is selected), then
//     that profile's `[senpi]` and `[native]` blocks.
// In each location: `categories.<name>` and `agents.<name>` entries (`model`, `models`, `fallback_models`, and the
// reasoning selectors) and `exclude_models`. Another harness's block (`[codex]`, `[opencode]`) never routes a Senpi child.
const SENPI_HARNESS_BLOCKS = ["[senpi]", "[native]"] as const
const ROUTING_PATH = /^(?:profiles\.[^.]+\.)?(?:\[(?:senpi|native)\]\.)?(?:categories|agents|exclude_models|models)(?:\.|$)/
// "provider/model", or a model catalog name that resolves to one.
const MODEL_REF = /^[^\s/]+\/\S+$/
const SELECTOR_FIELDS = ["variant", "reasoningEffort", "provider"] as const
const CHAIN_FIELDS = ["models", "fallback_models"] as const
const ENTRY_GROUPS = ["categories", "agents"] as const

/** One place routing fields live, with the path prefix its fields are reported under and the profile it belongs to. */
export type RoutingLocation = {
  readonly prefix: string
  readonly profile?: string
  readonly scope: Record<string, unknown>
}

/** Whether a loader issue path is a routing field in any location above. */
export function isRoutingPath(issuePath: string): boolean {
  return ROUTING_PATH.test(issuePath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Every routing location of one layer, in the order listed above. */
function routingLocations(layer: unknown): readonly RoutingLocation[] {
  if (!isRecord(layer)) return []
  const locations: RoutingLocation[] = []
  const add = (prefix: string, scope: Record<string, unknown>, profile?: string) => {
    locations.push({ prefix, scope, ...(profile === undefined ? {} : { profile }) })
    for (const block of SENPI_HARNESS_BLOCKS) {
      const value = scope[block]
      if (isRecord(value)) locations.push({ prefix: `${prefix}${block}.`, scope: value, ...(profile === undefined ? {} : { profile }) })
    }
  }
  add("", layer)
  const profiles = layer["profiles"]
  if (isRecord(profiles)) {
    for (const [name, profile] of Object.entries(profiles)) if (isRecord(profile)) add(`profiles.${name}.`, profile, name)
  }
  return locations
}

// The loader reads the legacy reasoning suffixes ("model (high)", "model high") as "model:high"; check the same form.
function canonicalModel(value: string): string {
  const normalized = normalizeLegacyModelFields({ model: value })["model"]
  return typeof normalized === "string" ? normalized : value
}

type Check = {
  readonly issues: string[]
  readonly isModelRef: (value: unknown) => boolean
}

function checkSelectors(entry: Record<string, unknown>, at: string, check: Check): void {
  for (const key of SELECTOR_FIELDS) {
    if (key in entry && (typeof entry[key] !== "string" || entry[key] === "")) check.issues.push(`${at}.${key}`)
  }
}

function checkChain(value: unknown, at: string, check: Check, allowsSingle: boolean): void {
  if (allowsSingle && typeof value === "string") {
    if (!check.isModelRef(value)) check.issues.push(at)
    return
  }
  // An empty chain names no model at all, so the child would route on whatever the other layers leave.
  if (!Array.isArray(value) || value.length === 0) {
    check.issues.push(at)
    return
  }
  value.forEach((item: unknown, index) => {
    const itemAt = `${at}.${index}`
    if (typeof item === "string") {
      if (!check.isModelRef(item)) check.issues.push(itemAt)
      return
    }
    if (!isRecord(item) || !check.isModelRef(item["model"])) {
      check.issues.push(itemAt)
      return
    }
    checkSelectors(item, itemAt, check)
  })
}

function checkEntry(entry: unknown, at: string, check: Check): void {
  if (!isRecord(entry)) {
    check.issues.push(at)
    return
  }
  if ("model" in entry && !check.isModelRef(entry["model"])) check.issues.push(`${at}.model`)
  for (const key of CHAIN_FIELDS) if (key in entry) checkChain(entry[key], `${at}.${key}`, check, key === "fallback_models")
  checkSelectors(entry, at, check)
}

function checkLocation(location: RoutingLocation, check: Check): void {
  for (const group of ENTRY_GROUPS) {
    const entries = location.scope[group]
    const at = `${location.prefix}${group}`
    if (entries === undefined) continue
    if (!isRecord(entries)) {
      check.issues.push(at)
      continue
    }
    for (const [name, entry] of Object.entries(entries)) checkEntry(entry, `${at}.${name}`, check)
  }
  const excluded = location.scope["exclude_models"]
  if (excluded === undefined) return
  if (!Array.isArray(excluded) || excluded.some((item: unknown) => typeof item !== "string" || item === "")) {
    check.issues.push(`${location.prefix}exclude_models`)
  }
}

function catalogKeys(scope: Record<string, unknown>): readonly string[] {
  const catalog = scope["models"]
  return isRecord(catalog) ? Object.keys(catalog) : []
}

/**
 * Every routing-field path the layers get wrong, as written: a wrong type, null, an empty value, or a model id that is
 * neither "provider/model" (legacy reasoning suffixes included) nor a catalog name the location can resolve. A base
 * location resolves the catalog the merged view resolves plus every base scope's `models`; a profile location also
 * resolves its own profile's `models`.
 */
export function routingIssues(
  layers: readonly { readonly config: unknown }[],
  resolvedCatalog: unknown,
): readonly { readonly layer: number; readonly issues: readonly string[] }[] {
  const locations = layers.map((layer) => routingLocations(layer.config))
  const baseNames = new Set<string>(isRecord(resolvedCatalog) ? Object.keys(resolvedCatalog) : [])
  const profileNames = new Map<string, Set<string>>()
  for (const location of locations.flat()) {
    if (location.profile === undefined) {
      for (const name of catalogKeys(location.scope)) baseNames.add(name)
      continue
    }
    const names = profileNames.get(location.profile) ?? new Set<string>()
    for (const name of catalogKeys(location.scope)) names.add(name)
    profileNames.set(location.profile, names)
  }
  return locations.map((layerLocations, layer) => {
    const issues: string[] = []
    for (const location of layerLocations) {
      const own = location.profile === undefined ? undefined : profileNames.get(location.profile)
      const known = (name: string) => baseNames.has(name) || own?.has(name) === true
      const isModelRef = (value: unknown): boolean => {
        if (typeof value !== "string" || value === "") return false
        if (known(value)) return true
        const canonical = canonicalModel(value)
        return MODEL_REF.test(canonical) || known(canonical.split(":")[0] ?? canonical)
      }
      checkLocation(location, { issues, isModelRef })
    }
    return { layer, issues }
  })
}
