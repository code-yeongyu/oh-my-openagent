# Task 7 evidence - planner agent-first resolution

## What was tested

- Known active agents resolve before explicit-model and category paths.
- Explicit model plus agent keeps the persona/tool policy and uses explicit model metadata without a registry.
- A disabled agent plus explicit model returns `unknown_target`; the explicit model cannot revive it.
- Without an explicit model, a disabled agent name may still retain the pre-existing category fallback when a same-name category exists.
- Unknown names retain category fallback and final errors list active agents and categories.

## What was observed

- The disabled-plus-explicit reproduction changed from a resolved unrestricted plan to `unknown_target`.
- The newly strengthened same-name category case was RED at 10 pass / 1 fail before the planner distinguished disabled explicit requests; the final planner run is 11 pass / 0 fail.
- The generated extension was rebuilt only through `build-extension.mjs`.

## Why it is enough

The cases distinguish all three meanings of `subagent_type`: active agent, disabled agent, and legacy category alias, including the explicit-model bypass that caused rejection.

## What was omitted

The generic explicit-model path remains unchanged for requests that do not name a known disabled agent.
