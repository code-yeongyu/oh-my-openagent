## Summary

<!-- Explain what changed, why it changed, and how observable behavior is different. Use plain reviewer-facing language, not a file list. -->

- <!-- summary item -->

## AI Assistance

<!-- Tick exactly one box. Pair-programming is the common case: you drove the agent, reviewed and
     corrected what it wrote, and you own the result. "Fully AI-authored" means an agent produced
     the change with no hand-editing. "none" means you wrote it yourself. This is a disclosure for
     downstream audit, not a gate: leaving everything unticked records nothing and never blocks a
     merge. See "AI-generated commits" in CONTRIBUTING.md for what is expected of an agent-assisted
     change beyond ticking the box. -->

- [ ] none
- [ ] pair-programming
- [ ] fully AI-authored

## Changes

<!-- Group by reviewer-relevant area. Each bullet should say what changed and how to map it to the diff. -->

- <!-- change item -->

## QA & Evidence

<!-- For each command or manual QA action: what was tested, what you observed, where the saved artifact/log lives, and why that evidence is sufficient. Evidence files stay local (.omo/evidence/ is gitignored and never committed), so paste the decisive sanitized excerpt of each capture here (RED failure line, GREEN pass count, driver final JSON, isolation proof) plus one `sha256sum <artifact>` line per evidence file. Do not paste raw secret-bearing logs, env dumps, tokens, auth headers, or private credentials. -->

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
