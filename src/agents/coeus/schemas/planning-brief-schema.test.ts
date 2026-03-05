import { describe, it, expect } from 'bun:test'
import {
  PlanningBriefMetadataSchema,
  parseBriefMetadata,
  type PlanningBriefMetadata,
} from './planning-brief-schema'

describe('PlanningBriefMetadataSchema', () => {
  //#given a valid brief metadata object
  //#when validating with the schema
  //#then it should pass validation
  it('validates a complete brief metadata object', () => {
    const validBrief = {
      topic: 'build auth system',
      slug: 'auth-system',
      created: '2026-03-05',
      routing: 'coeus' as const,
      domains: ['auth', 'backend'],
      complexity_hint: 'multi-domain' as const,
    }

    const result = PlanningBriefMetadataSchema.safeParse(validBrief)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.topic).toBe('build auth system')
      expect(result.data.slug).toBe('auth-system')
      expect(result.data.domains).toEqual(['auth', 'backend'])
    }
  })

  //#given a brief with empty domains array
  //#when validating
  //#then it should fail validation
  it('rejects brief with empty domains array', () => {
    const invalidBrief = {
      topic: 'build auth system',
      slug: 'auth-system',
      created: '2026-03-05',
      routing: 'coeus' as const,
      domains: [],
    }

    const result = PlanningBriefMetadataSchema.safeParse(invalidBrief)
    expect(result.success).toBe(false)
  })

  //#given a brief with invalid slug (spaces or uppercase)
  //#when validating
  //#then it should fail validation
  it('rejects brief with invalid slug format', () => {
    const invalidSlug1 = {
      topic: 'build auth system',
      slug: 'Auth System',
      created: '2026-03-05',
      routing: 'coeus' as const,
      domains: ['auth'],
    }

    const result1 = PlanningBriefMetadataSchema.safeParse(invalidSlug1)
    expect(result1.success).toBe(false)

    const invalidSlug2 = {
      topic: 'build auth system',
      slug: 'auth_system',
      created: '2026-03-05',
      routing: 'coeus' as const,
      domains: ['auth'],
    }

    const result2 = PlanningBriefMetadataSchema.safeParse(invalidSlug2)
    expect(result2.success).toBe(false)
  })

  //#given a brief missing required fields
  //#when validating
  //#then it should fail validation
  it('rejects brief with missing required fields', () => {
    const incompleteBrief = {
      topic: 'build auth system',
      slug: 'auth-system',
      // missing created, routing, domains
    }

    const result = PlanningBriefMetadataSchema.safeParse(incompleteBrief)
    expect(result.success).toBe(false)
  })

  //#given a brief with optional complexity_hint omitted
  //#when validating
  //#then it should pass validation
  it('allows brief without optional complexity_hint', () => {
    const briefWithoutHint = {
      topic: 'build auth system',
      slug: 'auth-system',
      created: '2026-03-05',
      routing: 'prometheus-direct' as const,
      domains: ['auth'],
    }

    const result = PlanningBriefMetadataSchema.safeParse(briefWithoutHint)
    expect(result.success).toBe(true)
  })
})

describe('parseBriefMetadata', () => {
  //#given a markdown string with XML metadata block
  //#when parsing
  //#then it should extract all fields correctly
  it('parses valid brief metadata from markdown', () => {
    const markdown = `
# Planning Brief

<brief_metadata>
<topic>build auth system</topic>
<slug>auth-system</slug>
<created>2026-03-05</created>
<routing>coeus</routing>
<domains>auth,backend,frontend</domains>
<complexity_hint>multi-domain</complexity_hint>
</brief_metadata>

## Plan Details
...
`

    const result = parseBriefMetadata(markdown)
    expect(result.topic).toBe('build auth system')
    expect(result.slug).toBe('auth-system')
    expect(result.created).toBe('2026-03-05')
    expect(result.routing).toBe('coeus')
    expect(result.domains).toEqual(['auth', 'backend', 'frontend'])
    expect(result.complexity_hint).toBe('multi-domain')
  })

  //#given a markdown string with domains as comma-separated string
  //#when parsing
  //#then it should split domains into array
  it('splits comma-separated domains into array', () => {
    const markdown = `
<brief_metadata>
<topic>test</topic>
<slug>test-slug</slug>
<created>2026-03-05</created>
<routing>prometheus-direct</routing>
<domains>api,database,cache</domains>
</brief_metadata>
`

    const result = parseBriefMetadata(markdown)
    expect(result.domains).toEqual(['api', 'database', 'cache'])
  })

  //#given a markdown string without complexity_hint
  //#when parsing
  //#then it should omit the field
  it('handles missing optional complexity_hint', () => {
    const markdown = `
<brief_metadata>
<topic>simple task</topic>
<slug>simple-task</slug>
<created>2026-03-05</created>
<routing>coeus</routing>
<domains>frontend</domains>
</brief_metadata>
`

    const result = parseBriefMetadata(markdown)
    expect(result.complexity_hint).toBeUndefined()
  })

  //#given a markdown string with whitespace around tag values
  //#when parsing
  //#then it should trim whitespace
  it('trims whitespace from extracted values', () => {
    const markdown = `
<brief_metadata>
<topic>  build auth system  </topic>
<slug>  auth-system  </slug>
<created>  2026-03-05  </created>
<routing>  coeus  </routing>
<domains>  auth , backend  </domains>
</brief_metadata>
`

    const result = parseBriefMetadata(markdown)
    expect(result.topic).toBe('build auth system')
    expect(result.slug).toBe('auth-system')
    expect(result.domains).toEqual(['auth', 'backend'])
  })
})
