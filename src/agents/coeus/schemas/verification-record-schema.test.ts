import { describe, it, expect } from 'bun:test'
import {
  BoundaryVerificationSchema,
  VerificationRecordSchema,
  type BoundaryVerification,
  type VerificationRecord,
} from './verification-record-schema'

describe('BoundaryVerificationSchema', () => {
  //#given a valid boundary verification object
  //#when parsing with BoundaryVerificationSchema
  //#then it should succeed
  it('parses valid boundary verification', () => {
    const valid: BoundaryVerification = {
      boundary: 'auth→backend: JWT signing',
      query: 'How to sign JWTs securely?',
      matched_entry: 'jwt-signing-best-practices',
      confidence: 0.95,
      tier: 'tier-1-ground-truth',
      status: 'verified',
    }
    const result = BoundaryVerificationSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  //#given a boundary with status "novel" and no confidence/tier
  //#when parsing
  //#then it should accept the novel status without optional fields
  it('accepts novel status without confidence or tier', () => {
    const novel: BoundaryVerification = {
      boundary: 'new-pattern: async-generator-pooling',
      query: 'How to pool async generators?',
      status: 'novel',
    }
    const result = BoundaryVerificationSchema.safeParse(novel)
    expect(result.success).toBe(true)
  })

  //#given a boundary with status "verified" and all optional fields
  //#when parsing
  //#then it should accept all fields
  it('accepts verified status with all optional fields', () => {
    const verified: BoundaryVerification = {
      boundary: 'caching→redis: TTL strategy',
      query: 'What TTL strategy for Redis?',
      matched_entry: 'redis-ttl-patterns',
      confidence: 0.88,
      tier: 'tier-2-validated-reference',
      status: 'verified',
      rabbit_hole: 'Considered Memcached but Redis is standard',
    }
    const result = BoundaryVerificationSchema.safeParse(verified)
    expect(result.success).toBe(true)
  })

  //#given a boundary with invalid tier string
  //#when parsing
  //#then it should reject
  it('rejects invalid tier string', () => {
    const invalid = {
      boundary: 'test',
      query: 'test',
      status: 'verified',
      tier: 'invalid-tier',
    }
    const result = BoundaryVerificationSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  //#given a boundary with empty boundary string
  //#when parsing
  //#then it should reject
  it('rejects empty boundary string', () => {
    const invalid = {
      boundary: '',
      query: 'test',
      status: 'verified',
    }
    const result = BoundaryVerificationSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})

describe('VerificationRecordSchema', () => {
  //#given a valid verification record with all required fields
  //#when parsing
  //#then it should succeed
  it('parses valid verification record', () => {
    const valid: VerificationRecord = {
      slug: 'auth-jwt-caching-2026-03-05',
      created: '2026-03-05T10:30:00Z',
      domains: ['authentication', 'caching'],
      boundaries: [
        {
          boundary: 'auth→backend: JWT signing',
          query: 'How to sign JWTs?',
          status: 'verified',
          tier: 'tier-1-ground-truth',
          confidence: 0.95,
        },
        {
          boundary: 'cache→redis: TTL',
          query: 'TTL strategy?',
          status: 'novel',
        },
      ],
      verified_count: 1,
      unverified_count: 0,
      novel_count: 1,
    }
    const result = VerificationRecordSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  //#given a record with empty domains array
  //#when parsing
  //#then it should reject
  it('rejects record with no domains', () => {
    const invalid = {
      slug: 'test',
      created: '2026-03-05T10:30:00Z',
      domains: [],
      boundaries: [],
      verified_count: 0,
      unverified_count: 0,
      novel_count: 0,
    }
    const result = VerificationRecordSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  //#given a record with mixed boundary statuses
  //#when parsing
  //#then it should accept all status types
  it('accepts mixed boundary statuses', () => {
    const mixed: VerificationRecord = {
      slug: 'mixed-verification',
      created: '2026-03-05T10:30:00Z',
      domains: ['testing'],
      boundaries: [
        {
          boundary: 'verified-pattern',
          query: 'q1',
          status: 'verified',
          tier: 'tier-3-battle-tested',
          confidence: 0.8,
        },
        {
          boundary: 'unverified-pattern',
          query: 'q2',
          status: 'unverified',
        },
        {
          boundary: 'novel-pattern',
          query: 'q3',
          status: 'novel',
        },
      ],
      verified_count: 1,
      unverified_count: 1,
      novel_count: 1,
    }
    const result = VerificationRecordSchema.safeParse(mixed)
    expect(result.success).toBe(true)
  })

  //#given a record with missing required fields
  //#when parsing
  //#then it should reject
  it('rejects record with missing required fields', () => {
    const incomplete = {
      slug: 'test',
      created: '2026-03-05T10:30:00Z',
      domains: ['test'],
      // missing boundaries, counts
    }
    const result = VerificationRecordSchema.safeParse(incomplete)
    expect(result.success).toBe(false)
  })
})
