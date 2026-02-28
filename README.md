>
> [![Welcome to the Martix!](./.github/assets/orchestrator-architect.png?v=3)](https://github.com/code-yeongyu/oh-my-opencode/releases/tag/v3.0.0)
>
> This project is based on oh-my-opencode!
> Head to https://github.com/code-yeongyu/oh-my-opencode for more information on the core idea that forged this modified version - The Matrixx!
>

<div align="center">

<h1>Matrixx</h1>

**Multi-model agent orchestration for [OpenCode](https://github.com/sst/opencode).**<br/>
**11 specialized agents. 41 lifecycle hooks. 25+ tools. One plugin.**

*Use your existing ChatGPT, Claude, and Gemini subscriptions. OpenCode covers them all.*

</div>

---

> *This is coding on steroids. Run background agents, delegate to specialists, refactor with LSP precision, and search the entire open-source ecosystem — all from your terminal.*

---

## Why Matrixx?

[OpenCode](https://github.com/sst/opencode) is the most powerful open-source AI coding agent — endlessly extensible, zero screen flicker, mix-and-match models. But raw power needs direction.

Matrixx turns a single agent into a **coordinated team** — each model doing what it does best, in parallel, with full context awareness. No more one-model-does-everything. No more context window bloat. No more agents that quit halfway.

| Problem | Matrixx Solution |
|---------|------------------|
| One model does everything poorly | **11 specialists** — right model for the right job |
| Agent forgets what it was doing | **Todo Continuation** — forces completion, no exceptions |
| Slow sequential tool calls | **Parallel background agents** — 5+ running simultaneously |
| AI-generated code looks like AI | **Comment Checker** — code indistinguishable from human-written |
| Context window fills up fast | **Aggressive delegation** — subagents carry the load |
| Fragile refactoring | **LSP + AST-Grep** — deterministic, safe, surgical |

---

## The Magic Word

**Don't want to read docs? Just type `ultrawork` (or `ulw`) in your prompt.**

That's it. Parallel agents, background tasks, deep exploration, relentless execution until completion. The agent figures out the rest.

---

## The Agent Team

<table>
<tr>
<td width="50%">

### Morpheus — *The Orchestrator*
<img src=".github/assets/morpheus.png" width="120" align="right"/>

**Claude Opus 4.6** &middot; Primary agent

Plans, delegates, and executes. Fires background agents in parallel, leverages LSP for surgical refactoring, and never stops until the TODO list is empty.

</td>
<td width="50%">

### Keymaker — *The Craftsman*
<img src=".github/assets/keymaker.png" width="120" align="right"/>

**GPT 5.3 Codex** &middot; Autonomous deep worker

Give him a goal, not a recipe. Explores the codebase, matches your patterns, and delivers end-to-end. Inspired by [AmpCode's deep mode](https://ampcode.com).

</td>
</tr>
<tr>
<td>

### Cipher — *The Language Architect*
<img src=".github/assets/cipher.png" width="120" align="right"/>

**Claude Opus 4.6** &middot; DSL specialist

Grammars, parsers, type systems, code generators, metamodels. 11 composable skills covering textX, ANTLR4, tree-sitter, PyEcore, and more.

</td>
<td>

### Niobe — *The Research Navigator*
<img src=".github/assets/niobe.png" width="120" align="right"/>

**Claude Opus 4.6** &middot; Research & technical leadership

Academic papers, EU proposals, systematic reviews, project management, IP exploitation. 12 composable skills covering the full research lifecycle.

</td>
</tr>
</table>

| Agent | Role | Model |
|-------|------|-------|
| **Oracle** | Strategic planning with interview mode | Claude Opus 4.6 |
| **Merovingian** | Architecture decisions & debugging | GPT 5.2 |
| **Architect** | Plan execution orchestrator | Claude Sonnet 4.5 |
| **Seraph** | Pre-planning analysis | Claude Opus 4.6 |
| **Smith** | Plan validation & review | GPT 5.2 |
| **Operator** | Documentation & OSS search | GLM 4.7 |
| **Trinity** | Blazing fast codebase grep | Grok Code Fast |
| **Construct** | PDF, image & diagram analysis | Gemini 3 Flash |

Every agent, model, temperature, and permission is fully customizable. [**Meet the full team &rarr;**](docs/agents.md)

---

## Features at a Glance

| | |
|---|---|
| **Agent Orchestration** | 11 agents, parallel background execution, category-based routing, session continuity |
| **Developer Tools** | LSP (goto def, rename, diagnostics), AST-Grep (search & replace), Tmux terminal |
| **41 Lifecycle Hooks** | Context injection, think mode, comment checking, todo enforcement, error recovery |
| **27 Built-in Skills** | DSL engineering (11), research & leadership (12), browser, git, frontend |
| **Curated MCPs** | Exa (web search), Context7 (official docs), Grep.app (GitHub code search) |
| **Claude Code Compat** | Full compatibility — commands, agents, skills, MCPs, hooks from `settings.json` |

[**Full feature list &rarr;**](docs/features.md) &nbsp;&middot;&nbsp; [**Configuration guide &rarr;**](docs/configurations.md) &nbsp;&middot;&nbsp; [**Architecture diagram &rarr;**](docs/agent-architecture.md)

---

## Get Started

**For humans** — paste this into Claude Code, AmpCode, Cursor, or any LLM agent:

```
Install and configure matrixx by following the instructions here:
https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

**For LLM agents** — fetch and follow:

```bash
curl -s https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

We strongly recommend letting an agent handle installation. [Manual guide &rarr;](docs/guide/installation.md) &nbsp;&middot;&nbsp; [Uninstall &rarr;](docs/guide/uninstallation.md)

---

## Documentation

| | |
|---|---|
| [Overview](docs/guide/overview.md) | What Matrixx does, workflows, getting started |
| [Agents Deep Dive](docs/agents.md) | Full agent descriptions, skills, workflows, example prompts |
| [Architecture](docs/agent-architecture.md) | System diagrams, delegation flows, model routing |
| [Features](docs/features.md) | Complete feature reference |
| [Configuration](docs/configurations.md) | All config options, agent overrides, hooks, categories |
| [Orchestration](docs/orchestration-guide.md) | How agents coordinate, delegate, and recover |
| [Categories & Skills](docs/category-skill-guide.md) | Task categories, skill injection, delegation patterns |

---

**Curious about the philosophy?** Read the [Ultrawork Manifesto](docs/ultrawork-manifesto.md) from the creator of oh-my-opencode.

<sub>Productivity might spike too hard. Don't let your coworker notice. Actually — let's see who wins.</sub>
