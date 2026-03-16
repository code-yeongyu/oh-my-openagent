import { describe, it, expect } from 'bun:test'
import { buildBriefContent, buildBriefPath, BriefParams } from './brief-writer'
import { parseBriefMetadata } from '../schemas/planning-brief-schema'

describe('buildBriefContent', () => {
  //#given a valid BriefParams object
  //#when buildBriefContent is called
  //#then it returns a string containing all required XML tags

  it('returns string with all required XML metadata tags', () => {
    const params: BriefParams = {
      topic: 'build auth system',
      slug: 'auth-system',
      domains: ['auth', 'backend', 'frontend'],
      problemStatement: 'We need JWT-based auth with refresh tokens',
      optionSpace: [
        { name: 'JWT + Redis', selected: true, rationale: 'Scalable' },
        { name: 'Session cookies', selected: false, rationale: 'Legacy' },
      ],
      knownPatterns: ['OAuth 2.0', 'PKCE flow'],
      constraints: 'Must support mobile clients',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)

    expect(content).toContain('<brief_metadata>')
    expect(content).toContain('</brief_metadata>')
    expect(content).toContain('<topic>build auth system</topic>')
    expect(content).toContain('<slug>auth-system</slug>')
    expect(content).toContain('<routing>coeus</routing>')
    expect(content).toContain('<domains>auth, backend, frontend</domains>')
    expect(content).toContain('<created>')
    expect(content).toContain('</created>')
  })

  it('includes Problem Statement section', () => {
    const params: BriefParams = {
      topic: 'test',
      slug: 'test',
      domains: ['test'],
      problemStatement: 'Test problem here',
      optionSpace: [],
      knownPatterns: [],
      constraints: 'none',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)
    expect(content).toContain('## Problem Statement')
    expect(content).toContain('Test problem here')
  })

  it('renders optionSpace items with selected state', () => {
    const params: BriefParams = {
      topic: 'test',
      slug: 'test',
      domains: ['test'],
      problemStatement: 'test',
      optionSpace: [
        { name: 'Option A', selected: true, rationale: 'Best choice' },
        { name: 'Option B', selected: false, rationale: 'Not viable' },
      ],
      knownPatterns: [],
      constraints: 'none',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)
    expect(content).toContain('## Option Space')
    expect(content).toContain('Option A')
    expect(content).toContain('Best choice')
    expect(content).toContain('Option B')
    expect(content).toContain('Not viable')
  })

  it('includes Known Patterns section', () => {
    const params: BriefParams = {
      topic: 'test',
      slug: 'test',
      domains: ['test'],
      problemStatement: 'test',
      optionSpace: [],
      knownPatterns: ['Pattern 1', 'Pattern 2'],
      constraints: 'none',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)
    expect(content).toContain('## Known Patterns')
    expect(content).toContain('Pattern 1')
    expect(content).toContain('Pattern 2')
  })

  it('includes Constraints section', () => {
    const params: BriefParams = {
      topic: 'test',
      slug: 'test',
      domains: ['test'],
      problemStatement: 'test',
      optionSpace: [],
      knownPatterns: [],
      constraints: 'Must be fast and secure',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)
    expect(content).toContain('## Constraints')
    expect(content).toContain('Must be fast and secure')
  })

  it('output parses cleanly through parseBriefMetadata', () => {
    const params: BriefParams = {
      topic: 'auth system',
      slug: 'auth-system',
      domains: ['auth', 'backend'],
      problemStatement: 'Need auth',
      optionSpace: [],
      knownPatterns: [],
      constraints: 'none',
      routing: 'coeus',
    }

    const content = buildBriefContent(params)
    const metadata = parseBriefMetadata(content)

    expect(metadata.topic).toBe('auth system')
    expect(metadata.slug).toBe('auth-system')
    expect(metadata.routing).toBe('coeus')
    expect(metadata.domains).toEqual(['auth', 'backend'])
  })
})

describe('buildBriefPath', () => {
  //#given a base directory and slug
  //#when buildBriefPath is called
  //#then it returns a path ending in .sisyphus/briefs/{slug}-{YYYYMMDD}.md

  it('returns path with correct structure', () => {
    const path = buildBriefPath('/project', 'auth-system')
    expect(path).toContain('.sisyphus/briefs')
    expect(path).toContain('auth-system')
    expect(path).toContain('.md')
  })

  it('includes date in YYYYMMDD format', () => {
    const path = buildBriefPath('/project', 'test-slug')
    const dateRegex = /\d{8}\.md$/
    expect(path).toMatch(dateRegex)
  })

  it('constructs full path from base directory', () => {
    const path = buildBriefPath('/home/user/project', 'feature-x')
    expect(path).toContain('/home/user/project')
    expect(path).toContain('feature-x')
  })
})
