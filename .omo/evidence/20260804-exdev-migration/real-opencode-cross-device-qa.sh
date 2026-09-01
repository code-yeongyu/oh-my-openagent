#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
evidence_dir="$repo_root/.omo/evidence/20260804-exdev-migration"
image="omo-qa"
container_repo="/workspaces/oh-my-openagent"

real_db="$(opencode db path)"
sqlite3 "$real_db" 'SELECT count(*) FROM session;' > "$evidence_dir/real-db-before.txt"

run_case() {
  local mode="$1"
  local fixture
  fixture="$(mktemp -d)"
  chmod 0777 "$fixture"
  cat > "$fixture/opencode.jsonc" <<EOF
{
  "plugin": ["file://${container_repo}/dist/index.js"]
}
EOF
  cat > "$fixture/oh-my-openagent.json" <<'EOF'
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-5"
    }
  }
}
EOF
  chmod 0666 "$fixture/opencode.jsonc" "$fixture/oh-my-openagent.json"
  local mount_args=(-v "$fixture:/home/node/.config/opencode:rw")
  if [ "$mode" = "warning" ]; then
    cp "$fixture/oh-my-openagent.json" "$fixture/legacy-read-only.json"
    mount_args+=(-v "$fixture/legacy-read-only.json:/home/node/.config/opencode/oh-my-openagent.json:ro")
  fi

  docker run --rm \
    -v "$repo_root:$container_repo" \
    "${mount_args[@]}" \
    -w "$container_repo" \
    --entrypoint bash \
    "$image" -lc '
      set -euo pipefail
      mode="$1"
      evidence_dir="$2"
      container_repo="/workspaces/oh-my-openagent"
      legacy="$HOME/.config/opencode/oh-my-openagent.json"
      mkdir -p "$HOME/.omo"
      {
        echo "mode=$mode"
        echo "opencode_version=$(opencode --version)"
        echo "legacy_device=$(stat -c %d "$legacy")"
        echo "omo_device=$(stat -c %d "$HOME/.omo")"
      } > "$evidence_dir/${mode}-devices.txt"

      opencode serve --print-logs --log-level INFO --hostname 127.0.0.1 --port 4096 > "$evidence_dir/${mode}-serve.log" 2>&1 &
      server_pid=$!
      cleanup() {
        kill "$server_pid" >/dev/null 2>&1 || true
        wait "$server_pid" >/dev/null 2>&1 || true
      }
      trap cleanup EXIT

      for _ in $(seq 1 100); do
        curl -fsS http://127.0.0.1:4096/global/health > "$evidence_dir/${mode}-health.json" 2>/dev/null && break
        sleep 0.1
      done
      test -s "$evidence_dir/${mode}-health.json"
      curl -fsS --get --data-urlencode "directory=$container_repo" \
        http://127.0.0.1:4096/session > "$evidence_dir/${mode}-session-list.json"

      if [ "$mode" = "success" ]; then
        for _ in $(seq 1 100); do
          [ -f "$HOME/.omo/omo.jsonc" ] && [ ! -e "$legacy" ] && break
          sleep 0.1
        done
        test -f "$HOME/.omo/omo.jsonc"
        test ! -e "$legacy"
        backup="$(find "$HOME/.omo" -type f -path "*/migration-backup-*/*/oh-my-openagent.json" -print -quit)"
        test -n "$backup"
        cp "$HOME/.omo/omo.jsonc" "$evidence_dir/success-omo.jsonc"
        cp "$backup" "$evidence_dir/success-backup.json"
        {
          echo "legacy_exists=no"
          echo "journal_exists=$([ -e "$HOME/.omo/.migration-journal.json" ] && echo yes || echo no)"
          echo "backup_path=${backup#$HOME/}"
          grep -F "[config-migration] startup completed" "$evidence_dir/${mode}-serve.log" | tail -1 || true
        } > "$evidence_dir/${mode}-observed.txt"
      else
        for _ in $(seq 1 100); do
          grep -F "legacy configuration changes were not applied" "$evidence_dir/${mode}-serve.log" >/dev/null 2>&1 && break
          sleep 0.1
        done
        grep -F "legacy configuration changes were not applied" "$evidence_dir/${mode}-serve.log" > "$evidence_dir/${mode}-warning.txt"
        {
          echo "legacy_exists=$([ -e "$legacy" ] && echo yes || echo no)"
          echo "journal_exists=$([ -e "$HOME/.omo/.migration-journal.json" ] && echo yes || echo no)"
          grep -F "[config-migration] startup completed" "$evidence_dir/${mode}-serve.log" | tail -1 || true
        } > "$evidence_dir/${mode}-observed.txt"
      fi
    ' bash "$mode" "$container_repo/.omo/evidence/20260804-exdev-migration"

  rm -rf "$fixture"
}

run_case success
run_case warning

sqlite3 "$real_db" 'SELECT count(*) FROM session;' > "$evidence_dir/real-db-after.txt"
cmp "$evidence_dir/real-db-before.txt" "$evidence_dir/real-db-after.txt"
printf 'real_db_session_count_unchanged=%s\n' "$(cat "$evidence_dir/real-db-after.txt")" > "$evidence_dir/isolation.txt"
