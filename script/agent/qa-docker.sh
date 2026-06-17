#!/usr/bin/env bash
# Run opencode-qa / codex-qa inside a DISPOSABLE Docker container that has the
# latest released opencode + codex and a COPY of your local config, so QA never
# touches the host. This is the DEFAULT QA path; it falls back to local QA when
# Docker is unavailable, and Windows always uses local (see the docker-qa.md
# reference in each QA skill).
#
#   script/agent/qa-docker.sh                                   # smoke: opencode + codex versions
#   script/agent/qa-docker.sh bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test
#   script/agent/qa-docker.sh --no-config bash -lc 'opencode --version'
#   script/agent/qa-docker.sh --clean                           # remove the QA images
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
log() { printf '[qa-docker] %s\n' "$*"; }

# Windows: no Docker QA path here - the QA skills run directly on the host.
case "$(uname -s 2>/dev/null || echo unknown)" in
  *NT* | MINGW* | MSYS* | CYGWIN*)
    log "Windows detected: run the QA skill scripts locally instead (see references/docker-qa.md)."
    exit 3
    ;;
esac

# No Docker: fall back to local QA (the unavoidable second-best).
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  log "Docker unavailable: fall back to local QA - 'cd <skill-dir> && bash scripts/<script>.sh' (see references/docker-qa.md)."
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
  log "building $qa_image with latest opencode + codex + QA tools (one-time)"
  docker build -t "$qa_image" -f .devcontainer/qa.Dockerfile .
}

if [ "$#" -eq 0 ]; then
  set -- bash -lc 'opencode --version && codex --version'
fi

config_mounts=()
if [ "$mount_config" -eq 1 ]; then
  [ -d "$HOME/.config/opencode" ] && config_mounts+=(-v "$HOME/.config/opencode:/mnt/host/opencode-config:ro")
  [ -d "$HOME/.codex" ] && config_mounts+=(-v "$HOME/.codex:/mnt/host/codex:ro")
fi

log "running QA in a disposable container (--rm); host config mounted read-only, copied into the container"
exec docker run --rm -i \
  -v "$REPO_ROOT:/workspaces/oh-my-openagent" \
  "${config_mounts[@]}" \
  -e "OPENCODE_CONFIG_DIR=${OPENCODE_CONFIG_DIR:-}" \
  -w /workspaces/oh-my-openagent \
  "$qa_image" "$@"
