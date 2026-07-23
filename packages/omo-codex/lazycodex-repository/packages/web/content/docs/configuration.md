LazyCodex is a thin distribution layer over [OmO](https://github.com/code-yeongyu/oh-my-openagent). The configuration that the installer writes into Codex controls model routing, hooks, skills, and the agent roles the harness uses.

### Zero-config by default

LazyCodex ships with sensible defaults and works immediately after install. You only need to touch configuration when the defaults do not fit your repository. There are no config files to create in advance — install and start working.

```bash
npx lazycodex-ai install
```

No global install. Always `npx`. This is shorthand for `npx --yes --package oh-my-openagent omo install --platform=codex`.

### Codex target

LazyCodex always targets Codex. The `--platform=codex` argument is baked into the `lazycodex-ai` bin's `install` path, so the harness connects to the [OpenAI Codex CLI](https://github.com/openai/codex) and not another platform. You do not pass `--platform` yourself.

**Prerequisites:**

- [Node.js](https://nodejs.org) — any maintained LTS; `npx` ships with it. Bun is not required.
- [OpenAI Codex CLI](https://github.com/openai/codex) or the Codex App, logged in.

### Where config lives

- Codex configuration that the installer connects to.
- Project-level `AGENTS.md` and rule files that shape agent behavior per repository.
- User-level skill locations such as `~/.config/opencode/skills` and `~/.agents/skills`.

### Install flags

The default installer is interactive (TUI). It detects subscriptions, helps with model selection, and walks provider auth.

```bash
npx lazycodex-ai install
```

For a fully autonomous, prompt-free setup, add both flags together:

```bash
npx lazycodex-ai install --no-tui --codex-autonomous
```

`--no-tui --codex-autonomous` are passed through to `omo install` — the `lazycodex-ai` bin does not interpret them itself. It is strongly recommended to let an LLM agent run the install: the agent handles subscription detection, model selection, and provider auth automatically.

### What you can tune

- **Model routing** — which model handles planning, implementation, verification, and specialist skills. The installer sets sensible defaults from your detected subscriptions; override per role when a project needs a different profile.
- **Hooks and lifecycle** — whether the Stop-hook auto-continues a plan, iteration caps (500 in ultrawork mode, 100 in normal mode), and how completion is gated.
- **Skills** — which skills are active and where they load from.
- **Agent roles** — Hephaestus plus explorer, librarian, planner, reviewer, QA, and gate roles. The installer writes the role definitions and model/prompt overrides that Codex can route to.

### Hooks & lifecycle

Hooks never run before approval. On the first launch after install, Codex's startup review asks you to approve the `omo` hooks. After every upgrade the hooks show as **Modified** — expected, because the plugin files changed and the previous trust hashes no longer match. Re-approve and the next session runs the new version's bootstrap.

### Provider & model settings

Provider and model settings are managed by OmO, not LazyCodex directly. During install, OmO reads the Codex configuration and the bundled `model-catalog.json` to align model profiles — this is the model routing layer.

- The installer connects provider auth for you. Letting an agent run the install is the recommended path.
- Provider keys are read from the environment. All `*_API_KEY` and OAuth credentials are secrets — never log or commit them.
- Deeper provider and model tuning beyond the install follows OmO conventions. See the OmO docs for provider environment variables and model resolution rules.

> Do not fabricate provider keys. Supply the key your chosen provider documents, via the environment, and let the installer's routing interpret it.

### Diagnosing config

If something looks pending or degraded, run:

```bash
npx lazycodex-ai doctor
```

It explains what is misconfigured and why, and points at the specific field to fix. It checks plugin cache, hooks, MCP servers, agent roles, and Codex config state.

### Re-running setup

The installer is idempotent. Re-running `npx lazycodex-ai install` rewrites the config blocks, agent roles, and bin links on top of what is there, so it is safe to run after editing configuration by hand.

See the [CLI reference](./cli.md) for every command the installer exposes.
