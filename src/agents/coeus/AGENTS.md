# COEUS KNOWLEDGE BASE

## OVERVIEW

Recursive divide-and-conquer planner. Decomposes complex multi-domain problems into domain-specific sub-plans via Sub-Prometheus agents, validates deterministically, merges into Sisyphus-compatible output.

## STRUCTURE
```
coeus/
├── agent.ts              # Coeus agent factory + metadata
├── system-prompt.ts      # 6-phase system prompt
├── orchestrator.ts       # Orchestration flow (assess → decompose → spawn → merge)
├── types.ts              # ComplexityScore, DecompositionDecision, thresholds
├── index.ts              # Barrel export
├── schemas/
│   ├── sub-plan-schema.ts    # SubPlanSchema (Zod)
│   ├── merged-plan-schema.ts # MergedPlanSchema (Zod)
│   ├── task-schema.ts        # TaskSchema (Zod)
│   └── index.ts
├── validation/
│   ├── complexity-scorer.ts      # Deterministic complexity scoring
│   ├── depth-limiter.ts          # Recursion depth guard (default 1, max 3)
│   ├── cost-tracker.ts           # Budget tracking
│   ├── overlap-detector.ts       # Scope overlap detection
│   ├── cycle-detector.ts         # Dependency cycle detection
│   ├── sub-plan-validator.ts     # Sub-plan schema + minimum work validation
│   ├── final-validator.ts        # Merged plan validation (7 checks)
│   └── index.ts
├── merge/
│   ├── file-manager.ts           # Sub-plan file I/O
│   ├── plan-merger.ts            # Multi-plan merge logic
│   ├── plan-serializer.ts        # JSON → Sisyphus-compatible markdown
│   ├── conflict-resolver.ts      # Overlap conflict resolution prompt builder
│   └── index.ts
├── constraints/
│   ├── extractor.ts              # Extract constraints from user input
│   ├── injector.ts               # Inject constraints into sub-plans
│   └── index.ts
├── coordination/
│   ├── background-spawner.ts     # Parallel Sub-Prometheus task dispatch
│   └── index.ts
└── taxonomy/
    ├── schema.ts                 # TaxonomyEntrySchema (Zod)
    ├── types.ts                  # TaxonomyEntry, TaxonomyQuery, Provenance types
    ├── storage.ts                # File-based taxonomy store with search
    ├── provenance-validator.ts   # Authority ranking + validation
    ├── seed/                     # 4 seed entries (merge-sort, rate-limiting, auth, caching)
    └── index.ts
```

## ARCHITECTURE

**Deterministic Sandwich (60/40)**:
- Code generates skeleton + validates (deterministic)
- LLM fills slots + resolves conflicts (non-deterministic)

**Depth Control**: Default depth 1 (Coeus → Sub-Prometheus). Configurable max 3.

**Flow**: Complexity assessment → domain decomposition → parallel Sub-Prometheus spawn → sub-plan validation → merge → final validation → markdown serialization

## AGENT CONFIG

| Property | Value |
|----------|-------|
| Model | claude-opus-4-6 (fallback: kimi-k2.5 → gpt-5.2 → gemini-3-pro) |
| Temperature | 0.1 |
| Thinking | 32k budget tokens |
| Tool Restrictions | write, edit denied (read-only planner) |
| Category | advisor |
| Cost | EXPENSIVE |

## VALIDATION PIPELINE (7 checks)

1. Schema validation (Zod safeParse)
2. Cycle detection (dependency graph)
3. Wave ordering (task before dep = error)
4. Task completeness (acceptance criteria required)
5. Orphan tasks (wave refs unknown task = error)
6. Unassigned tasks (task not in any wave = warning)
7. Same-wave file overlap (parallel conflict = warning)

## TAXONOMY

Solution library with per-claim provenance. 4-tier authority hierarchy:
- Tier 1: Peer-reviewed (CLRS, IEEE, ACM)
- Tier 2: Official docs (MDN, RFC, language specs)
- Tier 3: Established practice (high-star repos, conference talks)
- Tier 4: Community (blog posts, tutorials)

## KEY CONSTRAINTS

- Prometheus must remain **completely untouched**
- Sub-plans transfer via `.sisyphus/sub-plans/{session-id}/{domain}.json`
- Final output must be Sisyphus-compatible markdown
- Coeus never writes files (hook-enforced via coeus-md-only)
