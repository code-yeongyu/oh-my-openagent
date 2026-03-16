import { z } from 'zod'

export const PlanningBriefMetadataSchema = z.object({
  topic: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  created: z.string(),
  routing: z.enum(['coeus', 'prometheus-direct']),
  domains: z.array(z.string()).min(1),
  complexity_hint: z.enum(['simple', 'multi-domain', 'unknown']).optional(),
})

export type PlanningBriefMetadata = z.infer<typeof PlanningBriefMetadataSchema>

export function parseBriefMetadata(raw: string): PlanningBriefMetadata {
  const extractTag = (tag: string): string | undefined => {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`)
    const match = raw.match(regex)
    return match ? match[1].trim() : undefined
  }

  const topic = extractTag('topic')
  const slug = extractTag('slug')
  const created = extractTag('created')
  const routing = extractTag('routing')
  const domainsStr = extractTag('domains')
  const complexityHint = extractTag('complexity_hint')

  if (!topic || !slug || !created || !routing || !domainsStr) {
    throw new Error('Missing required brief metadata fields')
  }

  const domains = domainsStr
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)

  const parsed: PlanningBriefMetadata = {
    topic,
    slug,
    created,
    routing: routing as 'coeus' | 'prometheus-direct',
    domains,
    ...(complexityHint && { complexity_hint: complexityHint as 'simple' | 'multi-domain' | 'unknown' }),
  }

  const result = PlanningBriefMetadataSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid brief metadata: ${result.error.message}`)
  }

  return result.data
}
