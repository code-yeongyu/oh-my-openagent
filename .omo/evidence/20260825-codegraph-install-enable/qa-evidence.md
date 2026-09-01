# QA Evidence: fix(#6237) codegraph install-state detection + install-time provisioning

## WHAT WAS TESTED

1. **Failing-first regression test** (`packages/omo-opencode/src/mcp/codegraph.test.ts`,
   new case "#given only a provisioned binary and an unsupported host Node #when creating
   the MCP config #then it enables the provisioned command"): a valid provisioned
   standalone binary + version marker under `install_dir` with NO supported local Node
   runtime. Surface: `createCodegraphMcpConfig()` (the built-in codegraph MCP
   registration consumed by OpenCode's config phase).
2. **New installer provisioning module** (`packages/omo-opencode/src/cli/install-codegraph.test.ts`):
   success path provisions into `~/.omo/codegraph` with the pinned version and lock dir;
   failure paths (provisioner error result, thrown error) log a warning and never throw.
3. **Installer wiring hermeticity**: all 7 CLI/TUI installer test files spy-mock
   `installCodegraphForOpenCode` so no test performs a real download.
4. **Scoped gates**: `bun test` over the 8 affected co-located suites; full repo typecheck.

## WHAT WAS OBSERVED

- RED (before fix), captured from the run at implementation time:
  `bun test packages/omo-opencode/src/mcp/codegraph.test.ts` → 12 pass / 1 fail:
  `expect(config.enabled).toBe(true)` received `false` for the provisioned-binary +
  unsupported-Node case — reproducing the issue report ("installed codegraph shows
  disabled / Not Installed").
- GREEN (after fix): same suite 13 pass / 0 fail; full scoped suite across 8 files
  46 pass / 0 fail (`scoped-tests-green.txt`).
- Full typecheck `bun run typecheck` (tsgo --noEmit + script + all workspace packages)
  exit 0 (`typecheck-green.log`, `typecheck-exit.txt`).

## WHY IT IS ENOUGH

- The enablement gate now reuses the shared invariant
  `codegraphCommandRequiresSupportedLocalNode()` from `@oh-my-opencode/utils`
  (same semantics the Codex-side component already uses), removing the divergent inline
  copy that omitted `"provisioned"`. Bundled/env/PATH behaviors are pinned by the 12
  pre-existing cases in the same suite, all still green.
- Install-time provisioning mirrors the established ast-grep precedent
  (`installAstGrepForOpenCode`) in both CLI and TUI installers, best-effort non-fatal,
  so `bunx oh-my-openagent install` leaves a working provisioned binary behind
  regardless of invocation style.
- Residual risk: no live OpenCode session was driven in this environment (headless,
  network-restricted); behavior is verified at the MCP-config seam that OpenCode's
  config phase consumes, which is where the reported `enabled: false` originates.

## WHAT WAS OMITTED

No secrets, tokens, or auth material are present in any captured artifact. Test output
contains only local temp-dir paths.
