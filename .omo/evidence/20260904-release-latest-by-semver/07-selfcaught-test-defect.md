# Self-caught defect in the first version of the shape assertion (2026-09-04)

The first wiring assertion was `expect(run).toContain("gh release list --exclude-drafts")` applied to
both steps. It failed against the correctly wired workflow, because the LazyCodex step must query the
OTHER repository's releases and therefore reads
`gh release list --repo code-yeongyu/lazycodex --exclude-drafts ...` - the flags are separated by the
`--repo` argument. The workflow was right; my assertion pinned an argument ORDER that carries no
meaning.

Fix: locate the `LATEST_FLAG=` line in each step and assert its required PARTS
(`gh release list`, `--exclude-drafts`, `bun script/release-latest-flag.ts "$VERSION"`) instead of one
literal substring.

How it was nearly missed: the first "GREEN" run piped bun through `| tail -18`, so the reported exit
code belonged to `tail` and the failure scrolled past the window. Both runs were re-measured without a
pipe. This is the trap already recorded in
`reference/tooling/eval-tool-bash-result-shape.md` and the omo-release-pipeline monitor-sentinel note.
