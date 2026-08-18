# packages/omo-native

**Role:** Adapter - distribution package for the senpi-based omo native edition.

Publishes npm package `omo-ai` (bin `omo`) on the BETA channel only. The launcher in `bin/` spawns the
exact-pinned `@code-yeongyu/senpi` CLI with `--extension <pkgRoot>/plugin`, where `plugin/` is the staged
omo-senpi plugin payload produced by `bun run build:omo-native` (gitignored, never committed).

- `bin/omo.js` - launcher entry (dispatch, doctor, setup, senpi passthrough)
- brand: the launcher injects a `SENPI_BRAND` profile (name, `~/.omo/agent` home, `OMO_*` env prefix, wire identity, omo-ai beta update channel) so the pinned engine presents as omo; `--version` and every self-update spelling are answered by the launcher. See `docs/reference/omo-ai-publishing.md`.
- `bin/lib/` - launcher modules
- **agent state lives in ONE canonical directory: `~/.omo/agent`.** `bin/lib/agent-dir.js` owns that answer (`canonicalAgentDir`), and the launcher, `omo doctor`, `omo setup` and the locally installed launcher (`packages/omo-senpi/src/install/local-launcher.ts`) all resolve it from there - never by composing their own default. An explicit `OMO_CODING_AGENT_DIR` (or legacy `SENPI_CODING_AGENT_DIR` / `PI_CODING_AGENT_DIR`) still wins, and `adoptLegacyFlatState` carries state left in the pre-unification flat `~/.omo` layout forward once, so unifying the location never reads as another reset.
- `bin/omo-agent-toolkit.js` - internal delegate to the staged toolkit runtime, NOT an npm bin
- `test/` - package-contract and launcher tests

Release mechanics and the beta-channel contract: `docs/reference/omo-ai-publishing.md`.
