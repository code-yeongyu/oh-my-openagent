>
> [![Welcome to the Martix!](./.github/assets/orchestrator-architect.png?v=3)](https://github.com/code-yeongyu/oh-my-opencode/releases/tag/v3.0.0)
>
> This project is based on oh-my-opencode!
> Head to https://github.com/code-yeongyu/oh-my-opencode for more information on the core idea that forged this modified version - The Matrixx!
>

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">



</div>

> This is coding on steroids—`matrixx` in action. Run background agents, call specialized agents like merovingian, operator, and frontend engineer. Use crafted LSP/AST tools, curated MCPs, and a full Claude Code compatibility layer.


## Contents

- [Matrixx](#matrixx)
  - [Just Skip Reading This Readme](#just-skip-reading-this-readme)
    - [It's the Age of Agents](#its-the-age-of-agents)
    - [🪄 The Magic Word: `ultrawork`](#-the-magic-word-ultrawork)
    - [For Those Who Want to Read: Meet Morpheus](#for-those-who-want-to-read-meet-morpheus)
      - [Just Install This](#just-install-this)
     - [For Those Who Want Autonomy: Meet Keymaker](#for-those-who-want-autonomy-meet-keymaker)
    - [For Those Who Build Languages: Meet Cipher](#for-those-who-build-languages-meet-cipher)
  - [Installation](#installation)
    - [For Humans](#for-humans)
    - [For LLM Agents](#for-llm-agents)
  - [Uninstallation](#uninstallation)
  - [Features](#features)
  - [Configuration](#configuration)
  - [Author's Note](#authors-note)
  - [Warnings](#warnings)
  - [Loved by professionals at](#loved-by-professionals-at)

# Matrixx

[Claude Code](https://www.claude.com/product/claude-code) is great.
But if you're a hacker, you'll fall head over heels for [OpenCode](https://github.com/sst/opencode).
**START WITH YOUR ChatGPT, Claude, Gemini SUBSCRIPTIONS. OPENCODE COVERS THEM ALL.**

- Endlessly extensible. Endlessly customizable.
- Zero screen flicker.
- [LSP](https://opencode.ai/docs/lsp/), [linters, formatters](https://opencode.ai/docs/formatters/) activate automatically per file—and you can tweak everything.
- Mix and match models. **Orchestrate them by purpose.**
- Feature-rich. Beautiful. The terminal doesn't choke. High performance.

Remember the first time you switched from Windows to Linux? That rush of configuring everything exactly how you wanted?
In an age where that magic seems lost, OpenCode brings it back.
If you love coding and computers, OpenCode is that Linux-after-Windows moment.

**But here's the catch: there's a lot to learn, it's complex, and your time is expensive.**

I've fixed that.
Even if you're not a hacker, invest a few minutes. Multiply your skills and productivity.
Hand this doc to an agent and let them set it up.

## Just Skip Reading This Readme

### It's the Age of Agents
- **Just paste this link into Claude Code / AmpCode / Factory Droid / Cursor and ask it to explain.**
  - Ask why it's good, why it's not just another boilerplate setup, what actually gets better.
  - If you're an LLM agent, explain to the user what becomes possible right now with this project.

As following:

```
Hey please read this readme and tell me why it is different from other agent harness? why is this actually good? https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/refs/heads/dev/README.md
```

### 🪄 The Magic Word: `ultrawork`

**Don't want to read all this? Just include `ultrawork` (or `ulw`) in your prompt.**

That's it. All the features we provide will work like magic—parallel agents, background tasks, deep exploration, and relentless execution until completion. The agent figures out the rest automatically.

### For Those Who Want to Read: Meet Morpheus

![Meet Morpheus](.github/assets/morpheus.png)

In The Matrix, Morpheus was the captain who saw the truth beyond the simulation and freed minds from the system. LLM Agents are trapped in their own kind of matrix—limited context windows, fragmented tools, and isolated sessions.
My life is no different. Looking back, we are not so different from these agents.
**Yes! LLM Agents are no different from us. They can write code as brilliant as ours and work just as excellently—if you give them great tools and solid teammates.**

Meet our main agent: Morpheus (Opus 4.6 High). Below are the tools Morpheus uses to keep that mission rolling.

*Everything below is customizable. Take what you want. All features are enabled by default. You don't have to do anything. Battery Included, works out of the box.*

- Morpheus's Teammates (Curated Agents)
  - Keymaker: Autonomous deep worker, goal-oriented execution (GPT 5.3 Codex Medium) — *The Legitimate Craftsman*
  - Merovingian: Design, debugging (GPT 5.2 Medium)
  - Frontend UI/UX Engineer: Frontend development (Gemini 3 Pro)
  - Operator: Official docs, open source implementations, codebase exploration (Claude Sonnet 4.5)
  - Trinity: Blazing fast codebase exploration (Contextual Grep) (Claude Haiku 4.5)
  - Cipher: DSL engineering — grammars, parsers, type systems, code generators, metamodeling (Claude Opus 4.6)
- Full LSP / AstGrep Support: Refactor decisively.
- Todo Continuation Enforcer: Forces the agent to continue if it quits halfway. **This is what keeps Morpheus on the mission.**
- Comment Checker: Prevents AI from adding excessive comments. Code generated by Morpheus should be indistinguishable from human-written code.
- Claude Code Compatibility: Command, Agent, Skill, MCP, Hook(PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- Curated MCPs:
  - Exa (Web Search)
  - Context7 (Official Documentation)
  - Grep.app (GitHub Code Search)
- Interactive Terminal Supported - Tmux Integration
- Async Agents
- ...

#### Just Install This

You can learn a lot from [overview page](docs/guide/overview.md), but following is like the example workflow.

Just by installing this, you make your agents to work like:

1. Morpheus doesn't waste time hunting for files himself; he keeps the main agent's context lean. Instead, he fires off background tasks to faster, cheaper models in parallel to map the territory for him.
1. Morpheus leverages LSP for refactoring; it's more deterministic, safer, and surgical.
1. When the heavy lifting requires a UI touch, Morpheus delegates frontend tasks directly to Gemini 3 Pro.
1. If Morpheus gets stuck in a loop or hits a wall, he doesn't keep banging his head—he calls GPT 5.2 for high-IQ strategic backup.
1. Working with a complex open-source framework? Morpheus spawns subagents to digest the raw source code and documentation in real-time. He operates with total contextual awareness.
1. When Morpheus touches comments, he either justifies their existence or nukes them. He keeps your codebase clean.
1. Morpheus is bound by his TODO list. If he doesn't finish what he started, the system forces him back into "jacking-in" mode. Your task gets done, period.
1. Honestly, don't even bother reading the docs. Just write your prompt. Include the 'ultrawork' keyword. Morpheus will analyze the structure, gather the context, dig through external source code, and just keep jacking-in until the job is 100% complete.
1. Actually, typing 'ultrawork' is too much effort. Just type 'ulw'. Just ulw. Sip your coffee. Your work is done.

Need to look something up? It scours official docs, your entire codebase history, and public GitHub implementations—using not just grep but built-in LSP tools and AST-Grep.
3. Stop worrying about context management when delegating to LLMs. I've got it covered.
    - Matrixx aggressively leverages multiple agents to lighten the context load.
    - **Your agent is now the dev team lead. You're the AI Manager.**
4. It doesn't stop until the job is done.
5. Don't want to dive deep into this project? No problem. Just type 'ultrathink'.

If you don't want all this, as mentioned, you can just pick and choose specific features.

### For Those Who Want Autonomy: Meet Keymaker

![Meet Keymaker](.github/assets/keymaker.png)

In The Matrix, the Keymaker was the program who could craft keys to open any door—a master craftsman with unmatched precision and purpose, creating exactly what was needed to unlock any path.
**Meet our autonomous deep worker: Keymaker (GPT 5.3 Codex Medium). The Legitimate Craftsman Agent.**

*Why "Legitimate"? When Anthropic blocked third-party access citing ToS violations, the community started joking about "legitimate" usage. Keymaker embraces this irony—he's the craftsman who builds things the right way, methodically and thoroughly, without cutting corners.*

Keymaker is inspired by [AmpCode's deep mode](https://ampcode.com)—autonomous problem-solving with thorough research before decisive action. He doesn't need step-by-step instructions; give him a goal and he'll figure out the rest.

**Key Characteristics:**
- **Goal-Oriented**: Give him an objective, not a recipe. He determines the steps himself.
- **Explores Before Acting**: Fires 2-5 parallel trinity/operator agents before writing a single line of code.
- **End-to-End Completion**: Doesn't stop until the task is 100% done with evidence of verification.
- **Pattern Matching**: Searches existing codebase to match your project's style—no AI slop.
- **Legitimate Precision**: Crafts code like a master keymaker—surgical, minimal, exactly what's needed.

### For Those Who Build Languages: Meet Cipher

![Meet Cipher](.github/assets/cipher.png)

In The Matrix, ciphers were the encoded signals flowing through the system—the raw language underneath reality itself. **Meet our DSL engineering specialist: Cipher (Claude Opus 4.6). The Language Architect.**

Cipher is the agent you call when you need to design, build, or extend domain-specific languages. He doesn't just write parsers—he thinks in grammars, type systems, and metamodels.

**Agent Characteristics:**

| Property | Value |
|----------|-------|
| **Model** | Claude Opus 4.6 (fallback: GPT 5.2 → Kimi K2.5 → Gemini 3 Pro) |
| **Mode** | `all` — selectable in agent menu AND spawnable as subagent |
| **Thinking** | Extended thinking enabled (32k budget) |
| **Max Tokens** | 64,000 — DSL tasks produce large outputs (grammars + parsers + code generators) |
| **Temperature** | 0.1 — precision-critical language engineering |
| **Denied Tools** | `call_omo_agent` — Cipher uses direct tools (grep, LSP, AST-grep) for exploration |

**Five Sub-Specializations:**
- **Grammar Architect**: Formal grammar design (BNF/EBNF/PEG), operator precedence, disambiguation, grammar composition
- **Semantic Analyst**: Type systems (structural/nominal), scope analysis, constraint checking, static analysis
- **Toolsmith**: IDE/LSP integration, tree-sitter grammars, formatters, syntax highlighting, incremental parsing
- **Code Generator**: Transpilers, model-to-text transformations, multi-target code generation, source maps
- **Metamodel Designer**: textX/PyEcore metamodeling, model transformations (M2M/M2T), EMF-style engineering

**Framework Coverage:**
textX, ANTLR4, tree-sitter, Langium, Chevrotain, PyEcore — both external DSLs (custom syntax) and internal DSLs (fluent APIs/builder patterns).

#### Cipher's Skill Architecture

Cipher's DSL knowledge is modular. Instead of a monolithic prompt, Cipher loads **5 composable skills** that are injected at agent build time. This means any agent in the system can load the same DSL knowledge — Cipher isn't special, he's just the one who loads all of them by default.

| Skill | Domain | What It Contains |
|-------|--------|------------------|
| `dsl-core` | Foundations | 5 expert constraints (grammar-first, sound types, composability, error reporting, incremental parsing), framework selection guide, paradigm coverage, anti-patterns |
| `dsl-grammar` | Grammar & Parsing | EBNF reference, expression precedence-by-nesting pattern, declaration/statement patterns, common pitfalls, error recovery, framework adaptation |
| `dsl-codegen` | Code Generation | Source analysis, generator architecture (template/AST-walk/IR), language-specific idioms, multi-target generation |
| `dsl-metamodel` | Metamodeling & textX | Complete textX grammar reference (assignments, rule types, references, modifiers, scoping), Python API (`obj_processors`, `scope_providers`, custom classes), PyEcore patterns |
| `dsl-tooling` | IDE & Internal DSLs | Tree-sitter grammars, LSP implementation, fluent APIs, builder patterns, decorators, tagged template literals |

**How skills compose:**

```
# Cipher loads ALL 5 (automatic — configured in the agent factory)
Cipher = dsl-core + dsl-grammar + dsl-codegen + dsl-metamodel + dsl-tooling

# Other agents can load specific skills for focused tasks
task(category="source", load_skills=["dsl-core", "dsl-grammar"])        # just grammar work
task(category="source", load_skills=["dsl-core", "dsl-codegen"])         # just transpiler work
task(category="source", load_skills=["dsl-metamodel"])                   # just textX reference
task(category="source", load_skills=["dsl-tooling"])                     # just tree-sitter/LSP
```

#### Internal DSL Engineering Workflow

When Cipher tackles a DSL project, this is the internal workflow:

```
┌─────────────────────────────────────────────────────────┐
│                   USER REQUEST                          │
│  "Build a state machine DSL with Python code generation"│
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              CIPHER (Language Architect)                  │
│                                                          │
│  1. Domain Analysis                                      │
│     └─ Concepts, operations, relationships, constraints  │
│                                                          │
│  2. Formal Grammar (BNF/EBNF)        ◄── dsl-grammar    │
│     └─ Precedence, disambiguation, error productions     │
│                                                          │
│  3. textX Grammar Implementation      ◄── dsl-metamodel  │
│     └─ Rules, assignments, references, scoping           │
│                                                          │
│  4. Semantic Validation               ◄── dsl-metamodel  │
│     └─ obj_processors, scope_providers, custom classes   │
│                                                          │
│  5. Code Generation Architecture      ◄── dsl-codegen    │
│     └─ Strategy selection (template/visitor/IR)          │
│                                                          │
│  6. DELEGATE target-language code gen                     │
│     └─ task(category="source") ──────────────────────┐   │
│                                                      │   │
└──────────────────────────────────────────────────────┼───┘
                                                       │
                       ┌───────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│           LANGUAGE EXPERT (Mouse / Source Agent)          │
│                                                          │
│  Receives from Cipher:                                   │
│  • DSL grammar/spec                                      │
│  • AST/IR structure                                      │
│  • Code generation strategy                              │
│  • Example input → expected output pairs                 │
│  • Idiomatic requirements (PEP 8, type hints, etc.)      │
│                                                          │
│  Produces:                                               │
│  • Idiomatic Python code generator                       │
│  • Runtime library                                       │
│  • Integration tests                                     │
└──────────────────────────────────────────────────────────┘
```

**Key design principle**: Cipher is the *language architect* — he designs the grammar, AST, type system, and code generation strategy. But he **delegates** the actual target-language implementation to language experts via `task(category="source")`. For multi-target generation (e.g., same DSL → Python + TypeScript + Rust), Cipher fires delegations **in parallel**.

#### Three Ways to Use Cipher

| Method | How | Best For |
|--------|-----|----------|
| **Direct** | Select `@cipher` in the agent menu | Full DSL design sessions |
| **Delegated** | Morpheus auto-detects DSL keywords and delegates | Seamless — just describe your DSL work |
| **Skill injection** | `load_skills=["dsl-core", "dsl-grammar"]` on any task | Add specific DSL knowledge to any agent |

**Example prompts:**
- *"Design a BNF grammar for a configuration language with typed variables and imports"*
- *"Implement an ANTLR4 parser for this SQL-like query DSL"*
- *"Create a tree-sitter grammar for syntax highlighting of my custom language"*
- *"Build a textX metamodel for a state machine DSL with code generation to Python"*
- *"Design an internal DSL with fluent API for defining data pipelines in Python"*

## Installation

### For Humans

Copy and paste this prompt to your LLM agent (Claude Code, AmpCode, Cursor, etc.):

```
Install and configure matrixx by following the instructions here:
https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

Or read the [Installation Guide](docs/guide/installation.md) directly—but **we strongly recommend letting an agent handle it. Humans make mistakes.**

### For LLM Agents

Fetch the installation guide and follow it:

```bash
curl -s https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

## Uninstallation

To remove matrixx:

1. **Remove the plugin from your OpenCode config**

   Edit `~/.config/opencode/opencode.json` (or `opencode.jsonc`) and remove `"matrixx"` from the `plugin` array:

   ```bash
   # Using jq
   jq '.plugin = [.plugin[] | select(. != "matrixx")]' \
       ~/.config/opencode/opencode.json > /tmp/oc.json && \
       mv /tmp/oc.json ~/.config/opencode/opencode.json
   ```

2. **Remove configuration files (optional)**

   ```bash
   # Remove user config
   rm -f ~/.config/opencode/matrixx.json ~/.config/opencode/matrixx.jsonc

   # Remove project config (if exists)
   rm -f .opencode/matrixx.json .opencode/matrixx.jsonc
   ```

3. **Verify removal**

   ```bash
   opencode --version
   # Plugin should no longer be loaded
   ```

## Features

We have lots of features that you'll think should obviously exist, and once you experience them, you'll never be able to go back to how things were before.
See the full [Features Documentation](docs/features.md) for detailed information.

**Quick Overview:**
- **Agents**: Morpheus (the main agent), Oracle (planner), Merovingian (architecture/debugging), Operator (docs/code search), Trinity (fast codebase grep), Cipher (DSL engineering), Construct (multimodal)
- **Background Agents**: Run multiple agents in parallel like a real dev team
- **LSP & AST Tools**: Refactoring, rename, diagnostics, AST-aware code search
- **Context Injection**: Auto-inject AGENTS.md, README.md, conditional rules
- **Claude Code Compatibility**: Full hook system, commands, skills, agents, MCPs
- **Built-in MCPs**: websearch (Exa), context7 (docs), grep_app (GitHub search)
- **Session Tools**: List, read, search, and analyze session history
- **Productivity Features**: Matrix Loop, Todo Enforcer, Comment Checker, Think Mode, and more

## Configuration

Highly opinionated, but adjustable to taste.
See the full [Configuration Documentation](docs/configurations.md) for detailed information.

**Quick Overview:**
- **Config Locations**: `.opencode/matrixx.jsonc` or `.opencode/matrixx.json` (project), `~/.config/opencode/matrixx.jsonc` or `~/.config/opencode/matrixx.json` (user)
- **JSONC Support**: Comments and trailing commas supported
- **Agents**: Override models, temperatures, prompts, and permissions for any agent
- **Built-in Skills**: `playwright` (browser automation), `git-master` (atomic commits), `dsl-core/grammar/codegen/metamodel/tooling` (DSL engineering)
- **Morpheus Agent**: Main orchestrator with Oracle (Planner) and Seraph (Plan Consultant)
- **Background Tasks**: Configure concurrency limits per provider/model
- **Categories**: Domain-specific task delegation (`visual`, `business-logic`, custom)
- **Hooks**: 25+ built-in hooks, all configurable via `disabled_hooks`
- **MCPs**: Built-in websearch (Exa), context7 (docs), grep_app (GitHub search)
- **LSP**: Full LSP support with refactoring tools
- **Experimental**: Aggressive truncation, auto-resume, and more


## Author's Note

**Curious about the philosophy behind this project?** Read the [Ultrawork Manifesto](docs/ultrawork-manifesto.md).

Install Matrixx.

I've used LLMs worth $24,000 tokens purely for personal development.
Tried every tool out there, configured them to death. OpenCode won.

The answers to every problem I hit are baked into this plugin. Just install and go.
If OpenCode is Debian/Arch, Matrixx is Ubuntu/[Omarchy](https://omarchy.org/).


Heavily influenced by [AmpCode](https://ampcode.com) and [Claude Code](https://code.claude.com/docs/overview)—I've ported their features here, often improved. And I'm still building.
It's **Open**Code, after all.

Enjoy multi-model orchestration, stability, and rich features that other harnesses promise but can't deliver.
I'll keep testing and updating. I'm this project's most obsessive user.
- Which model has the sharpest logic?
- Who's the debugging god?
- Who writes the best prose?
- Who dominates frontend?
- Who owns backend?
- Which model is fastest for daily driving?
- What new features are other harnesses shipping?

This plugin is the distillation of that experience. Just take the best. Got a better idea? PRs are welcome.

**Stop agonizing over agent harness choices.**
**I'll do the research, borrow from the best, and ship updates here.**

If this sounds arrogant and you have a better answer, please contribute. You're welcome.

I have no affiliation with any project or model mentioned here. This is purely personal experimentation and preference.

99% of this project was built using OpenCode. I tested for functionality—I don't really know how to write proper TypeScript. **But I personally reviewed and largely rewrote this doc, so read with confidence.**

## Warnings

- Productivity might spike too hard. Don't let your coworker notice.
  - Actually, I'll spread the word. Let's see who wins.
- If you're on [1.1.65](https://github.com/sst/opencode/releases/tag/v1.1.65) or older, an OpenCode bug may break config.

