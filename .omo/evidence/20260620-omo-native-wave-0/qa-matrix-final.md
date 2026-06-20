# omo-native Wave 0 Manual QA Matrix Final

Worktree: `/Users/yeongyu/local-workspaces/omo-wt/code-yeongyu/omo-native-wave0`
Evidence directory: `.omo/evidence/20260620-omo-native-wave-0/`
Matrix refreshed: 2026-06-20
Scope: read current diff and evidence only; no product files edited by this refresh.

## Verdict

PASS.

Current evidence includes both required unblockers:
- Terminal/tmux screenshot proof is present and non-empty: `terminal-tui.png` is a 1600 x 1118 PNG, paired with `terminal-tui-transcript.txt` and `terminal-tui-screenshot-receipt.txt`.
- Installability is now passing: `bun-install-fixed.txt`, `review-blocker-fix-stop-hook-verify-3.txt`, and `final-local-verification.txt` show successful install/frozen install, lockfile grep, build, dynamic import, and typecheck evidence.

The C002 seam audit remains intentionally RED. That is a planned Wave 1 positive seam proof, not a Wave 0 product failure: the audit confirms the boundary test runs and the positive real senpi/pi type-layer import check fails as designed while the seam is still a stub.

## Current Diff Observed

Refresh surface: terminal CLI.
Refresh invocation used to read current state:

```sh
git status --short
git diff --stat
rg --files .omo/evidence/20260620-omo-native-wave-0
```

Observed product diff/status at refresh time:
- `.gitmodules` added.
- `bun.lock` modified.
- `bunfig.toml` modified.
- `package.json` modified.
- `packages/senpi` added as gitlink.
- `packages/omo-native/` untracked.

## manualQa.surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S-C001-01 | C001 terminal/tmux build proof | terminal CLI | `bun install --frozen-lockfile --ignore-scripts` | PASS | A001, A009 |
| S-C001-02 | C001 terminal/tmux build proof | terminal CLI | `bun run build:native` | PASS | A001, A004, A009 |
| S-C001-03 | C001 terminal/tmux build proof | terminal CLI | `node packages/omo-native/build.mjs` | PASS | A004, A009 |
| S-C001-04 | C001 terminal/tmux build proof | terminal CLI | `node -e "import('./packages/omo-native/dist/index.js').then(m => console.log(typeof m.default))"` | PASS | A001, A004, A009 |
| S-C001-05 | C001 terminal/tmux build proof | terminal CLI | `bun run --cwd packages/omo-native typecheck` | PASS | A001, A004, A009 |
| S-C001-06 | C001 terminal/tmux screenshot proof | tmux terminal screenshot | `tmux new-session -d -s ulw-qa-omo-native-wave0-terminal -x 120 -y 34 ...` followed by PNG capture | PASS | A002, A003 |
| S-C001-07 | C001 build reverify artifacts | terminal CLI | repeated Todo 2 stop-hook reverifies: `bun run build:native`, dynamic import, package typecheck, manifest checks | PASS | A005 |
| S-C002-01 | C002 seam audit RED | terminal CLI | `cd packages/omo-native && npx vitest run src/__tests__/seam-boundary-audit.test.ts` | PASS, intended RED observed | A006 |
| S-C002-02 | C002 seam audit RED repeated reverify | terminal CLI | `npx --yes vitest@4.1.9 run --root /Users/yeongyu/local-workspaces/omo-wt/code-yeongyu/omo-native-wave0 packages/omo-native/src/__tests__/seam-boundary-audit.test.ts` | PASS, intended RED reproduced | A007, A008 |
| S-C002-03 | C002 seam audit static guard | terminal CLI | `rg -n "as any|: any|@ts-ignore|@ts-expect-error|!\\s*(?:[.;,)]|$)" packages/omo-native/src/__tests__/seam-boundary-audit.test.ts` | PASS | A011 |
| S-C003-01 | C003 workspace wiring | terminal CLI | `node -e "const p=require('./package.json'); console.log(p.workspaces.includes('packages/omo-native')); console.log(p.workspaces.includes('packages/senpi'))"` | PASS | A012 |
| S-C003-02 | C003 installability | terminal CLI | `bun install` | PASS | A013 |
| S-C003-03 | C003 frozen install | terminal CLI | `bun install --frozen-lockfile --ignore-scripts` | PASS | A009, A001 |
| S-C003-04 | C003 typecheck | terminal CLI | `bun run --cwd packages/omo-native typecheck` | PASS | A013, A004, A009 |
| S-C003-05 | C003 lockfile grep | terminal CLI | `rg -n omo-native\\|@earendil-works/pi-agent-core\\|@earendil-works/pi-ai bun.lock` | PASS | A009, A001 |
| S-C003-06 | C003 gate/blocker fix reverify | terminal CLI | `node` manifest probes for `@earendil-works/pi-agent-core`, root `@earendil-works/pi-ai` override, typecheck wiring, and final stop-hook verify | PASS | A014, A009 |

## manualQa.adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| ADV-01 | C001/C003 | dirty_worktree | Evidence must acknowledge the dirty worktree and verify scoped behavior without treating concurrent changes as clean baseline. | PASS | A001, A009, A012, A014 |
| ADV-02 | C002/C003 | stale_state | Reverification must use current files/lockfile, not stale pre-fix claims; frozen install must pass after lockfile refresh. | PASS | A006, A007, A009, A013 |
| ADV-03 | C001/C003 | misleading_success_output | Success claims must be backed by process exits and concrete observables: non-empty dist, `function` dynamic import, lockfile entries, local package links. | PASS | A001, A004, A009, A013 |
| ADV-04 | C002 | misleading_success_output | Vitest exit 1 must be interpreted only as the planned positive seam assertion failure, not as product failure or runner setup failure. | PASS | A006, A007, A008 |
| ADV-05 | C002 | flaky tests | The intended RED seam result must reproduce across repeated focused runs with the same assertion. | PASS | A006, A007, A008 |
| ADV-06 | C001/C003 | hung command | Build, import, install, frozen install, and typecheck commands must terminate and record exits/durations. | PASS | A001, A004, A009, A013 |
| ADV-07 | C001/C003 | cleanup | tmux session and generated dist artifacts must be cleaned up or shown ignored; no commit/push performed. | PASS | A002, A009, A013 |

## Scoped Not-Applicable Rationale

These are not counted as adversarial PASS cases because Wave 0 evidence does not expose a relevant executable surface:

| class | reason |
|---|---|
| prompt_injection | No prompt/model-facing text path or agent message parser is introduced by the covered omo-native Wave 0 build/install/seam evidence. |
| malformed_input | No untrusted input parser or user-supplied data parser is exercised by the covered build, typecheck, workspace, install, screenshot, or seam-audit surfaces. |
| cancel/resume | No resumable workflow, session state, or cancellation surface is started by the covered commands. |
| repeated_interruptions | Evidence records bounded terminal/tmux command scenarios, not an interruptible harness/session flow. |

## manualQa.artifactRefs

| id | kind | description | path |
|---|---|---|---|
| A001 | terminal transcript | Fresh final local verification after install/build fixes; includes frozen install, build, dynamic import, typecheck, lockfile metadata, and scoped status. | `.omo/evidence/20260620-omo-native-wave-0/final-local-verification.txt` |
| A002 | screenshot receipt | tmux terminal screenshot capture receipt; records tmux invocation, transcript path, PNG path, file metadata, and tmux cleanup. | `.omo/evidence/20260620-omo-native-wave-0/terminal-tui-screenshot-receipt.txt` |
| A003 | png screenshot | Rendered terminal/tmux screenshot, non-empty PNG image data. | `.omo/evidence/20260620-omo-native-wave-0/terminal-tui.png` |
| A004 | terminal transcript | Build pipeline after Todo 2 fixes: root `build:native`, dynamic import, package typecheck, root script assertions. | `.omo/evidence/20260620-omo-native-wave-0/build-pipeline.txt` |
| A005 | terminal transcript set | Build/typecheck reverify artifacts; repeated `build:native`, dynamic import, typecheck, manifest, and cleanup checks. | `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-todo2-1.txt`, `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-todo2-2.txt`, `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-todo2-3.txt` |
| A006 | terminal transcript | Focused seam audit RED run twice; Vitest exits 1 with the expected positive seam import assertion. | `.omo/evidence/20260620-omo-native-wave-0/seam-audit-red.txt` |
| A007 | terminal transcript | Repeated focused seam audit RED proof. | `.omo/evidence/20260620-omo-native-wave-0/seam-audit-red-repeat.txt` |
| A008 | terminal transcript set | Stop-hook reverifies for seam audit RED; confirms one boundary test passed and one positive seam test failed intentionally. | `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-4.txt`, `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-5.txt`, `.omo/evidence/20260620-omo-native-wave-0/stop-hook-reverify-6.txt` |
| A009 | terminal transcript | Third review-blocker stop-hook verify; includes lockfile freshness, frozen install, root build, build:native, dynamic import, typecheck, lockfile grep, dirty status, and cleanup judgment. | `.omo/evidence/20260620-omo-native-wave-0/review-blocker-fix-stop-hook-verify-3.txt` |
| A010 | terminal transcript | Terminal TUI transcript paired with screenshot receipt. | `.omo/evidence/20260620-omo-native-wave-0/terminal-tui-transcript.txt` |
| A011 | static transcript | Seam audit static checks: forbidden TypeScript escape-hatch scan and pure LOC. | `.omo/evidence/20260620-omo-native-wave-0/seam-audit-static.txt` |
| A012 | terminal transcript | Workspace wiring proof including submodule, workspace membership, manifest checks, dirty-worktree and stale-state probes. | `.omo/evidence/20260620-omo-native-wave-0/workspace-wiring.txt` |
| A013 | terminal transcript | Installability fix evidence: `bun install` exits 0, build exits 0, typecheck exits 0, package resolution/link proof, no registry pi-ai lock entry. | `.omo/evidence/20260620-omo-native-wave-0/bun-install-fixed.txt` |
| A014 | terminal transcript | Todo 1 gate fix evidence with corrected `@earendil-works/pi-agent-core` devDependency and typecheck wiring evolution. | `.omo/evidence/20260620-omo-native-wave-0/todo1-gate-fix.txt` |
| A015 | terminal transcript | Historical negative install proof superseded by A013/A009; retained as before-fix context only, not used for final PASS. | `.omo/evidence/20260620-omo-native-wave-0/bun-install.txt` |
| A016 | terminal transcript | Failing-first build pipeline before Todo 2: `build:native` missing, superseded by A004/A005. | `.omo/evidence/20260620-omo-native-wave-0/build-pipeline-before.txt` |
