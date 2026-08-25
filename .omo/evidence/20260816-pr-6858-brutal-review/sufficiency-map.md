# PR #6858 evidence sufficiency map

## Review submission

| Requirement | RED | GREEN |
|---|---|---|
| No existing owner REQUEST_CHANGES review | `review-red.json` | `review-response.json`, `review-green.json` |
| Literal API payload and blocker traceability | `branch-baseline.txt` | `review-request.json`, review id `4945309647`, inline comments `3790854396` and `3790854397` |

## Submitted blockers

| Blocker | RED artifact | GREEN artifact |
|---|---|---|
| Generated bundle conflicted with current `dev` | `merge-red.txt` | `merge-green.txt`, `bundle-green.txt`, `local-verification.txt` |
| Current PR head lacked CI | `ci-red.json` | Workflow `31939507552`, final check rollup artifact |
| Windows evidence was prose-only and did not isolate the agent directory | `evidence-red.txt` | Canonical adapter `qa.md`, command artifacts, package-owned probe, RED payloads, `windows-console-probe-green.json`, and cleanup receipt |
| Production `execution_mode: "process"` route was dismissed as in-process | `routing-red.txt` | `routing-green.json`, `routing-sufficiency.md` |
| PR body used obsolete evidence paths | `evidence-red.txt` | Final PR body snapshot after canonical link replacement |

## Final security review blockers

| Blocker | RED | GREEN |
|---|---|---|
| RPC cancellation killed only the direct child | `security-blockers.md` descendant RED | Process-group/taskkill implementation, real descendant GREEN test |
| Bundle freshness trusted a self-declared body hash | `security-blockers.md` forgery RED | Exact generated-body comparison, pinned deterministic Terser build, size gate |

## Required local gates

`local-verification.txt` records:

- 125 runnable Senpi runner tests green, 1 Windows-only probe skip.
- Senpi-task, omo-senpi, and omo-codex typechecks exit 0.
- Exact Bun 1.3.12 generated bundle check exit 0.
- Full Senpi gate: 1715 pass, 1 intentional Windows-only skip, 0 fail.
- Full Codex gate: 519 pass, 0 fail.
- Changed-file LSP diagnostics clean.
- Changed files below 250 pure LOC.

## Real surfaces

- Codex installer: `codex-install-qa.txt`
- Production Senpi RPC routing: `routing-green.json`, `routing-sufficiency.md`
- Windows hosted process allocation: `windows-console-probe-green.json` from workflow `31939507552`, job `95146554570`.
- Windows production routing: `windows-routing-green.json` from workflow `31939507552`, job `95146554538`.
- Hosted Windows control: non-zero visible console HWND; hidden production child: `MainWindowHandle: 0` and no visible console HWND.

## Cleanup and omissions

- No environment dump is retained.
- Real credential contents, auth headers, model tokens, and private config bodies are omitted.
- Final worktree, LSP symlink, temporary probes, and process cleanup receipts will be added after merge cleanup.
