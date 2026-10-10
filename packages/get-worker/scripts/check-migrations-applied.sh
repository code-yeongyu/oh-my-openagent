#!/usr/bin/env bash
# Fails closed when a migration exists that the ledger does not list as applied. The deploy token has no D1
# access, so a pending migration must go through the reviewed step first (see migrations/applied.txt).
set -euo pipefail
dir="${1:-migrations}"
[ -f "$dir/applied.txt" ] || { echo "D1 migration ledger $dir/applied.txt is missing; refusing to deploy."; exit 1; }
compgen -G "$dir/*.sql" >/dev/null || { echo "no D1 migrations found in $dir; refusing to deploy (wrong directory?)."; exit 1; }
pending=()
for f in "$dir"/*.sql; do
  name=$(basename "$f")
  grep -qxF "$name" "$dir/applied.txt" || pending+=("$name")
done
if [ "${#pending[@]}" -gt 0 ]; then
  echo "D1 migration pending: ${pending[*]}. Apply it via the reviewed infra path first (sisyphuslabs/common-infra docs/cutover-workers.md), then list it in $dir/applied.txt."
  exit 1
fi
echo "D1 migrations: none pending"
