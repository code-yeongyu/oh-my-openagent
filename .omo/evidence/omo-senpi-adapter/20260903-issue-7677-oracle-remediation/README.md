# Issue #7677 Oracle remediation

> SUPERSEDED: this 48-test receipt predates the final reviewer blockers. Use `../20260903-issue-7677-c42f893c9-reviewer-remediation/`, generated fresh for source head `c42f893c953df103a38c42820568ccde34fcc215`.

## Reviewer findings remediated

This follow-up fixes every code-quality Oracle and ultrabrain blocker reported against `eef42638f`:

- a thrown file-read error now remains primary even when a diagnostic stat observes shrink;
- a traversal/read error now remains primary over directory close failure, while close-only failure is still reported;
- canonical isolation certification now requires complete, untruncated, error-free protected and nonvolatile-domain observations before and after the run;
- bounded snapshots account for symlinks by hashing link text and metadata without dereferencing targets; unsupported persistent entry kinds make the observation incomplete;
- path separator normalization receives explicit producing-platform context, preserving literal backslashes on POSIX;
- top-level `sessions/`, `cache/`, `logs/`, and `*.log` volatility is excluded before file/byte budgets are consumed.

## What was tested

- RED: five focused files produced 41 pass and the seven intended failures listed in `red.txt`.
- GREEN: the same focused command produced 48 pass, 0 fail.
- Driver self-test, package typecheck, exact scoped Biome, no-excuse, LSP diagnostics, and extension freshness passed.
- Final full `bun run test:senpi`: 2,567 pass, 7 platform-specific skips, 0 fail; resolver suite 10 pass, 0 fail.
- The real installed Senpi binary executed the feature scenario in a child HOME/USERPROFILE and isolated agent directory.

## Live result and isolation interpretation

The final driver emitted `result: "PASS"`: the Senpi ultrawork and comment-checker feature scenario succeeded. This is deliberately separate from `isolationCertified: false`. The run does **not** certify that either real home was untouched.

Independent protected snapshots were complete and error-free for both real roots, and both canonical changed-path arrays were empty. Certification was nevertheless withheld because the bounded Senpi nonvolatile-domain observation reached its hard limit and the OMO nonvolatile-domain observation encountered an unsupported persistent RPC socket entry. The socket path is non-sensitive and is retained structurally as `rpc/rpc.sock`; no socket/session identifier is present. These fail-closed facts are machine-consumed through `isolationCertified` and the `real*Untouched` fields.

The observation domain is explicitly labeled `nonvolatile-home`. It excludes volatile subtrees and logs and never claims whole-home completeness. Limits remain 10,000 files, 20,000 entries, and 64 MiB per snapshot.

## Why this is enough

Deterministic public-snapshot regressions cover both primary-error precedence defects, observation errors and truncation, close-only errors, symlink creation and retargeting, no dereference outside the root, explicit POSIX/Windows path style, and volatile-subtree budget exclusion. The full package gate and real driver prove integration with the shipped QA surface.

## Scope and omissions

Verified source head: `ba455bc1c9a60acc354915f909d89fd2cb338dc4`. Fetched `origin/dev` remained `65c55dc6b470e0b21f60ff3c16c8e9594d575cd8`, so no merge was needed after the fixes.

No `script/**`, package manifest, Senpi pin/patch, CI, OAuth/compile runtime, generated bundle, adapter production source, or Codex generated installer changed. No credential content, protected hash, token, auth header, environment dump, or model transcript is stored here.
