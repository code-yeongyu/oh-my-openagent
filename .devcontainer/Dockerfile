# Dev container image for oh-my-openagent.
# Node 24 (npm builds the vendored lsp-tools-mcp / lsp-daemon / git-bash-mcp +
# codex plugin) + Bun 1.3.12 (the workspace runtime, pinned to CI) + tmux
# (interactive_bash + team-mode). git ships with the base image.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux \
 && rm -rf /var/lib/apt/lists/*

# Pin Bun to match CI (oven-sh/setup-bun bun-version: 1.3.12).
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.12" \
 && bun --version

USER node
