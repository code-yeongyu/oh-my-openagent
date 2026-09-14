# Init-deep refresh plan

## Scope

Refresh the existing hierarchical `AGENTS.md` knowledge base in update mode at maximum depth 3. Preserve still-true guidance, document the current multi-harness package layout, and avoid source or runtime behavior changes.

## Execution

1. Measure tracked source after excluding vendored, generated, evidence, lockfile, minified, and binary content. Bin-pack whole directories into approximately 400 KiB scanner chunks and route oversized coverage through chained top-level DAG runs when the node cap requires it.
2. Run parallel quick scanners that write bounded reports under `.omo/init-deep/reports/` and do not edit guidance.
3. Run disjoint subtree writers that consume only assigned reports, score directories, update or create nested `AGENTS.md` files, and write bounded digests under `.omo/init-deep/digests/`.
4. Run a root writer from digests and the existing root file, then a verifier that checks declared paths, line limits, and parent-child duplication. Route every failure back through its owning DAG node.
5. Record committed-mode `.omo/init-deep.json`, remove ephemeral reports and digests, inspect the final diff, and verify the hierarchy mechanically and by reviewer read.
6. Commit the documentation-only result, open a PR to `dev`, satisfy CI and Cubic review, merge with a merge commit, and remove the task worktree.

## Verification

- Every digest-declared guidance path exists.
- Root `AGENTS.md` is 50-150 lines; nested guidance files selected by this refresh are 30-80 lines.
- No generated child repeats a parent section block.
- `.omo/init-deep.json` contains the current commit SHA, tracked file count, source LOC, millisecond timestamp, and `committed` mode.
- Git diff contains only guidance, snapshot, plan/evidence, and no runtime implementation changes.
