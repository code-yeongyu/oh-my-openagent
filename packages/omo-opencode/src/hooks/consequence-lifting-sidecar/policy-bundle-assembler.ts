import type { PolicyBundle, BundleConstraint, BundleSlot } from "./policy-bundle-types"
import type { QualifiedPolicy } from "./types"

function extractSlotTag(decision: string, tags: string[]): string {
  const tagged = tags.find((tag) => tag.startsWith("slot:"))
  if (tagged) return tagged.slice(5)
  if (decision.includes("timing") || decision.includes("phase") || decision.includes("defer")) return "timing"
  if (decision.includes("hedge") || decision.includes("vol") || decision.includes("pair")) return "hedge"
  if (decision.includes("size") || decision.includes("sizing")) return "sizing"
  return "primary_decision"
}

function collectConstraints(decision: string, tags: string[]): BundleConstraint[] {
  return tags.flatMap<BundleConstraint>((tag) => {
    if (tag.startsWith("exclusive_with:")) {
      return [{ left: decision, right: tag.slice("exclusive_with:".length), kind: "mutually_exclusive" as const }]
    }
    if (tag.startsWith("requires:")) {
      return [{ left: decision, right: tag.slice("requires:".length), kind: "requires" as const }]
    }
    if (tag.startsWith("composable_with:")) {
      return [{ left: decision, right: tag.slice("composable_with:".length), kind: "composable_with" as const }]
    }
    return []
  })
}

export function assemblePolicyBundle(
  policies: QualifiedPolicy[],
  tagsByDecision: Map<string, string[]>,
): PolicyBundle {
  const slots = new Map<string, string[]>()
  const constraints: BundleConstraint[] = []

  for (const policy of policies) {
    const tags = tagsByDecision.get(policy.primaryDecision) ?? []
    const slotName = extractSlotTag(policy.primaryDecision, tags)
    const existing = slots.get(slotName) ?? []
    existing.push(policy.primaryDecision)
    slots.set(slotName, existing)
    constraints.push(...collectConstraints(policy.primaryDecision, tags))
  }

  const bundleSlots: BundleSlot[] = [...slots.entries()].map(([name, candidates]) => ({
    name,
    candidates,
    maxSelectable: 1,
  }))

  return { slots: bundleSlots, constraints }
}
