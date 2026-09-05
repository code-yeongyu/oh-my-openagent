# Live QA driver repair: delivered, distinct runtime blocker

## What was tested

Only memory-model-fallback-e2e.mjs changed: resolve the built local plugin relative to the driver and pass it with -e in runParent, covering both seed and trigger invocations. The existing red-live-driver.txt remains the faithful RED; no source-text test was added. Edits used Codex's apply_patch entrypoint. No production memory code changed and no commit was created.

Evidence directory resolved with the senpi-qa skill's resolve-evidence-dir.mjs and slug 20260905-memory-reflection-isolation.

Validation: node --check on the driver, node packages/omo-senpi/scripts/qa/drive.mjs --self-test, and scoped git diff --check passed. LSP diagnostics could not initialize because its TypeScript installation was unavailable. Package-wide build/test gates remain with the lead; this child exercised the existing built artifact without rebuilding production files.

The first run used Bun with the evidence preload, the local node_modules/.bin/senpi, and OMO_SENPI_KEEP_QA=1. Bun did not propagate the patched builtin spawn binding, so no diagnostic capture was installed. The driver reached the new completion timeout; exact output is live-driver-bun-uninstrumented.stderr.

To capture exact stderr and system prompts, the second run used:

```sh
SENPI_BIN="$PWD/node_modules/.bin/senpi" OMO_SENPI_KEEP_QA=1 \
  NODE_OPTIONS="--import=$ev/live-driver-preload.mjs" \
  node packages/omo-senpi/scripts/qa/memory-model-fallback-e2e.mjs
```

The evidence-only preload supplies the driver's Bun.spawnSync calls through Node spawnSync, observes stdout/stderr, pins HOME/XDG and all agent-dir aliases to the driver's sandbox, and adds a read-only agent_start system-prompt capture extension. It does not alter model responses, memory code, lifecycle timing, or plugin selection. The captured spawn JSONL proves the driver itself passes the local plugin for both parents.

## What was observed

live-driver-result.json contains the structured result: repair PASS, full driver BLOCKED. The seed session recorded a successful memory tool result, with a local commit of system/facts.md. The trigger parent system prompt contains the seeded marker, captured in live-driver-parent-10805.system.txt.

The reflection request prepared reflection-run-1 files, but failed before invoking the child shim. Exact stderr in live-driver-10804.stderr:

> memory reflection launch failed: This extension ctx is stale after session replacement or reload.

The complete host error, including its withSession guidance, is retained in that stderr file. The trigger session is 01a07288-192a-7012-8f96-c36d8965a43f; its exact JSONL path is in live-driver-result.json. blocked-live-driver.stderr records the resulting 90-second completion timeout.

There is no attempts.log and no reflection-child session/system-prompt dump, so no-fork and child-prompt isolation cannot be claimed. No ModelUsabilityBudgetError appears in captured parent stdout/stderr or parent sessions. A separate seed-time Memorian gate attempted the deliberately parent-only primary model and reported child_failed; that error is also retained, not suppressed.

## Why it is enough / remaining blocker

Successful execution of the previously missing memory tool proves the requested explicit-plugin repair on the real local Senpi surface. The stale-context launch failure is a new distinct production/runtime blocker, meeting the delegated stop condition. Reflection completion is NOT a PASS and requires the lead's production investigation. No production workaround was applied.

Both sandboxes remain intact; paths are in live-driver-result.json. No process matching either retained sandbox path was present in the final process listing. The lead owns cleanup and real-home digest comparison; this child makes no real-home-untouched claim. The first, uninstrumented run inherited caller home/alias environment; the second pins them to the sandbox in its preload.

## What was omitted

No environment values, authentication files, or credentials were copied. Captured session output comes from the scripted mock provider. Parent prompt dumps remain local evidence, not shipped QA documentation. No child prompt exists to inspect.
