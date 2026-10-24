# WHY IT IS ENOUGH

The regression seam for this bug is the exact string content the plugin emits
into outbound chat payloads. The failing-first test pins, at the single source
of truth (`SYSTEM_DIRECTIVE_PREFIX` / `createSystemDirective`), that no shipped
directive payload can carry the trigger literal again; grep verified all
consumers derive from that constant, so one assertion covers every injection
site (todo continuation, ralph/ultrawork loop, compaction context, atlas
delegation/single-task, prometheus read-only).

Remaining regression risk is bounded and covered:
- Recognition regressions (keyword-detector skipping, continuation detection)
  are pinned by recognition-parity tests over both prefixes, including the
  ultrawork leading-keyword path.
- Double-injection guard regressions (atlas tool-execute-before,
  sisyphus-junior-notepad) are pinned by containment-parity tests.
- The legacy-format fixture in todo-continuation-enforcer proves in-flight
  sessions upgraded mid-continuation still resolve correctly.

Residual risk: markdown prompt prose elsewhere may still contain the literal;
that surface is explicitly out of scope here (see OMITTED.md) because a full
re-key needs maintainer policy per the issue thread, and prose contract tests
are a forbidden anti-pattern in this repo.
