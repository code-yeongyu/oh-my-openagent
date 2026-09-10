# omob — dev binary from the latest commits

`omob` builds a single-file Bun-compiled binary from senpi `origin/main` and
omo `origin/dev`. On macOS and Linux, the ordinary install places an auto-update
launcher at `~/.local/bin/omob` and its executable at `~/.cache/omob/bin/omob`.
It tests the current mainline commit pair end-to-end without cutting a release.

```bash
bun run omob                       # latest origin/main + origin/dev
bun run omob --name omob-feature --senpi-ref origin/feat/x --omo-ref abc1234
# Explicit feature builds use a separate name and require build-info support.
bun run omob --skip-install        # build only, into ~/.cache/omob/out
```

Behavior:

- The binary is stamped with an `omoBuild` provenance block (full commit SHAs,
  commit dates, branches). The TUI header shows `omo@<sha7> <date> ·
  senpi@<sha7> <date>` instead of a version; `omob --version` and `omob doctor`
  print the full SHAs, ISO commit dates, and branches.
- Dev builds are namespaced by commit pair: runtime provisioning lives under
  `~/.omo/binary-runtime/0.0.0-omob.<omo7>.<senpi7>/`, and older dev runtimes
  are pruned (keep 2 by default, `--keep N`). Release runtimes are never touched.
- `~/.omo` sessions/settings/auth are shared with a regular `omo` install on
  purpose: omob is the same product built from fresher commits.
- Every managed launch visibly checks both canonical upstream refs before running.
  The same pair skips dependency installation and compilation, checking provenance
  from the executable itself rather than trusting a metadata sidecar. A changed
  pair builds before launch. Running `bun run omob` again retains this launcher.
- The builder and source clones live in the managed cache, not the caller's
  checkout. A feature checkout is never reset or used as the default source.
  Named feature builds default to their own cache (for example
  `~/.cache/omob-feature`) so they cannot replace the managed mainline builder.
- Fetch/build failures stop launch with a nonzero status and leave the previous
  executable intact. Installation uses atomic rename. Concurrent updates share the
  existing cache lock and fail fast rather than interleave builds; retry after
  the active update finishes. Runtime arguments, exit status and signals pass
  through the launcher's final `exec`.
- Bun and Git must remain on `PATH`. `--binary-only` explicitly requests a bare
  executable instead of a launcher; the launcher uses this internally to refresh
  its cached executable. Windows retains the bare-binary installation path.
  `--launcher` explicitly requests the managed POSIX installation.
