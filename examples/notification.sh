#!/bin/sh

set -eu

hook_type=${1:?hook type is required}
payload=$(cat)

printf '%s %s %s\n' "$hook_type" "$OPENCODE_PROJECT_DIR" "$payload" >> /tmp/opencode-notifications.log
