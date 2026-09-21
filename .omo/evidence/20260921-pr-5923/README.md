# PR 5923: Windows Codex command shims

Rebuilt from origin/dev 1b21dc9bd. Supported root wrapper remains omo-agent-toolkit(.cmd). No legacy omo wrapper or source version/reasoning change is introduced.

## Verified behavior
- `bun test packages/omo-codex/src/install/codex-cache-command-shim.test.ts`: four real cmd.exe tests failed before the fix with batch syntax errors, then all four passed. Root and cached component shims receive quoted runtime paths containing spaces from environment and isolated config.toml. Arguments survive intact. See windows-before.txt and windows-after.txt (final run: CI Bun 1.4.2).
- `npm --prefix packages/omo-codex/plugin/components/ulw-loop test -- test/bootstrap-wrapper.test.ts test/package-smoke.test.ts`: 16 passed, one existing POSIX-only test skipped. The two new Windows tests execute real Git Bash against toolkit shell and .cmd wrappers outside PATH. The existing cached-JavaScript regression now exercises the dispatch function. See bootstrap-tests.txt.
- `node --test packages/omo-codex/scripts/install-generated-bundle.test.mjs`: 7 passed. See generated-bundle.txt.
- Codex adapter and ULW component typechecks passed. See typecheck.txt and ulw-typecheck.txt.
- Local plugin build passed. See plugin-build.txt.
- Real local Codex app-server completed a turn against the skill's local mock model. SessionStart and UserPromptSubmit hooks completed with no failed or missing hooks. See app-server.json. Local installer exit: 0; app-server driver exit: 0.
- Final live run isolated CODEX_HOME, HOME, USERPROFILE, install bins, and project directory. Real ~/.codex/config.toml SHA-256 is unchanged (isolation.json). No auth/config contents or environment dumps are recorded. Docker daemon was unavailable, so the codex-qa Windows fallback was used.

## Generated installer provenance
Regenerated using CI-pinned Bun 1.4.2 and script/build-codex-install.ts. The only output changes are the quote repair, freshness marker, and embedded adapter version beta.80 -> beta.81. Current dev already has beta.81 in packages/omo-codex/package.json; its checked-in bundle was stale. The source package metadata is unchanged. Keeping beta.80 would require altering source metadata or hand-editing generated output, contrary to the maintainer's regeneration requirement.

## Unavailable broader gates
- `bun run test:codex` stops in the pre-existing ULW `codex-goal-snapshot.test.ts` fixture-path case on Windows: 671 passed, 1 failed, 1 skipped. See codex-gate.txt. Later stages did not execute. This run used installed Bun 1.3.13; final focused regressions and bundle generation used 1.4.2.
- Broader wrapper suite: 14 passed, 2 POSIX-only skips, 3 failures creating legacy symlinks (Windows EPERM). Those unchanged cases require symlink privileges on this host. See wrapper-suite.txt.
- No Linux/macOS matrix or remote CI run was triggered. TUI smoke was not needed for a command-shim/bootstrap fix; the real app-server proved plugin wiring.

## Remote follow-up
Local branch: fix/windows-codex-toolkit-shims. No push, PR comment, merge, or label mutation was performed.
After publishing this rebuilt branch to PR 5923, request full Windows/Linux/macOS coverage:
`gh pr edit 5923 --repo code-yeongyu/oh-my-openagent --add-label 'ci:full-matrix'`
The existing PR still needs its remote branch replaced with this current-dev rebuild and CI/review completed.
