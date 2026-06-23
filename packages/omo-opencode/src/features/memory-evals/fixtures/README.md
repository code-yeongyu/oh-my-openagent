# Memory Eval Fixtures

This directory contains eval fixtures for the memory architecture.

Fixtures are added incrementally as each provider is integrated:
- Wave 3: claude-mem L1 fixtures (session resume, promotion candidate export)
- Wave 4: Mem0 L2 fixtures (search, graph, advanced retrieval)
- Wave 5: Promotion pipeline fixtures (classifier, dedup)
- Wave 6: Obsidian projection fixtures (hash conflict detection)
- Wave 7: Full acceptance test fixtures (all 10 acceptance tests)

See `src/features/memory-evals/harness.ts` for the EvalFixture interface.
