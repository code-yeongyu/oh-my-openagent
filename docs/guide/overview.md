# What Is Oh My OpenCode?

Oh My OpenCode is a multi-model agent orchestration harness for OpenCode. It transforms a single AI agent into a coordinated development team that actually ships code.

Not locked to Claude. Not locked to OpenAI. Not locked to anyone.

Just better results, cheaper models, real orchestration.

---

## The Old Framing Is Dead

We used to call this "Claude Code on steroids." That was wrong.

This isn't about making Claude Code better. It's about breaking free from the idea that one model, one provider, one way of working is enough. Anthropic wants you locked in. OpenAI wants you locked in. Everyone wants you locked in.

Oh My OpenCode doesn't play that game. It orchestrates across models, picking the right brain for the right job. Claude for orchestration. GPT for deep reasoning. Gemini for frontend. Haiku for quick tasks. All working together, automatically.

---

## Meet the Agents

### Sisyphus: The Discipline Agent

Named after the Greek myth. He rolls the boulder every day. Never stops. Never gives up.

Sisyphus is your main orchestrator. He plans, delegates to specialists, and drives tasks to completion with aggressive parallel execution. He doesn't stop halfway. He doesn't get distracted. He finishes.

**Recommended models:**
- **Claude Opus 4.6** - Best overall experience. Sisyphus was built with Claude-optimized prompts.
- **Claude Sonnet 4.6** - Good balance of capability and cost.
- **Kimi K2.5** - Great Claude-like alternative. Many users run this combo exclusively.
- **GLM 5** - Solid option, especially via Z.ai.

Sisyphus has Claude-optimized prompts. No GPT prompt exists for Sisyphus. Claude-family models work best because that's what the prompts were engineered for.

### Hephaestus: The Legitimate Craftsman

Named with intentional irony. Anthropic blocked OpenCode from using their API because of this project. So the team built an autonomous GPT-native agent instead.

Hephaestus runs on GPT-5.3 Codex. Give him a goal, not a recipe. He explores the codebase, researches patterns, and executes end-to-end without hand-holding. He is the legitimate craftsman because he was born from necessity, not privilege.

Use Hephaestus when you need deep architectural reasoning, complex debugging across many files, or cross-domain knowledge synthesis. Switch to him explicitly when the work demands GPT-5.3 Codex's particular strengths.

**Why this beats vanilla Codex CLI:**

 **Multi-model orchestration.** Pure Codex is single-model. OmO routes different tasks to different models automatically. GPT for deep reasoning. Gemini for frontend. Haiku for speed. The right brain for the right job.
 **Background agents.** Fire 5+ agents in parallel. Something Codex simply cannot do. While one agent writes code, another researches patterns, another checks documentation. Like a real dev team.
 **Category system.** Tasks are routed by intent, not model name. `visual-engineering` gets Gemini. `ultrabrain` gets GPT-5.3 Codex. `quick` gets Haiku. No manual juggling.
 **Accumulated wisdom.** Subagents learn from previous results. Conventions discovered in task 1 are passed to task 5. Mistakes made early aren't repeated. The system gets smarter as it works.

---

## Better Than Pure Claude Code

Claude Code is good. But it's a single agent running a single model doing everything alone.

Oh My OpenCode turns that into a coordinated team:

 **Parallel execution.** Claude Code processes one thing at a time. OmO fires background agents in parallel — research, implementation, and verification happening simultaneously. Like having 5 engineers instead of 1.
 **Hash-anchored edits.** Claude Code's edit tool fails when the model can't reproduce lines exactly. OmO's `LINE#ID` content hashing validates every edit before applying. Grok Code Fast 1 went from 6.7% to 68.3% success rate just from this change.
 **Intent Gate.** Claude Code takes your prompt and runs. OmO classifies your true intent first — research, implementation, investigation, fix — then routes accordingly. Fewer misinterpretations, better results.
 **LSP + AST tools.** Workspace-level rename, go-to-definition, find-references, pre-build diagnostics, AST-aware code rewrites. IDE precision that vanilla Claude Code doesn't have.
 **Skills with embedded MCPs.** Each skill brings its own MCP servers, scoped to the task. Context window stays clean instead of bloating with every tool.
 **Discipline enforcement.** Todo enforcer yanks idle agents back to work. Comment checker strips AI slop. Ralph Loop keeps going until 100% done. The system doesn't let the agent slack off.

**The fundamental advantage.** Models have different temperaments. Claude thinks deeply. GPT reasons architecturally. Gemini visualizes. Haiku moves fast. Single-model tools force you to pick one personality for all tasks. Oh My OpenCode leverages them all, routing by task type. This isn't a temporary hack — it's the only architecture that makes sense as models specialize further. The gap between multi-model orchestration and single-model limitation widens every month. We're betting on that future.

---

## The Intent Gate

Before acting on any request, Sisyphus classifies your true intent.

Are you asking for research? Implementation? Investigation? A fix? The Intent Gate figures out what you actually want, not just the literal words you typed. This means the agent understands context, nuance, and the real goal behind your request.

Claude Code doesn't have this. It takes your prompt and runs. Oh My OpenCode thinks first, then acts.

---

## Two Ways to Work

### Ultrawork Mode: For the Lazy

Type `ultrawork` or just `ulw`. That's it.

The agent figures everything out. Explores your codebase. Researches patterns. Implements the feature. Verifies with diagnostics. Keeps working until done.

This is the "just do it" mode. Full automatic. You don't have to think deep because the agent thinks deep for you.

### Prometheus Mode: For the Precise

Press **Tab** to enter Prometheus mode.

Prometheus interviews you like a real engineer. Asks clarifying questions. Identifies scope and ambiguities. Builds a detailed plan before a single line of code is touched.

Then run `/start-work` and Atlas takes over. Tasks are distributed to specialized subagents. Each completion is verified independently. Learnings accumulate across tasks. Progress tracks across sessions.

Use Prometheus for multi-day projects, critical production changes, complex refactoring, or when you want a documented decision trail.

---

## Model Configuration

Models are auto-configured at install time. The interactive installer asks which providers you have, then generates optimal model assignments for each agent and category.

At runtime, fallback chains ensure work continues even if your preferred provider is down. Each agent has a provider priority chain. The system tries providers in order until it finds an available model.

You can override specific agents or categories in your config, but you don't have to. The defaults work. The fallbacks work. Everything just works.

See the [Installation Guide](./installation.md) for details on initial setup and provider configuration.

---

## Next Steps

- [Orchestration Guide](./orchestration.md) - Deep dive into agent collaboration
- [Features Reference](../reference/features.md) - Complete feature documentation
- [Configuration Reference](../reference/configuration.md) - Customize everything
- [Manifesto](../manifesto.md) - Philosophy behind the project
