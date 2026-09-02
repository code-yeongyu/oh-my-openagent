PR #6725 doctor fallback_models review fix QA

What was tested

- Targeted regression tests for deprecated reasoning-key reporting and reasoning-unification migration:
  `bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-fallback-models.test.ts packages/omo-opencode/src/config-migration/reasoning-unification.test.ts --bail`
- Full local build after dependency refresh:
  `bun install`
  `bun run build`
- Built CLI doctor surface in an isolated temp home/config:
  `HOME=<tmp>/home-doctor XDG_CONFIG_HOME=<tmp>/xdg-config-doctor XDG_DATA_HOME=<tmp>/xdg-data-doctor XDG_STATE_HOME=<tmp>/xdg-state-doctor XDG_CACHE_HOME=<tmp>/xdg-cache-doctor OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OMO_DISABLE_POSTHOG=1 node dist/cli-node/index.js doctor --json`
- Built CLI config migration surface in an isolated temp home/config:
  `HOME=<tmp>/home-migrate XDG_CONFIG_HOME=<tmp>/xdg-config-migrate XDG_DATA_HOME=<tmp>/xdg-data-migrate XDG_STATE_HOME=<tmp>/xdg-state-migrate XDG_CACHE_HOME=<tmp>/xdg-cache-migrate OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OMO_DISABLE_POSTHOG=1 node dist/cli-node/index.js config migrate --json`
- Follow-up review regression suite:
  `bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-fallback-models.test.ts packages/omo-opencode/src/config-migration/reasoning-unification.test.ts packages/omo-opencode/src/cli/doctor/formatter.test.ts --bail`

What was observed

- Targeted tests passed: `11 pass`, `0 fail`, `34 expect() calls`.
- `bun install` completed and chained the repository build successfully after installing missing local dependencies.
- `bun run build` completed with `build: all steps completed`.
- Follow-up regression suite passed: `24 pass`, `0 fail`, `72 expect() calls`.
- Follow-up `bun run build` completed with `build: all steps completed`.
- Built `doctor --json` reported exactly one deprecated reasoning-key issue for the review fixture:
  `<tmp>/home-doctor/.omo/omo.jsonc: [opencode].categories.deep.fallback_models`
- The same built doctor output did not report `[opencode].agents.oracle.fallback_models`, preserving the OpenCode agent exemption requested by review.
- Built `config migrate --json` preserves OpenCode agent fallback chains and rewrites category fallback chains under the reasoning-unification migration:
  `[opencode].agents.oracle.model = "openai/gpt-5.6-sol"`
  `[opencode].agents.oracle.fallback_models = ["openai/gpt-5.6-terra"]`
  `[opencode].categories.deep.models = ["openai/gpt-5.6-sol", "openai/gpt-5.6-terra"]`
- The migrated file recorded `_migrations: ["2026-08-reasoning-unification"]`.
- LSP diagnostics were attempted but blocked by the local LSP daemon socket: `<home>/.omo/lsp-daemon/v0.1.0/daemon.sock` did not become reachable.
- The project `opencode-qa` skill required by AGENTS.md was not available in this harness, so the scoped CLI QA was driven manually against the built CLI in isolated XDG/HOME directories.

Why it is enough

- The regression tests cover the precise review requirement: recurse through `[opencode]`, keep `[opencode].agents.*.fallback_models` unreported and unmigrated, report `[opencode].categories.*.fallback_models`, and migrate OpenCode category fallback chains to `models`.
- The built CLI checks exercise the user-facing doctor and config-migration commands, not just imported test functions.
- The isolated `HOME` and XDG paths prevent writes to the real OpenCode/OMO configuration and state directories.

What was omitted

- Raw full doctor JSON was not committed because it includes unrelated local machine health diagnostics such as plugin registration and tool availability. The focused fixture and redacted relevant command outputs are committed in this directory.
- Existing unrelated generated bundle and old evidence line-ending changes from local build/QA were intentionally left unstaged.
