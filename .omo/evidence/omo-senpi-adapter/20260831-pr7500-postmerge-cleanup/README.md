# PR #7540 reviewed-blocker cleanup evidence

Starting production head: `e2cc57f4042862efa28c6abd2de1d35b36c7531a` (verified clean).
Semantic fix commit: `4ed3c4a99df909ebd9444b789a639f252124c834`.
Validated production/merge head: `745f7ffa075ec4c9ee20c16ba7bc4d385b344256`.
Current `origin/dev`: `8e8d06c90cc38600c2b4c9f1ef9fe9e0e09850e2`, integrated as the second parent of the validated merge head without conflicts.
The exact evidence-content commit is recorded in `final-heads.json` after this directory is committed.

## Deterministic RED

`reviewed-blockers-red.log` is the exact new-suite run against the unchanged starting production head: **0 pass / 9 fail**. It records one deterministic failing test per reviewed blocker group, with synchronous injected IO/races only:

- canonical nonvolatile union and fail-closed untouched verdict;
- Windows-shaped volatile path classification;
- direct credential/root/digest IO semantics;
- preservation of established FILE_REPLACED/FILE_CHANGED across ENOENT/EACCES diagnostic stat failures on both public readers;
- preservation of EREAD across diagnostic EFSTAT failure.

No sleeps, polling, permission-mode dependence, credentials, or timing races were used.

## GREEN semantics

- `realSenpiChangedPaths` / `realOmoChangedPaths` are sorted-deduplicated unions of direct protected differences, observed protected differences, and observed nonvolatile `other` differences. Only explicit volatile paths are excluded.
- `real*Untouched` requires both protected snapshots complete/error-free and the canonical union empty. Recursive scan completeness, truncation, byte totals, and errors remain separate bounded-observation fields; the driver does not claim whole-home completeness.
- Credential digesting directly reads each known file; only ENOENT means absent. Bounded snapshot roots directly enumerate; root ENOENT/ENOTDIR is complete-empty while inaccessible/I/O failures become structured `.` errors. Directory digesting tolerates only intended transient ENOENT/ENOTDIR and propagates inaccessible/I/O failures through injectable seams.
- Once pre-open metadata establishes FILE_REPLACED or FILE_CHANGED, a failing diagnostic current-path stat cannot erase it. A successful diagnostic stat may still prove a replacement. Public observed ENOENT therefore cannot silently become complete.
- Diagnostic fstat maps a primary read failure to SHORT_READ only when fstat succeeds and proves shrinkage; failed diagnosis retains the primary read code.
- Relative snapshot/error/classifier paths canonicalize `\\` to `/`; Windows-shaped `sessions\\`, `cache\\`, and `logs\\` remain volatile with deterministic sorted output.
- Existing bigint metadata checks, ENOENT-only protected absence, hard maxBytes/truncation, primary-over-close precedence, transient bounded entries, HOME+USERPROFILE isolation, OAuth-only packed postinstall, pristine Senpi 2026.8.31 hook contracts, and absence of a trust-storage patch remain intact.

## Verification

- Focused isolation/task-13/driver contracts after implementation and after current-dev merge: **47 pass / 0 fail** each final run.
- Hooks/OAuth/packed/package/pin contracts after current-dev merge: **38 pass / 0 fail**.
- Real isolated Senpi driver: **PASS** (`reviewed-driver-live.jsonl`), with exact protected, observed, limit, real-home, and sandbox machine fields. Both canonical changed-path arrays are empty and both untouched verdicts are true; bounded recursive observations explicitly report truncation/errors.
- One serialized `bun run test:senpi`: **2,482 pass / 7 platform skips / 0 fail**, followed by evidence-resolver **10 pass / 0 fail** (`reviewed-senpi-gate.log`).
- Senpi and script typechecks: PASS through repository-resolved `bunx tsgo`.
- Extension freshness: PASS; all six extension artifacts and staged LSP/ast-grep/agent-toolkit runtimes current.
- LSP on the relevant TypeScript driver contract: no diagnostics before the final test round; one later freshness request timed out and is not represented as a clean result.
- Biome lint on new isolation modules/tests: PASS. The touched legacy driver reports only its pre-existing informational `reason = undefined` suggestion when included.
- Programming no-excuse checker: not applicable to `.mjs` inputs (`No TypeScript files found`); no escape hatches were introduced.
- Pure LOC: isolation state 222, file readers 151, blocker tests 160, driver 245. Each file has one responsibility; the driver remains in the warning band and should be split before future growth.
- JSON parse, secret-shaped token scan, `git diff --check`, extension freshness, and final clean-tree checks: PASS.

## Omitted

No raw environment dump, credential content, protected hashes, tokens, private keys, or secret-bearing logs are stored. The live artifact contains only bounded machine fields and sanitized path/error metadata.
