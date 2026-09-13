# Agent-Model Matching Guide

> **For agents and users**: the three model profiles that pick the main agent's model, which models carry tuned prompt presets, how curated agents and categories keep their own chains, and how to change any of it without breaking things.

---

## Three profiles pick the main agent's model

The main agent thinks with your session model. The easiest way to choose it is a **model profile**: a named, ordered chain you pick by intent. At session start omo walks the chain and applies the first model your connected providers serve. Chains live in [`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`](../../packages/omo-senpi/src/components/model-profile/builtin-profiles.ts); every rung lists each provider that serves the model, so a Copilot-only or gateway-only account resolves the same way a direct API key does.

| Profile | Id | Pick it for | Chain |
| --- | --- | --- | --- |
| Capable | `capable` | The strongest generalist; the default when you don't want to think about models | `anthropic\|anthropic-api\|github-copilot\|opencode/claude-fable-5-1 (max)` -> same providers `/claude-opus-5 (max)` -> `kimi-coding\|kimi-for-coding\|moonshotai\|opencode-go/kimi-k3 (max)` -> `zai-coding-plan\|opencode-go/glm-5.3 (max)` |
| Simple work | `simple-work` | Small, well-specified edits where speed and cost matter | `openai\|openai-codex/gpt-5.6-luna-fast (low)` -> `deepseek/deepseek-v4-flash` -> `anthropic\|github-copilot/claude-haiku-4-5` |
| Deep work | `deep-work` | Hard problems that need maximum reasoning; the `deep` category chain verbatim | `openai\|openai-codex\|github-copilot\|opencode/gpt-6-astra (high)` -> same providers `/gpt-5.6-sol (medium)` |

Activate one with a single key in `omo.json`:

```jsonc
{ "model_profile": "capable" }
```

The session prints `omo-senpi: model profile "capable" selected anthropic/claude-fable-5-1; mid-session fallback follows senpi's retry chains`, naming any skipped rungs. A few rules worth knowing:

- **Pins win.** Write a literal `provider/model` into the same key (`"model_profile": "anthropic/claude-opus-5"`) and that exact model is applied; anything containing `/` is a pin.
- **Explicit models are never clobbered.** A `--model` flag, a scoped model, a resumed session, and a fork keep their own model; the profile only touches a fresh session.
- **Unset means untouched.** With no `model_profile`, Senpi's own default resolution runs and nothing changes.
- **Session-scoped.** The apply never writes `settings.json` or `omo.json`. Mid-session failures follow Senpi's retry chains, not the profile.
- **Your own chains.** `model_profiles.<name>` adds a profile, or replaces a builtin of the same name wholesale (no field merge). Entries take the same shape as a category chain and may reference `models.<catalog>` aliases. Key reference: [omo.json](../reference/omo-json.md#model-profiles-senpi-harness).

You can still pick with `/model` and switch mid-session; the main agent switches with you and the prompt stays the same.

### The recommended tier

Two configurations are the ones we recommend and tune against, and the Capable and Deep work profiles lead with them:

- **Claude Opus 5** (or Claude Fable 5 when you have it). Claude is the reference configuration for the orchestration prompt: long nested todos, delegation tables, many tool calls in a row.
- **GPT 5.6 Sol**. The GPT-recommended configuration. It gets a model-aware GPT-native prompt built for autonomous, principle-driven work. Over-orchestration on small bounded tasks is a known risk on GPT; give it a goal, not a recipe.

Models below the recommended tier aren't supported as the main agent. They may look fine for a few turns and then fall apart three tool calls later. Nobody is regression-checking the orchestration prompt against them, so a prompt change that helps Claude or GPT can silently break an unsupported model with zero warning. Don't file that as a bug; it was never working on purpose.

**A prompt cannot fix a model.** Models have hard, intrinsic characteristics. If a model is the wrong brain for orchestration, no amount of prompt-carving changes that. We've ground the prompts down to the bone; the model that can't, still can't.

---

## Models with tuned prompt presets

The harness ships a prompt preset per model family. When your session model matches one, the main agent's prompt is shaped for that model's habits. The current preset set:

| Preset | Notes |
| --- | --- |
| `claude-fable-5` | Top tier, above Opus. Highest compliance with long, mechanics-driven prompts. |
| `claude-opus-5` | Current best Opus. Steerable and literal. The reference configuration. |
| `gpt-5.6` | GPT-5.6 Sol and its siblings. Model-aware GPT-native prompt: concise principles, explicit decision criteria. |
| `gpt-5.5` | Shares the GPT-native prompt family with 5.6. |
| `kimi-k3` | Newest Kimi. Instruction-following mirrors Claude closely. The preset is calibrated to stop overthinking and keep work moving, so expect thinking-token cost. |
| `glm-5-3` / `glm-5-2` | Claude-like, slightly looser on long nested workflows. GLM has a calibrated preset and one community report of good results, but no maintainer end-to-end validation of the nested todo, delegation, and long-context paths. Treat it as lower-confidence than Claude or Kimi. |
| `deepseek-v4` | Preset exists for the V4 line (including Flash and Pro). Not a recommended main-agent configuration. |
| `grok-4.5` / `grok-4.6` | Preset exists. Grok 4.6 is also the default for the `unspecified-low` category. |

Having a preset means the prompt is shaped for that model. It doesn't mean the model is recommended as the main agent; the recommended tier is the two configurations above. Anything outside this table runs on the generic prompt with no model-specific tuning at all.

---

## Claude vs GPT prompting differences

This matters for understanding why the main agent's prompt changes shape with the model, and why delegation categories split along family lines.

**Claude** responds to **mechanics-driven** prompts: detailed checklists, templates, step-by-step procedures. More rules = more compliance. You can write a very long prompt with nested workflows and Claude will follow every step.

**GPT** (especially 5.2+) responds to **principle-driven** prompts: concise principles, XML structure, explicit decision criteria. More rules = more contradiction surface = more drift. GPT works best when you state the goal and let it figure out the mechanics.

The `/ulw-plan` skill used to mirror this split with separate model-family prompts. It now uses a single thin prompt, so swapping your session model changes the model, not the planning prompt.

---

## Curated agents and categories keep their own chains

A model profile picks the main session model and nothing else. Every delegated child, curated agent or category, walks its own chain, and `model_profile` isn't consulted at any rung of that path. A user who sets `categories.deep.model` sees identical behavior with or without a profile active.

### Curated agents

Delegation goes through the `task` tool. Four curated read-only agents have their own fallback chains, hardcoded in [`packages/senpi-task/src/agents/builtin/fallback-chains.ts`](../../packages/senpi-task/src/agents/builtin/fallback-chains.ts). The first rung your connected providers can serve wins.

| Agent | Job | Primary | Chain |
| --- | --- | --- | --- |
| `explore` | Fast codebase grep and pattern discovery | `gpt-5.6-luna-fast` (low) | `openai\|openai-codex/gpt-5.6-luna-fast (low)` -> `deepseek/deepseek-v4-flash (max)` -> `opencode-go\|bailian-coding-plan/qwen3.5-plus` -> cheaper utility rungs -> `anthropic\|github-copilot/claude-haiku-4-5` -> `openai\|openai-codex/gpt-5.4-nano` |
| `librarian` | Documentation and OSS code search | `gpt-5.6-luna-fast` (low) | Same chain as `explore`. |
| `plan-consultant` | Pre-planning gap analysis for `/ulw-plan` | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode/claude-sonnet-4-6` -> `anthropic\|github-copilot\|opencode/claude-opus-5 (max)` -> `openai\|openai-codex\|github-copilot\|opencode/gpt-5.6-sol (medium)` -> `opencode-go/glm-5.2` -> `kimi-for-coding/kimi-k3` |
| `plan-reviewer` | One-shot plan review against clarity, verification, and context criteria | `gpt-6-astra` (xhigh) | `openai\|openai-codex/gpt-6-astra (xhigh)` -> `github-copilot/gpt-6-astra (high)` -> `openai\|openai-codex\|opencode/gpt-6-astra (high)` -> `anthropic\|github-copilot\|opencode/claude-opus-5 (max)` -> two lower rungs listed in the source file -> `opencode-go/glm-5.2` |

The utility rungs elided above are cheap fast models; read the source file for the exact list. They exist so the system degrades gracefully when you don't hold every subscription. If you have a paid tier connected, it's always preferred.

The ulw-loop reviewers (`omo-senpi-code-reviewer`, `omo-senpi-qa-executor`, `omo-senpi-gate-reviewer`) don't have hand-written chains. They resolve their model through the `categories` field on their definition.

#### Where to spend one scarce premium model

If one premium model is quota-limited while your other models are effectively unlimited:

1. **Match the family to the role.** Claude-family models fit the communicative roles: the main agent and `plan-consultant`. GPT-family models fit `plan-reviewer` and the `deep` / `ultrabrain` categories.
2. **Prefer a low-frequency, high-leverage role.** `plan-consultant` contributes one gap-analysis pass per plan generation. High-accuracy planning runs one `plan-reviewer` pass per round and repeats after any rejection. Both are far cheaper places for a rare model than the main agent, which runs throughout the workflow.
3. **Avoid execution-heavy slots.** The category worker, `explore`, and `librarian` are high-volume. They're usually poor homes for the rarest model.

For a scarce Claude Fable 5 allocation, `plan-consultant` is the default value-per-token placement: it runs before the plan is finalized and can prevent expensive downstream work.

```jsonc
{
  "agents": {
    "plan-consultant": {
      "model": "anthropic/claude-fable-5-1",
      "reasoning": "high"
    }
  }
}
```

---

### Categories

When the main agent delegates implementation work, it doesn't pick a model name. It picks a **category**, and the category spawns the category worker: a fresh worker session configured by the category's model and skills. Chains live in [`packages/senpi-task/src/category/fallback-chains.ts`](../../packages/senpi-task/src/category/fallback-chains.ts); descriptions and prompt appends live next to them in `packages/senpi-task/src/category/*-categories.ts`.

| Category | Used for | Default | Chain |
| --- | --- | --- | --- |
| `architect` | Big-picture system design; proposes, doesn't implement (the architect consult lane) | `anthropic/claude-fable-5-1 (max)` | `anthropic\|anthropic-api\|github-copilot\|opencode/claude-fable-5-1 (max)` |
| `visual-engineering` | Frontend, UI/UX, CSS, animation, design systems | `anthropic/claude-fable-5-1 (max)` | `claude-fable-5-1 (max)` -> `claude-opus-5 (max)` -> `kimi-coding\|kimi-for-coding\|moonshotai\|opencode-go/kimi-k3 (max)` |
| `ultrabrain` | Genuinely hard, logic-heavy tasks; goals only, no step-by-step | `openai/gpt-6-astra (max)` | `gpt-6-astra (max)` across `openai`, `openai-codex`, `github-copilot`, `opencode` -> `gpt-5.6-sol (max)` across the same providers |
| `deep` | 3D graphics, computer use, browser use, backend, algorithms, multimodal work, complex research | `openai/gpt-6-astra (high)` | `openai\|openai-codex\|github-copilot\|opencode/gpt-6-astra (high)` -> same providers `/gpt-5.6-sol (medium)` |
| `artistry` | Unconventional, creative problem-solving | `anthropic/claude-fable-5-1 (max)` | `claude-fable-5-1 (max)` -> `kimi-k3 (max)` -> `claude-opus-5 (xhigh)` |
| `quick` | Trivial tasks: single-file changes, typos | `kimi-coding/kimi-for-coding-highspeed` | `kimi-for-coding-highspeed` -> `openai-codex/gpt-5.6-luna-fast (low)` -> `deepseek/deepseek-v4-flash (off)` -> `qwen3.6-flash (low)` -> cheaper utility rungs -> `xai/grok-4.20-0309-non-reasoning` -> `claude-haiku-4-5 (off)` |
| `unspecified-low` | Doesn't fit elsewhere, low effort | `xai/grok-4.6 (xhigh)` | `xai\|github-copilot\|opencode/grok-4.6 (xhigh)` -> `gpt-5.6-terra (high)` -> `claude-sonnet-5 (low)` -> `qwen3.8-max-preview (max)` -> `deepseek\|opencode-go/deepseek-v4-pro (max)` -> `xiaomi\|opencode-go/mimo-v2.5-pro (max)` |
| `unspecified-high` | Doesn't fit elsewhere, high effort | `openai/gpt-6-astra (high)` | `gpt-6-astra (high)` -> `claude-opus-5 (xhigh)` -> `zai-coding-plan\|opencode-go/glm-5.3 (max)` -> `kimi-k3 (max)` |
| `writing` | Documentation, prose, technical writing | `anthropic/claude-fable-5-1 (medium)` | `claude-fable-5-1 (medium)` -> `kimi-k3 (max)` |

The `quick` category ships a caller warning: small fast models need an explicit prompt with numbered must-do steps, forbidden deviations, and concrete success criteria. `deep` is one goal plus one deliverable per call; fan out multiple goals as parallel `deep` calls.

See the [Orchestration System Guide](./orchestration.md) for how the main agent decides between a category and a curated agent.

---

## Customizing in `omo.json`

Override any category or curated agent in `omo.json`. `model` sets one model; `models` sets an ordered chain that's tried before the builtin one. Entries may be plain `provider/model` strings (with an optional `:level` reasoning suffix such as `openai/gpt-6-astra:xhigh`) or objects carrying `model`, `reasoning`, `max_tokens`, or `provider_options`. Full key reference: [omo.json](../reference/omo-json.md).

### Example A: Claude plus OpenAI

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",

  "agents": {
    "plan-consultant": { "model": "anthropic/claude-opus-5", "reasoning": "high" },
    "plan-reviewer": { "model": "openai/gpt-6-astra", "reasoning": "xhigh" },
    "explore": { "model": "openai/gpt-5.6-luna-fast", "reasoning": "low" },
    "librarian": { "model": "openai/gpt-5.6-luna-fast", "reasoning": "low" }
  },

  "categories": {
    "visual-engineering": { "model": "anthropic/claude-fable-5-1", "reasoning": "max" },
    "deep": { "model": "openai/gpt-6-astra", "reasoning": "high" },
    "ultrabrain": { "model": "openai/gpt-6-astra", "reasoning": "max" },
    "unspecified-high": { "model": "anthropic/claude-opus-5", "reasoning": "xhigh" }
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
    "deep": {
      "models": [
        { "model": "openai/gpt-6-astra", "reasoning": "high" },
        { "model": "deepseek/deepseek-v4-pro", "reasoning": "max" }
      ]
    }
  }
}
```

---

## Safe vs risky overrides

**Safe**, same family and role shape:

- Main agent: the Capable profile, or Claude Opus 5 <-> Claude Fable 5 pinned; Deep work, or GPT 5.6 Sol pinned, when you want the GPT-native prompt.
- `plan-consultant`: any Claude-family model, Kimi K3, GLM 5.2 / 5.3.
- `plan-reviewer`: GPT-6 Astra <-> GPT 5.6 Sol; Claude Opus 5 at max as a communicative fallback.
- `visual-engineering`, `artistry`, `writing`: swap among Claude Fable 5, Claude Opus 5, and Kimi K3.

**Lower-confidence**, works but thinly validated:

- Main agent on GLM 5.2 / 5.3. A calibrated preset exists, but maintainers haven't validated the nested todo and delegation paths end to end.
- Main agent on Kimi K3. Strong instruction-following; budget for the thinking tokens.

**Risky**, family or role mismatch:

- **Main agent on any model below the recommended tier.** Not maintainer-verified. Can break at the very next patch. A prompt cannot fix a model.
- **`deep` / `ultrabrain` on Claude or Kimi.** These categories are built for GPT's autonomous style. Other families finish eventually but don't shine.
- **`plan-reviewer` on a small or fast model.** Review needs sustained reasoning; small models drift and rubber-stamp.
- **`explore` / `librarian` on Opus or Fable.** Massive cost waste. Search needs speed, not intelligence.
- **`visual-engineering` on utility or search models.** Keep it on the Fable 5 -> Opus 5 -> Kimi K3 chain.

---

## How model resolution works

For the main agent, resolution happens once, at session start (`packages/omo-senpi/src/components/model-profile/index.ts`):

```
1. --model flag or scoped model    -> kept as is; the profile never runs
2. model_profile = provider/model  -> the pin; that exact model, if the registry serves it
3. model_profile = <profile id>    -> builtins overlaid with model_profiles; first rung the registry serves
4. Senpi's default resolution      -> including its recommended-models builtin
```

Mid-session model failures follow the harness's own retry chains, not the profile and not the delegation chains below.

For every delegated child (a category or a curated agent), resolution walks a chain until a rung matches a model your connected providers can serve:

```
1. omo.json override   -> categories.<name>.model(s) / agents.<name>.model(s)
2. Builtin chain       -> category/fallback-chains.ts or agents/builtin/fallback-chains.ts
3. First serviceable rung wins; reasoning and variant are normalized to what the model supports
```

Your explicit configuration always wins. If you set a model for a category or agent, that choice takes precedence over the builtin chain.

---

## See Also

- [Installation Guide](./installation.md): setup and provider authentication
- [Orchestration System Guide](./orchestration.md): how the main agent delegates to categories and curated agents
- [omo.json Reference](../reference/omo-json.md): `model_profiles`, `model_profile`, `agents`, `categories`, and `models` keys
- [`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`](../../packages/omo-senpi/src/components/model-profile/builtin-profiles.ts): the three builtin profile chains
- [`packages/senpi-task/src/agents/builtin/fallback-chains.ts`](../../packages/senpi-task/src/agents/builtin/fallback-chains.ts): curated agent chains
- [`packages/senpi-task/src/category/fallback-chains.ts`](../../packages/senpi-task/src/category/fallback-chains.ts): category chains
