# PR 5923 local rebuild plan and todos
Base: origin/dev 1b21dc9bd. One fix agent, local delivery only.
- [x] Add real cmd.exe root toolkit and cached component regressions for quoted runtime paths (environment and isolated config), capture failure.
- [x] Repair double-quote stripping in codex-cache-command-shim.ts; rerun regressions.
- [x] Correct ULW bootstrap wrapper/native JS resolution with toolkit naming and executable Git Bash regression.
- [x] Regenerate scripts/install-dist/install-local.mjs with build:codex-install; verify source/bundle parity.
- [x] Run test:codex and scoped typechecks; install local build in isolated CODEX_HOME and drive real app-server with mock model; record host config digest isolation.
- [x] Commit focused changes and evidence; prepare ci:full-matrix request for existing PR, without remote writes.
Goal: Windows toolkit and component shims execute with quoted runtime paths; bootstrap executes supported toolkit correctly; evidence records all gates and limitations. No version/reasoning drift or legacy omo wrappers.

Broader gate limitations are recorded in README.md; remote publication remains out of scope.
