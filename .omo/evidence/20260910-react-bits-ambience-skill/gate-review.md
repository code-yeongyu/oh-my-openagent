# Gate review record — react-bits ambience reference (PR #8064)

Two gate-review passes were run under the review-work protocol, each in a locked, detached review worktree with no test execution on the reviewing host (fleet policy: recorded remote artifacts are what the reviewer audits).

## Attempt 1 — REJECT (3 blockers)

The first reviewer terminated on a provider error after emitting its findings. All three were accepted and fixed:

1. **Copied upstream documentation in the evidence capture.** The endpoint-verification artifact reproduced the catalog header and intro sentence fetched from `llms.txt`. The reference forbids reproducing upstream text; the evidence file has to hold to the same rule. Fixed: the quoted lines were replaced with a statement that the header and intro line were present but are not reproduced.
2. **Fleet machine names in three evidence files.** The RED, GREEN, and README artifacts named the compute host and carried `/Users/<name>` paths. Fixed: neutral descriptions ("a fleet compute node", "the session host") and `~` paths.
3. **Truncated GREEN capture.** The battery log had been stored through `head -120`, so the artifact did not prove its own QA row. Fixed: the full 206-line output, sanitized at capture.

## Attempt 2 — APPROVE (HIGH confidence)

A fresh reviewer re-checked the delta and the previously approved scope at the reviewed HEAD. Verdict: APPROVE, no blocking issues.

Independent verification it performed, beyond confirming the three fixes:

- **Copied-text scan.** N-gram comparison of every added diff line against a live `llms.txt` fetch: at n=8/6/5 the only matches were fragments of the install command the recipe documents; at n=4, URL and CLI fragments plus one factual noun phrase. Zero four-word overlaps against all 171 upstream component descriptions. The only fenced block in the reference is our own curl/jq recipe.
- **Identity and secret scan.** All 15 changed files scanned for machine names, user paths, IPs, and tailnet hostnames: zero hits. The one full-diff match is a pre-existing test title on `dev` echoed by captured output, not a leak.
- **GREEN log recount.** Independent counts of pass lines, fail lines, and test-file headers agree with Bun's own footer (142 pass, 0 fail, 25 files, 856 expect() calls), and all seven tests the QA row names appear as passes, including both byte-equivalence assertions and the three ambience routing assertions.
- **Routing-map accuracy.** All 74 component names resolve as `<Name>-TS-TW` registry items, and the engine label on all 35 rows was cross-checked against each item's live `dependencies[]`: zero discrepancies.
- **Constraint sweep.** No vendored source, no banned terms, no emoji, no Hangul, English throughout; pure-LOC within the ceiling (test 33, manifest 138); the test pins only machine-consumed values, no wording.

## Non-blocking notes and their disposition

- **`shadcn add` described as copying "the four-variant source".** Factually wrong: the `<Name>-TS-TW.json` URL installs the one variant it names. Corrected in this branch, because a reader would otherwise skip choosing a variant.
- **`ReflectiveCard` labelled engine `none` while its registry item depends on an icon library.** The label means "no animation engine", which the legend did not say. Legend corrected to state it explicitly and to require reading `dependencies[]` before importing.
- **Redundant type assertion in the routing test.** Left as is: it mirrors the sibling `frontend-stylegallery-routing.test.ts` exactly, and consistency with the template is worth more than removing one cast.
- **Trailing whitespace inside the captured Bun output.** Left as is: editing it would falsify a verbatim capture.
- **Rebase drift.** The reviewed commit was reparented onto newer `dev` during an unrelated commit-author repair. Per-path blob SHAs are identical for all 15 files, so the review applies to the live head.
