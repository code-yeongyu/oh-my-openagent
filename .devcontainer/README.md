# Dev container guide

This dev container backs GitHub Codespaces, VS Code Dev Containers, and plain
Docker (via [`script/agent/docker-dev.sh`](../script/agent/docker-dev.sh)). It
builds [`Dockerfile`](./Dockerfile) (Node 24 + Bun 1.3.12 + tmux) and runs
[`script/agent/setup.sh`](../script/agent/setup.sh) on create. This guide covers
getting your credentials and per-harness config INTO the container so OpenCode,
Codex, and Claude Code all work inside it.

`setup.sh` also initializes the frontend provenance submodules under
`packages/shared-skills/upstreams/` and materializes their references (both steps
are non-fatal). The container has network on create, so the submodules clone and
the frontend brand / taste / ui-ux references materialize automatically; if you
build the image offline they are skipped and the frontend skill simply lacks those
brand refs until the next online `script/agent/setup.sh` run.

## Provider credentials (required)

`setup.sh` and [`script/agent/qa-sandbox.sh`](../script/agent/qa-sandbox.sh)
auto-source a repo-root `.env`. Inside the container, create it once:

```bash
cp .env.example .env
$EDITOR .env   # set ANTHROPIC_API_KEY / OPENAI_API_KEY
```

Alternatives:

- **GitHub Codespaces**: add `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` as
  Codespaces secrets (repo Settings, Secrets, Codespaces). They are injected as
  environment variables automatically.
- **Local Dev Containers**: `devcontainer.json` forwards them from your host
  shell via `"remoteEnv": { "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}", ... }`.
  Export them in your host shell before opening the container.

## Harness config (optional, to drive the agents inside the container)

To use OpenCode / Codex / Claude Code from inside the container with your
existing auth and settings, bind-mount the host config dirs. Add a `mounts`
entry to [`devcontainer.json`](./devcontainer.json) (it supports JSONC):

```jsonc
"mounts": [
  // OpenCode config + auth
  "source=${localEnv:HOME}/.config/opencode,target=/home/node/.config/opencode,type=bind,consistency=cached",
  // Codex CLI config + auth
  "source=${localEnv:HOME}/.codex,target=/home/node/.codex,type=bind,consistency=cached",
  // Claude Code config + auth
  "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind,consistency=cached"
]
```

Notes:

- The container user is `node` (home `/home/node`), so target those paths.
- Bind mounts are read-write; the container can change your host config. Mount
  only what you need, or copy the files in instead if you want isolation.
- Codespaces has no host filesystem to mount; re-authenticate inside the
  container, or copy the needed files via a `postCreateCommand`.
- For QA that must NOT touch any real config, `source script/agent/qa-sandbox.sh`
  points `XDG_*` and `CODEX_HOME` at a throwaway temp dir instead.

## Maintenance

If the image, the bootstrap, or the injected config changes, update
[`Dockerfile`](./Dockerfile), [`script/agent/setup.sh`](../script/agent/setup.sh),
this README, and the "Development Environment" sections of the root
[`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) together.
See the maintenance directive in `AGENTS.md`.
