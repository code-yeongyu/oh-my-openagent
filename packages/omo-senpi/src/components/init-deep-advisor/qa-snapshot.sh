#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
TMPREPO=$(mktemp -d)
trap 'rm -rf "$TMPREPO"' EXIT
export STATE_MODULE="$ROOT/packages/omo-senpi/src/components/init-deep-advisor/state.ts"
cd "$TMPREPO"
git init >/dev/null
git -c user.name=QA -c user.email=qa@example.invalid -c commit.gpgsign=false commit --allow-empty -m init >/dev/null
mkdir -p src
printf 'export const a = 1\n' > src/a.ts
printf 'export const b = 2\n' > $'src/line\nbreak.ts'
git add -A
git -c user.name=QA -c user.email=qa@example.invalid -c commit.gpgsign=false commit -m source >/dev/null

write_snapshot() {
  mkdir -p .omo
  SHA=$(git rev-parse HEAD)
  FILES=$(git ls-files -z | node -e 'let c=0;process.stdin.on("data",d=>{for(let i=0;i<d.length;i++)if(d[i]===0)c++});process.stdin.on("end",()=>process.stdout.write(String(c)))')
  LOC=$(git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.go' '*.rs' '*.java' '*.kt' '*.swift' '*.rb' '*.php' '*.c' '*.cpp' '*.cs' '*.scala' '*.lua' '*.ex' '*.exs' '*.zig' '*.dart' | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')
  NOW=$(node -e 'console.log(Date.now())')
  USER_MODE_CHOICE="${USER_MODE_CHOICE:-}" && if [ "$USER_MODE_CHOICE" = "committed" ]; then MODE=committed; elif [ "$USER_MODE_CHOICE" = "local" ]; then MODE=local; elif git ls-files --error-unmatch AGENTS.md >/dev/null 2>&1; then MODE=committed; else MODE=local; fi
  cat > .omo/init-deep.json <<EOF
{"commitSha":"$SHA","fileCount":$FILES,"loc":${LOC:-0},"timestamp":$NOW,"mode":"$MODE"}
EOF
  if [ "$MODE" = "local" ]; then
    EXCLUDE=$(git rev-parse --git-path info/exclude)
    mkdir -p "$(dirname "$EXCLUDE")"
    if ! grep -q '# >>> omo-senpi init-deep local (managed)' "$EXCLUDE" 2>/dev/null; then
      cat >> "$EXCLUDE" <<'BLOCK'
# >>> omo-senpi init-deep local (managed)
# Do not edit this block; rerun init-deep or switch modes.
/.omo/init-deep.json
AGENTS.md
# <<< omo-senpi init-deep local (managed)
BLOCK
    fi
  fi
}

remove_managed_block() {
  EXCLUDE=$(git rev-parse --git-path info/exclude)
  sed -i.bak "/# >>> omo-senpi init-deep local (managed)/,/# <<< omo-senpi init-deep local (managed)/d" "$EXCLUDE"
  rm -f "$EXCLUDE.bak"
}

json_field() {
  node -e 'const v=JSON.parse(require("fs").readFileSync(".omo/init-deep.json","utf8"));process.stdout.write(String(v[process.argv[1]]))' "$1"
}

touch AGENTS.md
USER_MODE_CHOICE="" write_snapshot
test "$(json_field mode)" = "local"
test "$(json_field commitSha)" = "$(git rev-parse HEAD)"
test "$(json_field fileCount)" -eq "$(git ls-files -z | node -e 'let c=0;process.stdin.on("data",d=>{for(let i=0;i<d.length;i++)if(d[i]===0)c++});process.stdin.on("end",()=>process.stdout.write(String(c)))')"
test "$(json_field loc)" -ge 0
test "$(json_field timestamp)" -ge 1000000000000
grep -q '# >>> omo-senpi init-deep local (managed)' "$(git rev-parse --git-path info/exclude)"
QA_REPO="$TMPREPO" bun -e 'const {readSnapshot}=await import(process.env.STATE_MODULE);const r=readSnapshot(process.env.QA_REPO);if(r.kind!=="valid"||r.snapshot.mode!=="local")process.exit(1)'

USER_MODE_CHOICE=committed write_snapshot
test "$(json_field mode)" = "committed"
remove_managed_block
! grep -q '# >>> omo-senpi init-deep local (managed)' "$(git rev-parse --git-path info/exclude)"

git add AGENTS.md
git -c user.name=QA -c user.email=qa@example.invalid -c commit.gpgsign=false commit -m agents >/dev/null
USER_MODE_CHOICE="" write_snapshot
test "$(json_field mode)" = "committed"

USER_MODE_CHOICE=local write_snapshot
test "$(json_field mode)" = "local"
git ls-files --error-unmatch AGENTS.md >/dev/null

rm -f AGENTS.md
git rm --cached AGENTS.md >/dev/null
USER_MODE_CHOICE=committed write_snapshot
test "$(json_field mode)" = "committed"
! grep -q '# >>> omo-senpi init-deep local (managed)' "$(git rev-parse --git-path info/exclude)"

echo "qa-snapshot: OK"
