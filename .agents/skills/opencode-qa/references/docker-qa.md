# Docker QA (default path)

Run opencode QA inside a DISPOSABLE container so the host is never touched and
you always test against the latest opencode. The container itself is the
sandbox: latest released opencode + codex are baked in, a COPY of your local
config is loaded, and the container is removed on exit (`docker run --rm`). This
is the DEFAULT; fall back to running the scripts locally (see SKILL.md) only
when Docker is unavailable or on Windows.

## Run

From the repo root:

```bash
# smoke: prove the container has the latest opencode + codex
script/agent/qa-docker.sh

# run any opencode-qa script inside the container
script/agent/qa-docker.sh bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test
script/agent/qa-docker.sh bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test

# skip the config copy (fastest, for pure version / CLI checks)
script/agent/qa-docker.sh --no-config bash -lc 'opencode --version'

# remove the QA images when done
script/agent/qa-docker.sh --clean
```

`qa-docker.sh` builds two images on first use and reuses them after: `omo-dev`
(from `.devcontainer/Dockerfile`) and `omo-qa` (from `.devcontainer/qa.Dockerfile`,
which adds the latest `opencode-ai` + `@openai/codex` npm packages plus
`sqlite3 jq curl rsync`). Pin versions with `--build-arg OMO_OPENCODE_VERSION=...`
on the qa.Dockerfile if you need a specific release.

## Why the container is the sandbox

The local scripts isolate by pointing `XDG_*` at temp dirs so they never
pollute the real `~/.local/share/opencode/opencode.db`. In Docker the whole
container is throwaway, so isolation is structural: your host DB and config are
never written. `qa-docker.sh` mounts `~/.config/opencode` (and `~/.codex`)
READ-ONLY at `/mnt/host/*`; the entrypoint copies them into the container's
writable home (heavy caches excluded) so QA runs against a COPY.

## Credentials

Secrets are never baked into the image. Provide them at run time only:

- a gitignored `.env` or `.env.local` at the repo root (auto-sourced by
  `script/agent/setup.sh` and `script/agent/qa-sandbox.sh`),
- GitHub Codespaces secrets, or
- the devcontainer `remoteEnv` passthrough.

The host config is mounted read-only, so auth that already lives in
`~/.config/opencode` rides along without copying secrets into any image layer.

Fish caveat: if your shell sets `OPENCODE_CONFIG_DIR` (for example a
`profiles/today` override), export it before calling `qa-docker.sh` so the
container resolves the same profile (the runner forwards it with `-e`).

## Fallback: local / Windows

`qa-docker.sh` exits 3 with guidance when Docker is unavailable or on Windows.
There, run the scripts directly on the host (the rest of this skill); they
isolate via temp `XDG_*`. Windows has no Docker QA path here by design.

## Cleanup

Each run auto-removes its container (`--rm`). The `omo-dev` / `omo-qa` images
persist for fast re-runs; drop them with `script/agent/qa-docker.sh --clean`.
