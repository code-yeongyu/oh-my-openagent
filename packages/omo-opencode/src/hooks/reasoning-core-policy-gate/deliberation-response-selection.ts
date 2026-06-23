import { comparePolicies } from "../consequence-lifting-sidecar/dominance-comparator-v2"
import type { SidecarOutput } from "../consequence-lifting-sidecar/types"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function getSelectedDecision(sidecarResult: SidecarOutput | null): string | null {
  const candidates = [...new Set(Object.values(sidecarResult?.bundle?.selection.selectedBySlot ?? {}).flat())]
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0] ?? null

  const policies = new Map(sidecarResult?.policies.map((policy) => [policy.primaryDecision, policy]) ?? [])
  const dominantCandidates = candidates.filter((candidate) => {
    const candidatePolicy = policies.get(candidate)
    if (!candidatePolicy) return false

    return candidates.every((otherCandidate) => {
      if (otherCandidate === candidate) return true
      const otherPolicy = policies.get(otherCandidate)
      if (!otherPolicy) return false
      return comparePolicies(candidatePolicy, otherPolicy).winner === "left"
    })
  })

  return dominantCandidates.length === 1 ? dominantCandidates[0] ?? null : null
}

export function getSolverSelectedDecision(extensions: unknown[], optionMap: Map<string, string>): string | null {
  if (extensions.length !== 1) return null
  const ext = extensions[0]
  if (!isRecord(ext)) return null
  const conclusions = Array.isArray(ext.accepted_conclusions) ? ext.accepted_conclusions : []
  const positiveSelects = conclusions.filter(
    (c): c is string => typeof c === "string" && !c.startsWith("-") && !c.startsWith("@") &&
      (c.startsWith("select(") || c.startsWith("select_") || c.endsWith("_selected") || c.includes("selected")),
  )
  if (positiveSelects.length !== 1) return null
  const candidate = positiveSelects[0]
  if (!candidate) return null
  if (optionMap.has(candidate)) return candidate
  const lc = candidate.toLowerCase()
  for (const key of optionMap.keys()) {
    if (key.toLowerCase() === lc) return key
  }
  const slugVariant = candidate.replace("select(", "select_").replace(")", "")
  if (optionMap.has(slugVariant)) return slugVariant
  const lcSlug = slugVariant.toLowerCase()
  for (const key of optionMap.keys()) {
    if (key.toLowerCase() === lcSlug) return key
  }
  return candidate
}

export function hasNoSelectableBundle(sidecarResult: SidecarOutput | null): boolean {
  return sidecarResult?.humility?.report.escalationReasons.some((reason) => reason.code === "no_selectable_bundle") ?? false
}

export function hasMultiSelectInExtensions(extensions: unknown[]): boolean {
  return extensions.some((extension) => {
    return getSelectConclusions(extension).length > 1
  })
}

export function buildMultipleExtensionsRationale(extensions: unknown[]): string {
  if (extensions.length > 1) {
    return `Multiple preferred extensions returned (${extensions.length}); no unique bundle selected.`
  }

  const multiSelectCount = extensions
    .map((extension) => getSelectConclusions(extension).length)
    .find((count) => count > 1)

  return `Preferred semantics returned a single extension with ${multiSelectCount ?? 0} selectable conclusions; no unique bundle selected.`
}

function getSelectConclusions(extension: unknown): string[] {
  if (!isRecord(extension) || !Array.isArray(extension.accepted_conclusions)) return []
  return extension.accepted_conclusions.filter(
    (conclusion): conclusion is string => typeof conclusion === "string"
      && (conclusion.startsWith("select_") || conclusion.startsWith("select(")),
  )
}
