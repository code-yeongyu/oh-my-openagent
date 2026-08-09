# QA summary - PR #6569 review hardening (2 product P2s)

Captured 2026-08-04 on Windows 11, bun 1.3.12, node v24.18.0, codex-cli 0.146.0.

Covers the two remaining product findings on #6569:

1. `codex-cleanup.ts` - an install that used a one-shot `CODEX_LOCAL_BIN_DIR` left every wrapper
   behind, because uninstall recomputed the default bin directory.
2. `codex-cleanup-bins.ts` - a managed Windows wrapper stored as `OMO.CMD` survived uninstall,
   because both the `.cmd` suffix test and the managed-name lookup were case-sensitive.

## What was tested

- Unit RED/GREEN for the Windows casing predicate and for the recorded bin directory:
  `bun test packages/omo-codex/src/install/codex-cleanup.test.ts`,
  `bun test packages/omo-codex/src/install/codex-installed-bin-dir.test.ts`
- Regression scope: `bun test packages/omo-codex/src/install`, compared against the same run with
  the product changes stashed.
- `bun run typecheck:packages`
- Isolated install verification from the `codex-qa` skill:
  `.agents/skills/codex-qa/scripts/install-verify.sh --self-test` -> `install-verify.txt`
- Live end-to-end proof of the reported scenario, install and uninstall against an isolated
  `CODEX_HOME`: `live-bindir-driver.sh` -> `live-bindir-BEFORE.txt`, `live-bindir-AFTER.txt`

## What was observed

- Windows casing: RED then GREEN. A managed `OMO.CMD` carrying the installer marker is now
  removed, while a markerless `Omo.Cmd` owned by the user is still kept, so case-insensitive
  matching did not widen ownership.
- Recorded bin directory, live, through the real installer and the real `omo cleanup
  --platform=codex` command surface:

  | | manifest recorded | wrappers left after uninstall | result |
  |---|---|---|---|
  | BEFORE (PR head) | no | 13 stranded | fails=1 |
  | AFTER (fix) | yes, pointing at the custom dir | none, directory empty | fails=0 |

  The BEFORE column is the control: without the fix the exact reported symptom reproduces on this
  branch, so the AFTER result is a real result rather than a harness artifact.
- Install verification: plugin cache present (4.19.4), `config.toml` enables `omo@sisyphuslabs`,
  9 component bins linked, agent TOMLs linked, exit 0.
- Isolation: every run asserted the real `~/.codex/config.toml` shasum unchanged
  (`05cb7d5a3b6147a929bff1781ba258237c7744e0`). Independently confirmed before the QA started:
  sha256 `2D70A22821B092AACB25ABE1E129CE37ADA71AA15EB5BC23BB09F03D01019B14`, 9957 bytes.
- Suites: `packages/omo-codex/src/install` went from `261 pass / 2 fail` (stashed baseline) to
  `269 pass / 2 fail`, so all 8 added tests pass and the failure set is unchanged. Those 2
  failures are the pre-existing project-local cleanup failures already documented in
  `.omo/evidence/20260803-fix-6320-uninstall-bins/preexisting-projlocal-fails.txt`.
- `bun run typecheck:packages` exit 0.

## Why it is enough

The defect is only visible across an install/uninstall boundary, so it is proven there: a real
install writes real wrappers into a custom directory, and a real uninstall run without the
override either clears them or does not. The BEFORE/AFTER pair isolates the change, and the
control shows the harness can observe the failure.

Residual risk: the recorded location is only consulted when neither an explicit `binDir`
argument nor `CODEX_LOCAL_BIN_DIR` is present, pinned by a precedence test. A malformed or blank
record falls back to normal resolution rather than producing a bad sweep target, also pinned.

## One harness that produced a false negative, and why it was replaced

The first version of the live driver called
`node packages/omo-codex/scripts/install-local.mjs uninstall`. That reported the wrappers as
stranded even with the fix applied. `install-local.mjs` maps `uninstall` to a pass-through that
spawns the PUBLISHED omo CLI through `npx`, so it exercised the released build rather than this
worktree, and `cleanupCodexLight` is not even present in that bundle. The driver now invokes
`bun packages/omo-opencode/src/cli/index.ts cleanup --platform=codex`, which is the same command
surface a user gets and does run this worktree's code. `live-bindir-AFTER.txt` is from the
corrected driver.

## What was omitted

`bun run test:codex` was not run to completion locally: on this Windows host it fails in the
vendored `packages/lsp-tools-mcp` step (`rm -rf` is unavailable), which is unrelated to this
change. The gate runs in CI (`ci.yml` `codex-compatibility`, ubuntu/macos/windows).

The regenerated `packages/omo-codex/scripts/install-dist/install-local.mjs` and
`packages/omo-codex/plugin/components/codegraph/dist/cli.js` were reverted rather than committed,
matching existing practice for generated artifacts in this repo. `publish.yml` runs
`bun run build:codex-install` before packing, so the shipped installer is rebuilt from this
source. The live proof above was captured with the bundle regenerated from these sources.

No secrets, auth headers, provider tokens, or environment dumps were recorded. All installs used
an isolated `CODEX_HOME` under a temp dir.
