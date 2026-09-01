# Installing the LOCAL omo build into an isolated CODEX_HOME

QA must run THIS repo's local build, not the published package. The installer
respects `CODEX_HOME` for everything, so a non-default home is fully self
contained.

## Command

```bash
export CODEX_HOME="$(mktemp -d)/codex"; mkdir -p "$CODEX_HOME"   # must exist first
export OMO_DISABLE_POSTHOG=1 OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_PROJECT="$(mktemp -d)/project"                  # keep project-local cleanup off your tree
node packages/omo-codex/scripts/install-local.mjs install
```

`cqa_install_local_omo` wraps this (logs to `$CQA_HOME_ROOT/install.log`).

## What it writes (all under CODEX_HOME)

Source: `packages/omo-codex/src/install/install-codex.ts`.

1. Builds + copies the plugin to
   `$CODEX_HOME/plugins/cache/sisyphuslabs/omo/<version>/` (then `npm ci --omit=dev`).
2. Links component bins into `$CODEX_HOME/bin/omo-*` (8: comment-checker,
   git-bash-hook, lsp, rules, start-work-continuation, telemetry, ultrawork,
   ulw-loop).
3. Links agent TOMLs into `$CODEX_HOME/agents/*.toml`.
4. Writes a marketplace snapshot under `$CODEX_HOME/.tmp/marketplaces/sisyphuslabs/`.
5. Edits `$CODEX_HOME/config.toml`: enables `[plugins."omo@sisyphuslabs"]`,
   the `[marketplaces.sisyphuslabs]` local source, `[features]`
   (plugins/plugin_hooks/multi_agent/child_agents_md), and one
   `[hooks.state."omo@sisyphuslabs:hooks/hooks.json:<event>:i:j"] trusted_hash`
   per hook (so Codex trusts them — no `--dangerously-bypass-hook-trust` needed
   for the app-server turn).

## Assertions (what install-verify.sh checks)

```bash
ls "$CODEX_HOME"/plugins/cache/sisyphuslabs/omo/*/                 # cache present
grep -A2 '\[plugins."omo@sisyphuslabs"\]' "$CODEX_HOME/config.toml" | grep 'enabled = true'
ls "$CODEX_HOME"/bin/omo-*                                          # component bins
ls "$CODEX_HOME"/agents/*.toml                                      # agent links
```

Plus the cross-cutting invariant every script enforces: the real
`~/.codex/config.toml` shasum is unchanged.

## Notes

- The only thing outside CODEX_HOME is the `omo` runtime wrapper, which targets
  the repo's `dist/cli/index.js` (the CLI ships from the repo). `dist/cli/index.js`
  must exist (run `bun run build` if missing) or that link is skipped.
- Cleanup: for an isolated home just `rm -rf "$CODEX_HOME"` (the harness does
  this on exit). For a normal home, `node packages/omo-codex/scripts/install-local.mjs uninstall`.
- `bun run test:codex` is the hermetic unit gate (installer/config/component
  build) and does NOT launch a real codex — this skill is what proves the live
  session.
