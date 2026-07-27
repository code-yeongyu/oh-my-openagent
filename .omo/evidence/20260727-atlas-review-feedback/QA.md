# Atlas reviewer-loop PR feedback QA

Date: 2026-07-27
PR: #6224

## What was tested

### Automated regression suite

Command:

```bash
bun test \
  packages/omo-opencode/src/hooks/atlas \
  packages/omo-opencode/src/hooks/goal \
  packages/omo-opencode/src/hooks/todo-continuation-enforcer \
  packages/omo-opencode/src/features/boulder-state \
  packages/boulder-state/src
```

Behavior covered:

- Internal OMO prompts do not clear final-wave approval.
- Real user text clears approval for the creator session.
- Split `message.updated` and `message.part.updated` events correlate by message ID.
- Interleaved user/internal messages remain independent.
- File and `synthetic: true` attachment context preserve correlation until real text arrives.
- Malformed, oversized, and excess pending IDs fail closed and remain bounded.
- Every session in one Boulder work observes the work-level pause.
- Only the creator session can clear the pause.
- Unknown sessions cannot set, replace, or clear another work's pause.
- Unknown Atlas completion callers use standalone verification.
- Legacy single-work state and task-session storage remain compatible.
- Goal continuation prompts carry the OMO internal marker.

Artifact: `targeted-regression-suite-final.txt`

### Type safety and policy audit

Commands:

```bash
bun run typecheck
bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts <changed-ts-files>
```

Artifacts:

- `typecheck-final.txt`
- `no-excuse-audit-final.txt`

### Production-module driver

Command:

```bash
bun .omo/evidence/20260727-atlas-review-feedback/final-blocker-driver.ts
```

The driver imports the production Atlas handler and Boulder storage modules. It exercises synthetic attachment text, a file part, later human approval, unknown-session pause mutation, and untracked-session completion routing.

Artifacts:

- `final-blocker-driver.ts`
- `final-blocker-driver-result.txt`

### Isolated real OpenCode lifecycle probe

Command:

```bash
bash .omo/evidence/20260727-atlas-review-feedback/independent-sse-probe.sh \
  .omo/evidence/20260727-atlas-review-feedback
```

Surface driven:

- Real `opencode serve` in an isolated XDG sandbox.
- Real session creation and async prompt API.
- Real `/event` SSE lifecycle stream.

Artifacts:

- `independent-sse-probe.sh`
- `sse-final.txt`
- `real-db-isolation-final.txt`

## What was observed

- Final scoped suite: **513 pass, 0 fail, 1,014 expectations across 59 files**.
- Full root typecheck completed successfully.
- No-excuse audit reported no violations in 16 changed TypeScript files.
- Production driver reported all five final behaviors as `true`.
- Real prompt API returned HTTP `204`.
- SSE observed three `message.updated` events and one `message.part.updated` event.
- The real split part had text but no `info.role`, validating role-independent correlation.
- Real OpenCode database count stayed **6350 before and 6350 after** isolated QA.
- No QA-owned OpenCode, curl, npm, Bun build, or driver processes remained.
- No temporary driver directories remained.

## Why this is enough

The regression suite covers each reported reviewer scenario and the additional ordering, malformed-input, authorization, and legacy-state boundaries found during review. The production driver executes the actual exported modules rather than test doubles. The isolated OpenCode probe proves the lifecycle events reach the plugin surface with the wire shape the implementation now handles, while the unchanged host DB count proves isolation.

Five independent review lanes checked goal compliance, code quality, security, hands-on behavior, and PR/history context. After all blocking findings were fixed, the final quality and security verdicts were unconditional PASS.

## Validation limitations

- `lsp_diagnostics` was clean before the ambient OpenCode package cache disappeared. Subsequent calls could not start the shared daemon because the running proxy's cached package path no longer existed. Full root typecheck and the no-excuse audit were rerun after the final edit. See `lsp-diagnostics-caveat.txt`.
- The main plugin compilation completed, but root build could not complete the unrelated vendored `packages/lsp-daemon` install because npm 11.8.0 and package-pinned npm 11.16.0 both stalled at Arborist `idealTree buildDeps` before compilation. See `lsp-daemon-npm-ci-pinned.txt`.
- The canonical root test run under local Bun 1.3.9 ignored `bunfig.toml` upstream exclusions after build materialization and discovered Vitest-only submodule fixtures. CI pins Bun 1.3.12. The affected 513-test suite is green.

## What was omitted

- Raw failed-suite output was omitted because it is 6,196 lines of unrelated upstream fixture failures and terminal formatting; the cause and replacement validation are summarized above.
- Provider credentials, environment dumps, authorization headers, tokens, and private configuration were not recorded.
- Unrelated untracked `.cortexkit/` content was not modified or staged.
