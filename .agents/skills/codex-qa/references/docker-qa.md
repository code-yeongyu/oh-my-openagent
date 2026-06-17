# Docker QA (default path)

Run Codex QA inside a DISPOSABLE container so the real `~/.codex` is never
touched and you always test against the latest codex. The container is the
sandbox: latest released codex (and opencode) are baked in, a COPY of your
config is loaded, and the container is removed on exit (`docker run --rm`). This
is the DEFAULT; fall back to running the scripts locally (see SKILL.md) only
when Docker is unavailable or on Windows.

## Use it

`qa-docker.sh` brings up a disposable box (builds `omo-dev` then `omo-qa` on
first use, reused after) and drops you into it. From the repo root:

```bash
# drive codex via the FIRST-PARTY app-server (no acp): a real turn in the box
script/agent/qa-docker.sh codex

# fallback: the interactive codex TUI in the box (uses your mounted config)
script/agent/qa-docker.sh codex --tui

# a shell inside the box: codex (and opencode) are on PATH
script/agent/qa-docker.sh
script/agent/qa-docker.sh shell

# one-off command, or a codex-qa self-test inside the box:
script/agent/qa-docker.sh exec codex --version
script/agent/qa-docker.sh exec bash .claude/skills/codex-qa/scripts/tui-smoke.sh --self-test

script/agent/qa-docker.sh --clean   # remove the QA images
```

`omo-qa` is `omo-dev` (`.devcontainer/Dockerfile`) plus the latest `@openai/codex`
and `opencode-ai` npm packages and `sqlite3 jq curl rsync`.

## Isolation still applies inside

The codex-qa scripts already isolate via an mktemp `CODEX_HOME` and a local mock
model (no real API call). In Docker that runs inside a throwaway container too,
so there are two layers: the scripts never touch the mounted real `~/.codex`,
and the container is discarded on exit. `qa-docker.sh` mounts `~/.codex`
READ-ONLY at `/mnt/host/codex`; the entrypoint copies it into the container's
writable home for any case that wants the real config. The host `~/.codex`
(including `config.toml`) is never written.

## Credentials

codex-qa uses a mock model, so no real key is needed for the first-party hook
proof. For runs that do need auth, provide it at run time only: a gitignored
`.env` / `.env.local`, Codespaces secrets, or the devcontainer `remoteEnv`
passthrough - never baked into the image.

## Fallback: local / Windows

`qa-docker.sh` exits 3 with guidance when Docker is unavailable or on Windows;
run the scripts directly on the host there (they isolate via mktemp
`CODEX_HOME`). Windows has no Docker QA path here by design.

## Cleanup

Each run auto-removes its container (`--rm`). The `omo-dev` / `omo-qa` images
persist for fast re-runs; drop them with `script/agent/qa-docker.sh --clean`.
