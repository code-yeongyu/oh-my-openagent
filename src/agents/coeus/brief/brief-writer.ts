import { join } from 'path'

export interface BriefParams {
  topic: string
  slug: string
  domains: string[]
  problemStatement: string
  optionSpace: Array<{ name: string; selected: boolean; rationale: string }>
  knownPatterns: string[]
  constraints: string
  routing: 'coeus' | 'prometheus-direct'
}

export function buildBriefContent(params: BriefParams): string {
  const now = new Date()
  const created = now.toISOString().split('T')[0]

  const domainsStr = params.domains.join(', ')

  const optionSpaceSection = params.optionSpace
    .map((opt) => {
      const selected = opt.selected ? '[SELECTED]' : '[NOT SELECTED]'
      return `- **${opt.name}** ${selected}: ${opt.rationale}`
    })
    .join('\n')

  const knownPatternsSection = params.knownPatterns.map((p) => `- ${p}`).join('\n')

  return `<brief_metadata>
<topic>${params.topic}</topic>
<slug>${params.slug}</slug>
<created>${created}</created>
<routing>${params.routing}</routing>
<domains>${domainsStr}</domains>
</brief_metadata>

## Problem Statement
${params.problemStatement}

## Option Space
${optionSpaceSection}

## Known Patterns
${knownPatternsSection}

## Constraints
${params.constraints}`
}

export function buildBriefPath(baseDir: string, slug: string): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  return join(baseDir, '.sisyphus', 'briefs', `${slug}-${dateStr}.md`)
}
