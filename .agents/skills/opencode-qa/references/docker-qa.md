# Docker QA (default path)

Run opencode QA inside a DISPOSABLE container so the host is never touched and
you always test against the latest opencode. The container itself is the
sandbox: latest released opencode + codex are baked in, a COPY of your local
config is loaded, and the container is removed on exit (`docker run --rm`). This
is the DEFAULT; fall back to running the scripts locally (see SKILL.md) only
when Docker is unavailable or on Windows.

## Use it

`qa-docker.sh` brings up a disposable box (builds `omo-dev` then `omo-qa` on
first use, reused after) and either drops you into it or serves opencode to
your host. From the repo root:

```bash
# a shell inside the box: just type `opencode ...` or `codex ...`
script/agent/qa-docker.sh
script/agent/qa-docker.sh shell

# serve opencode's HTTP API to the host, then drive it from OUTSIDE:
script/agent/qa-docker.sh serve 4096               # terminal 1 (Ctrl-C stops + removes)
curl http://127.0.0.1:4096/global/health           # host -> {"healthy":true,"version":"1.17.7"}
opencode run "hi" --attach http://127.0.0.1:4096   # a real turn against the box

# one-off command, or a skill's own self-test, inside:
script/agent/qa-docker.sh exec opencode --version
script/agent/qa-docker.sh exec bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test

script/agent/qa-docker.sh --no-config exec opencode --version   # skip the config copy
script/agent/qa-docker.sh --clean                               # remove the QA images
```

`omo-qa` is `omo-dev` (`.devcontainer/Dockerfile`) plus the latest `opencode-ai`
and `@openai/codex` npm packages and `sqlite3 jq curl rsync`. Pin with
`--build-arg OMO_OPENCODE_VERSION=...` on the qa.Dockerfile for a specific release.

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
