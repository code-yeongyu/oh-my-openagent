# `test (windows-latest, 2/2)` on this branch: not this PR

Run 34028823669 failed one matrix shard. Triage before treating it as a verdict:

- The failing case is `LspClient diagnostics freshness > #given a full pull report followed by an
  unchanged report for the same version and resultId`, in
  `packages/lsp-core/src/lsp/client-diagnostics-freshness.integration.test.ts`.
- This PR changes `script/published-install-smoke.mjs`, its test, its `.d.mts`, and one
  `.github/workflows/ci.yml` step. It does not touch `packages/lsp-core` at all.
- That test has a history of being stabilized rather than being a real signal: #7589
  ("drive diagnostics freshness through a controlled clock") and #7611 ("make diagnostics freshness
  deterministic") both merged for it.
- Local reruns on Windows, 3 consecutive runs each, on this branch and on a branch that carries none
  of its changes:

```
published-smoke (this PR):   11 pass / 0 fail  x3
pack-shape (no lsp changes): 11 pass / 0 fail  x3
```

- The same shard failed earlier on #7837, which also never touches `packages/lsp-core`.

Conclusion: a load-dependent flake in an unrelated package, not a regression from this branch. It
cannot be re-run from here (`gh run rerun` needs admin on the upstream repo), so this note is pushed
to retrigger the matrix and to leave the triage on the record.
