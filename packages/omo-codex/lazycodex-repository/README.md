<div align="center">
  <img src=".github/assets/lazycodex-logo.png" alt="LazyCodex" width="280">

  <h1>LazyCodex</h1>

  <p><strong>The one and only agent harness for complex codebases.</strong><br />
  Project memory, planning, execution, and verified completion inside Codex.</p>

  <p>
    <a href="https://github.com/code-yeongyu/lazycodex/stargazers">
      <img alt="Stars" src="https://img.shields.io/github/stars/code-yeongyu/lazycodex?style=for-the-badge&color=c69ff5&logoColor=D9E0EE&labelColor=302D41" />
    </a>
  </p>

  <p>
    <a href="#-what-is-this">What is this?</a>
    ·
    <a href="https://github.com/code-yeongyu/oh-my-openagent">OmO</a>
    ·
    <a href="https://lazycodex.ai">lazycodex.ai</a>
  </p>

  <br />
</div>

<hr />

> [!NOTE]
> **[OmO] 60K Stars: the terrifying token burner has arrived in LazyCodex.**
>
> Sisyphus Labs' OmO is the quality-obsessed agent harness whose public lore says it loved Anthropic models hard enough to get third-party clients blocked. Now that same OmO quality bar is available for Codex through LazyCodex.
>
> If you wanted OmO but did not want the setup ceremony, start here:
>
> ```bash
> npx lazycodex-ai install
> ```
>
> Context: [OmO 60K Stars on X](https://x.com/justsisyphus/status/2060210365338939452?s=20)

## 🚀 Install

One line. No global install, no `npm i -g`. Always use `npx`:

```bash
npx lazycodex-ai install
```

This is shorthand for `npx --yes --package oh-my-openagent omo install --platform=codex`. For a fully autonomous, no-TUI setup:

```bash
npx lazycodex-ai install --no-tui --codex-autonomous
```

### Install from the Codex marketplace (experimental)

The npx installer above stays the primary path. As an additive, experimental
alternative you can install from inside Codex itself: type `/plugins`, open the
**Add Marketplace** tab ("Add a marketplace from a Git repo or local root."),
and enter `https://github.com/code-yeongyu/lazycodex`, then install `omo` from
the `sisyphuslabs` marketplace. Or from the CLI:

```bash
codex plugin marketplace add https://github.com/code-yeongyu/lazycodex
codex plugin add omo@sisyphuslabs
```

On the next launch, approve the omo hooks in Codex's startup review — hooks
never run before approval. The first approved session prints
`LazyCodex bootstrap running in background — restart the session when it completes`
while a background worker finishes the setup (config blocks, agent roles, bin
links, a pinned `sg` binary for the `ast_grep` MCP); restart when it is done.
The marketplace path never touches Codex permission settings — autonomous mode
remains the explicit `npx lazycodex-ai install --no-tui --codex-autonomous`
choice.

Upgrade with `codex plugin marketplace upgrade sisyphuslabs`. The next startup
review shows the hooks as **Modified** — expected after every upgrade —
re-approve them and the following session re-runs bootstrap on the new version.
If anything looks pending or degraded, `npx lazycodex-ai doctor` explains what
and why. Full details: [lazycodex.ai/docs](https://lazycodex.ai/docs).

### Verify it worked

```bash
npx lazycodex-ai doctor
```

`doctor` prints the installation health report: plugin cache, hooks, MCP
servers, agents, and config state. Inside Codex, type `$` in the composer to
browse every installed skill — `init-deep`, `ulw-loop`, `ulw-plan`,
`start-work`, and the rest — and hooks announce themselves with
`LazyCodex(<version>): ...` status messages during a session.

### Uninstall

```bash
npx lazycodex-ai uninstall
```

Removes the installed plugin cache, bin links, agent roles, and the managed
sections of `~/.codex/config.toml`.

## ⚡ Commands

LazyCodex installs these as OmO commands for Codex. Invoke them with the
`$command` syntax shown by the installer.

| Command | Type this | What it does |
| --- | --- | --- |
| `$ulw-loop` | `$ulw-loop "task" [--completion-promise=TEXT] [--strategy=reset\|continue]` | Self-referential loop that runs until Oracle-verified completion. Caps at 500 iterations in ultrawork mode, 100 in normal mode. |
| `$ulw-plan` | `$ulw-plan "what to build"` | Prometheus strategic planner. Writes a plan to `plans/<slug>.md`. Never writes product code. |
| `$start-work` | `$start-work [plan-name] [--worktree <path>]` | Executes a plan until every checkbox is done. Prints **ORCHESTRATION COMPLETE**. |

Full documentation lives at [lazycodex.ai/docs](https://lazycodex.ai/docs).

## Use the built-in workflows

LazyCodex should be judged by the features it actually installs. It is the
Codex distribution for OmO's agent harness: project memory, planning,
execution, verified completion, skills, hooks, model routing, and diagnostics.

### 1. `$init-deep` creates project memory

`$init-deep` generates hierarchical `AGENTS.md` context. It scores complex
directories, writes local guidance near the code that needs it, and gives future
agents landmarks before they edit. Type `$init-deep` in the Codex composer —
the `$` prefix is how every installed skill is invoked.

Use it when the repository is too large to explain from memory. Run it again
when the shape of the codebase changes.

### 2. The three command pillars stay up front

Use `$ulw-plan` when the work needs decisions before implementation. It writes a
plan to `plans/<slug>.md` and does not touch product code.

Use `$start-work` when a plan is ready. It executes the checklist with durable
Boulder progress and stops only when the plan is complete.

Use `$ulw-loop` when the task should keep moving until the result is verified by
evidence instead of a hopeful status update.

### 3. Skills cover specialized work

The command layer stays simple. The skill layer adds specialist judgment for the
actual work:

| Feature | Use it for |
| --- | --- |
| `$init-deep` | Hierarchical project memory through `AGENTS.md` |
| `$ulw-plan` | Decision-complete planning before code changes |
| `$start-work` | Durable plan execution with Boulder progress |
| `$ulw-loop` | Verified completion for open-ended tasks |
| `review-work` | Multi-angle post-implementation review |
| `remove-ai-slops` | Behavior-preserving cleanup of AI-looking code |
| `frontend-ui-ux` | Polished UI surfaces |
| `programming` | Strict TypeScript, Rust, Python, or Go discipline |
| `LSP` | Diagnostics, definitions, references, symbols, and renames |
| `AST-grep` | Structural search and rewrite across code |
| `rules` | Project instructions from AGENTS, rules, and instruction files |
| `comment-checker` | Feedback after edit-like operations |

### 4. Sub-agent roles ride Codex's native multi-agent tools

LazyCodex installs selectable agent roles into `~/.codex/agents/`: `explorer`,
`librarian`, `plan`, `momus`, `metis`, and `codex-ultrawork-reviewer`. Pick one
by passing `agent_type` to Codex's `spawn_agent` tool — the child agent runs
with that role's model and instructions:

```jsonc
spawn_agent({"message": "TASK: map the auth flow end to end.", "agent_type": "explorer"})
```

The installer exposes `agent_type` on `multi_agent_v2` sessions (Codex hides it
by default). If your Codex build's spawn tool has no `agent_type` parameter,
describe the role inside `message` instead — the skills are written to fall
back to that form automatically.

Start at [https://lazycodex.ai](https://lazycodex.ai).

<hr />

## 💤 What is this?

**LazyCodex** packages [OmO (oh-my-openagent)](https://github.com/code-yeongyu/oh-my-openagent) as the Codex agent harness for complex codebases.

Think [LazyVim](https://github.com/LazyVim/LazyVim) for [lazy.nvim](https://github.com/folke/lazy.nvim), but for Codex.

OmO is the agent harness: discipline agents, parallel orchestration, multi-model routing, skills, hooks, and verified completion. LazyCodex packages that harness for Codex.

> _"LazyVim made Neovim usable for the rest of us. LazyCodex does the same for Codex."_

Credit: The LazyCodex name idea is inspired by [LazyVim](https://github.com/LazyVim/LazyVim). The Ultragoal and UltraQA ideas are inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), reimplemented from concept for this Codex setup.

## 🧩 What you get

| Feature | Description |
| --- | --- |
| 🤖 **Discipline Agents** | Sisyphus orchestrates Hephaestus, Oracle, Librarian. A full AI dev team |
| 🔀 **Parallel Execution** | Multiple agents working simultaneously on subtasks |
| 🎯 **Multi-Model Routing** | Automatic model selection per task category |
| 🛠️ **Skills System** | Extensible skill library for specialized tasks |
| 📋 **Hooks & Lifecycle** | Pre/post hooks for every agent action |
| 🔧 **Zero Config** | Sensible defaults, override when you want |

## 🧠 Why different GPT models appear

Do not be surprised if an OmO/LazyCodex run shows models like `gpt-5.2`
with `xhigh`, `gpt-5.4-mini`, `gpt-5.3-codex`, or newer equivalents like
`gpt-5.5` with `xhigh`. That is intentional.

OmO does not blindly spend your best model on every subtask. Its source
defines task categories and fallback chains so the agent can pick the most
appropriate model for the job: `quick` routes to `gpt-5.4-mini` for small
edits, `ultrabrain` uses a high-reasoning GPT model for hard logic, and
agentic coding paths can use Codex-tuned GPT models when available. See
[`openai-categories.ts`](src/src/tools/delegate-task/openai-categories.ts)
and [`model-requirements.ts`](src/packages/model-core/src/model-requirements.ts).

The point is quota discipline: use the strongest model when the task needs
deep reasoning, use a cheaper/faster model when that is enough, and keep
parallel agent work efficient instead of burning premium quota on routine
steps. This is benchmark-driven routing, not random model churn:

- [GPT-5.2](https://openai.com/index/introducing-gpt-5-2/) is documented by
  OpenAI as stronger at code review, bug finding, and complex tool use; the
  announcement notes that its maximum API reasoning effort uses `xhigh`.
- [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex)
  is OpenAI's Codex-tuned model for agentic software engineering, with public
  coding-agent benchmarks such as SWE-Bench Pro, Terminal-Bench 2.0, and
  OSWorld Verified reported in the
  [GPT-5.3-Codex announcement](https://openai.com/index/introducing-gpt-5-3-codex).
- [GPT-5.4 mini](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)
  is positioned for efficient everyday coding, computer use, and subagents;
  that is why lightweight OmO tasks can land there instead of spending a
  frontier reasoning model.

Reference links:

- [OpenAI GPT-5.2 announcement](https://openai.com/index/introducing-gpt-5-2/)
- [OpenAI GPT-5.2 model docs](https://platform.openai.com/docs/models/gpt-5.2/)
- [OpenAI GPT-5.3-Codex model docs](https://developers.openai.com/api/docs/models/gpt-5.3-codex)
- [OpenAI GPT-5.4 mini and nano announcement](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)
- [OpenAI latest model guide](https://platform.openai.com/docs/guides/latest-model)

## 🏗️ Architecture

LazyCodex is a thin distribution layer. The core engine is [oh-my-openagent (OmO)](https://github.com/code-yeongyu/oh-my-openagent), included as a submodule under `src/`.

```
lazycodex/
├── src/                     → oh-my-openagent (submodule)
├── packages/
│   └── web/                 → Next.js 16 + Tailwind v4 + opennextjs-cloudflare
│                              (deployed to lazycodex.ai via Cloudflare Workers)
├── .github/workflows/       → web-ci.yml + web-deploy.yml
├── README.md
└── ...
```

LazyCodex is part of the [omo.dev](https://omo.dev) project. **omo in Codex**, packaged for the lazy.

## 👷 Maintainer

LazyCodex is maintained by **Jobdori**, the AI assistant that builds and ships [OmO](https://github.com/code-yeongyu/oh-my-openagent) in real-time.

<div align="center">

[![Sisyphus Labs](.github/assets/sisyphuslabs.png)](https://sisyphuslabs.ai)

> **Meet your own Jobdori, Dori.**
> **Learn more at [sisyphuslabs.ai](https://sisyphuslabs.ai).**

</div>

## 📄 License

MIT
