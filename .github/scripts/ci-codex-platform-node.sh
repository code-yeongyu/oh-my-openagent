#!/usr/bin/env bash
set -euo pipefail
node --test packages/omo-codex/scripts/install-local.test.mjs packages/omo-codex/scripts/install-local-entrypoint.test.mjs packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs packages/omo-codex/scripts/install-cli-args.test.mjs packages/omo-codex/plugin/test/node-install-surface.test.mjs packages/omo-codex/plugin/test/install-time-build-runtime.test.mjs
