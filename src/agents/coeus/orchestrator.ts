import type { ComplexityScore, DecompositionDecision } from "./types"
import { DECOMPOSITION_THRESHOLD } from "./types"
import { scoreComplexity } from "./validation/complexity-scorer"
import { injectConstraints } from "./constraints/injector"
import { validateSubPlan, type ValidationResult } from "./validation/sub-plan-validator"
import { detectOverlaps, type FileOverlap } from "./validation/overlap-detector"
import { detectCycles } from "./validation/cycle-detector"
import { mergeSubPlans } from "./merge/plan-merger"
import type { SubPlan } from "./schemas/sub-plan-schema"
import type { MergedPlan } from "./schemas/merged-plan-schema"
import { buildBoundaryClaims } from "./verification/boundary-claim-builder"
import { verifyClaims } from "./verification/taxonomy-verifier"
import { assembleVerificationRecord } from "./verification/verification-record-assembler"
import { createLocalTaxonomyClient } from "../../shared/taxonomy-client"
import type { VerificationRecord } from "./schemas/verification-record-schema"

const CONCERN_DOMAINS: Record<string, RegExp> = {
  auth: /\b(auth(?:entication|orization)?|login|logout|signup|sign[- ]?up|sign[- ]?in|oauth|jwt|sessions?|tokens?|passwords?|credentials?|permissions?|rbac|acl)\b/i,
  frontend: /\b(frontend|front[- ]?end|react|vue|angular|svelte|ui|ux|components?|css|html|layout|responsive|tailwind|styled|dom|browser)\b/i,
  backend: /\b(backend|back[- ]?end|apis?|servers?|express|fastify|nest|endpoints?|middleware|rest|graphql|routes?|controllers?|services?)\b/i,
  database: /\b(database|db|postgres|postgresql|mysql|mongo|mongodb|redis|sql|schemas?|migrations?|orm|prisma|drizzle|quer(?:y|ies)|tables?|index(?:es)?)\b/i,
  infra: /\b(infra|infrastructure|docker|kubernetes|k8s|ci\/cd|ci|cd|pipelines?|deploy(?:ment)?|terraform|aws|gcp|azure|nginx|load[- ]?balancers?|monitoring|logging)\b/i,
  testing: /\b(tests?|testing|e2e|integration[- ]?tests?|unit[- ]?tests?|cypress|playwright|jest|coverage)\b/i,
  payments: /\b(payments?|stripe|billing|checkout|subscriptions?|invoic(?:e|ing)|pricing|e-commerce|ecommerce|commerce)\b/i,
}

function detectDomains(text: string): string[] {
  const detected: string[] = []
  for (const [domain, pattern] of Object.entries(CONCERN_DOMAINS)) {
    if (pattern.test(text)) detected.push(domain)
  }
  return detected
}

export function evaluateRequest(
  request: string,
  projectContext?: string
): { score: ComplexityScore; decision: DecompositionDecision } {
  const score = scoreComplexity(request, projectContext)

  if (score.total < DECOMPOSITION_THRESHOLD) {
    return {
      score,
      decision: {
        should_decompose: false,
        domains: [],
        strategy: "domain",
        rationale: `Score ${score.total} below threshold ${DECOMPOSITION_THRESHOLD}. ${score.reasoning}`,
      },
    }
  }

  const domains = detectDomains(request)

  return {
    score,
    decision: {
      should_decompose: true,
      domains,
      strategy: "domain",
      rationale: `Score ${score.total} meets threshold ${DECOMPOSITION_THRESHOLD}. ${score.reasoning}`,
    },
  }
}

export function buildDecompositionContext(
  _projectDir: string,
  domains: string[],
  constraints: string
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const domain of domains) {
    const basePrompt = `You are planning the "${domain}" domain sub-plan.\nFocus exclusively on ${domain}-related tasks.`
    result[domain] = injectConstraints(basePrompt, constraints)
  }

  return result
}

export function validateAndMerge(
  subPlans: SubPlan[],
  globalConstraints: string
): {
  merged: MergedPlan | null
  errors: string[]
  overlaps: FileOverlap[]
  cycles: string[][]
} {
  if (subPlans.length === 0) {
    return {
      merged: mergeSubPlans([], globalConstraints),
      errors: [],
      overlaps: [],
      cycles: [],
    }
  }

  const allErrors: string[] = []
  for (const plan of subPlans) {
    const validation: ValidationResult = validateSubPlan(plan)
    if (!validation.valid) {
      allErrors.push(...validation.errors.map((e) => `[${plan.domain}] ${e}`))
    }
  }

  if (allErrors.length > 0) {
    return { merged: null, errors: allErrors, overlaps: [], cycles: [] }
  }

  const merged = mergeSubPlans(subPlans, globalConstraints)
  const overlaps = detectOverlaps(subPlans)
  const cycles = detectCycles(merged.dependency_graph)

  return { merged, errors: [], overlaps, cycles }
}

export async function runKnowledgeVerification(
  domains: string[],
  constraints: string,
  taxonomyDir: string
): Promise<VerificationRecord> {
  const client = createLocalTaxonomyClient(taxonomyDir)
  const claims = buildBoundaryClaims(domains, constraints)
  const verifications = await verifyClaims(claims, client)
  return assembleVerificationRecord(
    domains.join("-"),
    domains,
    verifications
  )
}

export const orchestrateRecursivePlanning = {
  evaluateRequest,
  buildDecompositionContext,
  validateAndMerge,
}
