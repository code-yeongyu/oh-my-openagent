# omob — dev binary from the latest commits

`omob` builds a single-file bun-compiled binary from the freshest tracked
commits — senpi `origin/main` + omo `origin/dev` — and installs it as
`omob` next to your regular `omo`. It exists to test a commit pair
end-to-end without cutting a release.

```bash
bun run omob                       # latest origin/main + origin/dev
bun run omob --senpi-ref origin/feat/x --omo-ref abc1234   # omo refs must already contain the omob build-info support
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
- Rebuild to update: `bun run omob` (the `update` hint inside omob says so).
