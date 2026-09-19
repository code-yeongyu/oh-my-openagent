# PR7857 refresh plan

Starting PR head: 771eefe2b8cda74816127655b69c22f522677c9b.
Upstream dev: 496dcce68d62f223c37895e3792f6d5f65920769.

The prior Windows failures are repaired on current dev. Its CI run
35424381441 passed all operating-system root-test and Senpi compatibility
jobs, typecheck and build. The PR's affected OpenCode source paths have no
upstream changes since the previous review.

1. Merge origin/dev with command-scoped MoerAI identity and stop before commit.
   Inspect conflicts and the PR-specific source delta. Preserve the existing
   terminal-error fixes; do not rewrite unrelated source.
2. Install dependencies with pinned Bun 1.4.0 without lifecycle scripts, then
   run the six relevant OpenCode test domains, full workspace typecheck and
   full build using Node 24. Record failures rather than treating them as green.
3. Copy the previously verified live-probe.ts and live-qa.mjs into this
   evidence directory via apply_patch. Their relative imports remain anchored
   to this task-owned worktree. Preserve old evidence unchanged.
4. Bundle the probe and run disabled/recovery cases against real OpenCode,
   using fresh HOME/XDG roots, public built-in assets, a local fake provider,
   exact SSE events and unchanged host database session counts.
5. Save reviewer-readable outcomes and sanitized receipts here. Do not stage
   generated artifacts or raw private logs produced by the build.
6. Confirm the staged PR-specific source diff is unchanged except for upstream
   integration. Commit the verified merge as MoerAI, push only the existing
   fork PR branch, update the PR description and watch current-head CI.

This is integration of an already-tested fix, not a new behavior change.
Existing failing-first evidence remains authoritative for the original bugs.
