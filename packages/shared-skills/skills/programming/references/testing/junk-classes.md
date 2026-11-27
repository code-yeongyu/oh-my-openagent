# Junk classes, retention bar, marks

One table for three jobs: writing a test (`programming`), cleaning a branch (`remove-ai-slops`), and auditing a suite. A test that matches a class below is junk unless the retention bar keeps it. The gate reviewer applies the same table; a test that would be deleted in review is a test not to write.

## Marks (one per test declaration; one per row when table rows differ)

| Mark | Meaning | What the ledger line names |
|---|---|---|
| `R` retain | guards a contract | the contract and the regression it catches |
| `F` fix | real contract, weak assertion (a negative that passes when only one of several items is missing; `toBeTruthy` on a value that is always an object; a lower bound over independently removable items) | the repaired assertion |
| `C` consolidate | the assertion moves into a keeper (a table row in a sibling, a stronger boundary suite); the declaration disappears | the keeper |
| `D` delete | no contract, or another test owns it | the owner test that still fails on the regression, or why no contract exists; plus a proof receipt |

## Junk classes (candidates for `D` or `C`)

| Class | What it looks like | Proof that it is junk |
|---|---|---|
| Cannot fail | no assertion; `expect(x).toBe(x)`; expected value computed by the code under test; `assert result is not None` and nothing else; an override fixture equal to its fallback; assertion inside a callback that never runs | a mutation of the owner the test survives |
| Change certificate | pins the diff, not a behavior: a constant, a string, a rename, a call, the shape of the edit the PR made | revert the change: the test fails for the diff, not for a regression; the run is the proof |
| Mock echo | the mock returns the value the test then asserts; the behavior lives in the mock | mutate the owner: test stays green |
| Implementation mirror | asserts call order, call count, private helper args, bracket-notation access to private members, internal state shape that a behavior-preserving refactor would break | a keeper at the real boundary catches the behavioral mutation |
| Prose pin | asserts wording, headings, section order, snapshots, phrase counts, or length of `SKILL.md`, prompts, `AGENTS.md`, docs, rule text | no runtime behavior to mutate; cite the repo's prose-test rule |
| Copied inventory | a hard-coded list of exports, files, tools, keys that mirrors the source and fails only when someone edits both | a generator or freshness check or a real consumer already owns it |
| Source grep | reads a source file and greps for a string or import | an identifier-only refactor turns it red for no reason; a behavior mutation it misses |
| Duplicate contract | the same input/output asserted at two or more layers with no distinct transport or lifecycle risk; an adapter package's copy of a Core package's test | the mutation is caught by both: keep the stronger boundary |
| Layer replay | a shared helper re-tested through every wrapper that calls it | one helper owner test plus one wiring test per real wrapper |
| Seam keeper | exists to keep a test-only export, flag, getter, or reset hook alive | `knip` or grep shows no production caller; delete test and seam together |
| Fabricated postcondition | the fixture supplies the receipt, ordering, or stored state the owner should produce; asserts a store nothing writes | mutate the writer: test stays green |
| Capability restatement | asserts a flag or capability is `true` instead of the delivery it promises | a delivery test owns it, or none exists (then `F`, not `D`) |
| Input transcript | asserts the argv, flags, URL, or request the code handed to a child, not the state the child resolved | mutate the child's handling of that input: test stays green; the witness drives the real component and asserts resolved state |
| Misnamed | the name promises a behavior its inputs never exercise | read the assertions; mark by what it actually checks |
| Near-duplicate cases | N tests differing only in input literals | `C` into one table (`it.each` / `test.each`, or a loop over a typed array where the package's test typings lack `.each`); typecheck after; every old assertion stays a row |

## Retention bar (these stay `R` even when they match a class above)

Keep a test that independently guards a public API, SDK, RPC or app-server protocol, config schema or default, migration, storage format, security boundary, platform behavior, prompt-byte or shipped-copy equality between real artifacts, generated or cross-language contract, package or install payload, release, or architecture invariant (meta-audits, tracked-artifact audits). Say which one in the test. Also keep:

- **Node-compat suites**: anything that runs shipped code under real Node is a platform contract even when a Bun run covers the same assertions.
- **Issue regressions**: a test naming an issue number stays until another test is shown to fail on that exact regression.
- **Machine-consumed text**: parsed fields, sentinel tokens, tool names, schema keys, a routing-bearing fragment of a parsed frontmatter `description`.
- **Baseline-red tests**: a test that fails on the unchanged base is a product bug to fix at its owner, never a deletion.

Outside that list, a source-inspection test survives only as the cheapest independent guard of a user-facing key, byte, or path that an identifier-only refactor leaves green. Static or slow is never a reason to delete.

## Proof rule for `D` and `C`

Break the production owner (flip a condition, drop a branch, return a constant, skip a write) and run the candidate and its named keeper on the unmodified test tree:

| Candidate | Keeper | Verdict |
|---|---|---|
| green | red | candidate cannot catch this: `D` proven |
| red | red | candidate redundant for this behavior: `D` or `C` proven |
| red | green | candidate is the ONLY proof: `R`, or `C` it into the keeper and re-run |
| green | green | the mutation missed the behavior: confirm the edit landed, then pick another mutation |

Restore the owner byte for byte; never commit a mutation. A prose pin needs no mutation: the receipt is the assertion line plus the repo rule. Coverage diffs prove lines still execute, not that anything still asserts on them; pair a coverage diff with at least one mutation per theme.
