# Senpi task category model status QA

## What was tested

- Failing-first renderer proof for a resolved `ultrabrain` category.
- Planner propagation of the registry model's friendly name.
- Registry-boundary rejection of inherited/accessor/control-bearing/oversized model names.
- Backward-compatible provider deduplication for persisted human-readable displays.
- Plain task result grammar and the real width-aware task result component.
- The full senpi-task package suite, Senpi adapter gate, package/root type checks, and the pinned repository build.
- A real xterm.js browser-rendered 72-column terminal surface.
- The isolated live Senpi task lifecycle probe for spawn, batch, category error, isolation, and process cleanup.

## What was observed

Before:
`task category:ultrabrain (GPT-5.6 Sol reasoning:xhigh) ...`

After, plain result:
`task category:ultrabrain (openai GPT-5.6 Sol reasoning:xhigh) ...`

After, 72-column component:
`task category:ultrabrain (openai GPT-5.6 Sol xhigh) background pending`

The compact row keeps all requested identity at 72 columns by rendering the reasoning level as `xhigh`; the expanded/plain result retains the explicit `reasoning:xhigh` label.

## Why this is enough

The failing tests pin both data plumbing and output grammar: the planner must preserve the friendly name, and both plain and width-aware renderers must combine it with provider and reasoning. Package-wide and adapter-wide gates cover neighboring state, persistence, sanitization, error, and task-tool behavior. The xterm artifact proves the exact user-visible terminal row at the width used by the existing task renderer tests.

The broad live Senpi probe's three follow-up/output-sequencing failures were reproduced on unmodified `origin/dev@499b52358`; see `live-baseline.txt`.

## What was omitted

- Raw Senpi logs and environment dumps were not copied because they may contain private session data.
- The broad live lifecycle probe's three unrelated follow-up/output-sequencing failures are summarized in `verification.txt`; they are not presented as a pass for those behaviors.
- Unrelated generated Codex/codegraph diffs from the repository build are not part of this change.
