# QA evidence contract: `qa-matrix.json`

The manual QA matrix of Phase 1 is prose for the reader and a file for the machine. The file is `qa-matrix.json` at the root of the evidence directory, next to the artifacts it names, and `scripts/validate-evidence.ts` checks it. A matrix the validator rejects is not QA evidence, whatever the prose table says. The shape follows the verdict contract of lidge-jun/codexclaw's `qa` skill (MIT), reduced to one file per review.

## Shape

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-11-07T05:12:40Z",
  "source": { "commitSha": "<40 lowercase hex>", "dirty": false },
  "rows": [
    {
      "id": "1",
      "scenario": "Happy path: create a project from the empty state",
      "surface": "web",
      "command": "omowright: open /projects, click New, fill name, submit; screenshot",
      "expected": "project card appears with the typed name",
      "observed": "card rendered, name matches, no console error",
      "verdict": "PASS",
      "artifacts": ["1-create-project.png", "1-actions.log"]
    },
    {
      "id": "2",
      "scenario": "Viewport reflow at 320 px",
      "surface": "http",
      "command": "n/a",
      "expected": "n/a",
      "observed": "n/a",
      "verdict": "NA",
      "artifacts": [],
      "naReason": "JSON API, no rendered surface"
    }
  ]
}
```

- `source` comes from `bun "$SKILL_DIR/scripts/validate-evidence.ts" stamp --repo <repo>`, run on the checkout the captures were taken from. When the tree is dirty the block also carries `treeHash`, the SHA-256 of `git diff --binary HEAD`; the validator recomputes it, so a capture taken on uncommitted work is still bound to exactly that work.
- `capturedAt` is an RFC 3339 timestamp with a date and a `T`; a bare year is not a capture time.
- `surface` is one of `http`, `cli`, `tui`, `web`, `gui`, `library`, `data`. It decides the faithful channel (Phase 1 step 2) and what the validator demands of the artifacts.
- `verdict` is `PASS`, `FAIL`, or `NA`. Nothing else exists.
- `artifacts` are paths relative to the evidence directory. They must stay inside it; `..` and absolute paths are rejected.

## What the validator enforces

| Rule | Why |
|---|---|
| A PASS names at least one artifact; each exists, is a regular file, and is non-empty | a verdict without a capture is a claim, not evidence |
| A `web` or `gui` PASS names at least one `.png` | the faithful channel for a drawn surface is a screenshot |
| Every `.png`, on any surface, carries the PNG signature, an IHDR with non-zero dimensions and a valid CRC, and an IEND chunk | a truncated or half-written capture looks like a file and proves nothing |
| An NA carries a non-empty `naReason` | NA is for scenarios that structurally cannot apply, and the reason is what shows that |
| `source.commitSha` equals `git rev-parse HEAD` of `--repo`; `dirty` matches the live tree; a dirty `treeHash` matches the recomputed one | a fix committed after a capture stales the capture, and re-stamping would hide that |
| `id` values are unique; `surface` and `verdict` come from their lists; `capturedAt` parses | the file is read by machines downstream |

FAIL rows are reported and do not invalidate the file: an honest matrix with a FAIL row is valid evidence that the review failed.

## Commands

```bash
bun "$SKILL_DIR/scripts/validate-evidence.ts" stamp --repo <repo>            # prints source + capturedAt to paste
bun "$SKILL_DIR/scripts/validate-evidence.ts" <evidence-dir> --repo <repo>    # exit 0 valid, 1 invalid (one error per line), 2 usage
bun "$SKILL_DIR/scripts/validate-evidence.ts" <evidence-dir> --json           # machine-readable result
```

Keep the evidence directory out of the commit (`.omo/evidence/` is gitignored in this repository); the PR body quotes the validator's summary line and the rows.
