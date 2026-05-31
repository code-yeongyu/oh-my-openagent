# Model Settings Compatibility Resolver Design

## Goal

Introduce a central resolver that takes an already-selected model and a set of desired model settings, then returns the best compatible configuration for that exact model.

This is explicitly separate from model fallback.

## Problem

Today, logic for `variant` and `reasoningEffort` compatibility is scattered across multiple places:
- `hooks/anthropic-effort`
- `plugin/chat-params`
- agent/category/fallback config layers
- delegate/background prompt plumbing

That creates inconsistent behavior:
- some paths clamp unsupported levels
- some paths pass them through unchanged
- some paths silently drop them
- some paths use model-family-specific assumptions that do not generalize

The result is brittle request behavior even when the chosen model itself is valid.

## Scope

Phase 1 covers only:
- `variant`
- `reasoningEffort`

Out of scope for Phase 1:
- model fallback itself
- `thinking`
- `maxTokens`
- `temperature`
- `top_p`
- automatic upward remapping of settings

## Desired behavior

Given a fixed model and desired settings:
1. If a desired value is supported, keep it.
2. If not supported, downgrade to the nearest lower compatible value.
3. If no compatible value exists, drop the field.
4. Do not switch models.
5. Do not automatically upgrade settings in Phase 1.

## Architecture

Add a central module:
- `src/shared/model-settings-compatibility.ts`

Core API:

```ts
type DesiredModelSettings = {
  variant?: string
  reasoningEffort?: string
}

type ModelSettingsCompatibilityInput = {
  providerID: string
  modelID: string
  desired: DesiredModelSettings
}

type ModelSettingsCompatibilityChange = {
  field: "variant" | "reasoningEffort"
  from: string
  to?: string
  reason: string
}

type ModelSettingsCompatibilityResult = {
  variant?: string
  reasoningEffort?: string
  changes: ModelSettingsCompatibilityChange[]
}
```

## Compatibility model

Phase 1 should be **metadata-first where the platform exposes reliable capability data**, and only fall back to family-based rules when that metadata is absent.

### Variant compatibility

Preferred source of truth:
- OpenCode/provider model metadata (`variants`)

Fallback when metadata is unavailable:
- family-based ladders

Examples of fallback ladders:
- Claude Opus family: `low`, `medium`, `high`, `max`
- Claude Sonnet/Haiku family: `low`, `medium`, `high`
- OpenAI GPT family: conservative family fallback only when metadata is missing
- Unknown family: drop unsupported values conservatively

### Reasoning effort compatibility

Current Phase 1 source of truth:
- conservative model/provider family heuristics

Reason:
- the currently available OpenCode SDK/provider metadata exposes model `variants`, but does not expose an equivalent per-model capability list for `reasoningEffort` levels

Examples:
- GPT/OpenAI-style models: `low`, `medium`, `high`, `xhigh` where supported by family heuristics
- Claude family via current OpenCode path: treat `reasoningEffort` as unsupported in Phase 1 and remove it

The resolver should remain pure model/settings logic only. Transport restrictions remain the responsibility of the request-building path.

## Separation of concerns

This design intentionally separates:
- model selection (`resolveModel...`, fallback chains)
- settings compatibility (this resolver)
- request transport compatibility (`chat.params`, prompt body constraints)

That keeps responsibilities clear:
- choose model first
- normalize settings second
- build request third

## First integration point

Phase 1 should first integrate into `chat.params`.

Why:
- it is already the centralized path for request-time tuning
- it can influence provider-facing options without leaking unsupported fields into prompt payload bodies
- it avoids trying to patch every prompt constructor at once

## Rollout plan

### Phase 1
- add resolver module and tests
- integrate into `chat.params`
- migrate `anthropic-effort` to either use the resolver or become a thin Claude-specific supplement around it

### Phase 2
- expand to `thinking`, `maxTokens`, `temperature`, `top_p`
- formalize request-path capability tables if needed

### Phase 3
- centralize all variant/reasoning normalization away from scattered hooks and ad hoc callers

## Risks

- Overfitting family rules to current model naming conventions
- Accidentally changing request semantics on paths that currently rely on implicit behavior
- Mixing provider transport limitations with model capability logic

## Mitigations

- Keep resolver pure and narrowly scoped in Phase 1
- Add explicit regression tests for keep/downgrade/drop decisions
- Integrate at one central point first (`chat.params`)
- Preserve existing behavior where desired values are already valid

## Recommendation

Proceed with the central resolver as a new, isolated implementation in a dedicated branch/worktree.
This is the clean long-term path and is more reviewable than continuing to add special-case clamps in hooks.
