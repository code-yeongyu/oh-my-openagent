PR #6725 review blocker resolution QA

What was addressed

- Cubic thread on `.omo/evidence/20260810-doctor-config-summary/doctor-verbose.txt`: the verbose summary now includes `2 skipped`, so `2 passed + 1 failed + 3 warnings + 2 skipped = 8 total`.
- Cubic thread on `packages/omo-opencode/src/config-migration/reasoning-unification.test.ts`: current source preserves `[opencode].agents.*.fallback_models` and migrates `[opencode].categories.*.fallback_models`; this thread is stale after the existing fix.
- Cubic thread on `packages/omo-senpi/plugin/runtime/agent-toolkit/directive.md`: the generated `runtime/agent-toolkit` directory is no longer tracked, and `stage-agent-toolkit.mjs --check` skips the ignored staged runtime on a fresh checkout before build/install generates it.
- Follow-up Cubic review on `.omo/evidence/20260810-doctor-config-summary/README.md`: the README expected summary now includes `2 skipped`, matching `doctor-verbose.txt`.
- Follow-up Cubic review on `packages/omo-senpi/plugin/scripts/stage-agent-toolkit.mjs`: `--check` skips only when both generated source and target are absent; when the source exists and the ignored target is missing, it stages the target and then runs freshness validation.

What was tested

- `PATH="/tmp/opencode/bun140/bin:$PATH" bun test packages/omo-senpi/plugin/scripts/stage-agent-toolkit.test.mjs script/agent-command-string-audit.test.ts packages/omo-opencode/src/config-migration/reasoning-unification.test.ts`
- `PATH="/tmp/opencode/bun140/bin:$PATH" node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
- `PATH="/tmp/opencode/bun140/bin:$PATH" bun run build:senpi-plugin`
- `PATH="/tmp/opencode/bun140/bin:$PATH" node packages/omo-senpi/scripts/expect-exit.mjs 1 -- node packages/omo-senpi/plugin/runtime/agent-toolkit/cli.js __proto__`
- `PATH="/tmp/opencode/bun140/bin:$PATH" OMO_AGENT_TOOLKIT_TARGET=/tmp/opencode/pr6725-missing-agent-toolkit node packages/omo-senpi/plugin/scripts/stage-agent-toolkit.mjs --check`
- `PATH="/tmp/opencode/bun140/bin:$PATH" OMO_AGENT_TOOLKIT_SOURCE_ENTRY=/tmp/opencode/pr6725-missing-source/cli.js OMO_AGENT_TOOLKIT_TARGET=/tmp/opencode/pr6725-missing-agent-toolkit node packages/omo-senpi/plugin/scripts/stage-agent-toolkit.mjs --check`
- `PATH="/tmp/opencode/bun140/bin:$PATH" bun run build:omo-native`
- `PATH="/tmp/opencode/bun140/bin:$PATH" node script/verify-omo-ai-payload.mjs`
- `GIT_MASTER=1 git diff --check`

What was observed

- Focused tests passed: `17 pass`, `0 fail`, `22 expect() calls`.
- `build-extension.mjs --check` reported current Senpi LSP, ast-grep MCP, agent-toolkit runtime, and extension bundles.
- `build:senpi-plugin` rebuilt and staged the ignored agent-toolkit runtime locally without requiring it to be tracked.
- The dispatcher rejected `__proto__` with exit code 1 and `Unknown component: __proto__. Available components: ulw-loop`.
- The source-present, target-missing generated-runtime check staged `/tmp/opencode/pr6725-missing-agent-toolkit` and then reported the runtime current.
- The both-missing generated-runtime check succeeded with `agent-toolkit runtime not staged locally; skipping freshness check: /tmp/opencode/pr6725-missing-agent-toolkit`.
- `build:omo-native` copied a complete staged Senpi plugin payload into `packages/omo-native/plugin` with `36 required artifacts present`.
- `verify-omo-ai-payload.mjs` passed with `525 packed paths`, `0 offenders`, and `8084828 bytes`.
- `git diff --check` produced no output.
- LSP diagnostics were attempted for changed source/config files, but the local LSP daemon did not become reachable at `<home>/.omo/lsp-daemon/v0.1.0/daemon.sock`.

Why it is enough

- The focused tests cover the migration behavior, command-string allowlist update, and agent-toolkit staging behavior touched by these review fixes.
- The Senpi build and `omo-native` payload verification prove the generated agent-toolkit runtime is still produced and shipped even though the ignored runtime directory is no longer committed.
- The target-missing and both-missing checks prove `build-extension.mjs --check` does not pass with an incomplete runtime: it either stages and validates from an existing source, or skips only when neither generated side exists.
- The dispatcher smoke proves the prior inherited-property regression remains fixed after untracking the generated runtime.

What was omitted

- Raw build logs were not committed because they include absolute local workspace paths and verbose bundle output; the relevant pass/fail summaries are recorded above.
