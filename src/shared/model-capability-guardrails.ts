import type { ModelCapabilitiesSnapshot } from "./model-capabilities"
import { getBundledModelCapabilitiesSnapshot } from "./model-capabilities"
import {
  getExactModelIDAliasRules,
  getPatternModelIDAliasRules,
  resolveModelIDAlias,
} from "./model-capability-aliases"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

export type ModelCapabilityGuardrailIssue =
  | {
      kind: "alias-target-missing-from-snapshot"
      ruleID: string
      aliasModelID: string
      canonicalModelID: string
      message: string
    }
  | {
      kind: "exact-alias-collides-with-snapshot"
      ruleID: string
      aliasModelID: string
      canonicalModelID: string
      message: string
    }
  | {
      kind: "pattern-alias-collides-with-snapshot"
      ruleID: string
      modelID: string
      canonicalModelID: string
      message: string
    }
  | {
      kind: "built-in-model-relies-on-alias"
      modelID: string
      canonicalModelID: string
      ruleID: string
      message: string
    }
  | {
      kind: "built-in-model-missing-from-snapshot"
      modelID: string
      canonicalModelID: string
      message: string
    }

type CollectModelCapabilityGuardrailIssuesInput = {
  snapshot?: ModelCapabilitiesSnapshot
  requirementModelIDs?: Iterable<string>
}

function normalizeLookupModelID(modelID: string): string {
  return modelID.trim().toLowerCase()
}

export function getBuiltInRequirementModelIDs(): string[] {
  const modelIDs = new Set<string>()

  for (const requirement of Object.values(AGENT_MODEL_REQUIREMENTS)) {
    for (const entry of requirement.fallbackChain) {
      modelIDs.add(entry.model)
    }
  }

  for (const requirement of Object.values(CATEGORY_MODEL_REQUIREMENTS)) {
    for (const entry of requirement.fallbackChain) {
      modelIDs.add(entry.model)
    }
  }

  return [...modelIDs].sort()
}

export function collectModelCapabilityGuardrailIssues(
  input: CollectModelCapabilityGuardrailIssuesInput = {},
): ModelCapabilityGuardrailIssue[] {
  const snapshot = input.snapshot ?? getBundledModelCapabilitiesSnapshot()
  const snapshotModelIDs = new Set(
    Object.keys(snapshot.models).map((modelID) => normalizeLookupModelID(modelID)),
  )
  const requirementModelIDs = input.requirementModelIDs ?? getBuiltInRequirementModelIDs()
  const issues: ModelCapabilityGuardrailIssue[] = []

  for (const rule of getExactModelIDAliasRules()) {
    if (!snapshotModelIDs.has(rule.canonicalModelID)) {
      issues.push({
        kind: "alias-target-missing-from-snapshot",
        ruleID: rule.ruleID,
        aliasModelID: rule.aliasModelID,
        canonicalModelID: rule.canonicalModelID,
        message: `Alias ${rule.aliasModelID} points to missing snapshot model ${rule.canonicalModelID}.`,
      })
    }

    if (snapshotModelIDs.has(rule.aliasModelID)) {
      issues.push({
        kind: "exact-alias-collides-with-snapshot",
        ruleID: rule.ruleID,
        aliasModelID: rule.aliasModelID,
        canonicalModelID: rule.canonicalModelID,
        message: `Alias ${rule.aliasModelID} now exists in models.dev and should be reviewed instead of force-mapping to ${rule.canonicalModelID}.`,
      })
    }
  }

  for (const rule of getPatternModelIDAliasRules()) {
    for (const modelID of snapshotModelIDs) {
      if (!rule.match(modelID)) {
        continue
      }

      const canonicalModelID = rule.canonicalize(modelID)
      if (canonicalModelID === modelID) {
        continue
      }

      issues.push({
        kind: "pattern-alias-collides-with-snapshot",
        ruleID: rule.ruleID,
        modelID,
        canonicalModelID,
        message: `Pattern alias ${rule.ruleID} would rewrite canonical snapshot model ${modelID} to ${canonicalModelID}.`,
      })
    }
  }

  for (const modelID of requirementModelIDs) {
    const aliasResolution = resolveModelIDAlias(modelID)
    if (aliasResolution.source !== "canonical") {
      issues.push({
        kind: "built-in-model-relies-on-alias",
        modelID: aliasResolution.requestedModelID,
        canonicalModelID: aliasResolution.canonicalModelID,
        ruleID: aliasResolution.ruleID ?? "unknown-alias-rule",
        message: `Built-in requirement model ${aliasResolution.requestedModelID} should be canonical and not rely on alias rule ${aliasResolution.ruleID}.`,
      })
    }

    if (!snapshotModelIDs.has(aliasResolution.canonicalModelID)) {
      issues.push({
        kind: "built-in-model-missing-from-snapshot",
        modelID: aliasResolution.requestedModelID,
        canonicalModelID: aliasResolution.canonicalModelID,
        message: `Built-in requirement model ${aliasResolution.requestedModelID} resolves to ${aliasResolution.canonicalModelID}, which is missing from the bundled snapshot.`,
      })
    }
  }

  return issues
}
