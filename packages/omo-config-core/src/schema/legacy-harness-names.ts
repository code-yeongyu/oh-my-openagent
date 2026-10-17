import { OMO_CONFIG_LEGACY_HARNESS_ALIASES } from "./harness"

export type LegacyHarnessRename = {
  readonly canonical: string
  readonly dropped: boolean
  readonly legacy: string
  readonly path: string
}

export type CanonicalizeLegacyHarnessBlocksResult = {
  readonly document: Record<string, unknown>
  readonly renames: readonly LegacyHarnessRename[]
}

export function canonicalHarnessName(name: string): string {
  return Object.hasOwn(OMO_CONFIG_LEGACY_HARNESS_ALIASES, name) ? OMO_CONFIG_LEGACY_HARNESS_ALIASES[name] : name
}

export function harnessBlockKey(harness: string): string {
  return `[${harness}]`
}

function legacyHarnessOfBlockKey(key: string): string | undefined {
  if (!key.startsWith("[") || !key.endsWith("]")) return undefined
  const harness = key.slice(1, -1)
  return Object.hasOwn(OMO_CONFIG_LEGACY_HARNESS_ALIASES, harness) ? harness : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// A harness block is legal only at the root and inside a `profiles.<name>` object, so the walk is
// targeted rather than recursive: a `[senpi]` string sitting anywhere else is user data, not a key
// this rename owns.
function canonicalizeBlocksIn(
  container: Record<string, unknown>,
  path: readonly string[],
  renames: LegacyHarnessRename[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(container)) {
    const legacyHarness = legacyHarnessOfBlockKey(key)
    if (legacyHarness === undefined) {
      result[key] = value
      continue
    }
    const canonical = harnessBlockKey(canonicalHarnessName(legacyHarness))
    const dropped = Object.hasOwn(container, canonical)
    renames.push({ canonical, dropped, legacy: key, path: [...path, key].join(".") })
    if (!dropped) result[canonical] = value
  }
  return result
}

export function canonicalizeLegacyHarnessBlocks(document: unknown): CanonicalizeLegacyHarnessBlocksResult {
  if (!isRecord(document)) return { document: {}, renames: [] }

  const renames: LegacyHarnessRename[] = []
  const canonicalized = canonicalizeBlocksIn(document, [], renames)
  const profiles = canonicalized["profiles"]
  if (isRecord(profiles)) {
    const canonicalProfiles: Record<string, unknown> = {}
    for (const [name, profile] of Object.entries(profiles)) {
      canonicalProfiles[name] = isRecord(profile)
        ? canonicalizeBlocksIn(profile, ["profiles", name], renames)
        : profile
    }
    canonicalized["profiles"] = canonicalProfiles
  }
  return { document: canonicalized, renames }
}

export function hasLegacyHarnessBlocks(document: unknown): boolean {
  return canonicalizeLegacyHarnessBlocks(document).renames.length > 0
}
