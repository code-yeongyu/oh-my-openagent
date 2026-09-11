# builtin-mcps: context7 + grep_app parity for the native Senpi edition

Change: new `packages/omo-senpi/src/components/builtin-mcps/` component registering the two remote MCP
servers the OpenCode edition injects at runtime (`context7`, `grep_app`), registered after `ast-grep`
in `src/extension/component-list.ts`, plus the regenerated `plugin/extensions/omo.js` bundle.

Reported on Discord, 2026-09-08: "is there a reason why omo beta does not come with context7, websearch
mcps?" — `context7`/`grep_app` are the real gap; `websearch`/`webfetch` are senpi builtins and are
deliberately NOT re-declared.

## WHAT WAS TESTED

1. Component unit contract (hostless): declaration shape, `CONTEXT7_API_KEY` bearer branch, placeholder
   normalization, missing-`registerMcpServer` skip, and the `omo-senpi-builtin-mcps-disabled` compose flag.
2. Host declaration contract: the INSTALLED senpi's own `validateMcpServerDeclaration`
   (`@code-yeongyu/senpi@2026.9.9-2`, `dist/core/extensions/builtin/mcp/config-schema.js`) accepts both
   declarations in both auth shapes. This is the validator `pi.registerMcpServer` throws from.
3. Live real-harness proof: the real senpi runtime booted in `--mode rpc` inside an isolated agent dir
   with the built `plugin/extensions/omo.js` loaded via `-e`, then asked `get_loaded_surfaces` which MCP
   servers the host actually loaded. Three scenarios: anonymous, placeholder `CONTEXT7_API_KEY`, and
   `mcp.json` disable override.
4. Bundle freshness: the committed `plugin/extensions/omo.js` must match a fresh build, because
   `src/**` is bundled into it and CI's `senpi-compatibility` job fails with `stale-output` otherwise.
   Checked twice: `checkExtensionCurrent()` directly, and then the full CLI
   `build-extension.mjs --check` once the staged runtimes it preflights were built.

Driver used for (3) is the throwaway script recorded in `live-rpc-surface-driver.mjs` here (not shipped:
the repo's committed drivers live in `packages/omo-senpi/scripts/qa/`; this change needed one RPC call,
not a new lane). It builds its own sandbox HOME/XDG/`SENPI_CODING_AGENT_DIR`, ignores the caller's, and
snapshots the real agent dirs before and after.

## WHAT WAS OBSERVED

Unit + host contract (`bun test packages/omo-senpi/src/components/builtin-mcps packages/omo-senpi/src/extension`):
91 pass, 0 fail across 17 files. RED capture before the component existed and the GREEN capture after are
in `red.log` / `green.log`.

Live RPC surfaces (`live-rpc-surface.json`), real host, no mock of our code:

| Scenario | context7 | grep_app |
|----------|----------|----------|
| anonymous (no `CONTEXT7_API_KEY`) | `status: connected`, `toolCount: 2`, `authStatus: unsupported` | `status: connected`, `toolCount: 1` |
| `CONTEXT7_API_KEY="<YOUR_API_KEY>"` (placeholder) | `status: connected`, `toolCount: 2` — placeholder never became a bearer token | `status: connected`, `toolCount: 1` |
| sandbox `<agentDir>/mcp.json` = `{"mcpServers":{"context7":{"enabled":false}}}` | `status: disabled`, `toolCount: 0` | `status: connected`, `toolCount: 1` |

`omoExtensionLoaded: true` in every run, so the surface came from our bundle.

Isolation: `realSenpiAgentDirUnchanged: true` in all three runs (`~/.senpi/agent` byte-size digest
identical). `realOmoAgentDirUnchanged` reported `false`, and that flag is NOISE from the machine this ran
on, not sandbox leakage: the QA ran from inside a live OmO Native session whose own
`SENPI_CODING_AGENT_DIR` is `~/.omo/agent`, and an idle 4-second re-digest of that directory with NO
sandbox child running also changes (`idleDigestStable: false`, recorded in `live-rpc-surface.json`). The
sandbox child's `SENPI_CODING_AGENT_DIR` was the temp dir printed as `agentDir` in each run.

Bundle freshness after regeneration: `checkExtensionCurrent()` -> `{"ok": true, ...}` (`bundle-check.log`).
The CLI form additionally preflights the staged lsp-daemon/ast-grep/agent-toolkit runtimes, so
`packages/ast-grep-mcp/dist/cli.js` was built (`bun run --cwd packages/ast-grep-mcp build`) and the
runtimes staged; `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` then printed
`omo-senpi extension build is current: .../plugin/extensions/omo.js` with **exit code 0**, and
`git status --short` was empty afterwards, i.e. the committed bundle is byte-identical to a fresh build
(`bundle-check-cli.log`). The bundle is its own commit, `build(omo-senpi): regenerate extension bundle
for builtin-mcps`.

## WHY IT IS ENOUGH

The failure mode this change addresses is "the native edition never registers these servers". The live
run shows the real host resolving both server names from our extension and completing an anonymous MCP
handshake against both public endpoints (tool counts prove a real `tools/list`, not just a config row).
The disable scenario proves the documented off switch, and the placeholder scenario proves a copied `.env`
template cannot turn a working anonymous server into an auth failure.

## WHAT WAS OMITTED

- No real `CONTEXT7_API_KEY` was available, so the `auth: "bearer"` + `bearerTokenEnv` branch is proven at
  declaration level (unit test + the host's own validator) and NOT by an authenticated live handshake.
- No secrets are recorded here: the bearer path is declaration-only by design (`bearerTokenEnv`), and the
  unit test asserts the token value never appears in the declaration.
- The full `bun test` suite was not run on this host by instruction; the scoped omo-senpi files above plus
  `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` were.
