import { injectConstraints } from "../constraints/injector"

export interface SubPrometheusTask {
  domain: string
  prompt: string
  taskId?: string
}

export interface SpawnConfig {
  maxSubPlanners: number
  constraints: string
  sessionId: string
}

export interface CollectionManifest {
  domains: string[]
  expectedCount: number
}

function buildDomainPrompt(domain: string, basePrompt: string): string {
  return `[Domain: ${domain}]\n\n${basePrompt}`
}

export function buildSubPrometheusTasks(
  domains: string[],
  constraints: string,
  basePrompt: string,
): SubPrometheusTask[] {
  return domains.map((domain) => {
    const domainPrompt = buildDomainPrompt(domain, basePrompt)
    const prompt = injectConstraints(domainPrompt, constraints)
    return { domain, prompt }
  })
}

export function enforceMaxSubPlanners(
  tasks: SubPrometheusTask[],
  max: number,
): SubPrometheusTask[] {
  if (max <= 0) return []
  if (tasks.length <= max) return tasks

  const truncatedCount = tasks.length - max
  const capped = tasks.slice(0, max)

  const last = capped[capped.length - 1]
  capped[capped.length - 1] = {
    ...last,
    prompt: `${last.prompt}\n\n[WARNING: ${truncatedCount} domain(s) were truncated due to max_sub_planners=${max} limit.]`,
  }

  return capped
}

export function buildCollectionManifest(
  tasks: SubPrometheusTask[],
): CollectionManifest {
  return {
    domains: tasks.map((t) => t.domain),
    expectedCount: tasks.length,
  }
}
