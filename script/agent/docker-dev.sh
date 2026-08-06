#!/usr/bin/env bash
# Plain-Docker dev shell using the SAME image as GitHub Codespaces and VS Code
# Dev Containers (.devcontainer/Dockerfile). Builds the image, then drops you
# into a bash shell with the repo mounted. The first thing to run inside is
# usually: bash script/agent/setup.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

IMAGE="${OMO_DEV_IMAGE:-omo-dev}"
WORKDIR="/workspaces/oh-my-openagent"

echo "[docker-dev] building $IMAGE from .devcontainer/Dockerfile"
docker build -t "$IMAGE" -f .devcontainer/Dockerfile .

echo "[docker-dev] starting shell ($IMAGE) with repo mounted at $WORKDIR"
exec docker run --rm -it -v "$REPO_ROOT:$WORKDIR" -w "$WORKDIR" "$IMAGE" bash
