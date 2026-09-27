# Agent-Model Matching Guide

> **For agents and users**: the four model-profile lanes that pick the main agent's model, which models carry tuned prompt presets, how curated agents and categories keep their own chains, and how to change any of it without breaking things.

**OmO Native sets all of this up on its own, so you can probably skip this page.** With nothing in `omo.json`, a fresh session starts on Claude Opus 5.5 when you have it and otherwise on the next model of the Recommended list below that you have connected, and every category and curated agent picks its model from its own chain against the providers you are logged in to. A category that none of your providers can serve is left off the main agent's list, so it is never picked and then fails. Read on when you want to change a default, or when you want to know why a session landed on the model it did.

---

## Four lanes pick the main agent's model

The main agent thinks with your session model. The easiest way to choose it is a **model profile**: a named, ordered chain you pick by lane (Daily or Geeky, Normal or Heavy). At session start omo walks the chain and applies the first model your connected providers serve. Chains live in [`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`](../../packages/omo-senpi/src/components/model-profile/builtin-profiles.ts); every rung lists each provider that serves the model, so a Copilot-only or gateway-only account resolves the same way a direct API key does.

| Lane | Id | Pick it for | Chain |
| --- | --- | --- | --- |
| Daily · Normal | `daily-normal` | Gets any task done without fuss. | `anthropic-subscription\|anthropic\|anthropic-api\|github-copilot\|opencode/claude-opus-5-5 (medium)` -> `kimi-coding\|kimi-for-coding\|moonshotai\|opencode-go/kimi-k3 (max)` -> `zai-coding-plan\|opencode-go/glm-5.3 (max)` |
| Daily · Heavy | `daily-heavy` | Gets any task done, after thinking it over from more sides. | same Claude providers `/claude-fable-5-1 (xhigh)` |
| Geeky · Normal | `geeky-normal` | Works on one task and thinks it through. | `chatgpt-subscription\|openai\|github-copilot\|opencode/gpt-5.6-sol (medium)` |
| Geeky · Heavy | `geeky-heavy` | Works on one task and thinks it over from every side. | `chatgpt-subscription\|openai\|github-copilot\|opencode/gpt-6-astra (xhigh)` |

With no `model_profile` at all, a fresh desktop or headless session runs **Recommended** (`recommended`), which is not a lane: `claude-opus-5-5` (medium) -> `claude-fable-5-1` (xhigh) -> `kimi-k3` (max) -> `gpt-6-astra` (xhigh) -> `gpt-6-sol` (medium) -> `glm-5.3` (max), each rung served only by its ranked providers (Claude subscription, then the Anthropic API, Copilot, OpenCode; Kimi Code, then Moonshot and OpenCode Go; ChatGPT subscription, then the OpenAI API, Copilot, OpenCode; Z.ai Coding Plan, then OpenCode Go). Gateway aggregators such as OpenGateway and OpenRouter are never picked for it. It is the same order Senpi's recommended-model auto-switch uses in the terminal.

Activate a lane with a single key in `omo.json`:

```jsonc
{ "model_profile": "daily-normal" }
```

The session prints `OmO Native: model profile "daily-normal" (Daily · Normal) selected anthropic-subscription/claude-opus-5-5 medium; mid-session fallback follows senpi's retry chains`, naming any skipped rungs. A few rules worth knowing:

- **Pins win.** Write a literal `provider/model` into the same key (`"model_profile": "anthropic/claude-opus-5-5"`) and that exact model is applied; anything containing `/` is a pin.
- **Explicit models are never clobbered.** A `--model` flag, a scoped model, a resumed session, and a fork keep their own model; the profile only touches a fresh session.
- **Unset means Recommended.** With no `model_profile`, a fresh session applies `recommended`. That apply is session-scoped and is not written back to `omo.json`.
- **Session-scoped.** The apply never writes `settings.json` or `omo.json`. Mid-session failures follow Senpi's retry chains, not the profile.
- **The interactive TUI ignores `model_profile`**, pins included, because it has no lane surface yet. A TUI session that starts on an implicit default is moved by Senpi's own recommended-model switch, which uses the same six-model order.
- **Retired ids are unknown.** `capable`, `deep-work`, and `simple-work` are not aliases. A config still naming one of them gets the unknown-profile notice listing `recommended` and the four lane ids.
- **Your own chains.** `model_profiles.<name>` adds a profile or replaces a builtin's entire model chain. A builtin override keeps its family/tier identity unless those metadata fields are supplied. A provider-qualified candidate is used only on that provider; if absent, only the next configured candidate is tried. Bare model ids may match any provider. Key reference: [omo.json](../reference/omo-json.md#model-profiles-native-harness).

You can still pick with `/model` and switch mid-session; the main agent switches with you, and the prompt preset follows the new model.

### The recommended models

We tune the orchestration prompt against the models on the Recommended ladder: Claude Opus 5.5, Claude Fable 5.1, Kimi K3, GPT-6 Astra, GPT-6 Sol and GLM 5.3. Their order is our order of preference. The Daily lanes and Geeky · Heavy are slices of it; Geeky · Normal runs GPT-5.6 Sol, the GPT-5 flagship, for people who prefer it over GPT-6.

- **Claude Opus 5.5 and Claude Fable 5.1** are the reference configuration for the orchestration prompt: long nested todos, delegation tables, many tool calls in a row.
- **GPT-6 Astra and GPT-6 Sol** get the GPT-native `gpt-6-astra` preset, built for autonomous, principle-driven work. Over-orchestration on small bounded tasks is a known risk on GPT; give it a goal, not a recipe.
- **Kimi K3 and GLM 5.3** follow instructions much like Claude and sit lower on the ladder. Kimi K3 spends more thinking tokens. GLM has had less maintainer validation on the nested todo, delegation, and long-context paths.

A model outside the ladder isn't supported as the main agent. It may look fine for a few turns and then fall apart three tool calls later. Nobody is regression-checking the orchestration prompt against it, so a prompt change that helps Claude or GPT can silently break it with zero warning. Don't file that as a bug; it was never working on purpose. In the terminal, Senpi prints a warning when a session runs on a model outside the ladder and none of the ladder is connected.

**A prompt cannot fix a model.** Models have hard, intrinsic characteristics. If a model is the wrong brain for orchestration, no amount of prompt-carving changes that. We've ground the prompts down to the bone; the model that can't, still can't.

---

## Models with tuned prompt presets

The harness ships a prompt preset per model family. When your session model matches one, the main agent's prompt is shaped for that model's habits. Senpi picks the preset from the model id (and the display name for GPT-6, Kimi and SWE-2), checking the more specific ids first, so `claude-fable-5-1` never lands on the Fable 5 preset. The matcher is `resolvePresetName` in Senpi's `prompt-preset/presets.ts`.

| Preset | Picked for | Notes |
| --- | --- | --- |
| `claude-fable-5-1` | Claude Fable 5.1 | Top tier, above Opus. The Fable 5 core with the Fable 5.1 adjustments. |
| `claude-fable-5` | Claude Fable 5 | Highest compliance with long, mechanics-driven prompts. |
| `claude-opus-5-5` | Claude Opus 5.5 | Current best Opus. Steerable and literal. The reference configuration. |
| `claude-opus-5` | Other Claude Opus 5 ids | The Opus 5 core. |
| `claude-opus-4-5` and later 4.x presets | The Claude Opus 4.x line | One preset per 4.x release; `claude-opus-4-6` is still the third `writing` rung. |
| `gpt-6-astra` | Every GPT-6 model: Astra, Sol, Sol Fast, Luna | The GPT-6 family shares one prompting guide, so they share one preset. This is what Geeky · Heavy and the `ultrabrain`, `deep-low`, `deep-high` and `quick` categories run. |
| `gpt-5.6` / `gpt-5.5` | GPT-5.6 ids (Sol, Terra) and GPT-5.5 | GPT-native prompt: concise principles, explicit decision criteria. Geeky · Normal runs on it. |
| `gpt-5.4`, `gpt-5.3-codex` and older GPT-5 presets | Older GPT-5 ids | Kept for configs that still pin them. |
| `kimi-k3` | Kimi K3 (`k3` on Kimi Code) and Devin SWE-2 | Instruction-following mirrors Claude closely. The preset is calibrated to stop overthinking and keep work moving, so expect thinking-token cost. |
| `kimi-k2-8` / `kimi-k2-7` / `kimi-k2-6` | Kimi K2.8 (including `kimi-for-coding`), K2.7 (including `kimi-for-coding-highspeed`, the `explore` and `librarian` head), K2.6 | Older Kimi line. Not a recommended main-agent configuration. |
| `glm-5.3` / `glm-5.2` | GLM 5.3 and 5.2 | Claude-like, slightly looser on long nested workflows. GLM 5.3 is the last Recommended rung; see the validation note above. |
| `deepseek-v4-pro` | DeepSeek V4 Pro | Preset exists. Not a recommended main-agent configuration. |
| `deepseek-v4-1-flash` | DeepSeek V4.1 Flash, including `deepseek-flash` and `deepseek/deepseek-v4-flash` (DeepSeek's own API has served V4.1 under that name since 2026-09-10) | Preset exists. Not a recommended main-agent configuration. |
| `deepseek-v4-flash` / `deepseek-v4-flash-0731` | DeepSeek V4 Flash on other hosts, and the dated snapshot | Preset exists. Not a recommended main-agent configuration. |
| `grok-4.7` / `grok-4.6` / `grok-4.5` | Grok 4.7, 4.6, 4.5 | Preset exists. `grok-4.7` is the second `unspecified-low` rung, after `mimo-v2.6-pro`. |

Having a preset means the prompt is shaped for that model. It doesn't mean the model is recommended as the main agent; only the six models above are. A model that matches no row runs on Senpi's generic prompt with no model-specific tuning at all.

---

## Claude vs GPT prompting differences

This matters for understanding why the main agent's prompt changes shape with the model, and why delegation categories split along family lines.

**Claude** responds to **mechanics-driven** prompts: detailed checklists, templates, step-by-step procedures. More rules = more compliance. You can write a very long prompt with nested workflows and Claude will follow every step.

**GPT** (especially 5.2+) responds to **principle-driven** prompts: concise principles, XML structure, explicit decision criteria. More rules = more contradiction surface = more drift. GPT works best when you state the goal and let it figure out the mechanics.

The `/ulw-plan` skill used to mirror this split with separate model-family prompts. It now uses a single thin prompt, so swapping your session model changes the model, not the planning prompt.

---

## Curated agents and categories keep their own chains

A model profile picks the main session model and nothing else. Every delegated child, curated agent or category, takes its model from its own chain, and `model_profile` is never read on that path. A user who sets `categories.deep-low.model` sees identical behavior with or without a profile active.

### Curated agents

Delegation goes through the `task` tool. Four curated read-only agents have their own fallback chains, hardcoded in [`packages/senpi-task/src/agents/builtin/fallback-chains.ts`](../../packages/senpi-task/src/agents/builtin/fallback-chains.ts). The first rung your connected providers can serve wins.

| Agent | Job | Primary | Chain |
| --- | --- | --- | --- |
| `explore` | Fast codebase grep and pattern discovery | `kimi-for-coding-highspeed` (off) | `kimi-coding\|kimi-for-coding/kimi-for-coding-highspeed (off)` -> `chatgpt-subscription\|openai/gpt-6-luna-fast (low)` -> `deepseek/deepseek-flash (max)` -> `opencode-go\|bailian-coding-plan/qwen3.7-plus` -> `opencode-go/minimax-m2.7` -> `anthropic-subscription\|anthropic\|github-copilot/claude-haiku-4-5` |
| `librarian` | Documentation and OSS code search | `kimi-for-coding-highspeed` (off) | Same chain as `explore`. |
| `plan-consultant` | Pre-planning gap analysis for `/ulw-plan` | `claude-fable-5-1` (max) | `anthropic-subscription\|anthropic\|github-copilot\|opencode/claude-fable-5-1 (max)` -> `anthropic-subscription\|anthropic\|github-copilot\|opencode/claude-opus-5-5 (max)` -> `opencode-go\|kimi-for-coding\|moonshotai\|opencode/kimi-k3 (max)` |
| `plan-reviewer` | One-shot plan review against clarity, verification, and context criteria | `gpt-6-astra` (xhigh) | `chatgpt-subscription\|openai/gpt-6-astra (xhigh)` -> `github-copilot/gpt-6-astra (high)` -> `chatgpt-subscription\|openai\|opencode/gpt-6-astra (high)` -> `anthropic-subscription\|anthropic\|github-copilot\|opencode/claude-opus-5-5 (max)` -> one lower rung listed in the source file -> `opencode-go/glm-5.2` |

The utility rungs elided above are cheap fast models; read the source file for the exact list. They exist so the system degrades gracefully when you don't hold every subscription. If you have a paid tier connected, it's always preferred.

The ulw-loop reviewers have no hand-written chains. Each one names categories on its definition and runs on the first of them that resolves; the later categories extend its runtime retry chain:

| Agent | Categories, in order |
| --- | --- |
| `omo-native-code-reviewer` | `unspecified-high` |
| `omo-native-gate-reviewer` | `deep-high`, then `unspecified-high` |
| `omo-native-qa-executor` | `deep-low`, then `unspecified-low` |

Overriding one of those categories in `omo.json` moves the reviewer with it.

#### Where to spend one scarce premium model

If one premium model is quota-limited while your other models are effectively unlimited:

1. **Match the family to the role.** Claude-family models fit the communicative roles: the main agent and `plan-consultant`. GPT-family models fit `plan-reviewer`, `ultrabrain`, `deep-low` and `deep-high`.
2. **Prefer a low-frequency, high-leverage role.** `plan-consultant` contributes one gap-analysis pass per plan generation. High-accuracy planning runs one `plan-reviewer` pass per round and repeats after any rejection. Both are far cheaper places for a rare model than the main agent, which runs throughout the workflow.
3. **Avoid execution-heavy slots.** The category worker, `explore`, and `librarian` are high-volume. They're usually poor homes for the rarest model.

Claude Fable 5.1 is the first rung of `plan-consultant`, of the `architect`, `visual-engineering`, `artistry` and `writing` categories, and of Daily · Heavy, and the second rung of Recommended. With a tight Fable allocation, move the categories off it first, since each runs once per delegated task of its kind, and keep `plan-consultant`, which runs once per plan, at a lower effort. `architect` has no fallback rung, so it disappears when Fable is missing unless you configure it yourself.

```jsonc
{
  "agents": {
    "plan-consultant": { "model": "anthropic/claude-fable-5-1", "reasoning": "high" }
  },
  "categories": {
    "visual-engineering": { "model": "anthropic/claude-opus-5-5", "reasoning": "max" },
    "artistry": { "model": "anthropic/claude-opus-5-5", "reasoning": "max" },
    "writing": { "model": "anthropic/claude-opus-5-5", "reasoning": "low" }
  }
}
```

---

### Categories

When the main agent delegates implementation work, it doesn't pick a model name. It picks a **category**, and the category spawns the category worker: a fresh worker session configured by the category's model and skills. Chains live in [`packages/senpi-task/src/category/fallback-chains.ts`](../../packages/senpi-task/src/category/fallback-chains.ts); defaults, descriptions and prompt appends live next to them in `packages/senpi-task/src/category/*-categories.ts`.

| Category | Used for | Default | Chain |
| --- | --- | --- | --- |
| `architect` | Big-picture system design; proposes, doesn't implement (the architect consult lane) | `anthropic/claude-fable-5-1 (max)` | `anthropic-subscription\|anthropic\|anthropic-api\|github-copilot\|opencode/claude-fable-5-1 (max)` |
| `visual-engineering` | Frontend, UI/UX, CSS, animation, design systems | `anthropic/claude-fable-5-1 (max)` | `claude-fable-5-1 (max)` -> `claude-opus-5-5 (max)` -> `kimi-coding\|kimi-for-coding\|moonshotai\|opencode-go/kimi-k3 (max)` |
| `ultrabrain` | Genuinely hard, logic-heavy tasks; goals only, no step-by-step | `chatgpt-subscription/gpt-6-astra (max)` | `gpt-6-astra (max)` across `chatgpt-subscription`, `openai`, `github-copilot`, `opencode` -> `gpt-5.6-sol (max)` across the same providers |
| `deep-low` | Default deep lane: 3D graphics, computer use, browser use, backend, algorithms, multimodal work; decisions settled from evidence | `chatgpt-subscription/gpt-5.6-sol-fast (medium)` | `chatgpt-subscription\|openai/gpt-5.6-sol-fast (medium)` -> `chatgpt-subscription\|openai\|github-copilot\|opencode/gpt-5.6-sol (medium)` |
| `deep-high` | Escalation deep lane: a central decision evidence cannot settle | `chatgpt-subscription/gpt-6-astra (xhigh)` | `chatgpt-subscription\|openai\|github-copilot\|opencode/gpt-6-astra (xhigh)`, no fallback |
| `artistry` | Unconventional, creative problem-solving | `anthropic/claude-fable-5-1 (max)` | `claude-fable-5-1 (max)` -> `claude-opus-5-5 (max)` -> `kimi-k3 (max)` |
| `quick` | Trivial tasks: single-file changes, typos | `chatgpt-subscription/gpt-6-luna-fast (low)` | `chatgpt-subscription\|openai/gpt-6-luna-fast (low)` -> `deepseek/deepseek-flash (off)` -> `qwen3.6-flash (low)` -> cheaper utility rungs -> `xai/grok-4.20-0309-non-reasoning` -> `claude-haiku-4-5 (off)` |
| `unspecified-low` | Doesn't fit elsewhere, low effort | `xiaomi/mimo-v2.6-pro (max)` | `xiaomi\|opencode-go/mimo-v2.6-pro (max)` -> `xai\|github-copilot\|opencode-go/grok-4.7 (xhigh)` -> `gpt-5.6-terra (high)` -> `claude-sonnet-5 (low)` -> `qwen3.8-max-preview (max)` -> `deepseek\|opencode-go/deepseek-v4-pro (max)` -> `xiaomi\|opencode-go/mimo-v2.5-pro (max)` |
| `unspecified-high` | Doesn't fit elsewhere, high effort | `anthropic/claude-opus-5-5 (medium)` | `claude-opus-5-5 (medium)` -> `zai-coding-plan\|opencode-go/glm-5.3 (max)` -> `kimi-k3 (max)` |
| `writing` | Documentation, prose, technical writing | `anthropic/claude-fable-5-1 (low)` | `claude-fable-5-1 (low)` -> `claude-opus-5-5 (low)` -> `claude-opus-4-6 (max)`; unavailable when none of these is connected, with no fallback to another family |

Every Claude rung is headed by `anthropic-subscription` and every GPT rung by `chatgpt-subscription`, so a subscription login always outranks an API key for the same model.

A category you haven't configured is offered to the main agent only when your providers can run it. Four categories are gated on a model: `ultrabrain` needs `gpt-6-astra` or `gpt-5.6-sol`, `deep-low` needs `gpt-5.6-sol-fast` or `gpt-5.6-sol`, `deep-high` needs `gpt-6-astra`, and `architect` needs `claude-fable-5-1`. An account without those models never sees the matching deep lane. Every other builtin category is listed only while at least one rung of its chain resolves, which is how `writing` disappears without its Claude models. Writing `categories.<name>` yourself lifts both checks: the category is always listed and runs what you set.

The `quick` category ships a caller warning: small fast models need an explicit prompt with numbered must-do steps, forbidden deviations, and concrete success criteria. `deep-low` and `deep-high` take one goal plus one deliverable per call; fan out several goals as parallel `deep-low` calls, and escalate to `deep-high` only when the central decision can't be settled from evidence.

See the [Orchestration System Guide](./orchestration.md) for how the main agent decides between a category and a curated agent.

---

## Customizing in `omo.json`

Override any category or curated agent in `omo.json`. `model` sets one model; `models` sets an ordered chain that's tried before the builtin one. Entries may be plain `provider/model` strings (with an optional `:level` reasoning suffix such as `openai/gpt-6-astra:xhigh`) or objects carrying `model`, `reasoning`, `max_tokens`, or `provider_options`. Full key reference: [omo.json](../reference/omo-json.md).

### Example A: Claude plus OpenAI

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",

  "agents": {
    "plan-consultant": { "model": "anthropic/claude-opus-5-5", "reasoning": "high" },
    "plan-reviewer": { "model": "openai/gpt-6-astra", "reasoning": "xhigh" },
    "explore": { "model": "openai/gpt-6-luna-fast", "reasoning": "low" },
    "librarian": { "model": "openai/gpt-6-luna-fast", "reasoning": "low" }
  },

  "categories": {
    "visual-engineering": { "model": "anthropic/claude-fable-5-1", "reasoning": "max" },
    "deep-high": { "model": "openai/gpt-6-astra", "reasoning": "xhigh" },
    "ultrabrain": { "model": "openai/gpt-6-astra", "reasoning": "max" },
    "unspecified-high": { "model": "anthropic/claude-opus-5-5", "reasoning": "medium" }
  }
}
```

### Example B: Kimi and GLM for Claude-shaped roles

```jsonc
{
  "agents": {
    "plan-consultant": { "model": "kimi-for-coding/kimi-k3" }
  },
  "categories": {
    "visual-engineering": { "model": "kimi-for-coding/kimi-k3", "reasoning": "max" },
    "unspecified-high": {
      "models": [
        { "model": "zai-coding-plan/glm-5.3", "reasoning": "max" },
        "kimi-for-coding/kimi-k3"
      ]
    }
  }
}
```

### Example C: DeepSeek as a GPT alternative in a chain

```jsonc
{
  "categories": {
    "deep-low": {
      "models": [
        { "model": "openai/gpt-6-sol", "reasoning": "medium" },
        { "model": "deepseek/deepseek-v4-pro", "reasoning": "max" }
      ]
    }
  }
}
```

Because this is your own configuration, `deep-low` stays on the list even on a machine with no GPT-6, and DeepSeek V4 Pro serves it there.

---

## Safe vs risky overrides

**Safe**, same family and role shape:

- Main agent: Daily · Normal or Daily · Heavy for the generalist lanes; Geeky · Normal or Geeky · Heavy for the GPT lanes.
- `plan-consultant`: any Claude-family model, Kimi K3, GLM 5.2 / 5.3.
- `plan-reviewer`: GPT-6 Astra at xhigh or high; Claude Opus 5.5 at max as a communicative fallback.
- `visual-engineering`, `artistry`: swap among Claude Fable 5.1, Claude Opus 5.5, and Kimi K3.
- `writing`: Claude Fable 5.1, Claude Opus 5.5, or Claude Opus 4.6.

**Lower-confidence**, works but thinly validated:

- Main agent on GLM 5.2 / 5.3. A calibrated preset exists, but maintainers haven't validated the nested todo and delegation paths end to end.
- Main agent on Kimi K3. Strong instruction-following; budget for the thinking tokens.

**Risky**, family or role mismatch:

- **Main agent on a model outside the Recommended ladder.** Maintainers don't test it. Can break at the very next patch. A prompt cannot fix a model.
- **`ultrabrain`, `deep-low` or `deep-high` on Claude or Kimi.** These categories are built for GPT's autonomous style. Other families finish eventually but don't shine.
- **`plan-reviewer` on a small or fast model.** Review needs sustained reasoning; small models drift and rubber-stamp.
- **`explore` / `librarian` on Opus or Fable.** Massive cost waste. Search needs speed, not intelligence.
- **`visual-engineering` on utility or search models.** Keep it on the Fable 5.1 -> Opus 5.5 -> Kimi K3 chain.

---

## How model resolution works

For the main agent, resolution happens once, at session start (`packages/omo-senpi/src/components/model-profile/index.ts`). It runs for OmO Desktop and headless sessions. The interactive TUI skips it, so a TUI session keeps the model it started with, or the one Senpi's recommended-model switch moved it to, whatever `model_profile` says.

```
1. --model flag or scoped model    -> kept as is; the profile never runs
2. model_profile = provider/model  -> the pin; that exact model, if the registry serves it
3. model_profile = <profile id>    -> builtins overlaid with model_profiles; first rung the registry serves
4. model_profile unset            -> Recommended on a fresh desktop/headless session
5. No profile candidate available  -> notice; retain Senpi's selected model
```

Mid-session model failures follow the harness's own retry chains, not the profile and not the delegation chains below.

For every delegated child (a category or a curated agent), omo tries the chain's rungs in order and takes the first model your connected providers can serve:

```
1. omo.json override   -> categories.<name>.model(s) / agents.<name>.model(s); a configured category skips step 2
2. Category gate       -> ultrabrain, deep-low, deep-high and architect need their gate model; other builtin categories need one live rung
3. Builtin chain       -> category/fallback-chains.ts or agents/builtin/fallback-chains.ts
4. First serviceable rung wins; reasoning and variant are normalized to what the model supports
```

Your explicit configuration always wins. If you set a model for a category or agent, that choice takes precedence over the builtin chain.

---

## See Also

- [Installation Guide](./installation.md): setup and provider authentication
- [Orchestration System Guide](./orchestration.md): how the main agent delegates to categories and curated agents
- [omo.json Reference](../reference/omo-json.md): `model_profiles`, `model_profile`, `agents`, `categories`, and `models` keys
- [`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`](../../packages/omo-senpi/src/components/model-profile/builtin-profiles.ts): the Recommended ladder and the four lane chains
- [`packages/senpi-task/src/agents/builtin/fallback-chains.ts`](../../packages/senpi-task/src/agents/builtin/fallback-chains.ts): curated agent chains
- [`packages/senpi-task/src/category/fallback-chains.ts`](../../packages/senpi-task/src/category/fallback-chains.ts): category chains
