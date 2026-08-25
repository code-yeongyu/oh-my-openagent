# PR #6611 post-rebase verification

## Rebase integrity

The remote PR head `3d0694b3084e52aa90777c0bbaa7156b79900359`
was backed up locally and rebased from merge base
`00bd5b2fc7ca98ecc4732a387033a3c50aa67b0a` onto current `origin/dev`
`b8b7b095409828e2d5f2a8619d93a415061609e2`.

`post-rebase-range-diff.txt` maps every PR commit to its rewritten equivalent.
The seven blocker-fix commits and their evidence commits are all retained. The
only skipped commit is the unrelated completion-fixture timebomb fix
`dde2ea84d`: current `dev` independently supersedes it with the stronger fixed
clock injection (`FIXED_NOW_MS`) and tolerant teardown helper. Its focused 10-test
suite passed on the rebased tree.

The source-verified rebased code head was
`c3596c1bde49a55917f9d07d1a3d56eece6ee560`; the evidence commit added after
verification changes no source or runtime artifact.

## Fresh affected proof

- `post-rebase-related-tests.txt`: runtime fallback, chat adapter, prompt route
  audit, all prompt-gate tests, and the resolved completion conflict passed
  `439 pass, 0 fail` across 44 files on CI-pinned Bun 1.3.14.
- `post-rebase-lsp-daemon-tests.txt`: vendored daemon passed 21 files / 155 tests.
- `post-rebase-typecheck.txt`: root, script, and all package typechecks exited 0.
- `post-rebase-root-tests.txt` (kept locally due its repetitive 2 MB size): the
  exact non-Windows CI command `bun --config=bunfig.root.toml test` passed
  `13920`, skipped 12 platform-gated tests, and failed 0 across 1793 files.
- `post-rebase-install.txt`: `bun install --frozen-lockfile` completed and its
  root prepare hook rebuilt every shipped surface successfully.
- Rebuilt `dist/index.js` SHA-256:
  `47af8b5857a8001b2c841ff43253f7ea098a450191a5034c4c778c96079a7194`.

## Fresh real OpenCode QA

OpenCode 1.18.18 loaded that exact source-built bundle from this worktree in an
authenticated isolated-XDG server. A deterministic local OpenAI-compatible
provider accepted the API prompt (HTTP 204), and a pre-subscribed SSE stream
observed `server.connected`, `session.status`, `message.updated`, and
`message.part.updated` with `fake response 2`.

The isolated DB contained one QA session. The host DB remained at 7586 sessions
before and after. The sandbox was removed and both the OpenCode and fake-provider
processes were confirmed stopped. The refreshed common-harness and SSE self-tests
also passed.

Artifacts:

- `post-rebase-opencode-source-qa.txt`
- `post-rebase-opencode-common-self-check.txt`
- `post-rebase-opencode-sse-self-test.txt`
- `post-rebase-bundle-sha256.txt`

No credentials, auth headers, passwords, environment dumps, or private provider
payloads are present in the committed evidence.
