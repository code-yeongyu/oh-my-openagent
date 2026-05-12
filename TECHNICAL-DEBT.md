# Technical Debt — [PID-SENTINEL]

## [2026-05-12] Remaining Barrel Imports
**Debt**: 59 occurrences of `import { ... } from "../../shared"` (or similar barrel imports) remain.
- `src/features/`: 9 occurrences
- `src/hooks/`: 50 occurrences
**Risk**: High potential for circular dependency re-introduction if new symbols are added to the barrel.
**Mitigation**: Continue "Leaf-First" migration iteratively across `src/features/` and `src/hooks/`.
