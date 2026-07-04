LazyCodex packages [OmO](https://github.com/code-yeongyu/oh-my-openagent) as the Codex agent harness for complex codebases: project memory, planning, execution, and verified completion inside Codex. Think [LazyVim](https://github.com/LazyVim/LazyVim) for [lazy.nvim](https://github.com/folke/lazy.nvim), but for Codex.

> *"LazyVim made Neovim usable for the rest of us. LazyCodex does the same for Codex."*

### Thin distribution

LazyCodex itself is close to a small install alias. `lazycodex-ai` runs the OmO installer targeting the Codex platform, and the actual features come from the `omo` plugin.

### What gets installed

| Layer | What it means in Codex |
| --- | --- |
| **Commands** | `$init-deep`, `$ulw-plan`, `$start-work`, `$ulw-loop` — workflow entry points. |
| **Skills** | Review, debugging, refactoring, frontend, LSP, rules injection, and more — specialist playbooks. |
| **Hooks** | Automatic assistants that fire at session start, prompt submit, post-edit, post-compact, and stop. |
| **MCP Servers** | `grep_app`, `context7`, `codegraph`, `git_bash`, `lsp` — tool connections. |
| **Model routing** | Role-based model profiles so planning, implementation, and verification each get the right model. |
| **Agent roles** | `explorer`, `librarian`, `plan`, `momus`, `metis`, and executor/reviewer roles for subagent delegation. |

### Where it comes from

OmO is the core agent harness: discipline agents, parallel orchestration, multi-model routing, skills, hooks, verified completion, diagnostics, and team mode. LazyCodex packages that harness for Codex through the `lazycodex-ai` installer and the `omo@sisyphuslabs` marketplace plugin.

### What you get

The OmO harness, wired into Codex with:

- Goal-oriented execution — you give it objectives, not step-by-step recipes.
- A tight operating loop: **Explore → Plan → Implement → Verify → Manually QA**.
- Parallel agent roles so it maps the terrain before writing anything.
- The `$ulw-plan`, `$start-work`, and `$ulw-loop` workflows that keep complex work moving until it is verified.
- Project memory, skills, hooks, MCP tools, model routing, diagnostics, and verification defaults wired into Codex in one pass.

### Remember these four

1. `$init-deep` creates project memory.
2. `$ulw-plan "what to build"` sets the work order.
3. `$start-work` executes the plan.
4. `$ulw-loop "task"` keeps going until verified.

LazyCodex wires rules loading, skills, hooks, model routing, and verification habits around this flow. Browse the sidebar docs one section at a time when you need the details.

### The harness workflow

Use `{your prompt} ultrawork` when the job needs the deep worker to run as one coordinated, evidence-bound loop instead of a single turn.

### How it fits together

LazyCodex is a thin distribution layer over [OmO](https://github.com/code-yeongyu/oh-my-openagent). The core engine is OmO; LazyCodex packages the OmO harness for Codex.

Credit: The LazyCodex name idea is inspired by [LazyVim](https://github.com/LazyVim/LazyVim). The Ultragoal and UltraQA ideas are inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), reimplemented from concept for this Codex setup.

- [LazyCodex on GitHub](https://github.com/code-yeongyu/lazycodex)
- [OmO on GitHub](https://github.com/code-yeongyu/oh-my-openagent)
- [Discord — #building-in-public](https://discord.gg/PUwSMR9XNk)
- [lazycodex.ai](https://lazycodex.ai)
