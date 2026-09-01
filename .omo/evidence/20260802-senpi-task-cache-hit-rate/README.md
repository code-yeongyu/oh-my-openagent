# Senpi task cache-hit-rate semantics QA

## What was tested

The change separates cache-hit statistics into:

- `cache_hit_rate_last`: the latest assistant request with a nonzero cacheable denominator;
- `cache_hit_rate_run`: the cumulative whole-run aggregate.

Running task status rows consume the latest-request value, while completed task summaries consume the run aggregate. Existing persisted `cache_hit_rate` data is accepted as a legacy whole-run value.

## What was observed

### Failing-first proof

`red-focused-tests.txt` captures the focused suite before implementation. The new expectations failed because the tracker, parser, and live/terminal renderers did not yet expose or select the explicit fields.

### Automated verification

`automated-verification.txt` lists the commands and observed green results. It covers tracker semantics, persistence compatibility, all affected renderers, both changed packages, the generated Senpi extension, repository typechecking, the complete Bun suite, and the repository build.

### Real Senpi TUI surface

The real `senpi` binary (2026.8.1) was driven in tmux with the packaged omo-senpi extension and isolated mock provider. The child emitted:

1. a cold request: `0 / (4000 + 0 + 1000) = 0%`;
2. a latest hot request: `6800 / (1200 + 6800 + 400) = 80.95%`, rounded to `81%`.

The cumulative run value at that point was `6800 / 13400 = 50.75%`, rounded to `51%`.

`tui-capture.txt` and `tui-isolation-capture.txt` show the RUNNING row rendering `$0.0481 (CH: 81%)`. `CH: 51%` is absent, proving the status surface uses the latest request rather than the run aggregate.

## Isolation proof

`isolation-verdict.txt` records the disposable sandbox path, confirms it was removed, and confirms the digest of the real Senpi credential/config boundary (`auth.json`, `models.json`, `settings.json`, `trust.json`) was byte-identical before and after. The TUI footer also shows execution under `/private/.../omo-senpi-qa-*/project`, not a real project or agent directory.

## Why this is enough

- Unit tests distinguish latest and cumulative values numerically, so identical-value false positives cannot pass.
- Renderer tests pass both fields with conflicting values and assert the correct one for live versus completed surfaces.
- Record tests cover new explicit fields and old persisted records.
- The real TUI capture verifies the generated extension and host integration, not only source-level helpers.
- Full package and repository gates cover regressions outside the focused paths. Pinned Bun 1.3.12 also passed both changed packages and typecheck; its only root-suite failure is the pre-existing stale Codex installer version documented in `automated-verification.txt`.

## Omitted

Raw ANSI stream output was not retained in the review summary because it is noisy and adds no evidence beyond the sanitized tmux capture. No provider secrets were used; the QA driver strips credential-like environment variables and uses an offline mock provider.
