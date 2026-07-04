## Summary

<!-- Explain what changed, why it changed, and how observable behavior is different. Use plain reviewer-facing language, not a file list. -->

- <!-- summary item -->

## Changes

<!-- Group by reviewer-relevant area. Each bullet should say what changed and how to map it to the diff. -->

- <!-- change item -->

## QA & Evidence

<!-- For each command or manual QA action: what was tested, what you observed, where the saved artifact/log lives, and why that evidence is sufficient. Link sanitized artifacts under .omo/evidence/ when applicable. Do not paste raw secret-bearing logs, env dumps, tokens, auth headers, or private credentials. -->

- **What was tested:** <!-- command or surface driven -->
  **Observed result:** <!-- actual result -->
  **Artifact:** <!-- saved sanitized artifact/log path -->
  **Why sufficient:** <!-- covered behavior or risk -->

## Risks & Residuals

<!-- Map each meaningful risk to the evidence above and state the conclusion: mitigated, accepted, blocked, or not applicable. -->

- <!-- risk item -->

## Screenshots

<!-- If applicable, add screenshots or GIFs showing before/after. Delete this section if not needed. -->

| Before | After |
|:---:|:---:|
|  |  |

## Automated Checks

<!-- Keep only commands actually run. Explain unavailable gates in Risks & Residuals. -->

```bash
bun run typecheck
bun test
```

## Related Issues

<!-- Link related issues. Use "Closes #123" to auto-close on merge. -->

<!-- Closes # -->
