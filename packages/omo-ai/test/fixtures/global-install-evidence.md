# omo-ai global install evidence

Evidence root: `.omo/evidence/20260701-omo-ai-senpi-package/global-install-rerun/`.
Marker proof subdir: `.omo/evidence/20260701-omo-ai-senpi-package/global-install-rerun/marker-proof/`.

This receipt records the sandboxed global-install QA rerun for the `omo-ai` package after the packaging fix. The previous blocked attempt is preserved separately under `.omo/evidence/20260701-omo-ai-senpi-package/global-install/` and is superseded by this rerun.

Surfaces proven:

- `npm pack --workspace omo-ai`
- isolated `npm install -g <tarball> --foreground-scripts`
- installed `omo-ai doctor --json`
- two installed `omo-ai repair --json` runs
- installed hook payload parse/discovery
- installed `rules/session-start` hook marker under temp `PLUGIN_DATA`
- focused Bun tests
- `tsc --noEmit`

Isolation was temp-only: temp `HOME`, npm prefix, agent dir, and `PLUGIN_DATA` were used. Cleanup receipts exist for the global-install sandbox and marker-proof sandbox.

Important artifacts:

- `tarball-assertions.txt`
- `doctor.json`
- `repair-assertions.txt`
- `state-assertions.txt`
- `hook-list-proof.json`
- `marker-proof/marker.jsonl`
- `marker-proof/marker-assertions.txt`
- `cleanup.txt`
- `marker-proof/cleanup.txt`
