# PR #6043 Final Repair Evidence - Round 13

Date: 2026-07-17

## Exact Source

- Prior exact PR head: `01e2294be6407d124415b9bcc4f40567aebb7f85`.
- Lifecycle arrival-order repair: `093efc8c713d66c78cef65c5210af622a029c22a`.
- QA candidate and repair commit tree:
  `402ef28ff67606eb98116910222fcefbe2ed4514`
  (`candidate_tree_match=yes`).

## Finding And Repair

A `session.created` handler could arrive first and pause in ordinary hook
fan-out. A later `session.deleted` for the same ID could then reserve and finish
cleanup before the older creation resumed. The older creation would finally
call `setMainSession`, resurrecting the deleted ID.

The failing-first composed-handler regression ended with the deleted ID still
registered (`3 pass, 1 fail`). The repair serializes the complete
`session.created` and `session.deleted` handlers in arrival order per resolved
session ID. Different session IDs and all non-lifecycle events remain
concurrent. The same regression then passed with the three existing
delete/recreate ordering cases (`4 pass, 0 fail`).

The fresh review also found `first-prompt-watchdog.ts` at 255 pure lines. Its
public interface now lives in `first-prompt-watchdog-types.ts` and is re-exported
from the original module, preserving the import contract while reducing the
implementation to 247 pure lines.

## Verification

- Red/green lifecycle proof: `red-lifecycle-ordering.txt` and
  `green-lifecycle-ordering.txt`.
- Focused ownership/lifecycle matrix: 28 pass, 0 fail, 74 expectations.
- Complete runtime-fallback plus lifecycle suite: 368 pass, 0 fail, 751
  expectations across 60 files.
- Complete plugin-event and session-state matrix: 86 pass, 0 fail, 208
  expectations across 13 files.
- Exact committed-source smoke: 18 pass, 0 fail, 52 expectations.
- OpenCode adapter typecheck and pinned Biome 2.4.16 lint: pass.
- Repository-local no-excuse audit: no violations in all 92 PR-changed
  TypeScript files.
- Pure-LOC gate: zero changed TypeScript files above 250 lines;
  `first-prompt-watchdog.ts=247`, `event.ts=244`.
- OpenCode harness self-check, SSE self-test, and isolated tmux TUI smoke: pass;
  the real database remained at 5,751 sessions.
- Production-duration isolated source-plugin run: silent-primary watchdog
  fallback, two active roots, newer-root deletion and older-root restoration,
  no fallback-owned re-arm, later external user cancellation, unchanged real
  database, and complete sandbox/process cleanup.
- Live-source binding: `run-live-watchdog-qa.sh` refuses to start unless all
  five repaired source paths are byte-identical to repair commit
  `093efc8c713d66c78cef65c5210af622a029c22a`, whose tree is
  `402ef28ff67606eb98116910222fcefbe2ed4514`. The accepted receipt records the
  evidence run head, source commit, source tree, and `source_matches=yes`.
- Exact evidence-head rerun: after the source-binding and lifecycle sanitizer
  were committed at `11d66695322a5a861299bb2a61af6d8dd2765c54`, the complete
  production-duration scenario was run again from that exact head. The current
  live receipt records that run head and the repaired source identity together.
- Lifecycle wire proof: the sanitized SSE artifact retains
  `session.created` and `session.deleted` alongside message, idle, and error
  events; session identifiers are replaced with reviewer-safe placeholders.
- Exact invocations and arguments for every red, green, static, harness, and
  production-duration check are indexed in `qa-commands.txt`.

## Sufficiency And Omissions

The deterministic regression directly controls the reverse lifecycle order
that caused resurrection. The full event matrix covers all sibling lifecycle
paths, while the runtime suite and real OpenCode run cover the watchdog,
fallback, deletion, and cancellation integration boundaries. The live script's
source-path assertion binds the production-duration run to the repair commit,
while its recorded run head identifies the evidence revision that performed
the check. The exact-commit smoke independently rechecks the changed behavior.

Raw `live-last-*` captures, the debug journal, and the temporary reviewer report
were removed. Sanitized artifacts contain no tokens, auth headers, credentials,
private environment dumps, or secret-bearing server logs.
