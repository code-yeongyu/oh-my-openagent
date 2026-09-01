#!/usr/bin/env bash
# Bring up a DISPOSABLE, isolated dev/QA box that has the latest opencode + codex
# and a COPY of your local config, then just USE it: a shell inside, a one-off
# command, or opencode's HTTP server published to your host. The host is never
# touched (config mounted read-only, copied into the container; --rm on exit).
# Default QA path; Windows and Docker-less hosts use the local skill scripts
# (see references/docker-qa.md in each QA skill).
#
#   script/agent/qa-docker.sh                 # shell in the box (type 'opencode ...' / 'codex ...')
#   script/agent/qa-docker.sh shell           # same
#   script/agent/qa-docker.sh serve [PORT]    # opencode serve -> http://127.0.0.1:PORT (default 4096)
#   script/agent/qa-docker.sh codex [--tui]   # drive codex via the first-party app-server, or --tui fallback
#   script/agent/qa-docker.sh exec <cmd...>   # run one command inside, then exit
#   script/agent/qa-docker.sh --no-config ... # do not copy host config in
#   script/agent/qa-docker.sh --clean         # remove the QA images
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
log() { printf '[qa-docker] %s\n' "$*"; }

# Windows: no Docker QA path here; the QA skills run directly on the host.
case "$(uname -s 2>/dev/null || echo unknown)" in
  *NT* | MINGW* | MSYS* | CYGWIN*)
    log "Windows detected: run the QA skill scripts locally instead (see references/docker-qa.md)."
    exit 3
    ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  log "Docker unavailable: run the QA skill scripts locally (see references/docker-qa.md)."
  exit 3
fi

dev_image="omo-dev"
qa_image="omo-qa"

if [ "${1:-}" = "--clean" ]; then
  docker rmi -f "$qa_image" "$dev_image" >/dev/null 2>&1 || true
  log "removed QA images ($qa_image, $dev_image)."
  exit 0
fi

mount_config=1
if [ "${1:-}" = "--no-config" ]; then
  mount_config=0
  shift
fi

docker image inspect "$dev_image" >/dev/null 2>&1 || {
  log "building $dev_image from .devcontainer/Dockerfile (one-time)"
  docker build -t "$dev_image" -f .devcontainer/Dockerfile .
}
docker image inspect "$qa_image" >/dev/null 2>&1 || {
  log "building $qa_image with latest opencode + codex (one-time)"
  docker build -t "$qa_image" -f .devcontainer/qa.Dockerfile .
}

config_mounts=()
if [ "$mount_config" -eq 1 ]; then
  [ -d "$HOME/.config/opencode" ] && config_mounts+=(-v "$HOME/.config/opencode:/mnt/host/opencode-config:ro")
  [ -d "$HOME/.codex" ] && config_mounts+=(-v "$HOME/.codex:/mnt/host/codex:ro")
fi

# Allocate a tty only when we have one (so CI / background use still works).
tty_flags=(-i)
[ -t 0 ] && [ -t 1 ] && tty_flags=(-it)

docker_run() {
  exec docker run --rm "${tty_flags[@]}" \
    -v "$REPO_ROOT:/workspaces/oh-my-openagent" \
    "${config_mounts[@]}" \
    -e "OPENCODE_CONFIG_DIR=${OPENCODE_CONFIG_DIR:-}" \
    -w /workspaces/oh-my-openagent \
    "$@"
}

mode="${1:-shell}"
case "$mode" in
  shell)
    log "shell in a disposable container; opencode + codex are on PATH. Ctrl-D to exit + remove."
    docker_run "$qa_image" bash
    ;;
  serve)
    shift
    port="${1:-4096}"
    log "opencode serve at http://127.0.0.1:${port} (reach it from the host). Ctrl-C to stop + remove."
    docker_run -p "127.0.0.1:${port}:${port}" "$qa_image" bash -lc "opencode serve --hostname 0.0.0.0 --port ${port}"
    ;;
  codex)
    shift
    if [ "${1:-}" = "--tui" ]; then
      log "codex TUI (fallback) in the box - interactive; uses your mounted config."
      docker_run "$qa_image" bash -lc "exec codex"
    else
      log "codex via the first-party app-server (no acp): driving a real turn in the box."
      docker_run "$qa_image" bash -lc "bash .agents/skills/codex-qa/scripts/app-server-drive.sh --self-test"
    fi
    ;;
  exec)
    shift
    [ "$#" -gt 0 ] || {
      log "exec needs a command, e.g. 'qa-docker.sh exec opencode --version'"
      exit 2
    }
    docker_run "$qa_image" "$@"
    ;;
  *)
    docker_run "$qa_image" "$@"
    ;;
esac
