# Issue 5838 Visual QA Completion Gate

## What was tested

- Reviewed the canonical shared frontend skill before and after the move.
- Verified the existing dual-oracle contract moved from line 139 to the
  truncation-safe opening block without weakening its browser, viewport,
  interaction, motion, or fresh-evidence requirements.

## What was observed

- Before: the completion contract appeared after all routing and ruleset prose.
- After: it appears immediately after the quality bar and before Phase 0.

## Why this evidence is enough

This is a pure prompt-ordering fix, so behavior tests would pin prose rather
than a machine contract.

## Additional verification

- Shared-skill suite: `138 pass, 0 fail`.
- Codex plugin build synced the canonical skill into the packaged tree.
- Packaged frontend skill retained the gate at line 12.
- Full `test:codex` gate with npm 11.12.1: clean; final Node gate `493 pass`.
- Isolated install verification: plugin cache, config enablement, nine
  component bins, and agent TOMLs all passed.
- Real isolated app-server turn completed with no missing/failed hooks.
- Real `~/.codex/config.toml` hash remained
  `6f9a9998e39f4f8c47e225e81801ecb2c183136a`.

## What was omitted

No private prompt content, credentials, or user session data were captured.
