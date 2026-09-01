# Agent-Model Matching Guide

> **For agents and users**: Why each agent needs a specific model — and how to customize without breaking things.

---

## 🚨 READ THIS FIRST — SISYPHUS IS **NOT** A "RUN IT ON ANY MODEL" SYSTEM 🚨

> **STOP. BEFORE YOU POINT SISYPHUS AT SOME OTHER MODEL, READ EVERY WORD BELOW. THIS IS THE SINGLE MOST IGNORED THING IN THIS WHOLE GUIDE.**

**SISYPHUS IS ONLY MAINTAINER-VERIFIED ON THE EXACT MODELS LISTED IN THIS SUPPORTED SET — AND NOTHING, *NOTHING*, ELSE.** The supported set is narrow on purpose:

- **Claude family:** Fable 5 · Opus 5 · Sonnet 5
- **Kimi:** **K3** · K2.7
- **GLM:** 5.2 / 5.1 *(acceptable — slightly looser on the long nested workflows)*
- **GPT:** 5.4 / 5.5 / 5.6 Sol *(GPT-native prompt paths exist — supported, but still **NOT** the recommended default for the orchestrator)*

> **Known GPT-5.6 Sisyphus risk:** GPT-5.6 Sol is an automatic fallback and receives a model-aware GPT-native prompt, but [issue #6074](https://github.com/code-yeongyu/oh-my-openagent/issues/6074) tracks over-orchestration on bounded work. Hephaestus remains the recommended GPT-5.6 agent; the Sisyphus route is available for fallback coverage, not a claim that it is the best fit.

**GLM 5.2 is explicit but still lower-confidence than Claude/Kimi.** A dedicated GLM-5.2-calibrated prompt exists, and the Sisyphus fallback chain now includes the `glm-5.2` model literal. One community report describes good results, but maintainers have not yet validated the nested todo, delegation, long-context, and non-ultrawork behavior end to end.

**IF A MODEL IS NOT ON THE SUPPORTED LIST, IT IS NOT MAINTAINER-VERIFIED WITH SISYPHUS.** A community report does not change that status. It may not work at all. It may *look* like it works and then fall apart three tool-calls later. **IT IS NOT A SUPPORTED CONFIGURATION, IT IS NOT BLESSED, AND IT IS NOT A PROMISE THAT IT WILL STILL WORK TOMORROW.**

**EVERY SINGLE PROMPT CHANGE TO SISYPHUS IS WRITTEN, TUNED, AND REGRESSION-CHECKED AGAINST THE MODELS ABOVE — AND ONLY THOSE MODELS.** Nobody is watching how an off-list model behaves. The consequences are not subtle:

- **AN UNLISTED MODEL CAN BREAK AT THE *VERY NEXT PATCH*, WITH ZERO WARNING.** A prompt tweak that helps Claude/Kimi can silently shatter whatever fragile thing was holding your off-list model together — and we will *never notice*, because we are not testing it. Do not file it as a bug. It was never working on purpose.
- **A PROMPT CANNOT FIX A MODEL.** Models have hard, intrinsic characteristics. No amount of prompt-carving makes a model do what it fundamentally *cannot* do. If a model is the wrong brain for orchestration, it stays the wrong brain — **forever**, no matter how perfectly the prompt is shaped. We have ground prompts down to the bone; the model that can't, still can't.

**SO, GENUINELY AND SINCERELY, FROM THE BOTTOM OF OUR HEARTS: RUNNING SISYPHUS ON ANY MODEL NOT LISTED HERE IS STRONGLY, EMPHATICALLY, DESPERATELY *NOT* RECOMMENDED.** Do it anyway and you are fully on your own — and you should *expect* it to break.

### MiniMax / Qwen / MiMo / DeepSeek as Sisyphus — JUST DON'T

**We have NOT found any way to make MiniMax, Qwen, MiMo, or DeepSeek work acceptably as Sisyphus.** We tried. They do not hold up under Sisyphus's nested todo + delegation + orchestration prompt. This is not a "tune it more" situation — see the rule above: *a prompt cannot fix a model.*

**MiniMax and Qwen in particular are so bad in the Sisyphus role that we would almost forbid it outright.** Treat **"Sisyphus on MiniMax"** and **"Sisyphus on Qwen"** as configurations you should simply *never* reach for. (These models still have legitimate jobs elsewhere as utility and research fallbacks, documented below — just **NEVER** as the orchestrator.)

---

## The Core Insight: Models Are Developers

Think of AI models as developers on a team. Each has a different brain, different personality, different strengths. **A model isn't just "smarter" or "dumber." It thinks differently.** Give the same instruction to Claude and GPT, and they'll interpret it in fundamentally different ways.

This isn't a bug. It's the foundation of the entire system.

Oh My OpenAgent assigns each agent a model that matches its _working style_ — like building a team where each person is in the role that fits their personality.

### Sisyphus: The Sociable Lead

Sisyphus is the developer who knows everyone, goes everywhere, and gets things done through communication and coordination. Talks to other agents, understands context across the whole codebase, delegates work intelligently, and codes well too. But deep, purely technical problems? He'll struggle a bit.

**This is why Sisyphus uses Claude / Kimi / GPT-5.6 Sol / GLM.** These models excel at:

- Following complex, multi-step instructions (Sisyphus's prompt is ~1,100 lines)
- Maintaining conversation flow across many tool calls
- Understanding nuanced delegation and orchestration patterns
- Producing well-structured, communicative output

Using Sisyphus with older GPT models would be like taking your best project manager — the one who coordinates everyone, runs standups, and keeps the whole team aligned — and sticking them in a room alone to debug a race condition. Wrong fit. GPT-5.4 has its own prompt, while GPT-5.5 and GPT-5.6 Sol share a model-aware GPT-native prompt family; GPT is still not the default recommendation for the orchestrator.

> **⚠️ Sisyphus is ONLY tested on Claude (Fable 5 / Opus 5 / Sonnet 5), Kimi (**K3** / K2.7), GLM (5.2 / 5.1), and GPT (5.4 / 5.5 / 5.6 Sol).** Anything else is not maintainer-verified or supported and can break without warning. **MiniMax and Qwen as Sisyphus are strongly discouraged to the point we'd almost forbid it.** Read the **🚨 READ THIS FIRST** warning at the very top of this guide before you override the orchestrator's model.

> **GLM 5.2 remains lower-confidence than Claude/Kimi.** It has a calibrated prompt and one community report, but no maintainer end-to-end validation. The automatic Sisyphus chain includes `glm-5.2` explicitly; older `glm-5` / `glm-5.1` entries are compatibility paths, not the current explicit fallback.

### Hephaestus: The Deep Specialist

Hephaestus is the developer who stays in their room coding all day. Doesn't talk much. Might seem socially awkward. But give them a hard technical problem and they'll emerge three hours later with a solution nobody else could have found.

**This is why Hephaestus uses GPT-5.6 Sol.** The GPT-5.x flagship line is built for exactly this:

- Deep, autonomous exploration without hand-holding
- Multi-file reasoning across complex codebases
- Principle-driven execution (give a goal, not a recipe)
- Working independently for extended periods

Using Hephaestus with GLM or Kimi would be like assigning your most communicative, sociable developer to sit alone and do nothing but deep technical work. They'd get it done eventually, but they wouldn't shine — you'd be wasting exactly the skills that make them valuable.

### The Takeaway

Every agent's prompt is tuned to match its model's personality. **When you change the model, you change the brain — and the same instructions get understood completely differently.** Model matching isn't about "better" or "worse." It's about fit.

---

## How Claude and GPT Think Differently

This matters for understanding why some agents support both model families while others don't.

**Claude** responds to **mechanics-driven** prompts — detailed checklists, templates, step-by-step procedures. More rules = more compliance. You can write a 1,100-line prompt with nested workflows and Claude will follow every step.

**GPT** (especially 5.2+) responds to **principle-driven** prompts — concise principles, XML structure, explicit decision criteria. More rules = more contradiction surface = more drift. GPT works best when you state the goal and let it figure out the mechanics.

Prometheus used to mirror this split with separate model-family prompts. It now uses a single thin prompt backed by `ulw-plan`, so swapping its model changes the fallback choice, not the prompt file.

Atlas still supports model-family prompt behavior. Prometheus does not auto-switch prompts at runtime.

---

## Step 1 — Check What's Actually Available

Before configuring anything, see what your current system can run.

### List all available models

```bash
opencode models
```

This prints every `provider/model` combination you can address right now. Providers are derived from your connected auth + the `models.dev` catalogue.

Opencode sorts the output so `opencode*` providers appear first — that's intentional, not cosmetic.

### List connected providers

```bash
opencode auth list
```

Shows which providers you've already logged into.

### If the model you want isn't listed

You need to log in to that provider:

```bash
opencode auth login
```

The interactive picker prioritizes providers in this order:

| Priority | Provider | Opencode's own hint |
|---|---|---|
| 0 | `opencode` | **(Recommended)** |
| 1 | `opencode-go` | Low cost subscription for everyone |
| 2 | `openai` | ChatGPT Plus/Pro or API key |
| 3 | `github-copilot` | — |
| 4 | `anthropic` | API key |
| 5 | `google` | — |

You can also skip the picker: `opencode auth login --provider opencode-go`.

### Verify what oh-my-openagent will actually use

```bash
bunx oh-my-openagent doctor --verbose
```

This shows the **effective model resolution** for every agent and category based on your current auth state. If an agent says "system-default" instead of a real fallback, that's a signal you're missing providers from its chain.

---

## Step 2 — The Recommended Stack

You don't need every provider. You need the right two.

### The Optimal Combination: OpenCode Go + OpenAI Plus/Pro

**~$30/month total.** Beats direct Anthropic + OpenAI + Google subscriptions (~$60+/month) on both cost and coverage.

| Subscription | Cost | What You Get | Covers |
|---|---|---|---|
| **OpenCode Go** | $10/mo | `kimi-k3`, `glm-5.2`, `minimax-m2.5`, `minimax-m2.7`, `minimax-m3`, `mimo-v2-pro`, `qwen3.7-plus`, `qwen3.6-plus` | Claude-family alternatives (Kimi, GLM), Gemini-family alternatives (Qwen), utility/retrieval (MiniMax) |
| **OpenAI Plus/Pro** | $20+/mo | `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | GPT-native agents (Hephaestus, Oracle, Momus), GPT-5.6 category defaults (`deep`, `ultrabrain`), GPT fallbacks for model-flexible agents |

### Why this specific combination

1. **Hephaestus has exactly one automatic model: GPT-5.6 Sol.** It has no GPT-5.4, GPT-5.5, or Claude-family fallback. ChatGPT Plus/Pro or OpenAI API access is the cheapest real path.
2. **OpenCode Go covers the orchestration and creative surface.** Kimi K3/K2.7 behaves like Claude for Sisyphus/Atlas. GLM 5.2 fills the long tail. Qwen 3.7 Plus supports utility and research fallbacks.
3. **No single provider can cover everything.** Anthropic-only setups break Hephaestus. OpenAI-only setups degrade Sisyphus. You need at least one from each family.

### What if you already have a Claude subscription?

Add `--claude=max20` (or `yes`) on install. The Claude chain default (Opus 5) activates for Sisyphus/Metis and you still get the OpenCode Go fallbacks for free. Pin `claude-opus-5` or `claude-fable-5` to run the current top Claude with Sisyphus/Atlas tuned prompts, or pin `opencode-go/kimi-k3` to run the top Kimi; Prometheus uses Fable 5 before its Kimi K3 fallback. Best-in-class orchestration + budget safety net.

### What if you have zero subscriptions?

OpenCode Go alone gets Sisyphus/Atlas/Oracle/Librarian/Explore working. Hephaestus won't activate without GPT access, so you lose autonomous deep work. Consider adding ChatGPT Plus as soon as you can.

### Where to Spend One Scarce Premium Model

If one premium model is quota-limited while your other models are effectively unlimited, optimize in this order:

1. **Match the model family to the agent.** A premium model is not an interchangeable upgrade. Claude-family models fit communicators such as Metis, Sisyphus, and Atlas; GPT-family models fit deep specialists such as Oracle, Momus, and Hephaestus.
2. **Prefer a low-frequency, high-leverage role.** Avoid spending scarce quota on continuous orchestration, execution, search, or retrieval unless that is the workflow you explicitly want to improve.
3. **Account for loops.** Metis normally contributes one gap-analysis pass per plan generation. High-accuracy planning runs one Momus pass and one independent Oracle pass per round, then repeats both after any rejection. Oracle can also be invoked separately for architecture or debugging advice.

For a scarce Claude Fable 5 allocation, **Metis is the default value-per-token placement**. It is compatible with Metis's prompt style, runs before the plan is finalized, and can prevent expensive downstream work without putting every Sisyphus, Atlas, or worker turn on the limited quota.

```jsonc
{
  "agents": {
    "metis": {
      "model": "anthropic/claude-fable-5",
      "variant": "max",
      "fallback_models": [
        { "model": "anthropic/claude-sonnet-5" },
        { "model": "openai/gpt-5.6-sol", "variant": "high" },
        { "model": "kimi-for-coding/kimi-k3" }
      ]
    }
  }
}
```

The explicit `model` and `variant` make Fable 5 the normal Metis model. `fallback_models` only supplies secondary candidates; putting Fable 5 there without an explicit `model` does not assign it as the normal model for an agent whose primary model is available.

Use a different slot only when the model family and workflow justify it:

- A scarce **GPT-family** reasoning model can be valuable on Oracle or Momus, but high-accuracy planning spends both once per review round. Hephaestus is a better target when the scarce model's purpose is autonomous deep implementation rather than advisory review.
- Prometheus is lower-frequency than Sisyphus, but a planning interview can span many turns.
- Sisyphus and Atlas are valid homes for Fable 5 when maximum orchestration quality matters more than quota. They are not the default for a scarce allocation because they run throughout the workflow.
- Sisyphus-Junior and categories are execution-heavy. Explore and Librarian favor speed and parallelism. These are usually poor places for the rarest model.

---

## Step 3 — Model Family Alternatives (Priority Order)

When the "native" model isn't available, oh-my-openagent walks each agent's fallback chain until something connects. The chains are hardcoded in [`packages/omo-opencode/src/shared/model-requirements.ts`](../../packages/omo-opencode/src/shared/model-requirements.ts). There is no single global priority list. Every agent and category has its own chain.

There are two separate systems:

- **model-fallback**: proactive resolution in `chat.params` using hardcoded `AGENT_MODEL_REQUIREMENTS` and `CATEGORY_MODEL_REQUIREMENTS`
- **runtime-fallback**: reactive recovery from `session.error`, configurable per category/agent in runtime-fallback hooks

### Current top tier vs the auto-resolution chain

The model recommendations and their auto-resolution chains now use the same current generation, and the runtime fallback chain uses the same resolved chain as initial selection:

- **The current top models** are Claude **Fable 5** and **Opus 5**, and Kimi **K3** and **K2.7**. Pin one in your config: `"anthropic/claude-opus-5"`, `"anthropic/claude-fable-5"`, `"opencode-go/kimi-k3"`, `"opencode-go/kimi-k2.7-code"`.
- **The auto-resolution fallback chains** use Opus 5 for Metis, Fable 5 for Prometheus, and their configured Kimi K3 fallbacks.

The chain entries below are the active recommendations, not snapshot-backed legacy defaults.

### Claude Family (communicative, instruction-following)

Used by: Sisyphus, Atlas, Sisyphus-Junior, Metis (Claude path), Prometheus (primary fallback), `unspecified-high`.

The priorities below include manual model choices. They are not a literal copy of every agent's automatic fallback chain; see [Agent Profiles](#agent-profiles) for the exact runtime chains.

| Priority | Model | Provider | Why |
|---|---|---|---|
| 1 | `claude-fable-5` / `claude-opus-5` | `anthropic`, `github-copilot`, `opencode`, `vercel` | Best overall compliance with the ~1,100-line Sisyphus prompt. Prometheus uses Fable 5 xhigh before Kimi K3 max; Metis uses Opus 5 high before Kimi K3 low. |
| 2 | `claude-sonnet-5` | same | Faster, cheaper, still Claude. |
| 3 | **`kimi-k3` - RECOMMENDED ALTERNATIVE (newest Kimi)** | `opencode-go`, `kimi-for-coding`, `moonshotai`, `opencode`, `vercel` | Strongest Kimi for Sisyphus. Use when you can accept the thinking-token cost; the prompt is calibrated to stop overthinking and keep work moving. |
| 4 | **`kimi-k2.7` - RECOMMENDED ALTERNATIVE** | same as K3 | Restrained, outcome-first, and the top Kimi when Anthropic isn't connected. Agents with Kimi-specific prompt paths use their K2.7 tuning; Prometheus keeps its `ulw-plan`-backed prompt. |
| 5 | **Additional Kimi K3 provider entries — RECOMMENDED ALTERNATIVE** | same as K3 | Instruction-following mirrors Claude closely. Current default Kimi in the chains after the top K3/K2.7 entries. |
| 6 | **`glm-5.2` — ACCEPTABLE FALLBACK, LIMITED VALIDATION** | `zai-coding-plan`, `opencode`, `bailian-coding-plan`, `vercel` | Claude-like, slightly looser on long nested workflows. The automatic Sisyphus chain includes `glm-5.2` explicitly and applies the GLM-5.2-calibrated prompt. |
| 7 | **`glm-5` / `glm-5.1` — LEGACY/COMPATIBILITY** | `zai-coding-plan`, `opencode`, `vercel` | Older configs and provider catalogs may still resolve these IDs, but they are not the current explicit GLM 5.2 fallback literal. |
| 8 | `big-pickle` (GLM 4.6) | `opencode` | Free-tier safety net. |

> **Kimi ≻ GLM.** Kimi (K3 newest, then K2.7) holds up under Sisyphus's nested todo+delegation prompts better than GLM. Use Kimi whenever both are available.

### GPT Family (principle-driven, autonomous)

Used by: Hephaestus, Oracle, Momus, `deep`, `ultrabrain`, `quick`, Atlas (GPT path). `unspecified-low` falls back to GPT-5.6 Terra after Grok 4.6.

| Priority | Model | Provider | Why |
|---|---|---|---|
| 1 | `gpt-5.6-sol` (xhigh / high / medium) | `openai`, `github-copilot`, `opencode`, `vercel` | The GPT-5.6 flagship. Default for Hephaestus, Oracle, and `ultrabrain`; first GPT-5.6 Sol-family fallback for deep GPT-native roles. |
| 1 | `gpt-5.6-terra` (xhigh / high) | `openai`, `vercel` | GPT-5.6 mid-tier. Default for Momus (high) and an optional balanced override elsewhere. |
| 1 | `gpt-5.6-luna` (xhigh) | `openai`, `vercel` | GPT-5.6 light tier. Not the `unspecified-low` default; that category now starts at Grok 4.6. |
| 2 | `gpt-5.4` / `gpt-5.4-pro` (pro / xhigh / high / medium) | `openai`, `github-copilot`, `opencode`, `vercel` | Previous flagship generation available as an explicit manual or catalog choice, not an active Hephaestus fallback. |
| 3 | **DeepSeek — LIMITED ALTERNATIVE** (`deepseek-v4-pro`) | `deepseek`, `opencode-go`, `vercel` | Approved in the `unspecified-low` fallback chain, but not a substitute for the Sol-only `deep` category. |
| 4 | **MiniMax — STRONGLY DISCOURAGED** (`minimax-m3`, `minimax-m2.7`) | `opencode-go`, `opencode`, `openrouter/minimax` | Used in the Explore, Librarian, Atlas, and Sisyphus-Junior fallback chains. Consistency and long-context management issues make it a poor substitute for Hephaestus/Oracle. Do NOT override deep agents to MiniMax. |

> **DeepSeek ≻≻ MiniMax.** DeepSeek retains GPT's autonomous exploration character. MiniMax loses coherence on multi-step deep work. MiniMax is fine for grep-style utility agents, nothing more.

### Visual Engineering Chain

The built-in `visual-engineering` category starts with Claude Opus 5 and does not require Gemini:

| Priority | Model | Provider | Why |
|---|---|---|---|
| 1 | `claude-opus-5` (`max`) | `anthropic`, `anthropic-api`, `github-copilot`, `opencode`, `vercel` | Primary UI/UX, CSS, design-token, and layout model. |
| 2 | `kimi-k3` (`max`) | `opencode-go`, `kimi-for-coding`, `moonshotai`, `opencode`, `vercel` | Current visual fallback when Opus 5 is unavailable. |
| 3 | `glm-5.2` (`max`) | `zai-coding-plan`, `opencode-go`, `vercel` | GLM visual fallback. |
| 4 | `gpt-5.6-sol` (`medium`) | `openai`, `quotio-openai`, `github-copilot`, `opencode`, `vercel` | Final built-in visual fallback. |

Gemini 3.1 Pro remains a visual-capable explicit override where a provider exposes it. Gemini 3.6 Flash remains useful for fast writing and documentation work, but neither model is the current `visual-engineering` default chain.

---

## Cheat Sheet: Substitution Rules

| If you lose... | Swap to (in order) | Avoid |
|---|---|---|
| Claude Opus/Sonnet for Sisyphus | Kimi K3 → GPT-5.6 Sol (medium) → GLM 5.2 → Big Pickle | Kimi K2.7 is not an automatic rung |
| GPT-5.6 Sol | Hephaestus: no automatic fallback. Oracle: Gemini 3.1 Pro → Claude Opus 5 → GLM 5.2 | DeepSeek v3.2 is not in these built-in chains |
| `visual-engineering` primary | Claude Opus 5 → Kimi K3 → GLM 5.2 → GPT-5.6 Sol (medium) | Qwen is not in the built-in chain |
| GPT 5.6 Luna Fast (Explore/Librarian) | DeepSeek v4 Flash (max) → Qwen 3.7 Plus → MiniMax M2.7 Highspeed (Vercel only) → MiniMax M3 → MiniMax M3 plan aliases → MiniMax M2.7 → Claude Haiku 4.5 → GPT-5.4 Nano | Opus (massive cost waste) |

GLM 5.2 is now an explicit model literal in the automatic Sisyphus fallback chain. Older `glm-5` / `glm-5.1` catalog entries remain compatibility paths, but the current GLM fallback is `glm-5.2`.

---

## Agent Profiles

Exact current runtime chains from [`agent-model-requirements.ts`](../../packages/model-core/src/agent-model-requirements.ts).

| Agent | Primary | Full fallback chain |
| --- | --- | --- |
| **sisyphus** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel\|bailian-coding-plan\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5.2` → `opencode/big-pickle` |
| **hephaestus** | `gpt-5.6-sol` | `openai\|github-copilot\|vercel\|opencode/gpt-5.6-sol (medium)` |
| **oracle** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|vercel/glm-5.2` |
| **librarian** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **explore** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **multimodal-looker** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (low)` → `opencode-go\|vercel/kimi-k3` → `zai-coding-plan\|vercel/glm-4.6v` → `openai\|github-copilot\|opencode\|vercel/gpt-5-nano` |
| **prometheus** | `claude-fable-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-fable-5 (xhigh)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (max)` |
| **metis** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (high)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (low)` |
| **momus** | `gpt-5.6-terra` | `openai\|vercel/gpt-5.6-terra (high)` → `github-copilot/gpt-5.6-terra (high)` → `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `opencode-go\|vercel/glm-5.2` |
| **atlas** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |
| **sisyphus-junior** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `opencode/big-pickle` |

## Model Families

### Claude Family

Communicative, instruction-following, structured output. Best for agents that need to follow complex multi-step prompts. Sisyphus, Sisyphus-Junior, Atlas, and Metis use tuned prompt paths for supported communicative models. Prometheus uses one thin `ulw-plan`-backed prompt across model families.

| Model                 | Strengths                                                                    |
| --------------------- | ---------------------------------------------------------------------------- |
| **Claude Fable 5**    | Top tier, above Opus. Highest compliance; has its own per-agent prompt variants. |
| **Claude Opus 5**     | Current best Opus — steerable and literal. Dedicated per-agent prompt variants. |
| **Claude Sonnet 5**   | Faster, cheaper. Good balance for everyday tasks.                            |
| **Claude Haiku 4.5**  | Fast and cheap. Good for quick tasks and utility work.                       |
| **Kimi K3**           | Newest Kimi generation and the active automatic model wherever the built-in chains use Kimi, including Sisyphus. |
| **Kimi K2.7**         | Manual/catalog option only; it is not present in any active built-in fallback chain. |
| **GLM 5**             | Claude-like behavior. Solid for orchestration tasks.                         |
| **GLM 5.2**           | Experimental for Sisyphus. Model IDs recognized as GLM use a GLM-5.2-calibrated prompt, but evidence is one community report without maintainer end-to-end validation. |

### GPT Family

Principle-driven, explicit reasoning, deep technical capability. Best for agents that work autonomously on complex problems.

| Model             | Strengths                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| **GPT-5.6 Sol**   | The GPT-5.6 flagship. Default for Hephaestus and `ultrabrain`; first GPT-5.6 Sol-family fallback for deep GPT-native roles. |
| **GPT-5.6 Terra** | GPT-5.6 mid-tier. Default for Momus (high) and an optional balanced override elsewhere. |
| **GPT-5.6 Luna**  | GPT-5.6 light tier. No longer the `unspecified-low` default (that is Grok 4.6 xhigh). |
| **GPT-5.6 Sol override paths** | High intelligence, strategic reasoning. Default for Oracle and a key fallback for Atlas. |
| **GPT 5.6 Luna Fast**  | Fast + strong reasoning. Utility fallback after the Kimi high-speed quick default. |
| **GPT-5-Nano**    | Ultra-cheap, fast. Good for simple utility tasks.                                               |

### Other Models

| Model                | Strengths                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Gemini 3.1 Pro**   | Visual-capable explicit override with a different reasoning style; not in the built-in `visual-engineering` chain. |
| **Gemini 3.6 Flash** | Fast. Good for doc search and light tasks.                                                                   |
| **GPT 5.6 Luna Fast** | Default for Explore and Librarian agents. Blazing-fast reasoning-capable mini model. |
| **MiniMax M3**       | Latest MiniMax flagship. Primary MiniMax fallback in OpenCode Go utility chains, ahead of M2.7. |
| **MiniMax M2.7**     | Fast and smart. Used through `opencode-go` and `vercel` fallback rungs. |
| **MiniMax M2.7 Highspeed** | High-speed, Vercel-only fallback rung in the Explore and Librarian chains. |

### OpenCode Go

A premium subscription tier ($10/month) that provides reliable access to Chinese frontier models through OpenCode's infrastructure.

**Available Models:**

| Model                    | Use Case                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| **opencode-go/kimi-k3** | Strongest Kimi orchestration model; vision-capable, Claude-like reasoning. Primary recommended Kimi for Sisyphus when thinking cost is acceptable. Used by Sisyphus, Atlas, Sisyphus-Junior, Multimodal Looker. |
| **opencode-go/glm-5.2**     | Text-only orchestration model. Used by Sisyphus, Oracle, Momus, and `visual-engineering`.  |
| **opencode-go/minimax-m3** | Latest MiniMax flagship on OpenCode Go. Primary MiniMax fallback for Atlas, Sisyphus-Junior, Explore and Librarian, ahead of M2.7. |
| **opencode-go/minimax-m2.7** | Ultra-cheap, fast responses. Used by Atlas, Sisyphus-Junior, Explore and Librarian fallbacks for utility work. |
| **opencode-go/qwen3.7-plus** | Qwen coding model used as the first OpenCode Go utility fallback for Explore and Librarian when GPT 5.6 Luna Fast is unavailable. |

**When It Gets Used:**

OpenCode Go models appear throughout the fallback chains as intermediate options. Depending on the agent, they can sit before GPT, after GPT, or act as the last structured-model fallback before cheaper utility paths.

**Go-Only Scenarios:**

Some model identifiers in fallback chains are provider-specific aliases. For example, `kimi-k3` resolves through `kimi-for-coding`, while `glm-5.2` can resolve through `zai-coding-plan`, `opencode`, or `vercel` depending on availability.

### About Free-Tier Fallbacks

You may see model names like `kimi-k3-free`, `minimax-m3`, `minimax-m2.7`, `minimax-m2.7-highspeed`, or `big-pickle` (GLM 4.6) in the source code or logs. These are provider-specific or speed-optimized entries in fallback chains.

You don't need to configure them. The system includes them so it degrades gracefully when you don't have every paid subscription. If you have the paid version, the paid version is always preferred.

---

## Task Categories

When agents delegate work, they don't pick a model name — they pick a **category**. The category maps to the right model automatically.

| Category | Used For | Default Model | Full fallback chain |
| --- | --- | --- | --- |
| `visual-engineering` | Frontend, UI, CSS, design | `anthropic/claude-opus-5 (max)` | `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `zai-coding-plan\|opencode-go\|vercel/glm-5.2 (max)` → `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` |
| `ultrabrain` | Maximum reasoning needed | `openai/gpt-5.6-sol (max)` | `openai\|quotio-openai\|vercel/gpt-5.6-sol (max)` → `github-copilot/gpt-5.6-sol (max)` → `openai\|opencode\|vercel/gpt-5.6-sol (max)` |
| `deep` | Deep coding, complex logic | `openai/gpt-5.6-sol (medium)` | `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` |
| `artistry` | Creative, novel approaches | `anthropic/claude-fable-5 (xhigh)` | `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-fable-5 (xhigh)` → `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (xhigh)` |
| `quick` | Simple, fast tasks | `kimi-for-coding/kimi-for-coding-highspeed` | `kimi-for-coding/kimi-for-coding-highspeed` → `openai-codex/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (off)` → `qwen-token-plan\|alibaba-token-plan\|bailian-coding-plan\|vercel/qwen3.6-flash (low)` → `opencode-go\|vercel/minimax-m3 (max)` → `opencode-go\|vercel/minimax-m2.7 (max)` → `xai/grok-4.20-0309-non-reasoning` → `anthropic\|anthropic-api\|github-copilot\|vercel/claude-haiku-4-5 (off)` |
| `unspecified-low` | General standard work | `xai/grok-4.6 (xhigh)` | `xai\|github-copilot\|opencode\|vercel/grok-4.6 (xhigh)` → `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-terra (high)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-sonnet-5 (low)` → `qwen-token-plan\|alibaba-token-plan\|qwen-token-plan-cn\|alibaba-token-plan-cn/qwen3.8-max-preview (max)` → `deepseek\|opencode-go\|vercel/deepseek-v4-pro (max)` → `xiaomi\|opencode-go\|vercel/mimo-v2.5-pro (max)` |
| `unspecified-high` | General complex work | `kimi-for-coding/kimi-k3 (max)` | `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (xhigh)` → `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (high)` |
| `writing` | Text, docs, prose | `kimi-for-coding/kimi-k3 (low)` | `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (low)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (low)` → `google\|github-copilot\|opencode\|vercel/gemini-3.6-flash` |

See the [Orchestration System Guide](./orchestration.md) for how agents dispatch tasks to categories.

### Vercel AI Gateway fallback coverage

`packages/omo-opencode/src/shared/model-requirements.ts` includes `vercel` on nearly every gateway-compatible fallback entry across both agent and category chains. Treat it as a universal extra provider path for the listed model IDs, not as a different model family.

---

## Customization

### Example A — Recommended Stack (OpenCode Go + OpenAI Plus/Pro)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  "agents": {
    // Sisyphus: Kimi K3 is the top alternative to Claude for orchestration
    "sisyphus": {
      "model": "opencode-go/kimi-k3",
      "ultrawork": { "model": "opencode-go/kimi-k3" },
    },

    // Hephaestus: needs GPT. ChatGPT Plus gets you here.
    "hephaestus": { "model": "openai/gpt-5.6-sol", "variant": "medium" },

    // Architecture consultation: GPT or Claude Opus
    "oracle": { "model": "openai/gpt-5.6-sol", "variant": "high" },

    // Prometheus keeps the same ulw-plan-backed prompt across model families
    "prometheus": { "model": "opencode-go/kimi-k2.7-code" },

    // Atlas also communicative — Kimi works great
    "atlas": { "model": "opencode-go/kimi-k3" },

    // Utility agents stay cheap
    "explore": { "model": "opencode-go/qwen3.7-plus" },
    "librarian": { "model": "opencode-go/qwen3.7-plus" },
  },

  "categories": {
    "visual-engineering": { "model": "opencode-go/kimi-k3", "variant": "max" },
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "medium" },
    "ultrabrain": { "model": "openai/gpt-5.6-sol", "variant": "xhigh" },
    "quick": { "model": "kimi-for-coding/kimi-for-coding-highspeed" },
    "unspecified-high": { "model": "opencode-go/kimi-k3" },
    "unspecified-low": { "model": "opencode-go/kimi-k2.7-code" },
    "writing": { "model": "opencode-go/kimi-k3", "variant": "low" },
  },

  "background_task": {
    "providerConcurrency": {
      "openai": 3,
      "opencode-go": 10,
    },
  },
}
```

### Example B — All Native (Anthropic + OpenAI + Google)

Highest quality, highest cost. No surprises.

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-5",
      "variant": "max",
    },
    "hephaestus": { "model": "openai/gpt-5.6-sol", "variant": "medium" },
    "oracle": { "model": "openai/gpt-5.6-sol", "variant": "high" },
  },
  "categories": {
    "visual-engineering": { "model": "anthropic/claude-opus-5", "variant": "max" },
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "medium" },
    "unspecified-high": { "model": "anthropic/claude-opus-5", "variant": "xhigh" },
  },
}
```

### Example C — OpenCode Go Only (Budget, No GPT)

Cheapest full-stack path. Hephaestus won't activate — accept that trade-off.

```jsonc
{
  "agents": {
    "sisyphus": { "model": "opencode-go/kimi-k3" },
    "atlas": { "model": "opencode-go/kimi-k3" },
    // Omit hephaestus entirely; it needs GPT.
    "oracle": { "model": "opencode-go/glm-5.2" },  // Degraded but functional
    "explore": { "model": "opencode-go/qwen3.7-plus" },
    "librarian": { "model": "opencode-go/qwen3.7-plus" },
  },
  "categories": {
    "visual-engineering": { "model": "opencode-go/qwen3.6-plus" },
    "deep": { "model": "opencode-go/kimi-k3" },  // Not ideal — Kimi isn't GPT, but best available
    "unspecified-high": { "model": "opencode-go/kimi-k3" },
    "unspecified-low": { "model": "opencode-go/kimi-k2.7-code" },
    "quick": { "model": "opencode-go/minimax-m2.7" },
    "writing": { "model": "opencode-go/kimi-k3", "variant": "low" },
  },
}
```

### Example D — Adding DeepSeek as GPT Alternative

If you have OpenRouter and want DeepSeek in the chain when GPT is unavailable:

```jsonc
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.6-sol",
      "variant": "high",
      "fallback_models": [
        "anthropic/claude-opus-5",
        { "model": "openrouter/deepseek/deepseek-v3.2", "temperature": 0.7 },
        "opencode-go/glm-5.2",
      ],
    },
  },
}
```

`fallback_models` accepts a mix of plain model strings and per-fallback objects with `variant`, `reasoningEffort`, `temperature`, `top_p`, `maxTokens`, `thinking`.

---

### Safe vs Dangerous Overrides

**Safe** — same personality type:

- Sisyphus: Opus → Sonnet, Kimi K3 / K2.7, GLM 5.2 (all communicative models)
- Prometheus: Opus → GPT-5.6 Sol as an explicit user override (same `ulw-plan`-backed prompt, different model); this is not an automatic source-backed fallback
- Atlas: Claude Sonnet 5 → Kimi K3 → GPT-5.6 Sol (auto-switches to the GPT prompt)

**Lower-confidence** — explicit fallback, limited maintainer validation:

- Sisyphus: GLM 5.2. Model IDs recognized as GLM use the calibrated GLM 5.2 prompt. The automatic fallback chain includes `glm-5.2` explicitly, but the model has less maintainer validation than Claude or Kimi.

**Dangerous** — personality mismatch:

- **Sisyphus → ANY model not on the tested list**: The supported set is Claude (Fable 5 / Opus 5 / Sonnet 5), Kimi (K3 / K2.7), GLM (5.2 / 5.1), GPT (5.4 / 5.5 / 5.6 Sol). Everything else is not maintainer-verified and can break at the very next patch. **A prompt cannot fix a model** — if it doesn't fit, no tuning makes it fit. See the **🚨 READ THIS FIRST** warning at the very top of this guide.
- **Sisyphus → MiniMax / Qwen**: **Strongly discouraged to the point of "almost forbidden."** Neither holds up under the orchestration prompt. Never use them as the orchestrator.
- **Sisyphus → MiMo / DeepSeek**: No working configuration found. Untested and unsupported as the orchestrator.
- **Sisyphus → older GPT models**: Still a bad fit. GPT-5.4 has its own prompt; GPT-5.5 and GPT-5.6 Sol share the supported model-aware GPT-native prompt family.
- **Hephaestus → Claude**: Built for Codex's autonomous style. Claude can't replicate this.
- **Hephaestus → MiniMax**: MiniMax loses coherence on multi-step deep work. **Never do this.**
- **Oracle → MiniMax**: Same reason. Oracle needs sustained reasoning; MiniMax drifts.
- **Explore → Opus**: Massive cost waste. Explore needs speed, not intelligence.
- **Librarian → Opus**: Same. Doc search doesn't need Opus-level reasoning.
- **`visual-engineering` → utility/search models**: Keep this category on its approved Claude Opus 5 → Kimi K3 → GLM 5.2 → GPT-5.6 Sol (medium) chain; MiniMax, Haiku, and search-oriented Qwen tiers are poor substitutes for visual implementation work.

---

## How Model Resolution Works

Each agent has a fallback chain. The system tries models in priority order until it finds one available through your connected providers. You don't need to configure providers per model. Just authenticate (`opencode auth login`) and the system figures out which models are available and where.

Resolution pipeline (from [`packages/omo-opencode/src/shared/model-resolution-pipeline.ts`](../../packages/omo-opencode/src/shared/model-resolution-pipeline.ts)):

```
1. Override          → User's explicit config or UI-selected model (primary agents only)
2. Category default  → From category config (when agent has category set)
3. User fallback_models → Configured strings/objects tried before hardcoded chain
4. Provider fallback → AGENT_MODEL_REQUIREMENTS / CATEGORY_MODEL_REQUIREMENTS
5. System default    → Ultimate safety net
```

Core-agent tab cycling is deterministic via injected runtime order field. The fixed priority order is Sisyphus (order: 1), Hephaestus (order: 2), Prometheus (order: 3), and Atlas (order: 4), then the remaining agents follow.

Your explicit configuration always wins. If you set a specific model for an agent, that choice takes precedence even when resolution data is cold.

Variant and `reasoningEffort` overrides are normalized to model-supported values, so cross-provider overrides degrade gracefully instead of failing hard.

Model capabilities are `models.dev`-backed, with a refreshable cache and capability diagnostics. Use `bunx oh-my-openagent refresh-model-capabilities` to update the cache, or configure `model_capabilities.auto_refresh_on_start` to refresh at startup.

To see which models your agents will actually use, run `bunx oh-my-openagent doctor --verbose`. This shows effective model resolution based on your current authentication and config.

```
Agent Request → User Override (if configured) → Fallback Chain → System Default
```

### File-Based Prompts

You can load agent system prompts from external files using `file://` URLs in the `prompt` field, or append additional content with `prompt_append`. The `prompt_append` field also works on categories.

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt": "file:///path/to/custom-prompt.md",
    },
    "oracle": {
      "prompt_append": "file:///path/to/additional-context.md",
    },
  },
  "categories": {
    "deep": {
      "prompt_append": "file:///path/to/deep-category-append.md",
    },
  },
}
```

The file content is loaded at runtime and injected into the agent's system prompt. Supports `~` expansion for home directory and relative `file://` paths.

---

## See Also

- [Installation Guide](./installation.md) — Setup and authentication
- [Orchestration System Guide](./orchestration.md) — How agents dispatch tasks to categories
- [Configuration Reference](../reference/configuration.md) — Full config options
- [`packages/omo-opencode/src/shared/model-requirements.ts`](../../packages/omo-opencode/src/shared/model-requirements.ts) — Source of truth for fallback chains
