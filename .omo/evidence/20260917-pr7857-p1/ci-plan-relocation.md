# CI tracking audit repair

Run 35211733406 failed Ubuntu and macOS shard 2 only because two historical
PR plans were tracked under the now-ignored `.omo/plans/` directory:

```text
.omo/plans/pr7857-p1-sync-attached.md
.omo/plans/pr7857-refresh-20260915.md
```

Both documents were moved unchanged into the existing public evidence folder:

```text
.omo/evidence/20260915-pr7857-refresh/plan-sync-attached.md
.omo/evidence/20260915-pr7857-refresh/plan-refresh.md
```

`git diff --cached --summary` reported 100% content-preserving renames.
No ignore rule, test assertion, platform gate or production code was changed.

Local reproduction used merge tree
`5f62dc63a8394c830dd49f33d203f9830af431c7`, computed from PR head
88688712d and dev 5ec06d5d3. A temporary Git index loaded that tree; the
current-dev checkout supplied its in-tree ignore rules. The audit command was
the same Git consumer used by `script/tracked-ignored-paths-audit.test.ts`:

```sh
git ls-files --cached --ignored --exclude-per-directory=.gitignore
```

Before relocation it returned exactly the two paths above. Applying only the
two staged renames to the temporary index made it return no paths; the
empty-result assertion exited 0. The shared checkout and its index were not
modified.

This is an artifact relocation, not a runtime change. Existing real OpenCode
QA remains applicable. Sibling-path LSP diagnostics are unavailable; the
documents were read, their contents preserved and Git's actual tracking
behavior checked.
