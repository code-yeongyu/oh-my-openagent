>
> [![Welcome to the Matrix!](./.github/assets/orchestrator-architect.png?v=3)](https://github.com/klpanagi/matrixx)
>
> Matrixx is **highly inspired by** [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) — the project that pioneered the "oh-my-zsh for OpenCode" concept.
> Full credit to [code-yeongyu](https://github.com/code-yeongyu) for the original vision.
>

<div align="center">

<h1>Matrixx</h1>

[![npm](https://img.shields.io/npm/v/opencode-matrixx.svg)](https://www.npmjs.com/package/opencode-matrixx)

**Multi-model agent orchestration for [OpenCode](https://github.com/sst/opencode).**<br/>
**14 specialized agents. 41 lifecycle hooks. 25+ tools. One plugin.**

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
| One model does everything poorly | **14 specialists** — right model for the right job |
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

**Claude Sonnet 4.6** &middot; DSL specialist

Grammars, parsers, type systems, code generators, metamodels. 11 composable skills covering textX, ANTLR4, tree-sitter, PyEcore, and more.

</td>
<td>

### Niobe — *The Research Navigator*
<img src=".github/assets/niobe.png" width="120" align="right"/>

**Claude Sonnet 4.6** &middot; Research & technical leadership

Academic papers, EU proposals, systematic reviews, project management, IP exploitation. 12 composable skills covering the full research lifecycle.

</td>
</tr>
<tr>
<td colspan="2">

### Sentinel — *The Security Auditor*
<img src=".github/assets/sentinel.png" width="120" align="right"/>

**Claude Sonnet 4.6** &middot; Read-only security specialist

Scans for vulnerabilities but never touches code. OWASP Top 10, SAST, DAST, dependency CVEs, secret detection, crypto audit, infrastructure hardening. 9 composable skills any agent can load.

</td>
</tr>
<tr>
<td colspan="2">

### Zion — *The Crypto Specialist*
<img src=".github/assets/zion.png" width="120" align="right"/>

**Claude Sonnet 4.6** &middot; Crypto market analyst & trader

Technical analysis (RSI, MACD, Bollinger Bands, market structure, Fibonacci), on-chain analytics (MVRV, SOPR, exchange flows, whale tracking), DeFi protocol research, tokenomics modeling, and trading strategy with defined risk management. 3 composable skills covering the full crypto analysis stack.

</td>
</tr>
</table>

| Agent | Role | Model |
|-------|------|-------|
| **Oracle** | Strategic planning with interview mode | Claude Opus 4.6 |
| **Merovingian** | Architecture decisions & debugging | GPT 5.2 |
| **Architect** | Plan execution orchestrator | Claude Sonnet 4.6 |
| **Seraph** | Pre-planning analysis | Claude Opus 4.6 |
| **Smith** | Plan validation & review | GPT 5.2 |
| **Operator** | Documentation & OSS search | GLM 4.7 |
| **Trinity** | Blazing fast codebase grep | Grok Code Fast |
| **Construct** | PDF, image & diagram analysis | Gemini 3 Flash |
| **Zion** | Crypto market analysis, trading & DeFi | Claude Sonnet 4.6 |

Every agent, model, temperature, and permission is fully customizable. [**Meet the full team &rarr;**](docs/agents.md)

---

## Features at a Glance

| | |
|---|---|
| **Agent Orchestration** | 14 agents, parallel background execution, category-based routing, session continuity |
| **Developer Tools** | LSP (goto def, rename, diagnostics), AST-Grep (search & replace), Tmux terminal |
| **41 Lifecycle Hooks** | Context injection, think mode, comment checking, todo enforcement, error recovery |
| **39 Built-in Skills** | DSL engineering (11), research & leadership (12), security (9), crypto (3), browser, git, frontend |
| **Curated MCPs** | Exa (web search), Context7 (official docs), Grep.app (GitHub code search), Document Reader (office docs) |
| **Claude Code Compat** | Full compatibility — commands, agents, skills, MCPs, hooks from `settings.json` |

[**Full feature list &rarr;**](docs/features.md) &nbsp;&middot;&nbsp; [**Configuration guide &rarr;**](docs/configurations.md) &nbsp;&middot;&nbsp; [**Architecture diagram &rarr;**](docs/agent-architecture.md)

---

## Security

Matrixx includes a three-tier security layer: reactive hooks, configurable policies, and a dedicated security auditing agent.

### Enforcement Hooks

Built-in hooks protect against accidental secret exposure — no setup required.

| Hook | What it does |
|------|-------------|
| **Secret Leak Guard** | Intercepts `git commit` and `git push`, runs [gitleaks](https://github.com/gitleaks/gitleaks) on staged changes, and **blocks the operation** if secrets are detected. |
| **Env File Write Guard** | Blocks agents from writing to sensitive files (`.env`, `*.pem`, `*.key`, `credentials.json`, `id_rsa`, and 16 other patterns). |

Both hooks are **enabled by default** and run before all other hooks in the execution pipeline. Configure via `matrixx.json`:

```jsonc
{
  "security": {
    "secret_scanning": { "enabled": true, "block_on_detection": true },
    "env_file_guard": { "enabled": true, "allowed_paths": [".env.example"] }
  }
}
```

> **Note:** Secret scanning requires [gitleaks](https://github.com/gitleaks/gitleaks) installed in your PATH. Without it, the hook silently degrades.

### Sentinel — Security Auditing Agent

**Sentinel** is a read-only security specialist with 9 composable skills covering the full application security stack:

| Skill | Domain |
|-------|--------|
| `security-core` | OWASP Top 10, CWE classification, threat modeling (STRIDE) |
| `security-secrets` | Secret detection, credential scanning, pre-commit hooks |
| `security-sast` | Static analysis, code vulnerability patterns, taint tracking |
| `security-dast` | Dynamic analysis, runtime testing, fuzzing, penetration testing |
| `security-dependencies` | CVE scanning, SBOM generation, supply chain security |
| `security-api` | Authentication, authorization, CORS/CSRF, input validation |
| `security-crypto` | Encryption audit, key management, TLS, password hashing |
| `security-infra` | Container scanning, Dockerfile hardening, IaC audit, K8s security |
| `security-review` | Structured audit reports, severity classification, remediation guidance |

Sentinel never modifies code — it reports findings with CWE IDs, exact locations, and actionable remediation. Any agent can load individual security skills via `load_skills`.

---

## Get Started

### Install

```bash
npm install -g opencode-matrixx
```

### Via LLM agent

Paste this into Claude Code, AmpCode, Cursor, or any LLM agent:

```
Install and configure matrixx by following the instructions here:
https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

**For LLM agents** — fetch and follow directly:

```bash
curl -s https://raw.githubusercontent.com/klpanagi/matrixx/refs/heads/dev/docs/guide/installation.md
```

We strongly recommend letting an agent handle installation. [Manual guide &rarr;](docs/guide/installation.md) &nbsp;&middot;&nbsp; [Uninstall &rarr;](docs/guide/uninstallation.md)

### OpenCode Compatibility

> **Recommended:** Matrixx works on **OpenCode 1.14.33 or newer**. Earlier 1.14.x releases also work, with one specific exception: **OpenCode 1.14.32** ships a regression that breaks plugin agent and MCP registration. Upgrade to **1.14.33+** to restore full functionality.

To install a recommended version:

```bash
curl -fsSL https://opencode.ai/install | bash
# or pin explicitly
curl -fsSL https://opencode.ai/install | bash -s -- --version 1.14.33
# or via npm
npm install -g opencode-ai@1.14.33
```

<details>
<summary><strong>Compatibility Matrix</strong></summary>

| OpenCode Version | Matrixx Status | Notes |
|-----------------|----------------|-------|
| 1.1.1 &ndash; 1.4.17 | **Supported** | Full agent registration, all hooks functional |
| 1.14.17 &ndash; 1.14.31 | **Supported** | Full agent registration, all hooks functional |
| **1.14.32** | **Broken** | Upstream regression: ALS context lost during `InstanceStore.boot` refactor; plugin async callbacks lose `Instance.current`, so agents and MCP servers fail to register. See [anomalyco/opencode#25457](https://github.com/anomalyco/opencode/issues/25457). |
| **1.14.33+** | **Recommended** | Upstream fix shipped via [anomalyco/opencode#25449](https://github.com/anomalyco/opencode/pull/25449); restored `InstanceBootstrap` init parameter for non-Effect contexts. |

**Minimum OpenCode version:** 1.1.1 (permission system required)
**Avoid:** 1.14.32 only.

</details>

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

If this saves you time, a ⭐ goes a long way.

**Curious about the philosophy?** Read the [Ultrawork Manifesto](docs/ultrawork-manifesto.md) — originally authored by [code-yeongyu](https://github.com/code-yeongyu), the creator of oh-my-opencode.

<sub>Productivity might spike too hard. Don't let your coworker notice. Actually — let's see who wins.</sub>
