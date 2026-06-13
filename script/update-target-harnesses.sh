#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
ASSUME_YES=0
SKIP_LIVE_VERIFICATION=0
BACKUP_DIR=""
VERIFY_MODEL="${OMO_UPDATE_VERIFY_MODEL:-xiaomi-mimo/mimo-v2.5-pro}"
FALLBACK_MODEL="${OMO_UPDATE_FALLBACK_MODEL:-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free}"
UPDATE_TIMEOUT="${OMO_UPDATE_TIMEOUT_SECONDS:-900}"
VERIFY_TIMEOUT="${OMO_UPDATE_VERIFY_TIMEOUT_SECONDS:-420}"

usage() {
  cat <<'EOF'
Usage: bash script/update-target-harnesses.sh [options]

Updates Oh My Pi and Pi while preserving compatible local installed-package
edits through a three-way merge. Then rebuilds, relinks, and verifies OMO.

Options:
  --dry-run                 Show the discovered paths and planned operations only.
  --yes                     Skip the interactive "UPDATE BOTH" confirmation.
  --skip-live-verification  Skip model-backed diagnostic calls after local checks.
  --backup-dir PATH         Write backups and merge workspaces under PATH.
  --help                    Show this help.

Environment:
  OMO_UPDATE_VERIFY_MODEL            Primary model for live diagnostics.
  OMO_UPDATE_FALLBACK_MODEL          Fallback model for live diagnostics.
  OMO_UPDATE_TIMEOUT_SECONDS         Harness update timeout, default 900.
  OMO_UPDATE_VERIFY_TIMEOUT_SECONDS  Per-model diagnostic timeout, default 420.
EOF
}

log() {
  printf '[omo-update] %s\n' "$*"
}

die() {
  printf '[omo-update] ERROR: %s\n' "$*" >&2
  if [[ -n "${BACKUP_DIR:-}" && -d "${BACKUP_DIR:-}" ]]; then
    printf '[omo-update] Backup and recovery workspace: %s\n' "$BACKUP_DIR" >&2
  fi
  exit 1
}

on_unhandled_error() {
  local status="$?"
  local line="$1"
  printf '[omo-update] ERROR: command failed at line %s with exit %s\n' "$line" "$status" >&2
  if [[ -n "${BACKUP_DIR:-}" && -d "${BACKUP_DIR:-}" ]]; then
    printf '[omo-update] Backup and recovery workspace: %s\n' "$BACKUP_DIR" >&2
    if [[ -x "$BACKUP_DIR/restore-before-update.sh" ]]; then
      printf '[omo-update] Pre-update package restore: %s/restore-before-update.sh\n' "$BACKUP_DIR" >&2
    fi
  fi
  exit "$status"
}

trap 'on_unhandled_error "$LINENO"' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

package_version() {
  node -e 'console.log(require(process.argv[1]).version)' "$1/package.json"
}

package_name() {
  node -e 'console.log(require(process.argv[1]).name)' "$1/package.json"
}

safe_name() {
  printf '%s' "$1" | tr '@/ ' '___'
}

clear_tree_except_git() {
  local target="$1"
  find "$target" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +
}

clear_tree_except_node_modules() {
  local target="$1"
  find "$target" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +
}

copy_package_tree() {
  local source="$1"
  local target="$2"
  (
    cd "$source"
    tar --exclude='./.git' --exclude='./node_modules' -cf - .
  ) | (
    cd "$target"
    tar -xf -
  )
}

overlay_merge_tree() {
  local source="$1"
  local target="$2"
  clear_tree_except_git "$target"
  copy_package_tree "$source" "$target"
}

apply_merged_tree() {
  local source="$1"
  local target="$2"
  clear_tree_except_node_modules "$target"
  copy_package_tree "$source" "$target"
}

snapshot_repo() {
  local repo="$1"
  local label="$2"
  local output_dir="$BACKUP_DIR/source-snapshots/$label"
  [[ -d "$repo/.git" ]] || return 0
  mkdir -p "$output_dir"
  git -C "$repo" status --short >"$output_dir/status.txt"
  git -C "$repo" diff --binary >"$output_dir/worktree.patch"
  git -C "$repo" diff --cached --binary >"$output_dir/index.patch"
  git -C "$repo" rev-parse HEAD >"$output_dir/head.txt"
}

backup_agent_state() {
  local agent_dir="$1"
  local archive="$2"
  [[ -d "$agent_dir" ]] || return 0
  tar \
    --exclude='./sessions' \
    --exclude='./git' \
    --exclude='./npm' \
    --exclude='./memory' \
    --exclude='./cache' \
    --exclude='./blobs' \
    --exclude='./terminal-sessions' \
    -czf "$archive" -C "$agent_dir" .
}

write_restore_script() {
  local restore="$BACKUP_DIR/restore-before-update.sh"
  cat >"$restore" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

echo "This replaces the four installed harness packages with their pre-update backups."
read -r -p 'Type RESTORE PACKAGES to continue: ' answer
[[ "\$answer" == "RESTORE PACKAGES" ]] || { echo "Restore cancelled."; exit 1; }
EOF

  local index
  for index in "${!PACKAGE_PATHS[@]}"; do
    local path="${PACKAGE_PATHS[$index]}"
    local archive="${PACKAGE_BACKUPS[$index]}"
    printf 'rm -rf -- %q\n' "$path" >>"$restore"
    printf 'mkdir -p -- %q\n' "$(dirname "$path")" >>"$restore"
    printf 'tar -xzf %q -C %q\n' "$archive" "$(dirname "$path")" >>"$restore"
  done

  cat >>"$restore" <<EOF

echo "Package restore complete."
echo "Optional agent-state snapshots are in: $BACKUP_DIR/agent-state"
EOF
  chmod +x "$restore"
}

prepare_merge_workspace() {
  local index="$1"
  local installed="${PACKAGE_PATHS[$index]}"
  local pkg="${PACKAGE_NAMES[$index]}"
  local version="${PACKAGE_VERSIONS[$index]}"
  local safe="${PACKAGE_SAFE_NAMES[$index]}"
  local pack_dir="$BACKUP_DIR/registry-tarballs"
  local baseline_dir="$BACKUP_DIR/baselines/$safe"
  local merge_dir="$BACKUP_DIR/merges/$safe"
  local pack_output
  local tarball

  mkdir -p "$pack_dir" "$baseline_dir" "$merge_dir"
  log "Downloading pristine merge base: $pkg@$version"
  pack_output="$(cd "$pack_dir" && timeout "${UPDATE_TIMEOUT}s" npm pack "$pkg@$version" --silent)"
  tarball="$pack_dir/$(printf '%s\n' "$pack_output" | tail -n 1)"
  [[ -f "$tarball" ]] || die "npm pack did not produce a tarball for $pkg@$version"
  tar -xf "$tarball" -C "$baseline_dir" --strip-components=1

  copy_package_tree "$baseline_dir" "$merge_dir"
  git -C "$merge_dir" init -q
  git -C "$merge_dir" config user.name "OMO Harness Updater"
  git -C "$merge_dir" config user.email "omo-harness-updater@localhost"
  git -C "$merge_dir" add -A
  git -C "$merge_dir" commit -q --allow-empty -m "pristine $pkg@$version"
  PACKAGE_BASE_COMMITS[$index]="$(git -C "$merge_dir" rev-parse HEAD)"

  git -C "$merge_dir" switch -q -c local-patches
  overlay_merge_tree "$installed" "$merge_dir"
  git -C "$merge_dir" add -A
  git -C "$merge_dir" commit -q --allow-empty -m "local installed edits"
  PACKAGE_LOCAL_COMMITS[$index]="$(git -C "$merge_dir" rev-parse HEAD)"
  git -C "$merge_dir" switch -q --detach "${PACKAGE_BASE_COMMITS[$index]}"
}

merge_updated_package() {
  local index="$1"
  local installed="${PACKAGE_PATHS[$index]}"
  local pkg="${PACKAGE_NAMES[$index]}"
  local safe="${PACKAGE_SAFE_NAMES[$index]}"
  local merge_dir="$BACKUP_DIR/merges/$safe"
  local local_commit="${PACKAGE_LOCAL_COMMITS[$index]}"

  git -C "$merge_dir" switch -q -C upstream-update "${PACKAGE_BASE_COMMITS[$index]}"
  overlay_merge_tree "$installed" "$merge_dir"
  git -C "$merge_dir" add -A
  git -C "$merge_dir" commit -q --allow-empty -m "updated upstream $pkg"

  log "Three-way merging local installed edits into updated $pkg"
  if ! git -C "$merge_dir" merge --no-edit "$local_commit"; then
    printf '\n[omo-update] Merge conflict in %s.\n' "$pkg" >&2
    printf '[omo-update] Updated upstream package remains installed and untouched by the merge result.\n' >&2
    printf '[omo-update] Resolve or inspect the merge workspace: %s\n' "$merge_dir" >&2
    printf '[omo-update] Restore pre-update packages with: %s/restore-before-update.sh\n' "$BACKUP_DIR" >&2
    exit 1
  fi
}

run_live_diagnostic() {
  local harness="$1"
  local expected="$2"
  local output_file="$BACKUP_DIR/verification/${harness}.txt"
  local model
  mkdir -p "$BACKUP_DIR/verification"

  for model in "$VERIFY_MODEL" "$FALLBACK_MODEL"; do
    [[ -n "$model" ]] || continue
    log "Running $harness live diagnostic with $model"
    if [[ "$harness" == "omp" ]]; then
      if timeout "${VERIFY_TIMEOUT}s" omp --mode text --print --no-title --model "$model" --thinking high \
        'Use tools. Call omo_diagnostic. Final answer exactly: DIAG=<one-line tool result>. Use ASCII only.' \
        >"$output_file" 2>&1 && grep -Fq "$expected" "$output_file"; then
        return 0
      fi
    else
      if timeout "${VERIFY_TIMEOUT}s" pi --mode text --print --model "$model" --thinking high \
        'Use tools. Call omo_pi_diagnostic. Final answer exactly: DIAG=<one-line tool result>. Use ASCII only.' \
        >"$output_file" 2>&1 && grep -Fq "$expected" "$output_file"; then
        return 0
      fi
    fi
    log "$harness diagnostic failed with $model; trying the next configured model"
  done

  die "$harness live diagnostic failed. Inspect $output_file"
}

while (($#)); do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --yes)
      ASSUME_YES=1
      ;;
    --skip-live-verification)
      SKIP_LIVE_VERIFICATION=1
      ;;
    --backup-dir)
      shift
      (($#)) || die "--backup-dir requires a path"
      BACKUP_DIR="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

for command_name in bun git node npm omp pi tar timeout; do
  require_command "$command_name"
done

OMP_CLI="$(readlink -f "$(command -v omp)")"
PI_CLI="$(readlink -f "$(command -v pi)")"
OMP_ROOT="$(dirname "$(dirname "$OMP_CLI")")"
PI_ROOT="$(dirname "$(dirname "$PI_CLI")")"
OMP_SCOPE_ROOT="$(dirname "$OMP_ROOT")"
PI_SCOPE_ROOT="$(dirname "$PI_ROOT")"

declare -a PACKAGE_PATHS=(
  "$OMP_ROOT"
  "$OMP_SCOPE_ROOT/pi-ai"
  "$PI_ROOT"
  "$PI_SCOPE_ROOT/pi-ai"
)
declare -a PACKAGE_NAMES=()
declare -a PACKAGE_VERSIONS=()
declare -a PACKAGE_SAFE_NAMES=()
declare -a PACKAGE_BACKUPS=()
declare -a PACKAGE_BASE_COMMITS=()
declare -a PACKAGE_LOCAL_COMMITS=()

for path in "${PACKAGE_PATHS[@]}"; do
  [[ -f "$path/package.json" ]] || die "Expected installed package is missing: $path"
  pkg="$(package_name "$path")"
  version="$(package_version "$path")"
  PACKAGE_NAMES+=("$pkg")
  PACKAGE_VERSIONS+=("$version")
  PACKAGE_SAFE_NAMES+=("$(safe_name "$pkg")")
done

log "Repository: $ROOT_DIR"
log "Oh My Pi: ${PACKAGE_VERSIONS[0]} at ${PACKAGE_PATHS[0]}"
log "Pi: ${PACKAGE_VERSIONS[2]} at ${PACKAGE_PATHS[2]}"
log "Planned update commands:"
log "  omp update --force"
log "  pi update pi --force"
log "Post-update: three-way package merge, full OMO rebuild, relink, focused tests, typecheck, diagnostics"

if ((DRY_RUN)); then
  log "Dry run complete. No downloads, updates, backups, builds, or tests were performed."
  exit 0
fi

if ((ASSUME_YES == 0)); then
  printf '\nThis updates both installed harnesses and reapplies compatible local runtime edits.\n'
  printf 'A conflict stops before merged package files are installed.\n'
  read -r -p 'Type UPDATE BOTH to continue: ' confirmation
  [[ "$confirmation" == "UPDATE BOTH" ]] || die "Confirmation did not match; update cancelled"
fi

if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="${HOME:?}/.omo/harness-update-backups/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$BACKUP_DIR/packages" "$BACKUP_DIR/agent-state" "$BACKUP_DIR/logs"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
log "Backup and merge workspace: $BACKUP_DIR"

snapshot_repo "$ROOT_DIR" "oh-my-openagent"
snapshot_repo "${OMP_SOURCE_REPO:-$HOME/pr-work/oh-my-pi}" "oh-my-pi"
snapshot_repo "${PI_SOURCE_REPO:-$HOME/pi-mono}" "pi-mono"

for index in "${!PACKAGE_PATHS[@]}"; do
  path="${PACKAGE_PATHS[$index]}"
  safe="${PACKAGE_SAFE_NAMES[$index]}"
  archive="$BACKUP_DIR/packages/$safe.tar.gz"
  log "Backing up ${PACKAGE_NAMES[$index]}"
  tar -czf "$archive" -C "$(dirname "$path")" "$(basename "$path")"
  PACKAGE_BACKUPS+=("$archive")
done

backup_agent_state "$HOME/.omp/agent" "$BACKUP_DIR/agent-state/omp-agent-without-caches.tar.gz"
backup_agent_state "$HOME/.pi/agent" "$BACKUP_DIR/agent-state/pi-agent-without-caches.tar.gz"
write_restore_script

for index in "${!PACKAGE_PATHS[@]}"; do
  prepare_merge_workspace "$index"
done

log "Updating Oh My Pi"
timeout "${UPDATE_TIMEOUT}s" omp update --force 2>&1 | tee "$BACKUP_DIR/logs/omp-update.log"
log "Updating Pi"
timeout "${UPDATE_TIMEOUT}s" pi update pi --force 2>&1 | tee "$BACKUP_DIR/logs/pi-update.log"

for index in "${!PACKAGE_PATHS[@]}"; do
  [[ -f "${PACKAGE_PATHS[$index]}/package.json" ]] || die "Updated package disappeared: ${PACKAGE_PATHS[$index]}"
  merge_updated_package "$index"
done

for index in "${!PACKAGE_PATHS[@]}"; do
  log "Installing merged package tree: ${PACKAGE_NAMES[$index]}"
  apply_merged_tree "$BACKUP_DIR/merges/${PACKAGE_SAFE_NAMES[$index]}" "${PACKAGE_PATHS[$index]}"
done

cd "$ROOT_DIR"
log "Running the full OMO build"
bun run build

log "Relinking OMO into both harnesses"
bun src/cli/index.ts install-targets --target both

log "Running focused target adapter tests"
bun test \
  src/host-contract \
  src/host-runtime \
  src/host-tools \
  src/host-agents \
  src/host-resources \
  src/host-hooks \
  src/host-mcp \
  src/hosts \
  src/cli/install-targets

log "Running OMO typecheck"
bun run typecheck

log "Checking rebuilt bundle imports"
node -e 'Promise.all([import("./dist/hosts/oh-my-pi/index.js"), import("./dist/hosts/pi/index.js")]).then(() => console.log("Both target bundles import successfully."))'

if ((SKIP_LIVE_VERIFICATION == 0)); then
  run_live_diagnostic "omp" "Oh My OpenAgent Oh My Pi adapter loaded"
  run_live_diagnostic "pi" "Oh My OpenAgent Pi adapter loaded"
else
  log "Skipping live model-backed diagnostics by request"
fi

log "Update and verification complete"
log "Oh My Pi version: $(omp --version | head -n 1)"
log "Pi version: $(pi --version | head -n 1)"
log "Backup and merge workspace: $BACKUP_DIR"
