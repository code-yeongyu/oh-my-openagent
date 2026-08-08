#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
evidence_dir="$repo_root/.omo/evidence/20260806-pr6339-rebase-prompt-append"
host_home="$HOME"
host_db="$host_home/.local/share/opencode/opencode.db"
host_before="$(sqlite3 "$host_db" "SELECT count(*) FROM session")"

if [ -n "${OMO_QA_ENV_FILE:-}" ]; then
  set -a
  . "$OMO_QA_ENV_FILE"
  set +a
fi
. "$repo_root/script/agent/qa-sandbox.sh"
trap 'rm -rf "$OMO_QA_ROOT"' EXIT

export HOME="$OMO_QA_ROOT/home"
mkdir -p "$HOME/.omo" "$HOME/.config/opencode" "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME/opencode"
cp "$host_home/.config/opencode/CELESTIA.md" "$HOME/.config/opencode/CELESTIA.md"
cp "$host_home/.local/share/opencode/account.json" "$XDG_DATA_HOME/opencode/account.json"
cp "$host_home/.local/share/opencode/auth.json" "$XDG_DATA_HOME/opencode/auth.json"

node - "$XDG_CONFIG_HOME/opencode/opencode.json" "$HOME/.omo/omo.jsonc" "$repo_root/dist/index.js" "$HOME/.config/opencode/CELESTIA.md" <<'NODE'
const [opencodeConfig, omoConfig, pluginPath, celestiaPath] = process.argv.slice(2)
const { writeFileSync } = require("node:fs")

writeFileSync(opencodeConfig, `${JSON.stringify({
  plugin: [pluginPath],
  agent: {
    sisyphus: {
      mode: "primary",
      model: "openai/gpt-5.6-luna",
      prompt: "You are Sisyphus for isolated QA.",
    },
  },
}, null, 2)}\n`)

writeFileSync(omoConfig, `${JSON.stringify({
  "[opencode]": {
    agents: {
      sisyphus: {
        model: "openai/gpt-5.6-luna",
        prompt_append: `file://${celestiaPath}`,
        prompt_append_exclude_model_keywords: ["claude", "gpt"],
      },
    },
  },
}, null, 2)}\n`)
NODE

probe="Reply CELESTIA_PRESENT only if your system instructions identify you as Celestia, Xinghui, or 星绘. Otherwise reply CELESTIA_ABSENT. Output no other text."
opencode --version > "$evidence_dir/opencode-version.txt"
agent_list="$(opencode agent list)"
case "$agent_list" in
  *"Sisyphus - ultraworker (primary)"*) ;;
  *) printf 'Sisyphus was not registered by the candidate plugin.\n' >&2; exit 1 ;;
esac
printf 'name=sisyphus\nmode=primary\nconfigured_model=openai/gpt-5.6-luna\nplugin=%s\n' "$repo_root/dist/index.js" > "$evidence_dir/agent-registration.txt"
opencode run --agent "Sisyphus - ultraworker" --model opencode-go/glm-5.2 --format json "$probe" > "$evidence_dir/glm.jsonl"
opencode run --agent "Sisyphus - ultraworker" --model openai/gpt-5.6-luna --format json "$probe" > "$evidence_dir/gpt.jsonl"

node - "$evidence_dir/glm.jsonl" "$evidence_dir/gpt.jsonl" <<'NODE'
const { readFileSync } = require("node:fs")
const [glmPath, gptPath] = process.argv.slice(2)
const glm = readFileSync(glmPath, "utf8")
const gpt = readFileSync(gptPath, "utf8")
if (!glm.includes("CELESTIA_PRESENT")) throw new Error("GLM probe did not observe CELESTIA_PRESENT")
if (!gpt.includes("CELESTIA_ABSENT")) throw new Error("GPT probe did not observe CELESTIA_ABSENT")
NODE

host_after="$(sqlite3 "$host_db" "SELECT count(*) FROM session")"
sandbox_sessions="$(sqlite3 "$XDG_DATA_HOME/opencode/opencode.db" "SELECT count(*) FROM session")"
printf 'host_before=%s\nhost_after=%s\nsandbox_sessions=%s\n' "$host_before" "$host_after" "$sandbox_sessions" > "$evidence_dir/isolation.txt"

if [ "$host_before" != "$host_after" ]; then
  printf 'Host OpenCode DB count changed during isolated QA.\n' >&2
  exit 1
fi
if [ "$sandbox_sessions" != "2" ]; then
  printf 'Expected exactly two isolated sessions, got %s.\n' "$sandbox_sessions" >&2
  exit 1
fi
