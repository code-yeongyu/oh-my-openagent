# Solution Taxonomy with Per-Claim Provenance — Agent Memory

## Core Thesis
LLMs regenerate known solutions from scratch every time. A structured taxonomy of known-solved problems with authoritative sources enables RETRIEVAL (1 round, correct) over GENERATION (6+ rounds, error-prone).

## Provenance Model
Per-CLAIM source tracking (not per-entry). Every individual assertion has its own source chain.

### Authority Hierarchy
- **Tier 1 (Ground Truth)**: RFCs, language specs, math proofs, foundational textbooks (CLRS, Knuth). Confidence ≥ 0.95
- **Tier 2 (Validated Reference)**: Peer-reviewed papers, official framework docs, OWASP. Confidence ≥ 0.80
- **Tier 3 (Battle-Tested)**: Production OSS (1000+ stars), FAANG-tier engineering blogs. Confidence ≥ 0.65
- **Tier 4 (Community)**: Stack Overflow, tutorials, blog posts. Confidence ≥ 0.40

### Provenance Schema Fields
`ref` (citation), `claim` (what it proves), `tier`, `confidence`, `type` (textbook/paper/spec/oss/docs/blog), optional: `isbn`, `url`, `verified_by`

## Taxonomy Entry Structure
- `category`: Problem name ("MergeSort", "RateLimiting")
- `solutions[]`: Each with name, description, spec_compliant flag, sources (min 1), constraints
- `pitfalls[]`: Common mistakes with source provenance
- `complexity`, `related[]` (links to other categories), `implementation_notes[]`

## Key Case Study: Merge Sort
6-round LLM conversation to get spec-compliant implementation. With taxonomy: 1 round (CLRS Ch. 2.3 provides spec, von Neumann 1945 is origin, Knuth Vol. 3 covers stability).

## Seed Categories
1. **Merge Sort** — CLRS/Knuth/von Neumann (Tier 1). Pitfalls: aux space, stability, base case.
2. **Rate Limiting** — RFC 6585 (Tier 1), Stripe blog (Tier 3). Token bucket, sliding window, etc.
3. **Authentication** — RFC 7519 JWT (Tier 1), OWASP (Tier 2). JWT/session/OAuth patterns.
4. **Caching** — Redis docs (Tier 2). Cache-aside, write-through, invalidation pitfalls.

## Commercial Validation
Ontology.works (https://ontology.works) builds "Ontology-as-a-Service" for structured knowledge injection into AI — same concept, commercially validated.

## Academic Support
- ReDel (EMNLP 2024): Recursive multi-agent overcommitment/undercommitment
- Cemri et al. (2026): 43.3% multi-agent degradation — taxonomy reduces need for decomposition on known problems
- DeepMind: Up to 17x cost overhead — taxonomy retrieval costs ~0 tokens

## Storage
- Project-level: `.opencode/taxonomy/` (domain-specific)
- User-level: `~/.config/opencode/taxonomy/` (shared across projects)
- Format: YAML/JSON files, lazy-loaded, cached in memory

## Implementation
Tasks T3, T28-T31 in `.sisyphus/plans/coeus-recursive-planning.md` (Wave 1 schemas, Wave 5 storage/query/seed/validation).

## Future Vision
1. Community-curated (like Wikidata, quality-gated by Tier 2+ sources)
2. Auto-enrichment (Coeus taxonomizes novel solutions after planning)
3. Confidence decay (source age reduces effective confidence)
4. Taxonomy-guided decomposition (skip planning for known categories)
