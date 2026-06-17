# Docker QA (default path)

Run Codex QA inside a DISPOSABLE container so the real `~/.codex` is never
touched and you always test against the latest codex. The container is the
sandbox: latest released codex (and opencode) are baked in, a COPY of your
config is loaded, and the container is removed on exit (`docker run --rm`). This
is the DEFAULT; fall back to running the scripts locally (see SKILL.md) only
when Docker is unavailable or on Windows.

## Run

From the repo root:

```bash
# smoke: prove the container has the latest codex
script/agent/qa-docker.sh bash -lc 'codex --version'

# drive the app-server / hook probes inside the container
script/agent/qa-docker.sh bash .claude/skills/codex-qa/scripts/app-server-drive.sh --self-test
script/agent/qa-docker.sh bash .claude/skills/codex-qa/scripts/hook-unit-probe.sh --self-test
script/agent/qa-docker.sh bash .claude/skills/codex-qa/scripts/install-verify.sh --self-test

# remove the QA images when done
script/agent/qa-docker.sh --clean
```

`qa-docker.sh` builds `omo-dev` (from `.devcontainer/Dockerfile`) then `omo-qa`
(from `.devcontainer/qa.Dockerfile`, which adds the latest `@openai/codex` +
`opencode-ai` npm packages plus `sqlite3 jq curl rsync`).

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
