# PR #6569 follow-up: the committed installer bundle was stale, and nothing could catch it

Review comment: https://github.com/code-yeongyu/oh-my-openagent/pull/6569#discussion_r3709241495
Captured 2026-08-05 on Windows 11, bun 1.3.14, node v24.18.0, codex-cli 0.146.0.

## What was tested

Two things, because the finding has two halves.

1. **The reported harm**, on the exact surface named in the review: a clean-checkout
   `node packages/omo-codex/scripts/install-local.mjs install` run with a one-shot
   `CODEX_LOCAL_BIN_DIR`, followed by an uninstall WITHOUT that variable. That entrypoint's
   `ensureGeneratedInstaller()` returns as soon as `install-dist/install-local.mjs` exists, so the
   committed bundle bytes are what actually execute.
2. **Whether the staleness could recur silently.** It could, and worse than it looks: `test:codex`
   begins with `bun run build:codex-install`, so every gate run regenerates the bundle before any
   test executes. No test that inspects the working-tree bundle can ever observe staleness.

## What was observed

**The harm reproduced and then disappeared, with only the bundle bytes changing.** The same
driver ran twice against an isolated `CODEX_HOME`:

| bundle bytes | `.installed-bin-dir.json` | uninstall result | driver |
|---|---|---|---|
| stale committed blob | not recorded | 13 wrappers **STRANDED** in the custom dir | `fails=1` |
| regenerated (final, marked) | recorded, `{"binDir":"…omo-6569-custombin-vGiwGr"}` | custom bin dir **empty** | `fails=0` |

Artifacts: `live-before-stale-bundle.txt`, `live-after-final-marked-bundle.txt`. Both runs assert
the real `~/.codex/config.toml` is unchanged, and both report `PASS: real ~/.codex/config.toml
unchanged`.

**The guard.** `build-codex-install.ts` now stamps the artifact with
`// omo-codex-install:<sourceDigest>:<bodyDigest>` on line 2, and
`script/codex-install-bundle-freshness.test.ts` reads the bundle **from the git index** and
asserts the marker is present, self-consistent, and that its `sourceDigest` equals a digest of the
current installer sources.

- RED (`red-stale-committed-blob.txt`): `0 pass / 2 fail` — the committed blob carries no marker.
- GREEN (`green-regenerated-staged.txt`): `2 pass / 0 fail`.
- CONTROL (`control-source-change.txt`): appending one line to
  `packages/omo-codex/src/install/codex-installed-bin-dir.ts` without regenerating flips the
  digest test to `1 pass / 1 fail`; reverting and rebuilding restores `2 pass / 0 fail`.
- `typecheck-script.txt`: `bun run typecheck:script` exit 0.

## Why it is enough

The control is what makes the GREEN non-vacuous: the digest provably tracks installer source
content, so the test fails for the real reason rather than by construction.

Two design choices were forced by how this repo actually builds, and both were verified rather
than assumed:

- **The test reads the git index, not the working tree.** Because `test:codex` pre-builds the
  bundle, a working-tree comparison would be rebuilt into agreement before running and could
  never fail. The index holds the bytes a clean checkout executes, and no pre-build step rewrites
  them.
- **The marker digests SOURCES, not output bytes.** An earlier draft compared the committed bundle
  byte-for-byte against a fresh `Bun.build`. That is wrong here: CI pins Bun 1.3.12 while this host
  runs 1.3.14, so bundler output can differ on a perfectly current bundle and the test would fail
  in CI for no real defect. Digesting sources (line-ending normalized, so a CRLF checkout and an
  LF checkout agree) removes that entire failure mode. This mirrors the `// omo-senpi-build:`
  marker in `packages/omo-senpi/plugin/scripts/build-extension.mjs`, which solves the same problem
  the same way.

## What was omitted

- `readInstalledCodexBinDir` is still absent from this bundle (`marker-grep.txt` records 0
  occurrences). That is correct, not a gap: the read happens on the uninstall path in
  `codex-cleanup.ts`, which is reached through the root CLI, not through the installer entrypoint.
  Only the WRITE belongs in this bundle.
- The source digest covers `packages/omo-codex/src/install/**/*.ts` plus the build script and its
  settings. A change in a transitively bundled dependency OUTSIDE that directory would not flip
  the marker. Residual accepted deliberately to keep the guard cheap; the reported regression
  class (installer source edited, bundle not regenerated) is fully covered.
- Isolated-home paths and the temp custom bin directories appear verbatim in the driver logs.
  They are `mktemp` paths under the OS temp dir and carry no credentials; no tokens, auth headers,
  or env dumps are included in any artifact here.
