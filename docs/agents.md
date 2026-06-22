# Matrixx Agents — Deep Dive

Matrixx orchestrates a team of specialized AI agents, each with distinct expertise, optimized models, and tool permissions. This page covers the primary agents you'll interact with directly. For the full architecture diagram, see [Agent Architecture](agent-architecture.md). For the complete agent table with models and fallback chains, see [Features](features.md).

---

## Morpheus — The Orchestrator

![Meet Morpheus](../.github/assets/morpheus.png)

In The Matrix, Morpheus was the captain who saw the truth beyond the simulation and freed minds from the system. LLM Agents are trapped in their own kind of matrix — limited context windows, fragmented tools, and isolated sessions.

**Yes! LLM Agents are no different from us. They can write code as brilliant as ours and work just as excellently — if you give them great tools and solid teammates.**

Meet the main agent: **Morpheus** (Claude Opus 4.6). Everything below is customizable. All features are enabled by default. Battery included, works out of the box.

### What Morpheus Does

1. **Delegates, doesn't grind** — fires off background tasks to faster, cheaper models in parallel to map the territory. Keeps the main context lean.
2. **Surgical refactoring** — leverages LSP for deterministic, safe, surgical code changes.
3. **Specialist delegation** — UI work goes to Gemini 3 Pro. Debugging goes to GPT 5.2. The right model for the right job.
4. **Contextual awareness** — spawns subagents to digest source code and documentation in real-time when working with unfamiliar frameworks.
5. **Clean code enforcement** — either justifies a comment's existence or nukes it. Code should be indistinguishable from human-written.
6. **Relentless execution** — bound by the TODO list. If he doesn't finish, the system forces him back. Your task gets done, period.
7. **One keyword** — type `ultrawork` (or just `ulw`). Morpheus analyzes, gathers context, digs through external source code, and keeps going until the job is 100% complete.

### Morpheus's Teammates

| Agent | Role | Model |
|-------|------|-------|
| **Keymaker** | Autonomous deep worker | GPT 5.3 Codex |
| **Merovingian** | Architecture & debugging | GPT 5.2 |
| **Operator** | Docs, OSS search, codebase exploration | GLM 4.7 |
| **Trinity** | Fast codebase grep | Grok Code Fast |
| **Cipher** | DSL engineering | Claude Opus 4.6 |
| **Niobe** | Research, grants, technical leadership | Claude Opus 4.6 |
| **Construct** | PDF/image analysis | Kimi K2.5 (free) |
| **Oracle** | Strategic planning | Claude Opus 4.6 |
| **Seraph** | Pre-planning analysis | Claude Opus 4.6 |
| **Smith** | Plan validation | GPT 5.2 |
| **Architect** | Plan execution orchestrator | Claude Sonnet 4.5 |
| **Sati** | Frontend specialist (components, a11y, perf, testing) | Claude Sonnet 4.6 |

### Built-in Capabilities

- Full LSP / AST-Grep support
- Todo Continuation Enforcer — keeps the agent on mission
- Comment Checker — prevents AI comment slop
- Claude Code Compatibility — commands, agents, skills, MCPs, hooks
- Curated MCPs: Exa (web search), Context7 (official docs), Grep.app (GitHub code search)
- Interactive terminal via Tmux integration
- Async background agents

---

## Keymaker — The Legitimate Craftsman

![Meet Keymaker](../.github/assets/keymaker.png)

In The Matrix, the Keymaker could craft keys to open any door — a master craftsman with unmatched precision and purpose, creating exactly what was needed to unlock any path.

**Meet the autonomous deep worker: Keymaker (GPT 5.3 Codex). The Legitimate Craftsman Agent.**

*Why "Legitimate"? When Anthropic blocked third-party access citing ToS violations, the community started joking about "legitimate" usage. Keymaker embraces this irony — he's the craftsman who builds things the right way, methodically and thoroughly, without cutting corners.*

Keymaker is inspired by [AmpCode's deep mode](https://ampcode.com) — autonomous problem-solving with thorough research before decisive action. He doesn't need step-by-step instructions; give him a goal and he'll figure out the rest.

### Key Characteristics

- **Goal-Oriented**: Give him an objective, not a recipe. He determines the steps himself.
- **Explores Before Acting**: Fires 2-5 parallel Trinity/Operator agents before writing a single line of code.
- **End-to-End Completion**: Doesn't stop until the task is 100% done with evidence of verification.
- **Pattern Matching**: Searches existing codebase to match your project's style — no AI slop.
- **Legitimate Precision**: Crafts code like a master keymaker — surgical, minimal, exactly what's needed.

---

## Cipher — The Language Architect

![Meet Cipher](../.github/assets/cipher.png)

In The Matrix, ciphers were the encoded signals flowing through the system — the raw language underneath reality itself. **Meet the DSL engineering specialist: Cipher (Claude Opus 4.6). The Language Architect.**

Cipher is the agent you call when you need to design, build, or extend domain-specific languages. He doesn't just write parsers — he thinks in grammars, type systems, and metamodels.

### Agent Characteristics

| Property | Value |
|----------|-------|
| **Model** | Claude Opus 4.6 (fallback: GPT 5.2 → Kimi K2.5 → Gemini 3.1 Pro) |
| **Mode** | `all` — selectable in agent menu AND spawnable as subagent |
| **Thinking** | Extended thinking enabled (32k budget) |
| **Max Tokens** | 64,000 — DSL tasks produce large outputs (grammars + parsers + code generators) |
| **Temperature** | 0.1 — precision-critical language engineering |
| **Denied Tools** | `delegate_agent` — Cipher uses direct tools (grep, LSP, AST-grep) for exploration |

### Five Sub-Specializations

- **Grammar Architect**: Formal grammar design (BNF/EBNF/PEG), operator precedence, disambiguation, grammar composition
- **Semantic Analyst**: Type systems (structural/nominal), scope analysis, constraint checking, static analysis
- **Toolsmith**: IDE/LSP integration, tree-sitter grammars, formatters, syntax highlighting, incremental parsing
- **Code Generator**: Transpilers, model-to-text transformations, multi-target code generation, source maps
- **Metamodel Designer**: textX/PyEcore metamodeling, model transformations (M2M/M2T), EMF-style engineering

### Framework Coverage

textX, ANTLR4, tree-sitter, Langium, Chevrotain, PyEcore — both external DSLs (custom syntax) and internal DSLs (fluent APIs/builder patterns).

### Cipher's Skill Architecture

Cipher's DSL knowledge is modular. Instead of a monolithic prompt, Cipher loads **11 composable skills** injected at agent build time. Any agent in the system can load the same DSL knowledge — Cipher isn't special, he's just the one who loads all of them by default.

| Skill | Domain | What It Contains |
|-------|--------|------------------|
| `dsl-core` | Foundations | 5 expert constraints (grammar-first, sound types, composability, error reporting, incremental parsing), framework selection guide, paradigm coverage, anti-patterns |
| `dsl-grammar` | Grammar & Parsing | EBNF reference, expression precedence-by-nesting pattern, declaration/statement patterns, common pitfalls, error recovery, framework adaptation |
| `dsl-codegen` | Code Generation | Source analysis, generator architecture (template/AST-walk/IR), language-specific idioms, multi-target generation |
| `dsl-metamodel` | Metamodeling & textX | Complete textX grammar reference (assignments, rule types, references, modifiers, scoping), Python API (`obj_processors`, `scope_providers`, custom classes), PyEcore patterns |
| `dsl-tooling` | IDE & Internal DSLs | Tree-sitter grammars, LSP implementation, fluent APIs, builder patterns, decorators, tagged template literals |
| `dsl-textx-ecosystem` | textX Ecosystem | Registration system (entry points, `textx_languages`/`textx_generators`), generator framework (`textx generate`, Jinja2), multi-file models (ModelRepository, FQNImportURI), language composition, visualization (dot/PlantUML), textX-LS |
| `dsl-pyecore-advanced` | PyEcore Advanced | Serialization (XMI/JSON, ResourceSet, URI), dynamic vs static metamodels (DynamicEPackage, pyecoregen), notifications (EObserver), @EMetaclass decorator, .ecore file loading, EMF interchange |
| `dsl-model-transformation` | M2M Transforms | Model-to-model transformation patterns (motra), in-place vs out-place, rule-based mapping, trace models, ATL-style patterns, M2T with Jinja2, protected regions |
| `dsl-testing` | DSL Testing | Grammar testing (pytest + textX), semantic validation testing (error assertions), code generator golden-file testing, property-based testing (Hypothesis), model roundtrip testing |
| `dsl-validation` | Advanced Validation | OCL-style constraint patterns, well-formedness rules, multiplicity/cardinality checks, referential integrity, cycle detection, validation framework pattern with severity levels |
| `dsl-composition` | Composition & Evolution | Language composition (multi-metamodel, grammar extension, referencing), DSL evolution (grammar versioning, backward compatibility), model migration, multiple concrete syntaxes |

**How skills compose:**

```
# Cipher loads ALL 11 (automatic — configured in the agent factory)
Cipher = dsl-core + dsl-grammar + dsl-codegen + dsl-metamodel + dsl-tooling
       + dsl-textx-ecosystem + dsl-pyecore-advanced + dsl-model-transformation
       + dsl-testing + dsl-validation + dsl-composition

# Other agents can load specific skills for focused tasks
task(category="source", load_skills=["dsl-core", "dsl-grammar"])                    # just grammar work
task(category="source", load_skills=["dsl-core", "dsl-codegen"])                     # just transpiler work
task(category="source", load_skills=["dsl-metamodel", "dsl-textx-ecosystem"])        # textX full stack
task(category="source", load_skills=["dsl-pyecore-advanced", "dsl-model-transformation"])  # PyEcore + M2M
task(category="source", load_skills=["dsl-testing", "dsl-validation"])               # testing + validation
task(category="source", load_skills=["dsl-composition"])                             # language composition
```

### Internal DSL Engineering Workflow

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

**Key design principle**: Cipher is the *language architect* — he designs the grammar, AST, type system, and code generation strategy. But he **delegates** the actual target-language implementation to language experts via `task(category="source")`. For multi-target generation (e.g., same DSL -> Python + TypeScript + Rust), Cipher fires delegations **in parallel**.

### Three Ways to Use Cipher

| Method | How | Best For |
|--------|-----|----------|
| **Direct** | Select `@cipher` in the agent menu | Full DSL design sessions |
| **Delegated** | Morpheus auto-detects DSL keywords and delegates | Seamless — just describe your DSL work |
| **Skill injection** | `load_skills=["dsl-core", "dsl-grammar"]` on any task | Add specific DSL knowledge to any agent |

### Example Prompts

- *"Design a BNF grammar for a configuration language with typed variables and imports"*
- *"Implement an ANTLR4 parser for this SQL-like query DSL"*
- *"Create a tree-sitter grammar for syntax highlighting of my custom language"*
- *"Build a textX metamodel for a state machine DSL with code generation to Python"*
- *"Design an internal DSL with fluent API for defining data pipelines in Python"*

See the [opencode-niobe](https://github.com/klpanagi/opencode-niobe) plugin for research & EU proposal capabilities.

## Sati — The Frontend Specialist

Sati is the dedicated frontend specialist. Self-contained execution — Sati handles UI/UX, components, accessibility, performance, and testing without delegating back to Morpheus.

### Agent Characteristics

- **Role**: Frontend specialist
- **Model**: Claude Sonnet 4.6 (fallback: Claude Opus 4.6 @ max)
- **Tool Restrictions**: Cannot use `task` or `delegate_agent` (self-contained execution)
- **Skills**: 8 frontend + browser skills (React/Next.js, Svelte/SvelteKit, a11y, perf, testing, state/data, build tooling, Playwright)
- **Mode**: `subagent` — explicitly invokable only

### Example Prompts

- *"Build a Next.js 15 dashboard with server components and a Prisma backend"*
- *"Audit this React app for WCAG 2.2 AA compliance and fix the violations"*
- *"Migrate this Vue 2 component to React 19 with hooks and Suspense"*
- *"Optimize this page's Core Web Vitals — LCP is 4.2s, target under 2.5s"*
- *"Write Storybook stories and Vitest tests for this component library"*

### Three Ways to Use Sati

| Method | How | Best For |
|--------|-----|----------|
| **Direct** | Select `@sati` in the agent menu | Full frontend sessions |
| **Delegated** | Morpheus auto-detects frontend keywords and delegates | Seamless — just describe your UI work |
| **Category** | Use `construct` category description hint | Routing to Sati for dedicated tasks |
