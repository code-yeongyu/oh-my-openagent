/**
 * Knowledge Repository Types
 *
 * Git-like immutable knowledge storage with hierarchical layers.
 * Supports ADRs, Policies, Patterns, and Specs with constraint-based conflict detection.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Hierarchical layers for knowledge organization.
 * Lower layers inherit from and can override higher layers.
 */
export type KnowledgeLayer = "company" | "org" | "project"

/**
 * Severity levels for policy enforcement.
 * - info: Informational, no action required
 * - warn: Warning, agent should acknowledge
 * - block: Blocking, agent must stop and report violation
 */
export type Severity = "info" | "warn" | "block"

/**
 * Types of knowledge artifacts.
 * - adr: Architectural Decision Record
 * - policy: Organizational policy with enforcement rules
 * - pattern: Reusable code/design pattern
 * - spec: Technical specification
 */
export type KnowledgeType = "adr" | "policy" | "pattern" | "spec"

/**
 * Status of an ADR (Architectural Decision Record).
 */
export type ADRStatus = "proposed" | "accepted" | "deprecated" | "superseded"

// =============================================================================
// Constraint Types
// =============================================================================

/**
 * Constraint operators for the DSL.
 */
export type ConstraintOperator =
  | "must_not_use" // Technology/library ban
  | "must_use" // Required technology/pattern
  | "must_match" // Regex pattern matching
  | "must_not_match" // Regex pattern exclusion
  | "must_exist" // Required file/directory
  | "must_not_exist" // Forbidden file/directory

/**
 * Constraint target types.
 */
export type ConstraintTarget =
  | "file" // File path matching
  | "code" // Code content matching
  | "dependency" // Package/dependency matching
  | "import" // Import statement matching
  | "config" // Configuration value matching

/**
 * A single constraint rule in the DSL.
 */
export interface Constraint {
  id: string
  operator: ConstraintOperator
  target: ConstraintTarget
  /** Glob pattern, regex, or exact string depending on target */
  pattern: string
  /** Optional message to show on violation */
  message?: string
  /** Severity when this constraint is violated */
  severity: Severity
  /** Glob patterns for files this constraint applies to */
  appliesTo?: string[]
  /** Glob patterns for files this constraint does NOT apply to */
  excludes?: string[]
}

/**
 * Result of a constraint check.
 */
export interface ConstraintViolation {
  constraintId: string
  knowledgeId: string
  severity: Severity
  message: string
  /** File path where violation occurred */
  file?: string
  /** Line number where violation occurred */
  line?: number
  /** The matching content that violated the constraint */
  match?: string
  /** Suggested remediation */
  remediation?: string
}

// =============================================================================
// Knowledge Commit Types
// =============================================================================

/**
 * Author information for a knowledge commit.
 */
export interface KnowledgeAuthor {
  id: string
  name: string
  email?: string
}

/**
 * Metadata for ADR-type knowledge.
 */
export interface ADRMetadata {
  status: ADRStatus
  /** ID of the ADR that supersedes this one */
  supersededBy?: string
  /** IDs of related ADRs */
  relatedTo?: string[]
  /** Context/background for the decision */
  context?: string
  /** Available options that were considered */
  options?: Array<{
    title: string
    description: string
    pros?: string[]
    cons?: string[]
  }>
  /** Final decision made */
  decision?: string
  /** Expected consequences of the decision */
  consequences?: string[]
}

/**
 * Metadata for Policy-type knowledge.
 */
export interface PolicyMetadata {
  /** Whether this policy is currently active */
  active: boolean
  /** Date when this policy takes effect */
  effectiveDate?: string
  /** Date when this policy expires */
  expiresAt?: string
  /** IDs of exceptions to this policy */
  exceptions?: string[]
  /** Owner responsible for this policy */
  owner?: string
}

/**
 * Metadata for Pattern-type knowledge.
 */
export interface PatternMetadata {
  /** Programming languages this pattern applies to */
  languages?: string[]
  /** Frameworks this pattern applies to */
  frameworks?: string[]
  /** Difficulty level */
  difficulty?: "beginner" | "intermediate" | "advanced"
  /** Example code snippets */
  examples?: Array<{
    language: string
    code: string
    description?: string
  }>
}

/**
 * Metadata for Spec-type knowledge.
 */
export interface SpecMetadata {
  /** Version of the specification */
  version?: string
  /** Specification status */
  status?: "draft" | "review" | "approved" | "deprecated"
  /** API endpoints or interfaces defined */
  endpoints?: string[]
  /** Data schemas defined */
  schemas?: string[]
}

/**
 * Union type for type-specific metadata.
 */
export type KnowledgeMetadata =
  | { type: "adr"; data: ADRMetadata }
  | { type: "policy"; data: PolicyMetadata }
  | { type: "pattern"; data: PatternMetadata }
  | { type: "spec"; data: SpecMetadata }

/**
 * An immutable knowledge commit.
 * Once created, commits cannot be modified - only new commits can be added.
 */
export interface KnowledgeCommit {
  /** Unique identifier (SHA-like hash) */
  id: string
  /** Type of knowledge artifact */
  type: KnowledgeType
  /** Human-readable title */
  title: string
  /** One-line summary for manifest (max 100 chars) */
  summary: string
  /** Full content in markdown format */
  content: string
  /** Hierarchical layer */
  layer: KnowledgeLayer
  /** Default severity for violations */
  severity: Severity
  /** Constraint rules for this knowledge */
  constraints: Constraint[]
  /** Type-specific metadata */
  metadata?: KnowledgeMetadata
  /** Author of this commit */
  author: KnowledgeAuthor
  /** ISO 8601 timestamp */
  createdAt: string
  /** ID of the parent commit (for versioning) */
  parentId?: string
  /** Tags for categorization */
  tags: string[]
  /** Keywords that trigger loading this knowledge */
  triggerKeywords: string[]
}

// =============================================================================
// Manifest Types (Context-Efficient Loading)
// =============================================================================

/**
 * A single entry in the knowledge manifest.
 * Designed to be extremely compact for initial context loading.
 */
export interface ManifestEntry {
  /** Knowledge ID */
  id: string
  /** Type abbreviation */
  type: KnowledgeType
  /** Layer abbreviation */
  layer: KnowledgeLayer
  /** One-line summary (max 100 chars) */
  summary: string
  /** Severity indicator */
  severity: Severity
  /** Keywords that trigger full loading */
  keywords: string[]
}

/**
 * The knowledge manifest for a session.
 * Must be under 2K tokens for efficient context usage.
 */
export interface KnowledgeManifest {
  /** Version of the manifest format */
  version: string
  /** When this manifest was generated */
  generatedAt: string
  /** Total number of knowledge items */
  totalCount: number
  /** Entries by layer */
  entries: {
    company: ManifestEntry[]
    org: ManifestEntry[]
    project: ManifestEntry[]
  }
  /** Aggregate statistics */
  stats: {
    byType: Record<KnowledgeType, number>
    bySeverity: Record<Severity, number>
  }
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Filter options for querying knowledge.
 */
export interface KnowledgeQueryFilter {
  /** Filter by type */
  type?: KnowledgeType | KnowledgeType[]
  /** Filter by layer */
  layer?: KnowledgeLayer | KnowledgeLayer[]
  /** Filter by severity */
  severity?: Severity | Severity[]
  /** Filter by tags */
  tags?: string[]
  /** Filter by keywords */
  keywords?: string[]
  /** Full-text search in title and content */
  search?: string
  /** Filter by author ID */
  authorId?: string
  /** Filter by date range */
  createdAfter?: string
  /** Filter by date range */
  createdBefore?: string
  /** Maximum results */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Result of a knowledge query.
 */
export interface KnowledgeQueryResult {
  items: KnowledgeCommit[]
  total: number
  hasMore: boolean
}

// =============================================================================
// Promotion Types
// =============================================================================

/**
 * A request to promote knowledge from one layer to another.
 */
export interface PromotionRequest {
  /** ID of the knowledge to promote */
  knowledgeId: string
  /** Target layer */
  targetLayer: KnowledgeLayer
  /** Justification for the promotion */
  justification: string
  /** Promoter information */
  promoter: KnowledgeAuthor
}

/**
 * Record of a promotion event.
 */
export interface PromotionRecord {
  id: string
  knowledgeId: string
  fromLayer: KnowledgeLayer
  toLayer: KnowledgeLayer
  promoter: KnowledgeAuthor
  justification: string
  promotedAt: string
  /** New knowledge ID after promotion (may change) */
  newKnowledgeId: string
}

// =============================================================================
// Repository Types
// =============================================================================

/**
 * Configuration for a knowledge repository.
 */
export interface KnowledgeRepositoryConfig {
  /** Root directory for knowledge storage */
  rootDir: string
  /** Organization identifier */
  orgId?: string
  /** Project identifier */
  projectId?: string
  /** Cache configuration */
  cache?: {
    /** Enable memory caching */
    memory?: boolean
    /** Enable disk caching */
    disk?: boolean
    /** TTL for cache entries in seconds */
    ttlSeconds?: number
  }
  /** Mem0 integration configuration */
  mem0?: {
    enabled: boolean
    apiKey?: string
    endpoint?: string
  }
}

/**
 * Statistics about the knowledge repository.
 */
export interface RepositoryStats {
  totalCommits: number
  byLayer: Record<KnowledgeLayer, number>
  byType: Record<KnowledgeType, number>
  bySeverity: Record<Severity, number>
  lastUpdated: string
}
