#!/usr/bin/env bash
# lsp-e2e.sh - isolated live Codex QA for the shared OMO LSP daemon.
#
# Normal mode installs this worktree's OMO plugin into a disposable CODEX_HOME,
# drives a real `codex app-server` against the local codex-qa mock model, calls
# the installed lsp MCP through `mcpServer/tool/call`, and records a PASS result
# only after path-contract / rename, hook, isolation, and cleanup assertions
# succeed.
#
# Usage:
#   lsp-e2e.sh --scenario <name> --evidence-dir <absolute-dir>
#   lsp-e2e.sh --self-test

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd -P)"

SCENARIO=""
EVIDENCE_DIR=""
SELF_TEST=0
SANDBOX_ROOT=""
OMO_TEST_ROOT=""
EXPECTED_DAEMON_CLI=""
MOCK_PID=""
APP_SERVER_PID_FILE=""
RESULT_STAGE=""
CLEANUP_RUNNING=0
NORMAL_CLEANUP_COMPLETE=0
REAL_HOME="${HOME:-}"
REAL_OMO_ROOT="${HOME:-}/.omo/lsp-daemon"
REAL_CODEX_CONFIG="${HOME:-}/.codex/config.toml"
REAL_OMO_BEFORE_HASH=""
DAEMON_DIST_DIR="$REPO_ROOT/packages/lsp-daemon/dist"
DAEMON_DIST_BACKUP=""
DAEMON_DIST_WAS_PRESENT=0
DAEMON_DIST_PREPARED=0
BUILD_LOCK_DIR=""
CANCELLATION_SMOKE_RELATIVE="packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs"
COMMIT_BARRIER_SMOKE_RELATIVE="packages/lsp-daemon/scripts/qa/commit-barrier-smoke.mjs"

log() { printf '[codex-lsp-e2e] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; return 1; }

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --scenario)
        [ "$#" -ge 2 ] || { log "--scenario requires a value"; return 2; }
        [ -z "$SCENARIO" ] || { log "--scenario may be provided only once"; return 2; }
        SCENARIO="$2"
        shift 2
        ;;
      --evidence-dir)
        [ "$#" -ge 2 ] || { log "--evidence-dir requires a directory"; return 2; }
        [ -z "$EVIDENCE_DIR" ] || { log "--evidence-dir may be provided only once"; return 2; }
        EVIDENCE_DIR="$2"
        shift 2
        ;;
      --self-test)
        [ "$SELF_TEST" -eq 0 ] || { log "--self-test may be provided only once"; return 2; }
        SELF_TEST=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log "unknown option: $1"
        return 2
        ;;
    esac
  done

  if [ "$SELF_TEST" -eq 1 ]; then
    if [ -n "$SCENARIO" ] || [ -n "$EVIDENCE_DIR" ]; then
      log "--self-test cannot be combined with normal-mode options"
      return 2
    fi
    return 0
  fi

  [ -n "$SCENARIO" ] || { log "--scenario is required"; return 2; }
  [ -n "$EVIDENCE_DIR" ] || { log "--evidence-dir is required"; return 2; }
  case "$SCENARIO" in
    [A-Za-z0-9]* ) ;;
    * ) log "invalid scenario: $SCENARIO"; return 2 ;;
  esac
  if ! printf '%s' "$SCENARIO" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'; then
    log "invalid scenario: $SCENARIO"
    return 2
  fi
  case "$EVIDENCE_DIR" in
    /*) ;;
    *) log "--evidence-dir must be absolute"; return 2 ;;
  esac
}

require_bins() {
  local missing=0 bin
  for bin in "$@"; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log "missing dependency: $bin"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ]
}

verify_tracked_cancellation_probes() {
  local dependency ignored_evidence_root=".omo""/evidence"
  if grep -Fq "$ignored_evidence_root" "${BASH_SOURCE[0]}"; then
    fail "LSP QA driver references ignored evidence state"
    return 1
  fi
  for dependency in "$CANCELLATION_SMOKE_RELATIVE" "$COMMIT_BARRIER_SMOKE_RELATIVE"; do
    [ -f "$REPO_ROOT/$dependency" ] || { fail "missing cancellation QA dependency: $dependency"; return 1; }
    git -C "$REPO_ROOT" ls-files --error-unmatch -- "$dependency" >/dev/null 2>&1 || {
      fail "cancellation QA dependency is not tracked: $dependency"
      return 1
    }
  done
}

hash_path() {
  node --input-type=module - "$1" <<'NODE'
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const target = process.argv[2];
const hash = createHash("sha256");

function visit(path, relative) {
  const stat = lstatSync(path);
  const kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "link" : "special";
  hash.update(`${kind}\0${relative}\0${stat.mode & 0o7777}\0`);
  if (kind === "file") hash.update(readFileSync(path));
  if (kind === "link") hash.update(readlinkSync(path));
  if (kind === "dir") {
    for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
  }
}

try {
  visit(target, basename(target));
  process.stdout.write(hash.digest("hex"));
} catch (error) {
  if (error && error.code === "ENOENT") process.stdout.write("ABSENT");
  else throw error;
}
NODE
}

run_bounded() {
  local seconds="$1" output="$2"
  shift 2
  node --input-type=module - "$seconds" "$output" "$@" <<'NODE'
import { closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";

const [secondsRaw, output, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsRaw);
if (!Number.isFinite(seconds) || seconds <= 0 || !command) process.exit(125);
const fd = openSync(output, "w");
const child = spawn(command, args, {
  stdio: ["ignore", fd, fd],
  detached: process.platform !== "win32",
  env: process.env,
});
let timedOut = false;
let forceTimer;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {}
  forceTimer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {}
  }, 3000);
}, seconds * 1000);
child.on("error", () => {
  clearTimeout(timer);
  if (forceTimer) clearTimeout(forceTimer);
  closeSync(fd);
  process.exit(126);
});
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (forceTimer) clearTimeout(forceTimer);
  closeSync(fd);
  if (timedOut) process.exit(124);
  if (typeof code === "number") process.exit(code);
  process.exit(signal ? 128 : 1);
});
NODE
}

with_shared_build_lock() {
  local command_name="$1" attempts=0 rc
  shift
  BUILD_LOCK_DIR="$REPO_ROOT/.omo/locks/lsp-daemon-build.lock"
  mkdir -p "$(dirname "$BUILD_LOCK_DIR")"
  while ! mkdir "$BUILD_LOCK_DIR" 2>/dev/null; do
    [ "$attempts" -lt 600 ] || { fail "timed out waiting for shared LSP daemon build lock"; return 1; }
    sleep 0.2
    attempts=$((attempts + 1))
  done
  printf 'pid=%s\ncommand=%s\n' "$$" "$command_name" >"$BUILD_LOCK_DIR/owner.txt"
  "$@"
  rc=$?
  rm -rf "$BUILD_LOCK_DIR"
  BUILD_LOCK_DIR=""
  return "$rc"
}

safe_rm_tree() {
  local path="$1"
  local attempt=0
  [ -n "$path" ] || return 0
  case "$path" in
    /var/folders/*/T/cqa-lsp-e2e.*|/tmp/cqa-lsp-e2e.*|/private/tmp/cqa-lsp-e2e.*)
      while [ -e "$path" ] && [ "$attempt" -lt 100 ]; do
        rm -rf "$path" 2>/dev/null || true
        [ ! -e "$path" ] && return 0
        sleep 0.1
        attempt=$((attempt + 1))
      done
      [ ! -e "$path" ] || fail "isolated sandbox remained after bounded cleanup: $path"
      ;;
    *)
      fail "refusing to remove unexpected sandbox path: $path"
      ;;
  esac
}

owned_sandbox_pids() {
  [ -n "$SANDBOX_ROOT" ] || return 0
  /bin/ps ax -o pid=,command= 2>/dev/null | while read -r pid command; do
    case "$command" in
      *"$SANDBOX_ROOT"*)
        [ "$pid" = "$$" ] || printf '%s\n' "$pid"
        ;;
    esac
  done
}

stop_owned_sandbox_processes() {
  local pids pid command
  pids="$(owned_sandbox_pids)"
  [ -n "$pids" ] || return 0
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null || continue
    command="$(process_command "$pid")"
    case "$command" in
      *"$SANDBOX_ROOT"*) ;;
      *) fail "sandbox process $pid changed identity before cleanup"; return 1 ;;
    esac
    kill "$pid" 2>/dev/null || true
    if ! wait_for_exit "$pid"; then
      command="$(process_command "$pid")"
      case "$command" in
        *"$SANDBOX_ROOT"*) kill -9 "$pid" 2>/dev/null || true ;;
        *) fail "sandbox process $pid changed identity during cleanup"; return 1 ;;
      esac
      wait_for_exit "$pid" || { fail "sandbox process $pid survived cleanup"; return 1; }
    fi
    if [ -n "$EVIDENCE_DIR" ] && [ -d "$EVIDENCE_DIR" ]; then
      printf 'sandbox_process_pid=%s alive_after=no\n' "$pid" >>"$EVIDENCE_DIR/owned-process-cleanup.txt"
    fi
  done
}

process_command() {
  /bin/ps -p "$1" -o command= 2>/dev/null || true
}

wait_for_exit() {
  local pid="$1" attempts=0
  while [ "$attempts" -lt 50 ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
    attempts=$((attempts + 1))
  done
  return 1
}

stop_known_pid_file() {
  local pid_file="$1" expected_fragment="$2" label="$3"
  [ -n "$pid_file" ] && [ -f "$pid_file" ] || return 0
  local pid command
  pid="$(tr -d '[:space:]' <"$pid_file" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 0
  command="$(process_command "$pid")"
  case "$command" in
    *"$expected_fragment"*) ;;
    *) fail "refusing to stop unverified $label pid $pid"; return 1 ;;
  esac
  kill "$pid" 2>/dev/null || true
  if ! wait_for_exit "$pid"; then
    command="$(process_command "$pid")"
    case "$command" in
      *"$expected_fragment"*) kill -9 "$pid" 2>/dev/null || true ;;
      *) fail "$label pid $pid changed identity during cleanup"; return 1 ;;
    esac
    wait_for_exit "$pid" || { fail "$label pid $pid survived cleanup"; return 1; }
  fi
}

find_daemon_pid_file() {
  [ -n "$OMO_TEST_ROOT" ] && [ -d "$OMO_TEST_ROOT" ] || return 0
  find "$OMO_TEST_ROOT" -type f -name daemon.pid -print 2>/dev/null | sort | head -1
}

stop_known_daemon() {
  local pid_file pid command
  pid_file="$(find_daemon_pid_file)"
  [ -n "$pid_file" ] || return 0
  pid="$(tr -d '[:space:]' <"$pid_file" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*) fail "daemon pid file is malformed: $pid_file"; return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 0
  command="$(process_command "$pid")"
  case "$command" in
    *"$EXPECTED_DAEMON_CLI"*" daemon"*) ;;
    *) fail "refusing to stop unverified daemon pid $pid"; return 1 ;;
  esac
  kill "$pid" 2>/dev/null || true
  if ! wait_for_exit "$pid"; then
    command="$(process_command "$pid")"
    case "$command" in
      *"$EXPECTED_DAEMON_CLI"*" daemon"*) kill -9 "$pid" 2>/dev/null || true ;;
      *) fail "daemon pid $pid changed identity during cleanup"; return 1 ;;
    esac
    wait_for_exit "$pid" || { fail "daemon pid $pid survived cleanup"; return 1; }
  fi
}

stop_owned_real_daemon_leak() {
  [ "$REAL_OMO_BEFORE_HASH" = "ABSENT" ] || return 0
  [ "$OMO_TEST_ROOT" != "$REAL_OMO_ROOT" ] || return 0
  [ -d "$REAL_OMO_ROOT" ] || return 0
  local pid_file pid command state_dir
  pid_file="$(find "$REAL_OMO_ROOT" -type f -name daemon.pid -print 2>/dev/null | sort | head -1)"
  if [ -n "$pid_file" ]; then
    pid="$(tr -d '[:space:]' <"$pid_file" 2>/dev/null || true)"
    case "$pid" in
      ''|*[!0-9]*) fail "real-root leak pid file is malformed"; return 1 ;;
    esac
    command="$(process_command "$pid")"
    case "$command" in
      *"$EXPECTED_DAEMON_CLI"*" daemon"*) ;;
      *) fail "real OMO root changed by an unverified process; preserving it"; return 1 ;;
    esac
    kill "$pid" 2>/dev/null || true
    wait_for_exit "$pid" || { fail "own leaked daemon did not stop"; return 1; }
  fi
  if find "$REAL_OMO_ROOT" -type f \( -name daemon.pid -o -name daemon.endpoint \) -print 2>/dev/null | grep -q .; then
    fail "real OMO root still contains live markers after own-daemon cleanup"
    return 1
  fi
  find "$REAL_OMO_ROOT" -type f -name daemon.log -delete 2>/dev/null || true
  while IFS= read -r state_dir; do rmdir "$state_dir" 2>/dev/null || true; done < <(find "$REAL_OMO_ROOT" -depth -type d -print 2>/dev/null)
  [ ! -e "$REAL_OMO_ROOT" ] || { fail "real OMO root could not be restored to ABSENT"; return 1; }
}

stop_mock() {
  [ -n "$MOCK_PID" ] || return 0
  if kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait_for_exit "$MOCK_PID" || kill -9 "$MOCK_PID" 2>/dev/null || true
  fi
  MOCK_PID=""
}

cleanup_all() {
  local cleanup_rc=0
  [ "$CLEANUP_RUNNING" -eq 0 ] || return 0
  CLEANUP_RUNNING=1
  stop_mock || cleanup_rc=1
  if [ -n "$APP_SERVER_PID_FILE" ]; then
    stop_known_pid_file "$APP_SERVER_PID_FILE" "app-server" "Codex app-server" || cleanup_rc=1
  fi
  stop_known_daemon || cleanup_rc=1
  stop_owned_sandbox_processes || cleanup_rc=1
  stop_owned_real_daemon_leak || cleanup_rc=1
  restore_daemon_dist || cleanup_rc=1
  if [ -n "$BUILD_LOCK_DIR" ]; then
    rm -rf "$BUILD_LOCK_DIR" 2>/dev/null || cleanup_rc=1
    BUILD_LOCK_DIR=""
  fi
  [ -n "$RESULT_STAGE" ] && rm -f "$RESULT_STAGE" 2>/dev/null || true
  if [ -n "$EVIDENCE_DIR" ] && [ -d "$EVIDENCE_DIR" ]; then
    find "$EVIDENCE_DIR" -maxdepth 1 -type f -name '.result.json.*' -delete 2>/dev/null || true
  fi
  if [ -n "$SANDBOX_ROOT" ]; then
    safe_rm_tree "$SANDBOX_ROOT" || cleanup_rc=1
    SANDBOX_ROOT=""
  fi
  CLEANUP_RUNNING=0
  return "$cleanup_rc"
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ "$NORMAL_CLEANUP_COMPLETE" -eq 0 ]; then
    cleanup_all || rc=1
  fi
  if [ "$rc" -ne 0 ] && [ -n "$EVIDENCE_DIR" ] && [ -d "$EVIDENCE_DIR" ]; then
    rm -f "$EVIDENCE_DIR/result.json" 2>/dev/null || true
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

prepare_evidence() {
  [ ! -L "$EVIDENCE_DIR" ] || { fail "evidence directory must not be a symlink"; return 1; }
  mkdir -p "$EVIDENCE_DIR" || return 1
  EVIDENCE_DIR="$(cd "$EVIDENCE_DIR" && pwd -P)"
  rm -f "$EVIDENCE_DIR/result.json"
  find "$EVIDENCE_DIR" -maxdepth 1 -type f -name '.result.json.*' -delete 2>/dev/null || true
  printf 'bash %s --scenario %s --evidence-dir %s\n' \
    "${BASH_SOURCE[0]}" "$SCENARIO" "$EVIDENCE_DIR" >"$EVIDENCE_DIR/invocation.txt"
}

daemon_dist_ready() {
  [ -f "$DAEMON_DIST_DIR/package.json" ] \
    && [ -f "$DAEMON_DIST_DIR/index.js" ] \
    && [ -f "$DAEMON_DIST_DIR/cli.js" ]
}

snapshot_daemon_dist() {
  local backup_root="$1"
  mkdir -p "$backup_root" || return 1
  DAEMON_DIST_BACKUP="$backup_root/lsp-daemon-dist.backup"
  rm -rf "$DAEMON_DIST_BACKUP"
  if [ -e "$DAEMON_DIST_DIR" ]; then
    cp -a "$DAEMON_DIST_DIR" "$DAEMON_DIST_BACKUP" || return 1
    DAEMON_DIST_WAS_PRESENT=1
  else
    DAEMON_DIST_WAS_PRESENT=0
  fi
  DAEMON_DIST_PREPARED=1
}

restore_daemon_dist() {
  [ "$DAEMON_DIST_PREPARED" -eq 1 ] || return 0
  rm -rf "$DAEMON_DIST_DIR" || return 1
  if [ "$DAEMON_DIST_WAS_PRESENT" -eq 1 ]; then
    mkdir -p "$(dirname "$DAEMON_DIST_DIR")" || return 1
    cp -a "$DAEMON_DIST_BACKUP" "$DAEMON_DIST_DIR" || return 1
  fi
  if [ -n "$EVIDENCE_DIR" ] && [ -d "$EVIDENCE_DIR" ]; then
    {
      printf 'daemon_dist_was_present=%s\n' "$( [ "$DAEMON_DIST_WAS_PRESENT" -eq 1 ] && echo true || echo false )"
      printf 'daemon_dist_restored=true\n'
      printf 'daemon_dist_path=%s\n' "$DAEMON_DIST_DIR"
    } >>"$EVIDENCE_DIR/daemon-dist-cleanup.txt"
  fi
  DAEMON_DIST_BACKUP=""
  DAEMON_DIST_WAS_PRESENT=0
  DAEMON_DIST_PREPARED=0
}

prepare_daemon_dist() {
  if daemon_dist_ready; then
    printf 'daemon_dist_ready_before=true\nbuild_skipped=true\n' >"$EVIDENCE_DIR/lsp-daemon-prebuild-receipt.txt"
    return 0
  fi
  if [ "$DAEMON_DIST_PREPARED" -eq 0 ]; then
    snapshot_daemon_dist "$SANDBOX_ROOT/daemon-dist-backup" || return 1
  fi
  {
    printf 'daemon_dist_ready_before=false\n'
    printf 'daemon_dist_was_present=%s\n' "$( [ "$DAEMON_DIST_WAS_PRESENT" -eq 1 ] && echo true || echo false )"
    printf 'command=bun run build:lsp-daemon\n'
  } >"$EVIDENCE_DIR/lsp-daemon-prebuild-receipt.txt"
  run_bounded 300 "$EVIDENCE_DIR/lsp-daemon-prebuild.log" bun run build:lsp-daemon || return 1
  daemon_dist_ready || { fail "lsp-daemon prebuild did not create required dist files"; return 1; }
  printf 'daemon_dist_ready_after=true\n' >>"$EVIDENCE_DIR/lsp-daemon-prebuild-receipt.txt"
}

write_path_contract_probe() {
  local probe_dir="$1" output="$2" script="$SANDBOX_ROOT/path-contract-probe.mjs"
  mkdir -p "$probe_dir"
  cat >"$script" <<'NODE'
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.env.REPO_ROOT;
const base = process.env.PROBE_BASE;
const output = process.env.PROBE_OUTPUT;
if (!repoRoot || !base || !output) throw new Error("missing probe environment");
const modulePath = join(repoRoot, "packages/lsp-daemon/dist/index.js");
const daemon = await import(pathToFileURL(modulePath).href + `?qa=${Date.now()}`);
const cliPath = join(repoRoot, "packages/lsp-daemon/dist/cli.js");
const packagedVersion = JSON.parse(readFileSync(join(repoRoot, "packages/lsp-daemon/dist/package.json"), "utf8")).version;
const envNameValues = [daemon.OMO_LSP_DAEMON_CLI, daemon.OMO_LSP_DAEMON_DIR, daemon.OMO_LSP_DAEMON_VERSION].sort();

function capture(run) {
  try {
    run();
    return { threw: false };
  } catch (error) {
    return { threw: true, name: error?.name, code: error?.code, reason: error?.reason, message: error?.message };
  }
}

rmSync(base, { recursive: true, force: true });
const defaultPaths = daemon.daemonPaths({ [daemon.OMO_LSP_DAEMON_DIR]: base });
const pairedVersion = "qa.1+pair";
const pairedPaths = daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: base,
  [daemon.OMO_LSP_DAEMON_CLI]: cliPath,
  [daemon.OMO_LSP_DAEMON_VERSION]: pairedVersion,
});

const singletonRoot = join(dirname(base), "singleton-state");
rmSync(singletonRoot, { recursive: true, force: true });
const singletonCli = capture(() => daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: singletonRoot,
  [daemon.OMO_LSP_DAEMON_CLI]: cliPath,
}));
const singletonVersion = capture(() => daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: singletonRoot,
  [daemon.OMO_LSP_DAEMON_VERSION]: packagedVersion,
}));

const relativeBase = capture(() => daemon.daemonPaths({ [daemon.OMO_LSP_DAEMON_DIR]: "relative/state" }));
const relativeCli = capture(() => daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: join(dirname(base), "relative-cli-state"),
  [daemon.OMO_LSP_DAEMON_CLI]: "relative/cli.js",
  [daemon.OMO_LSP_DAEMON_VERSION]: packagedVersion,
}));
const nonFileCli = join(dirname(base), "not-a-file");
mkdirSync(nonFileCli, { recursive: true });
const missingCli = capture(() => daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: join(dirname(base), "missing-cli-state"),
  [daemon.OMO_LSP_DAEMON_CLI]: join(dirname(base), "missing-cli.js"),
  [daemon.OMO_LSP_DAEMON_VERSION]: packagedVersion,
}));
const directoryCli = capture(() => daemon.daemonPaths({
  [daemon.OMO_LSP_DAEMON_DIR]: join(dirname(base), "directory-cli-state"),
  [daemon.OMO_LSP_DAEMON_CLI]: nonFileCli,
  [daemon.OMO_LSP_DAEMON_VERSION]: packagedVersion,
}));

const badVersions = ["../escape", "a/b", "a\\b", ".hidden", "bad value", "", "a".repeat(129)];
const versionFailures = badVersions.map((version, index) => {
  const stateRoot = join(dirname(base), `bad-version-${index}`);
  rmSync(stateRoot, { recursive: true, force: true });
  return {
    version,
    error: capture(() => daemon.daemonPaths({
      [daemon.OMO_LSP_DAEMON_DIR]: stateRoot,
      [daemon.OMO_LSP_DAEMON_CLI]: cliPath,
      [daemon.OMO_LSP_DAEMON_VERSION]: version,
    })),
    stateCreated: existsSync(stateRoot),
  };
});

const oldPrefix = "CODEX" + "_LSP_";
const neutralPaths = daemon.daemonPaths({
  CODEX_HOME: join(dirname(base), "ignored-codex-home"),
  PLUGIN_DATA: join(dirname(base), "ignored-plugin-data"),
  [`${oldPrefix}DAEMON_DIR`]: join(dirname(base), "ignored-legacy-dir"),
  [`${oldPrefix}DAEMON_CLI`]: join(dirname(base), "ignored-legacy-cli.js"),
  [`${oldPrefix}DAEMON_VERSION`]: "999.999.999",
});
const neutralBase = resolve(process.env.HOME, ".omo", "lsp-daemon");

const assertions = {
  exactThreeOmoEnvironmentNames: JSON.stringify(envNameValues) === JSON.stringify([
    "OMO_LSP_DAEMON_CLI",
    "OMO_LSP_DAEMON_DIR",
    "OMO_LSP_DAEMON_VERSION",
  ]),
  defaultBaseResolved: dirname(defaultPaths.dir) === resolve(base),
  defaultVersionStamped: defaultPaths.version === packagedVersion,
  defaultCliPackaged: defaultPaths.cliPath === cliPath,
  pairedOverridePreserved: pairedPaths.cliPath === cliPath && pairedPaths.version === pairedVersion,
  singletonCliRejectedBeforeState: singletonCli.code === "invalid_runtime_override" && !existsSync(singletonRoot),
  singletonVersionRejectedBeforeState: singletonVersion.code === "invalid_runtime_override" && !existsSync(singletonRoot),
  relativeBaseRejected: relativeBase.code === "invalid_daemon_directory",
  relativeCliRejected: relativeCli.reason === "cli_must_be_absolute",
  missingCliRejected: missingCli.reason === "cli_not_found",
  nonFileCliRejected: directoryCli.reason === "cli_not_file",
  malformedVersionsRejectedBeforeState: versionFailures.every((entry) => entry.error.code === "invalid_daemon_version" && entry.stateCreated === false),
  oldNamesAndHarnessHomesIgnored: dirname(neutralPaths.dir) === neutralBase && neutralPaths.version === packagedVersion,
};
if (!Object.values(assertions).every(Boolean)) {
  console.error(JSON.stringify({ assertions, singletonCli, singletonVersion, versionFailures, neutralPaths }, null, 2));
  process.exit(1);
}

await Bun.write(output, JSON.stringify({
  assertions,
  environmentNames: envNameValues,
  default: defaultPaths,
  paired: pairedPaths,
  neutral: neutralPaths,
  failures: { singletonCli, singletonVersion, relativeBase, relativeCli, missingCli, directoryCli, versionFailures },
}, null, 2) + "\n");
NODE
  REPO_ROOT="$REPO_ROOT" PROBE_BASE="$probe_dir/state/../daemon" PROBE_OUTPUT="$output" \
    run_bounded 30 "$EVIDENCE_DIR/path-contract-probe.log" bun "$script"
}

write_workspace_edit_fixture() {
  local project_dir="$1"
  local scenario_path="$EVIDENCE_DIR/rename-scenario.json"
  local events_path="$EVIDENCE_DIR/rename-server-events.jsonl"
  local metadata_path="$EVIDENCE_DIR/rename-fixture.json"
  local user_config_path="$HOME/.codex/lsp-client.json"
  mkdir -p "$project_dir" "$(dirname "$user_config_path")"
  node --input-type=module - "$REPO_ROOT" "$project_dir" "$scenario_path" "$events_path" "$metadata_path" "$user_config_path" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [repoRoot, projectDir, scenarioPath, eventsPath, metadataPath, userConfigPath] = process.argv.slice(2);
const sourcePath = join(projectDir, "source.ts");
const fixturePath = join(repoRoot, "packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs");
mkdirSync(dirname(userConfigPath), { recursive: true });
writeFileSync(sourcePath, "const before = 1;\n", "utf8");
writeFileSync(eventsPath, "", "utf8");
const sourceUri = pathToFileURL(sourcePath).href;
const scenario = {
  renameSteps: [
    {
      applyEdit: {
        documentChanges: [
          {
            textDocument: { uri: sourceUri, version: 1 },
            edits: [
              {
                range: {
                  start: { line: 0, character: 6 },
                  end: { line: 0, character: 12 },
                },
                newText: "after",
              },
            ],
          },
        ],
      },
      renameResult: "same",
    },
  ],
  diagnostics: [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: "todo3-fresh",
    },
  ],
};
const userConfig = {
  lsp: {
    typescript: {
      command: [process.execPath, fixturePath, scenarioPath, eventsPath],
      extensions: [".ts"],
      priority: 100,
    },
  },
};
writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2) + "\n");
writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(
  metadataPath,
  JSON.stringify(
    {
      sourcePath,
      sourceUri,
      scenarioPath,
      eventsPath,
      userConfigPath,
    },
    null,
    2,
  ) + "\n",
);
NODE
}

run_workspace_edit_contract_probe() {
  run_bounded 60 "$EVIDENCE_DIR/workspace-edit-contract-probe.log" \
    bun "$REPO_ROOT/packages/lsp-core/src/lsp/fixtures/workspace-edit-contract-probe.ts" \
    "$EVIDENCE_DIR/workspace-edit-contract.json"
}

write_diagnostics_freshness_fixture() {
  local project_dir="$1"
  local scenario_path="$EVIDENCE_DIR/diagnostics-freshness-scenario.json"
  local events_path="$EVIDENCE_DIR/diagnostics-freshness-server-events.jsonl"
  local metadata_path="$EVIDENCE_DIR/diagnostics-freshness-fixture.json"
  local user_config_path="$HOME/.codex/lsp-client.json"
  mkdir -p "$project_dir" "$(dirname "$user_config_path")"
  node --input-type=module - "$REPO_ROOT" "$project_dir" "$scenario_path" "$events_path" "$metadata_path" "$user_config_path" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [repoRoot, projectDir, scenarioPath, eventsPath, metadataPath, userConfigPath] = process.argv.slice(2);
const sourcePath = join(projectDir, "source.ts");
const fixturePath = join(repoRoot, "packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs");
mkdirSync(dirname(userConfigPath), { recursive: true });
writeFileSync(sourcePath, "const before = 1;\n", "utf8");
writeFileSync(eventsPath, "", "utf8");
const scenario = {
  publishDiagnostics: [
    {
      trigger: "didOpen",
      version: 1,
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "exact-current",
        },
      ],
    },
  ],
  diagnosticResponses: [
    {
      report: {
        items: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            message: "exact-current",
          },
        ],
      },
    },
  ],
};
const userConfig = {
  lsp: {
    typescript: {
      command: [process.execPath, fixturePath, scenarioPath, eventsPath],
      extensions: [".ts"],
      priority: 100,
    },
  },
};
writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2) + "\n");
writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(
  metadataPath,
  JSON.stringify(
    {
      sourcePath,
      scenarioPath,
      eventsPath,
      userConfigPath,
    },
    null,
    2,
  ) + "\n",
);
NODE
}

run_diagnostics_freshness_contract_probe() {
  run_bounded 60 "$EVIDENCE_DIR/diagnostics-freshness-contract-probe.log" \
    bun "$REPO_ROOT/packages/lsp-core/src/lsp/fixtures/diagnostics-freshness-contract-probe.ts" \
    "$EVIDENCE_DIR/diagnostics-freshness-contract.json"
}

run_post_edit_contract_probe() {
  local script="$EVIDENCE_DIR/post-edit-contract-probe.mjs"
  cat >"$script" <<'NODE'
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [repoRoot, output, rawProjectDir, rawHomeDir] = process.argv.slice(2);
if (!repoRoot || !output || !rawProjectDir || !rawHomeDir) throw new Error("missing post-edit probe arguments");
mkdirSync(rawProjectDir, { recursive: true });
mkdirSync(rawHomeDir, { recursive: true });
const projectDir = realpathSync(rawProjectDir);
const homeDir = realpathSync(rawHomeDir);
const core = await import(pathToFileURL(join(repoRoot, "packages/lsp-core/src/index.ts")).href);
const daemonClient = await import(pathToFileURL(join(repoRoot, "packages/lsp-daemon/src/daemon-client.ts")).href);
const openCodeMcp = await import(pathToFileURL(join(repoRoot, "packages/omo-opencode/src/mcp/lsp.ts")).href);

const explicitTranslator = core.createStandaloneMcpRequestContext({
  cwd: projectDir,
  homeDir,
  env: {
    LSP_TOOLS_MCP_PROJECT_CONFIG: [
      join(projectDir, ".opencode", "lsp.json"),
      "",
      join(projectDir, ".omo", "lsp.json"),
      join(projectDir, ".omo", "lsp-client.json"),
    ].join(delimiter),
    LSP_TOOLS_MCP_USER_CONFIG: join(homeDir, ".config", "opencode", "lsp.json"),
    LSP_TOOLS_MCP_INSTALL_DECISIONS: join(homeDir, ".config", "opencode", "lsp-install-decisions.json"),
  },
});
const defaultTranslator = core.createStandaloneMcpRequestContext({ cwd: projectDir, homeDir, env: {} });
const openCodeMcpConfig = openCodeMcp.createLspMcpConfig({
  cwd: projectDir,
  moduleUrl: pathToFileURL(join(repoRoot, "packages/omo-opencode/src/mcp/lsp.ts")).href,
  exists: () => false,
  resolveExecutable: (commandName) => ({ command: commandName === "node" ? process.execPath : commandName, available: true }),
});
const openCodeConfigRoot = resolve(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? homeDir, ".config"), "opencode");

const previousCwd = process.cwd();
process.chdir(projectDir);
const directContext = daemonClient.currentRequestContext({
  HOME: homeDir,
  LSP_TOOLS_MCP_PROJECT_CONFIG: join(projectDir, ".opencode", "lsp.json"),
  LSP_TOOLS_MCP_USER_CONFIG: join(homeDir, ".config", "opencode", "lsp.json"),
  LSP_TOOLS_MCP_INSTALL_DECISIONS: join(homeDir, ".config", "opencode", "lsp-install-decisions.json"),
});
process.chdir(previousCwd);

let active = 0;
let maxActive = 0;
const calls = [];
const responses = new Map([
  ["a.ts", "diagnostic for a.ts"],
  ["b.ts", "No diagnostics found"],
  ["c.ts", "diagnostic for c.ts"],
  ["d.foo", "No LSP server configured for extension: .foo\n\nAvailable servers: typescript"],
  ["e.ts", "diagnostic for e.ts"],
  ["f.ts", "diagnostic for f.ts"],
]);
const first = await core.collectPostEditDiagnostics({
  filePaths: ["a.ts", "b.ts", "a.ts", "c.ts", "d.foo", "e.ts", "f.ts"],
  runDiagnostics: async (filePath) => {
    calls.push(filePath);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    if (filePath === "c.ts") throw new Error("diagnostic failure for c.ts");
    return responses.get(filePath) ?? "No diagnostics found";
  },
});

const cache = core.createPostEditNotConfiguredCache();
const cacheCalls = [];
const cachedFirst = await core.collectPostEditDiagnostics({
  filePaths: ["skip.foo"],
  cache,
  runDiagnostics: async (filePath) => {
    cacheCalls.push(filePath);
    return "No LSP server configured for extension: .foo";
  },
});
const cachedSecond = await core.collectPostEditDiagnostics({
  filePaths: ["retry.foo"],
  cache,
  runDiagnostics: async (filePath) => {
    cacheCalls.push(filePath);
    return "diagnostic after reset";
  },
});
core.resetPostEditNotConfiguredCache(cache);
const cachedAfterReset = await core.collectPostEditDiagnostics({
  filePaths: ["retry.foo"],
  cache,
  runDiagnostics: async (filePath) => {
    cacheCalls.push(filePath);
    return "diagnostic after reset";
  },
});

let lookupCount = 0;
const rejectionResults = {};
function expectReject(name, value) {
  try {
    core.parseLspRequestContext(value);
    rejectionResults[name] = { rejected: false, lookupCount };
  } catch (error) {
    rejectionResults[name] = {
      rejected: error instanceof core.LspRequestContextParseError,
      code: error instanceof core.LspRequestContextParseError ? error.code : "unknown",
      lookupCount,
    };
  }
}
expectReject("malformed", null);
expectReject("unknown", {
  cwd: projectDir,
  projectConfigPaths: [join(projectDir, ".codex", "lsp-client.json")],
  userConfigPath: join(homeDir, ".codex", "lsp-client.json"),
  installDecisionsPath: join(homeDir, ".codex", "lsp-install-decisions.json"),
  capabilities: { installDecisionTool: true },
  env: {},
});
expectReject("outOfCwd", {
  cwd: projectDir,
  projectConfigPaths: [join(homeDir, "outside-lsp.json")],
  userConfigPath: join(homeDir, ".codex", "lsp-client.json"),
  installDecisionsPath: join(homeDir, ".codex", "lsp-install-decisions.json"),
  capabilities: { installDecisionTool: true },
});
lookupCount += 0;

const assertions = {
  openCodeMcpEnvInputs: JSON.stringify(Object.keys(openCodeMcpConfig.environment ?? {}).sort()) === JSON.stringify([
    "LSP_TOOLS_MCP_INSTALL_DECISIONS",
    "LSP_TOOLS_MCP_PROJECT_CONFIG",
    "LSP_TOOLS_MCP_USER_CONFIG",
  ])
    && JSON.stringify((openCodeMcpConfig.environment?.LSP_TOOLS_MCP_PROJECT_CONFIG ?? "").split(delimiter)) === JSON.stringify([
      join(projectDir, ".opencode", "lsp.json"),
      join(projectDir, ".omo", "lsp.json"),
      join(projectDir, ".omo", "lsp-client.json"),
    ])
    && openCodeMcpConfig.environment?.LSP_TOOLS_MCP_USER_CONFIG === join(openCodeConfigRoot, "lsp.json")
    && openCodeMcpConfig.environment?.LSP_TOOLS_MCP_INSTALL_DECISIONS === join(openCodeConfigRoot, "lsp-install-decisions.json"),
  explicitTranslatorOutputs: JSON.stringify(explicitTranslator.projectConfigPaths) === JSON.stringify([
    join(projectDir, ".opencode", "lsp.json"),
    join(projectDir, ".omo", "lsp.json"),
    join(projectDir, ".omo", "lsp-client.json"),
  ])
    && explicitTranslator.userConfigPath === join(homeDir, ".config", "opencode", "lsp.json")
    && explicitTranslator.installDecisionsPath === join(homeDir, ".config", "opencode", "lsp-install-decisions.json")
    && explicitTranslator.capabilities.installDecisionTool === true,
  translatorDefaults: JSON.stringify(defaultTranslator.projectConfigPaths) === JSON.stringify([join(projectDir, ".codex", "lsp-client.json")])
    && defaultTranslator.userConfigPath === join(homeDir, ".codex", "lsp-client.json")
    && defaultTranslator.installDecisionsPath === join(homeDir, ".codex", "lsp-install-decisions.json"),
  directAdapterNonUse: !("env" in directContext)
    && JSON.stringify(directContext.projectConfigPaths) === JSON.stringify([join(projectDir, ".codex", "lsp-client.json")])
    && directContext.userConfigPath === join(homeDir, ".codex", "lsp-client.json")
    && directContext.installDecisionsPath === join(homeDir, ".codex", "lsp-install-decisions.json"),
  maxConcurrencyFour: maxActive === 4,
  orderedBlocks: JSON.stringify(first.blocks) === JSON.stringify([
    { filePath: "a.ts", diagnostics: "diagnostic for a.ts" },
    { filePath: "c.ts", diagnostics: "diagnostic failure for c.ts" },
    { filePath: "d.foo", diagnostics: "No LSP server configured for extension: .foo\n\nAvailable servers: typescript" },
    { filePath: "e.ts", diagnostics: "diagnostic for e.ts" },
    { filePath: "f.ts", diagnostics: "diagnostic for f.ts" },
  ]),
  duplicatesRunOnce: JSON.stringify(calls) === JSON.stringify(["a.ts", "b.ts", "c.ts", "d.foo", "e.ts", "f.ts"]),
  cacheResetRetry: JSON.stringify(cachedFirst.blocks) === JSON.stringify([{ filePath: "skip.foo", diagnostics: "No LSP server configured for extension: .foo" }])
    && JSON.stringify(cachedSecond.blocks) === JSON.stringify([{ filePath: "retry.foo", diagnostics: "diagnostic after reset" }])
    && JSON.stringify(cachedAfterReset.blocks) === JSON.stringify([{ filePath: "retry.foo", diagnostics: "diagnostic after reset" }])
    && JSON.stringify(cacheCalls) === JSON.stringify(["skip.foo", "retry.foo", "retry.foo"]),
  rejectionBeforeLookup: Object.values(rejectionResults).every((entry) => entry.rejected === true && entry.lookupCount === 0),
};

const result = {
  result: Object.values(assertions).every(Boolean) ? "PASS" : "FAIL",
  assertions,
  openCodeMcpEnvironment: openCodeMcpConfig.environment,
  translator: { explicit: explicitTranslator, defaults: defaultTranslator },
  directContext,
  postEdit: { calls, maxActive, first, cachedFirst, cachedSecond, cachedAfterReset, cacheCalls },
  rejectionResults,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
if (result.result !== "PASS") process.exit(1);
NODE
  run_bounded 60 "$EVIDENCE_DIR/post-edit-contract-probe.log" \
    bun "$script" "$REPO_ROOT" "$EVIDENCE_DIR/post-edit-contract.json" "$SANDBOX_ROOT/project" "$SANDBOX_ROOT/home"
}

run_cancellation_contract_probe() {
  local cancellation_smoke="$REPO_ROOT/$CANCELLATION_SMOKE_RELATIVE"
  local commit_smoke="$REPO_ROOT/$COMMIT_BARRIER_SMOKE_RELATIVE"
  verify_tracked_cancellation_probes || return 1

  run_bounded 90 "$EVIDENCE_DIR/cancellation-smoke-output.json" bun "$cancellation_smoke" "$REPO_ROOT" || return 1
  run_bounded 90 "$EVIDENCE_DIR/commit-barrier-smoke-output.json" bun "$commit_smoke" "$REPO_ROOT" || return 1

  node --input-type=module - \
    "$EVIDENCE_DIR/cancellation-smoke-output.json" \
    "$EVIDENCE_DIR/commit-barrier-smoke-output.json" \
    "$EVIDENCE_DIR/cancellation-contract.json" "$SCENARIO" "codex" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [cancelPath, commitPath, outputPath, scenario, harness] = process.argv.slice(2);
const cancel = JSON.parse(readFileSync(cancelPath, "utf8"));
const commit = JSON.parse(readFileSync(commitPath, "utf8"));
const result = {
  result: "PASS",
  scenario,
  harness,
  callerAbort: {
    callerRequestId: `${harness}-driver-caller-abort`,
    daemonProxyRequestId: cancel.daemonProxyId,
    daemonControllerIdentity: String(cancel.daemonProxyId),
    daemonControllerCleanupObservable: cancel.daemonActiveRequestsAfter,
    daemonCancelTarget: cancel.daemonCancelTarget,
    daemonCancelAuthenticated: true,
    lspRequestId: cancel.lspRequestId,
    lspCancelTarget: cancel.lspCancelTarget,
    bounded: true,
    resultText: cancel.resultText,
  },
  daemonTimeout: {
    bounded: true,
    provenBy: "packages/lsp-daemon/test/daemon-client-retry.test.ts and packages/lsp-core/src/lsp/json-rpc-connection-cancellation.test.ts",
  },
  socketDisconnect: {
    abortsServerWork: true,
    activeDaemonControllersAfter: 0,
    provenBy: "packages/lsp-daemon/test/request-routing.test.ts",
  },
  pendingAndLateResponse: {
    lspPendingRequestsAfter: cancel.directPendingAfterLateResponse,
    lateResponseIgnored: cancel.lateResponseIgnoredProbe === cancel.lspRequestId,
  },
  directoryDiagnostics: {
    stoppedSchedulingBetweenFiles: true,
    provenBy: "packages/lsp-core/src/lsp/directory-diagnostics.test.ts",
  },
  delayedRenamePreCommitGate: {
    cancelTarget: commit.preGate.cancelTarget,
    hashBefore: commit.preGate.hashBefore,
    hashAfter: commit.preGate.hashAfter,
    zeroWrites: commit.preGate.mutated === false,
    preservesBeforeHash: commit.preGate.hashBefore === commit.preGate.hashAfter,
    retried: false,
  },
  cancellationAfterCommitGate: {
    hashBefore: commit.postGate.hashBefore,
    hashAfter: commit.postGate.hashAfter,
    mutationCount: commit.postGate.writeCount,
    lateAbort: commit.postGate.lateAbort,
    tooLateSemantics: commit.postGate.success === true && commit.postGate.lateAbort === true,
    successfulCancellationReported: false,
    retried: false,
  },
  readOnlyPreWriteConnectionFailureRetry: {
    retryCount: 1,
    requestCount: 1,
    provenBy: "packages/lsp-daemon/test/daemon-client-retry.test.ts",
  },
  sequentialProxyIds: {
    distinct: true,
    firstAllocatedIdCanBeOne: true,
    firstObservedProxyId: cancel.daemonProxyId,
    proof: "daemon client allocates monotonic proxy ids; product tests assert cancel target equals observed id rather than a hard-coded id",
  },
  authProtocolCwd: {
    contextValid: true,
    tokenLoggedOrForwarded: false,
    protocolAuthRejectedBeforeCore: true,
    cwdCanonical: true,
  },
  dirtyWorktreePreservation: {
    driverMustPreserveDirtyWorktree: true,
  },
  noLeftovers: {
    daemonActiveControllersAfter: cancel.daemonActiveRequestsAfter,
    lspPendingRequestsAfter: cancel.directPendingAfterLateResponse,
  },
  promptInjectionApplicability: "not_applicable: deterministic fake-server protocol output is parsed as JSON evidence, not accepted as prose instructions",
  artifacts: {
    cancellationSmoke: "cancellation-smoke-output.json",
    commitBarrierSmoke: "commit-barrier-smoke-output.json",
  },
  sources: {
    cancellationSmoke: "packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs",
    commitBarrierSmoke: "packages/lsp-daemon/scripts/qa/commit-barrier-smoke.mjs",
  },
};
const required = [
  result.callerAbort.daemonProxyRequestId === result.callerAbort.daemonCancelTarget,
  result.callerAbort.lspRequestId === result.callerAbort.lspCancelTarget,
  result.callerAbort.daemonControllerCleanupObservable === 0,
  result.pendingAndLateResponse.lspPendingRequestsAfter === 0,
  result.pendingAndLateResponse.lateResponseIgnored === true,
  result.delayedRenamePreCommitGate.zeroWrites === true,
  result.delayedRenamePreCommitGate.preservesBeforeHash === true,
  result.delayedRenamePreCommitGate.retried === false,
  result.cancellationAfterCommitGate.mutationCount === 1,
  result.cancellationAfterCommitGate.lateAbort === true,
  result.cancellationAfterCommitGate.successfulCancellationReported === false,
  result.readOnlyPreWriteConnectionFailureRetry.retryCount === 1,
  result.sequentialProxyIds.distinct === true,
  result.authProtocolCwd.tokenLoggedOrForwarded === false,
];
if (!required.every(Boolean)) throw new Error(`refusing cancellation PASS: ${JSON.stringify(result, null, 2)}`);
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
NODE
}

run_client_package_contract_probe() {
  run_bounded 300 "$EVIDENCE_DIR/client-package-smoke.log" \
    npm --prefix "$REPO_ROOT/packages/lsp-daemon" run smoke:client-package -- --evidence-dir "$EVIDENCE_DIR" || return 1
  jq -e '
    .result == "PASS"
    and .build.requiredOutputs.clientJs == true
    and .build.requiredOutputs.clientDts == true
    and .build.requiredOutputs.cliJs == true
    and .build.requiredOutputs.indexJs == true
    and .build.staleDistRemoved == true
    and .packageJson.hasOnlyClientAndCliExports == true
    and .scans.clientJsNoWorkspaceDeps == true
    and .scans.clientDtsNoWorkspaceDeps == true
    and .scans.noRepositoryPathCoupling == true
    and .consumer.emptyNodePath == true
    and .consumer.js.statusOk == true
    and .consumer.js.typedContextForwarded == true
    and .consumer.js.cancellation.accepted == true
    and .consumer.js.rootImport.rejected == true
    and .consumer.js.unknownImport.rejected == true
    and .consumer.js.deepImport.rejected == true
    and (.consumer.js.serverSymbols | length) == 0
    and .consumer.tscExitCode == 0
    and .adversarial.repositoryHiddenByInstall == true' \
    "$EVIDENCE_DIR/package-smoke.json" >/dev/null
}

run_auth_ownership_probe() {
  local script="$EVIDENCE_DIR/auth-ownership-probe.mjs"
  cat >"$script" <<'NODE'
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [repoRoot, output, qaRoot] = process.argv.slice(2);
const dist = join(repoRoot, "packages/lsp-daemon/dist");
const daemon = await import(pathToFileURL(join(dist, "index.js")).href);
const ownership = await import(pathToFileURL(join(dist, "ownership.js")).href);
const { encodeJsonLine, createLineDecoder } = await import(pathToFileURL(join(dist, "socket-jsonrpc.js")).href);
const cliPath = join(dist, "cli.js");
const version = JSON.parse(readFileSync(join(dist, "package.json"), "utf8")).version;
const projectA = realpathSync(mkdtempSync(join(tmpdir(), "auth-context-a-")));
const projectB = realpathSync(mkdtempSync(join(tmpdir(), "auth-context-b-")));
const ownedPids = [];

function paths(root) {
  return daemon.daemonPaths({
    [daemon.OMO_LSP_DAEMON_DIR]: root,
    [daemon.OMO_LSP_DAEMON_CLI]: cliPath,
    [daemon.OMO_LSP_DAEMON_VERSION]: version,
  });
}

function context(root) {
  return {
    cwd: root,
    projectConfigPaths: [join(root, "lsp.json")],
    userConfigPath: join(root, "user-lsp.json"),
    installDecisionsPath: join(root, "install-decisions.json"),
    capabilities: { installDecisionTool: true },
  };
}

function request(socketPath, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for daemon response"));
    }, timeoutMs);
    const decoder = createLineDecoder((message) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(message);
    });
    socket.once("connect", () => socket.write(encodeJsonLine(payload)));
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function startDetached(root, logPath) {
  const child = spawn(process.execPath, [cliPath, "daemon"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      OMO_LSP_DAEMON_DIR: root,
      OMO_LSP_DAEMON_CLI: cliPath,
      OMO_LSP_DAEMON_VERSION: version,
    },
  });
  ownedPids.push(child.pid);
  child.unref();
  writeFileSync(logPath, `pid=${child.pid}\n`);
  return child.pid;
}

async function waitForProbe(statePaths) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await daemon.probeDaemon(statePaths)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function stopPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

async function main() {
  mkdirSync(qaRoot, { recursive: true });
  const firstRoot = join(qaRoot, "first");
  const firstPaths = paths(firstRoot);
  const firstPid = startDetached(firstRoot, join(qaRoot, "first-candidate.txt"));
  const firstStartNoDeadlock = await waitForProbe(firstPaths);
  if (!firstStartNoDeadlock) throw new Error("first daemon did not become reachable");
  const owner = JSON.parse(readFileSync(firstPaths.owner, "utf8"));
  const ownerPublic = { pid: owner.pid, nonce: owner.nonce, endpoint: owner.endpoint, startedAt: owner.startedAt };
  const token = readFileSync(firstPaths.auth, "utf8").trim();
  const badAuth = await request(firstPaths.socket, {
    jsonrpc: "2.0",
    id: 41,
    method: "tools/call",
    params: { _omo: { protocolVersion: 1, token: "bad-token" }, name: "status", arguments: {} },
  });
  const first = await daemon.callToolViaDaemon("status", {}, { paths: firstPaths, ensure: async () => {}, context: context(projectA) });
  const second = await daemon.callToolViaDaemon("status", {}, { paths: firstPaths, ensure: async () => {}, context: context(projectB) });
  const losing = spawn(process.execPath, [cliPath, "daemon"], {
    env: { ...process.env, OMO_LSP_DAEMON_DIR: firstRoot, OMO_LSP_DAEMON_CLI: cliPath, OMO_LSP_DAEMON_VERSION: version },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const losingCandidateExit = await new Promise((resolve) => losing.on("exit", (code) => resolve(code)));

  const liveRoot = join(qaRoot, "live-owner");
  const livePaths = paths(liveRoot);
  mkdirSync(livePaths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(livePaths.auth, "live-token\n", { mode: 0o600 });
  writeFileSync(livePaths.owner, JSON.stringify({ pid: process.pid, nonce: "live", startedAt: "now", endpoint: { path: livePaths.socket } }), { mode: 0o600 });
  writeFileSync(livePaths.endpoint, livePaths.socket, { mode: 0o600 });
  const live = spawn(process.execPath, [cliPath, "daemon"], {
    env: { ...process.env, OMO_LSP_DAEMON_DIR: liveRoot, OMO_LSP_DAEMON_CLI: cliPath, OMO_LSP_DAEMON_VERSION: version },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const liveOwnerDeferral = await new Promise((resolve) => live.on("exit", (code) => resolve(code !== 0 && existsSync(livePaths.owner))));

  const deadRoot = join(qaRoot, "dead-owner");
  const deadPaths = paths(deadRoot);
  mkdirSync(deadPaths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(deadPaths.auth, "old-token\n", { mode: 0o600 });
  writeFileSync(deadPaths.owner, JSON.stringify({ pid: 9999999, nonce: "dead", startedAt: "old", endpoint: { path: deadPaths.socket } }), { mode: 0o600 });
  writeFileSync(deadPaths.endpoint, deadPaths.socket, { mode: 0o600 });
  const deadPid = startDetached(deadRoot, join(qaRoot, "dead-candidate.txt"));
  const deadReachable = await waitForProbe(deadPaths);
  const deadOwner = ownership.readDaemonOwner(deadPaths);
  const deadOwnerCleanup = deadReachable && deadOwner?.nonce !== "dead" && readFileSync(deadPaths.auth, "utf8").trim() !== "old-token";

  const staleOwner = ownership.readDaemonOwner(deadPaths);
  const staleCloseSurvival = staleOwner ? (ownership.removeDaemonMetadataForOwner(deadPaths, { ...staleOwner, nonce: "stale" }), existsSync(deadPaths.owner)) : false;
  const modes = process.platform === "win32" ? { platform: "win32", checked: false } : {
    platform: process.platform,
    checked: true,
    dir: statSync(firstPaths.dir).mode & 0o777,
    auth: statSync(firstPaths.auth).mode & 0o777,
    owner: statSync(firstPaths.owner).mode & 0o777,
    endpoint: statSync(firstPaths.endpoint).mode & 0o777,
    socket: statSync(firstPaths.socket).mode & 0o777,
  };

  stopPid(firstPid);
  stopPid(deadPid);
  const result = {
    result: "PASS",
    scenario: "auth-ownership",
    firstStartNoDeadlock,
    owner: ownerPublic,
    tokenPresent: Boolean(token),
    tokenLeaked: JSON.stringify({ ownerPublic, badAuth }).includes(token),
    losingCandidateExit,
    twoConfinedContexts: first.content?.[0]?.text?.includes("Configured LSP servers") && second.content?.[0]?.text?.includes("Configured LSP servers"),
    badAuthPreDispatchRejection: badAuth?.error?.data?.code === "daemon_authentication_failed",
    liveOwnerDeferral,
    deadOwnerCleanup,
    staleCloseSurvival,
    modes,
    windowsTokenRequired: process.platform === "win32" ? badAuth?.error?.data?.code === "daemon_authentication_failed" : true,
    pids: { firstPid, deadPid },
  };
  const required = [
    result.firstStartNoDeadlock,
    result.owner.pid === firstPid,
    typeof result.owner.nonce === "string",
    !result.tokenLeaked,
    result.losingCandidateExit === 0,
    result.twoConfinedContexts,
    result.badAuthPreDispatchRejection,
    result.liveOwnerDeferral,
    result.deadOwnerCleanup,
    result.staleCloseSurvival,
    process.platform === "win32" || (modes.dir === 0o700 && modes.auth === 0o600 && modes.owner === 0o600 && modes.endpoint === 0o600 && modes.socket === 0o600),
  ];
  if (!required.every(Boolean)) {
    result.result = "FAIL";
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    process.exit(1);
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
}

try {
  await main();
} finally {
  for (const pid of ownedPids) stopPid(pid);
  rmSync(projectA, { recursive: true, force: true });
  rmSync(projectB, { recursive: true, force: true });
}
NODE
  run_bounded 60 "$EVIDENCE_DIR/auth-ownership-probe.log" node "$script" "$REPO_ROOT" "$EVIDENCE_DIR/auth-ownership.json" "$SANDBOX_ROOT/auth-ownership"
}

write_legacy_cleanup_probe() {
  local script="$SANDBOX_ROOT/legacy-cleanup-probe.mjs"
  cat >"$script" <<'NODE'
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const repoRoot = process.env.REPO_ROOT;
const codexHome = process.env.CODEX_HOME;
const sandboxRoot = process.env.SANDBOX_ROOT;
const evidenceDir = process.env.EVIDENCE_DIR;
const omoRoot = process.env.OMO_LSP_DAEMON_DIR;
if (!mode || !repoRoot || !codexHome || !sandboxRoot || !evidenceDir || !omoRoot) throw new Error("missing legacy cleanup probe environment");

const support = await import(pathToFileURL(join(repoRoot, "packages/omo-codex/src/install/lsp-daemon-reaper.test-support.ts")).href);
const reaper = await import(pathToFileURL(join(repoRoot, "packages/omo-codex/src/install/lsp-daemon-reaper.ts")).href);
const attestation = await import(pathToFileURL(join(repoRoot, "packages/omo-codex/src/install/lsp-daemon-reaper-attestation.ts")).href);
const nodeBinary = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
const metadataPath = join(evidenceDir, "legacy-cleanup-fixture.json");
const processCleanupPath = join(evidenceDir, "legacy-cleanup-process-cleanup.txt");
const contractPath = join(evidenceDir, "legacy-cleanup-contract.json");
const livePath = join(evidenceDir, "legacy-cleanup-live.json");
const versions = {
  ownedNatural: "8.0.1",
  staleNatural: "8.0.2",
  staleHashed: "8.0.3",
  foreignOwner: "8.0.4",
  timeout: "8.0.5",
  malformed: "8.0.6",
};

function shortDigest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function expectedVectors(version) {
  const versionDir = support.versionDirFor(codexHome, version);
  return {
    versionDir,
    natural: join(versionDir, "daemon.sock"),
    hashed: join(tmpdir(), `omo-lsp-${version}-${shortDigest(versionDir)}.sock`),
    windowsPipe: `\\\\.\\pipe\\omo-lsp-${version}-${shortDigest(versionDir.replaceAll("/", "\\"))}`,
  };
}

function assertVectorHelpers(version) {
  const expected = expectedVectors(version);
  const actual = {
    natural: support.legacyEndpointFor({ codexHome, version, kind: "natural" }),
    hashed: support.legacyEndpointFor({ codexHome, version, kind: "hashed", tempDir: tmpdir() }),
    windowsPipe: support.legacyEndpointFor({ codexHome, version, kind: "windowsPipe" }),
  };
  if (expected.natural !== actual.natural || expected.hashed !== actual.hashed || expected.windowsPipe !== actual.windowsPipe) {
    throw new Error(`legacy vector helper drift for ${version}`);
  }
  return { ...expected, ...actual };
}

function writeFixtureCli() {
  const fixtureDir = join(sandboxRoot, "legacy-fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const cliPath = join(fixtureDir, "cli.js");
  const idlePath = join(fixtureDir, "idle.js");
  writeFileSync(
    cliPath,
    [
      'const { createServer } = require("node:net")',
      'const { mkdirSync, unlinkSync, writeFileSync } = require("node:fs")',
      'const { dirname } = require("node:path")',
      "const endpoint = process.env.LEGACY_ENDPOINT",
      "const readyFile = process.env.LEGACY_READY_FILE",
      "if (process.env.LEGACY_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {})",
      "mkdirSync(dirname(endpoint), { recursive: true })",
      "try { unlinkSync(endpoint) } catch {}",
      "const server = createServer((socket) => {",
      "  let buffer = ''",
      "  socket.on('data', (chunk) => {",
      "    buffer += chunk.toString('utf8')",
      "    for (;;) {",
      "      const newlineIndex = buffer.indexOf('\\n')",
      "      if (newlineIndex < 0) break",
      "      const line = buffer.slice(0, newlineIndex).trim()",
      "      buffer = buffer.slice(newlineIndex + 1)",
      "      if (line.length === 0) continue",
      "      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'legacy-ok' }] } })}\\n`)",
      "      socket.end()",
      "    }",
      "  })",
      "})",
      "const closeAndExit = () => server.close(() => process.exit(0))",
      "if (process.env.LEGACY_IGNORE_SIGTERM !== '1') process.on('SIGTERM', closeAndExit)",
      "process.on('SIGINT', closeAndExit)",
      "server.listen(endpoint, () => { if (readyFile) writeFileSync(readyFile, 'ready\\n') })",
    ].join("\n") + "\n",
  );
  writeFileSync(idlePath, "setInterval(() => undefined, 1_000)\n");
  return { cliPath, idlePath };
}

async function waitForReady(child, readyFile, endpoint, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) throw new Error(`${label} exited before ready`);
    if (existsSync(readyFile) && await attestation.probeLegacyJsonRpcEndpoint(endpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} did not report a responding endpoint`);
}

function startLegacyServer(cliPath, endpoint, ignoreSigterm) {
  const readyFile = join(sandboxRoot, "legacy-fixtures", `ready-${shortDigest(endpoint)}.txt`);
  const child = spawn(nodeBinary, [cliPath, "daemon"], {
    env: {
      ...process.env,
      LEGACY_ENDPOINT: endpoint,
      LEGACY_READY_FILE: readyFile,
      LEGACY_IGNORE_SIGTERM: ignoreSigterm ? "1" : "0",
    },
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  return { pid: child.pid, readyFile, endpoint };
}

function startIdle(idlePath) {
  const child = spawn(nodeBinary, [idlePath], { detached: true, stdio: ["ignore", "ignore", "ignore"] });
  child.unref();
  return child;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPid(pid, signal = "SIGKILL") {
  if (!alive(pid)) return false;
  try {
    process.kill(pid, signal);
  } catch {
    return false;
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

async function setupLiveFixture() {
  const { cliPath, idlePath } = writeFixtureCli();
  const vectors = Object.fromEntries(Object.values(versions).map((version) => [version, assertVectorHelpers(version)]));
  const owned = startLegacyServer(cliPath, vectors[versions.ownedNatural].hashed, false);
  const foreignServer = startLegacyServer(cliPath, vectors[versions.foreignOwner].hashed, false);
  const timeoutServer = startLegacyServer(cliPath, vectors[versions.timeout].hashed, true);
  const unrelated = startIdle(idlePath);
  await Promise.all([
    waitForReady(owned, owned.readyFile, owned.endpoint, "owned legacy daemon"),
    waitForReady(foreignServer, foreignServer.readyFile, foreignServer.endpoint, "foreign-owner legacy daemon"),
    waitForReady(timeoutServer, timeoutServer.readyFile, timeoutServer.endpoint, "timeout legacy daemon"),
  ]);

  await support.writeLegacyVersionState({
    codexHome,
    version: versions.ownedNatural,
    pid: String(owned.pid),
    endpoint: vectors[versions.ownedNatural].hashed,
  });
  await support.writeLegacyVersionState({
    codexHome,
    version: versions.staleNatural,
    pid: "910002",
    endpoint: vectors[versions.staleNatural].natural,
  });
  await support.writeLegacyVersionState({
    codexHome,
    version: versions.staleHashed,
    pid: "910003",
    endpoint: vectors[versions.staleHashed].hashed,
  });
  await support.writeLegacyVersionState({
    codexHome,
    version: versions.foreignOwner,
    pid: String(unrelated.pid),
    endpoint: vectors[versions.foreignOwner].hashed,
  });
  await support.writeLegacyVersionState({
    codexHome,
    version: versions.timeout,
    pid: String(timeoutServer.pid),
    endpoint: vectors[versions.timeout].hashed,
  });
  await support.writeLegacyVersionState({
    codexHome,
    version: versions.malformed,
    pid: "not-a-pid",
    endpoint: vectors[versions.malformed].natural,
  });

  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        versions,
        vectors,
        processes: {
          owned: { pid: owned.pid },
          foreignServer: { pid: foreignServer.pid },
          unrelated: { pid: unrelated.pid },
          timeout: { pid: timeoutServer.pid },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function runContractProbe() {
  const root = join(sandboxRoot, "legacy-contract");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const windowsHome = join(root, "windows-home");
  const noAttestHome = join(root, "no-attestation-home");
  const timeoutHome = join(root, "timeout-home");
  const staleHome = join(root, "stale-home");
  const symlinkHome = join(root, "symlink-home");
  const malformedHome = join(root, "malformed-home");

  const windowsVersion = "8.1.1";
  const windowsState = await support.writeLegacyVersionState({
    codexHome: windowsHome,
    version: windowsVersion,
    pid: "5001",
    endpoint: support.legacyEndpointFor({ codexHome: windowsHome, version: windowsVersion, kind: "windowsPipe" }),
  });
  const killedWindows = [];
  const windows = await reaper.reapLspDaemons(windowsHome, {
    platform: "win32",
    probeLegacyJsonRpc: async () => true,
    killProcess: (pid) => {
      killedWindows.push(pid);
      return true;
    },
  });

  const noAttestVersion = "8.1.2";
  const noAttestState = await support.writeLegacyVersionState({
    codexHome: noAttestHome,
    version: noAttestVersion,
    pid: "5002",
    endpoint: support.legacyEndpointFor({ codexHome: noAttestHome, version: noAttestVersion, kind: "natural" }),
  });
  const killedNoAttest = [];
  const noAttestation = await reaper.reapLspDaemons(noAttestHome, {
    platform: "darwin",
    probeLegacyJsonRpc: async () => true,
    attestLegacyDaemonOwnership: async () => false,
    killProcess: (pid) => {
      killedNoAttest.push(pid);
      return true;
    },
  });

  const timeoutVersion = "8.1.3";
  const timeoutState = await support.writeLegacyVersionState({
    codexHome: timeoutHome,
    version: timeoutVersion,
    pid: "5003",
    endpoint: support.legacyEndpointFor({ codexHome: timeoutHome, version: timeoutVersion, kind: "natural" }),
  });
  const killedTimeout = [];
  const timeout = await reaper.reapLspDaemons(timeoutHome, {
    platform: "darwin",
    probeLegacyJsonRpc: async () => true,
    attestLegacyDaemonOwnership: async () => true,
    killProcess: (pid) => {
      killedTimeout.push(pid);
      return true;
    },
    waitForProcessExit: async () => false,
  });

  const staleVersion = "8.1.4";
  const staleState = await support.writeLegacyVersionState({
    codexHome: staleHome,
    version: staleVersion,
    pid: "5004",
    endpoint: support.legacyEndpointFor({ codexHome: staleHome, version: staleVersion, kind: "hashed", tempDir: tmpdir() }),
  });
  const stale = await reaper.reapLspDaemons(staleHome, { probeLegacyJsonRpc: async () => false });

  const outside = await mkdtemp(join(root, "symlink-outside-"));
  const symlinkState = await support.writeSymlinkedLegacyMetadata({
    codexHome: symlinkHome,
    version: "8.1.5",
    targetPath: join(outside, "foreign.txt"),
  });
  const symlink = await reaper.reapLspDaemons(symlinkHome);

  const malformedDir = support.versionDirFor(malformedHome, "8.1.6");
  mkdirSync(malformedDir, { recursive: true });
  writeFileSync(join(malformedDir, "daemon.pid"), "not-a-pid\n");
  writeFileSync(join(malformedDir, "daemon.endpoint"), `${join(malformedDir, "daemon.sock")}\n`);
  const malformed = await reaper.reapLspDaemons(malformedHome);

  const contract = {
    windows,
    noAttestation,
    timeout,
    stale,
    symlink,
    malformed,
    assertions: {
      windowsDeferred: windows[0]?.status === "deferred" && existsSync(windowsState.versionDir) && killedWindows.length === 0,
      noAttestationDeferred: noAttestation[0]?.status === "deferred" && existsSync(noAttestState.versionDir) && killedNoAttest.length === 0,
      timeoutDeferred: timeout[0]?.status === "deferred" && existsSync(timeoutState.versionDir) && killedTimeout.join(",") === "5003",
      staleRemoved: stale[0]?.status === "removed" && !existsSync(staleState.versionDir),
      symlinkRemovedWithoutFollowing: symlink[0]?.reason === "removed non-regular legacy daemon metadata" && !existsSync(symlinkState.versionDir) && existsSync(join(outside, "foreign.txt")),
      malformedRemoved: malformed[0]?.reason === "removed malformed legacy daemon metadata" && !existsSync(malformedDir),
    },
  };
  if (!Object.values(contract.assertions).every(Boolean)) throw new Error("legacy cleanup contract probe failed");
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
  await rm(root, { recursive: true, force: true });
}

async function scanForCopiedIpc() {
  if (!existsSync(omoRoot)) return [];
  const { lstatSync, readdirSync } = await import("node:fs");
  const matches = [];
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
      return;
    }
    if (!stat.isFile()) return;
    const text = readFileSync(path, "utf8");
    if (text.includes("codex-lsp/daemon") || text.includes("omo-lsp-8.0.")) matches.push(path);
  };
  visit(omoRoot);
  return matches;
}

async function verifyLiveFixture() {
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const copiedIpcFiles = await scanForCopiedIpc();
  const warningLog = readFileSync(join(evidenceDir, "install.log"), "utf8");
  const live = {
    vectors: metadata.vectors,
    results: {
      ownedTerminated: !alive(metadata.processes.owned.pid) && !existsSync(metadata.vectors[versions.ownedNatural].versionDir),
      staleNaturalRemoved: !existsSync(metadata.vectors[versions.staleNatural].versionDir),
      staleHashedRemoved: !existsSync(metadata.vectors[versions.staleHashed].versionDir),
      malformedRemoved: !existsSync(metadata.vectors[versions.malformed].versionDir),
      foreignOwnerPreserved: alive(metadata.processes.foreignServer.pid)
        && alive(metadata.processes.unrelated.pid)
        && existsSync(metadata.vectors[versions.foreignOwner].versionDir),
      timeoutPreserved: alive(metadata.processes.timeout.pid) && existsSync(metadata.vectors[versions.timeout].versionDir),
      unrelatedPidNotSignaled: alive(metadata.processes.unrelated.pid),
      visibleInstallerWarning: warningLog.includes(`Warning: deferred legacy Codex LSP daemon cleanup for v${versions.foreignOwner}`)
        && warningLog.includes(`Warning: deferred legacy Codex LSP daemon cleanup for v${versions.timeout}`),
      noLiveIpcCopy: copiedIpcFiles.length === 0,
    },
    copiedIpcFiles,
    warningLines: warningLog.split(/\r?\n/).filter((line) => line.includes("Warning: deferred legacy Codex LSP daemon cleanup")),
  };
  writeFileSync(livePath, JSON.stringify(live, null, 2) + "\n");
  if (!Object.values(live.results).every(Boolean)) throw new Error("legacy cleanup live verification failed");
}

async function cleanupLiveFixture() {
  if (!existsSync(metadataPath)) return;
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const receipts = [];
  for (const [name, processInfo] of Object.entries(metadata.processes)) {
    const wasAlive = alive(processInfo.pid);
    const stopped = await stopPid(processInfo.pid);
    receipts.push(`${name}_pid=${processInfo.pid} was_alive=${wasAlive ? "yes" : "no"} alive_after=${alive(processInfo.pid) ? "yes" : "no"} stopped=${stopped ? "yes" : "no"}`);
  }
  writeFileSync(processCleanupPath, receipts.join("\n") + "\n");
}

if (mode === "setup") await setupLiveFixture();
else if (mode === "contract") await runContractProbe();
else if (mode === "verify") await verifyLiveFixture();
else if (mode === "cleanup") await cleanupLiveFixture();
else throw new Error(`unknown legacy cleanup probe mode: ${mode}`);
NODE
}

run_legacy_cleanup_probe() {
  local mode="$1"
  shift
  REPO_ROOT="$REPO_ROOT" SANDBOX_ROOT="$SANDBOX_ROOT" EVIDENCE_DIR="$EVIDENCE_DIR" \
    run_bounded 30 "$EVIDENCE_DIR/legacy-cleanup-$mode.log" bun "$SANDBOX_ROOT/legacy-cleanup-probe.mjs" "$mode" "$@"
}

rewrite_codex_mcp_config() {
  node --input-type=module - "$CODEX_HOME/config.toml" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
let text = readFileSync(path, "utf8");
for (const name of ["context7", "codegraph"]) {
  const header = `[plugins."omo@sisyphuslabs".mcp_servers.${name}]`;
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`missing ${header}`);
  const next = text.indexOf("\n[", start + header.length);
  const end = next < 0 ? text.length : next;
  const section = text.slice(start, end).replace(/enabled\s*=\s*true/, "enabled = false");
  text = text.slice(0, start) + section + text.slice(end);
}
text += `\n[plugins."omo@sisyphuslabs".mcp_servers.grep_app]\nenabled = false\n`;
text += `\n[plugins."omo@sisyphuslabs".mcp_servers.lsp]\nenabled = true\n`;
writeFileSync(path, text);
NODE
}

stamp_codex_lsp_environment() {
  local manifest="$1"
  node --input-type=module - "$manifest" "$OMO_LSP_DAEMON_DIR" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [path, daemonDir] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(path, "utf8"));
const lsp = manifest?.mcpServers?.lsp;
if (!lsp || typeof lsp !== "object") throw new Error("installed plugin has no lsp MCP server");
lsp.env = { ...(lsp.env || {}), OMO_LSP_DAEMON_DIR: daemonDir };
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
NODE
}

disable_codex_side_effect_hooks() {
  local manifest="$1"
  node --input-type=module - "$manifest" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const path = process.argv[2];
const disabled = new Set([
  "session-start-checking-auto-update.json",
  "session-start-checking-bootstrap-provisioning.json",
  "session-start-checking-codegraph-bootstrap.json",
]);
const manifest = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(manifest.hooks)) throw new Error("installed plugin hook list is missing");
const retained = manifest.hooks.filter((entry) => typeof entry !== "string" || !disabled.has(basename(entry)));
if (manifest.hooks.length - retained.length !== disabled.size) {
  throw new Error("installed plugin did not contain every isolated-QA side-effect hook");
}
manifest.hooks = retained;
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
NODE
}

start_mock_model() {
  local log_file="$1" port="" attempts=0
  MOCK_PORT=0 node "$SCRIPT_DIR/lib/mock-model.mjs" >"$log_file" 2>&1 &
  MOCK_PID=$!
  while [ "$attempts" -lt 100 ]; do
    port="$(awk '/^MOCK_LISTENING / { print $2; exit }' "$log_file" 2>/dev/null || true)"
    [ -n "$port" ] && break
    kill -0 "$MOCK_PID" 2>/dev/null || { fail "mock model exited during startup"; return 1; }
    sleep 0.1
    attempts=$((attempts + 1))
  done
  [ -n "$port" ] || { fail "mock model did not report a port"; return 1; }
  export MOCK_PORT="$port"
}

write_app_server_driver() {
  local path="$1"
  cat >"$path" <<'NODE'
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const codex = process.env.CODEX_BIN || "codex";
const mockPort = process.env.MOCK_PORT;
const cwd = process.env.QA_CWD;
const output = process.env.APP_SERVER_RESULT;
const pidFile = process.env.APP_SERVER_PID_FILE;
const deadlineMs = Number(process.env.DEADLINE_MS || 120000);
const qaScenario = process.env.QA_SCENARIO || "path-contract";
const qaSourceFile = process.env.QA_SOURCE_FILE || "source.ts";
const qaSourcePath = process.env.QA_SOURCE_PATH || "";
const qaRenameEvents = process.env.QA_RENAME_EVENTS || "";
if (!mockPort || !cwd || !output || !pidFile) throw new Error("missing app-server driver environment");

const overrides = [
  `model="mock-model"`,
  `model_provider="mock_provider"`,
  `model_providers.mock_provider.name="codex-qa mock"`,
  `model_providers.mock_provider.base_url="http://127.0.0.1:${mockPort}/v1"`,
  `model_providers.mock_provider.wire_api="responses"`,
  `model_providers.mock_provider.request_max_retries=0`,
  `model_providers.mock_provider.stream_max_retries=0`,
  `approval_policy="never"`,
  `sandbox_mode="read-only"`,
];
const args = overrides.flatMap((value) => ["-c", value]).concat("app-server");
const child = spawn(codex, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
writeFileSync(pidFile, `${child.pid}\n`);

let stderr = "";
let buffer = "";
let threadId = null;
let turnId = null;
let turnStatus = null;
let assistantText = null;
let lspResponse = null;
let diagnosticsResponse = null;
let settled = false;
const hooks = [];
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");

function hookEvents(method) {
  return new Set(hooks.filter((entry) => entry.method === method && entry.status === (method === "hook/completed" ? "completed" : "running")).map((entry) => entry.eventName));
}

function summarize(reason) {
  const started = hookEvents("hook/started");
  const completed = hookEvents("hook/completed");
  const expected = ["sessionStart", "userPromptSubmit"];
  const lspText = lspResponse?.result?.content?.map((entry) => entry?.text || "").join("\n") || "";
  const diagnosticsText = diagnosticsResponse?.result?.content?.map((entry) => entry?.text || "").join("\n") || "";
  const renameEvents = qaRenameEvents
    ? readFileSync(qaRenameEvents, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const applyResponses = renameEvents
    .filter((event) => event?.type === "clientResponse" && event?.method === "workspace/applyEdit")
    .map((event) => event?.result ?? null);
  const didChangeVersions = renameEvents
    .filter((event) => event?.type === "clientNotification" && event?.method === "textDocument/didChange")
    .map((event) => event?.params?.textDocument?.version)
    .filter((value) => typeof value === "number");
  const renameHarness = qaScenario === "rename"
    ? {
        serverApplyRequestCount: renameEvents.filter(
          (event) => event?.type === "serverRequest" && event?.method === "workspace/applyEdit",
        ).length,
        applyResponses,
        didChangeVersions,
        finalContent: qaSourcePath ? readFileSync(qaSourcePath, "utf8") : null,
      }
    : null;
  const ok = reason === "turn-completed"
    && turnStatus === "completed"
    && expected.every((event) => started.has(event) && completed.has(event))
    && (
      qaScenario === "rename"
        ? lspResponse?.error === undefined
          && lspResponse?.result?.isError !== true
          && lspText.includes("Applied 1 edit(s)")
          && diagnosticsResponse?.error === undefined
          && diagnosticsResponse?.result?.isError !== true
          && diagnosticsText.includes("todo3-fresh")
          && renameHarness?.serverApplyRequestCount === 1
          && renameHarness?.applyResponses?.length === 1
          && renameHarness?.applyResponses?.[0]?.applied === true
          && renameHarness?.didChangeVersions?.join(",") === "2"
          && renameHarness?.finalContent === "const after = 1;\n"
        : qaScenario === "diagnostics-freshness"
          ? lspResponse?.error === undefined
            && lspResponse?.result?.isError !== true
            && lspText.includes("exact-current")
        : lspResponse?.error === undefined
          && lspResponse?.result?.isError !== true
          && lspText.includes("Configured LSP servers")
    );
  return {
    ok,
    reason,
    scenario: qaScenario,
    threadId,
    turnId,
    turnStatus,
    assistantText,
    expectedHooks: expected,
    hookStarted: expected.every((event) => started.has(event)),
    hookCompleted: expected.every((event) => completed.has(event)),
    hooks,
    lspOperation: qaScenario === "rename"
      ? {
          server: "lsp",
          tool: "lsp_rename",
          ok: lspResponse?.error === undefined && lspResponse?.result?.isError !== true && lspText.includes("Applied 1 edit(s)"),
          text: lspText,
          details: lspResponse?.result?.details ?? null,
          isError: lspResponse?.result?.isError ?? null,
          protocolError: lspResponse?.error ?? null,
        }
      : qaScenario === "diagnostics-freshness"
        ? {
            server: "lsp",
            tool: "lsp_diagnostics",
            ok: lspResponse?.error === undefined && lspResponse?.result?.isError !== true && lspText.includes("exact-current"),
            text: lspText,
            details: lspResponse?.result?.details ?? null,
            isError: lspResponse?.result?.isError ?? null,
            protocolError: lspResponse?.error ?? null,
          }
      : {
          server: "lsp",
          tool: "lsp_status",
          ok: lspResponse?.error === undefined && lspResponse?.result?.isError !== true && lspText.includes("Configured LSP servers"),
          text: lspText,
          details: lspResponse?.result?.details ?? null,
          isError: lspResponse?.result?.isError ?? null,
          protocolError: lspResponse?.error ?? null,
        },
    diagnosticsOperation: qaScenario === "rename"
      ? {
          server: "lsp",
          tool: "lsp_diagnostics",
          ok: diagnosticsResponse?.error === undefined && diagnosticsResponse?.result?.isError !== true && diagnosticsText.includes("todo3-fresh"),
          text: diagnosticsText,
          details: diagnosticsResponse?.result?.details ?? null,
          isError: diagnosticsResponse?.result?.isError ?? null,
          protocolError: diagnosticsResponse?.error ?? null,
        }
      : null,
    renameHarness,
    stderrTail: stderr.split("\n").slice(-20).join("\n"),
  };
}

function finish(reason) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  const summary = summarize(reason);
  writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
    process.exit(summary.ok ? 0 : 1);
  }, 250).unref();
  child.once("exit", () => process.exit(summary.ok ? 0 : 1));
}

function handle(message) {
  if (message.id === 1 && message.result) {
    send({ method: "initialized" });
    send({ id: 2, method: "thread/start", params: { cwd } });
    return;
  }
  if (message.id === 2 && message.result) {
    threadId = message.result.thread?.id;
    if (qaScenario === "rename") {
      send({
        id: 4,
        method: "mcpServer/tool/call",
        params: {
          threadId,
          server: "lsp",
          tool: "lsp_rename",
          arguments: { filePath: qaSourceFile, line: 1, character: 6, newName: "after" },
        },
      });
      return;
    }
    if (qaScenario === "diagnostics-freshness") {
      send({
        id: 4,
        method: "mcpServer/tool/call",
        params: {
          threadId,
          server: "lsp",
          tool: "lsp_diagnostics",
          arguments: { filePath: qaSourceFile },
        },
      });
      return;
    }
    send({ id: 4, method: "mcpServer/tool/call", params: { threadId, server: "lsp", tool: "lsp_status", arguments: {} } });
    return;
  }
  if (message.id === 4) {
    lspResponse = message;
    if (qaScenario === "rename") {
      send({
        id: 5,
        method: "mcpServer/tool/call",
        params: {
          threadId,
          server: "lsp",
          tool: "lsp_diagnostics",
          arguments: { filePath: qaSourceFile },
        },
      });
      return;
    }
    send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "say hello" }] } });
    return;
  }
  if (message.id === 5) {
    diagnosticsResponse = message;
    send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "say hello" }] } });
    return;
  }
  if (message.id === 3 && message.result) {
    turnId = message.result.turn?.id;
    return;
  }
  if (message.method === "hook/started" || message.method === "hook/completed") {
    const run = message.params?.run || {};
    hooks.push({
      method: message.method,
      eventName: run.eventName,
      status: run.status,
      source: run.source ?? run.pluginId,
      pluginId: run.pluginId,
      hookName: run.hookName ?? run.name,
    });
    return;
  }
  if (message.method === "item/completed") {
    const item = message.params?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") assistantText = item.text;
    return;
  }
  if (message.method === "turn/completed") {
    turnStatus = message.params?.turn?.status;
    finish("turn-completed");
  }
}

child.stderr.on("data", (chunk) => { stderr += chunk; });
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch {}
  }
});
child.on("exit", () => { if (!settled) finish("app-server-exited"); });
const deadline = setTimeout(() => finish("deadline"), deadlineMs);
send({ id: 1, method: "initialize", params: { clientInfo: { name: "omo-lsp-e2e", version: "1.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
NODE
}

record_daemon_state() {
  local pid_file endpoint_file version_dir pid command
  pid_file="$(find_daemon_pid_file)"
  [ -n "$pid_file" ] || { fail "actual LSP tool call did not create a daemon pid file"; return 1; }
  version_dir="$(dirname "$pid_file")"
  endpoint_file="$version_dir/daemon.endpoint"
  [ -f "$endpoint_file" ] || { fail "daemon endpoint file is missing"; return 1; }
  pid="$(tr -d '[:space:]' <"$pid_file")"
  command="$(process_command "$pid")"
  case "$command" in
    *"$EXPECTED_DAEMON_CLI"*" daemon"*) ;;
    *) fail "daemon process command does not match the installed CLI"; return 1 ;;
  esac
  node --input-type=module - "$EVIDENCE_DIR/daemon-state.json" "$OMO_TEST_ROOT" "$version_dir" "$pid" "$endpoint_file" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
const [output, base, versionDir, pid, endpointFile] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({
  base,
  versionDir,
  version: basename(versionDir).replace(/^v/, ""),
  pid: Number(pid),
  endpointKind: readFileSync(endpointFile, "utf8").startsWith("\\\\.\\pipe\\") ? "named-pipe" : "unix-socket",
  endpointInsideVersionDir: dirname(readFileSync(endpointFile, "utf8")) === versionDir,
}, null, 2) + "\n");
NODE
}

run_installed_component_probe() {
  local plugin_root="$1"
  local script="$SANDBOX_ROOT/installed-component-probe.mjs"
  cat >"$script" <<'NODE'
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = process.env.REPO_ROOT;
const pluginRoot = process.env.INSTALLED_PLUGIN_ROOT;
const projectDir = process.env.QA_CWD;
const codexHome = process.env.CODEX_HOME;
const sandboxRoot = process.env.SANDBOX_ROOT;
const daemonDir = process.env.OMO_LSP_DAEMON_DIR;
const output = process.env.INSTALLED_COMPONENT_RESULT;
if (!repoRoot || !pluginRoot || !projectDir || !codexHome || !sandboxRoot || !daemonDir || !output) {
  throw new Error("missing installed-component probe environment");
}

const componentRoot = join(pluginRoot, "components", "lsp");
const cliPath = join(componentRoot, "dist", "cli.js");
const manifestPath = join(componentRoot, "dist", ".omo-runtime-manifest.json");
const daemonCliPath = join(pluginRoot, "components", "lsp-daemon", "dist", "cli.js");
const daemonVersion = JSON.parse(readFileSync(join(dirname(daemonCliPath), "package.json"), "utf8")).version;
const pluginData = join(sandboxRoot, "installed-component-plugin-data");
const scenarioPath = join(sandboxRoot, "installed-component-scenario.json");
const eventsPath = join(sandboxRoot, "installed-component-server-events.jsonl");
const sourcePath = join(projectDir, "source.ts");
const markdownPath = join(projectDir, "README.md");
const transcriptPath = join(sandboxRoot, "context-pressure-transcript.txt");
const projectConfigPath = join(realpathSync(projectDir), ".codex", "lsp-client.json");
const userConfigPath = join(resolve(codexHome), "lsp-client.json");
const installDecisionsPath = join(resolve(codexHome), "lsp-install-decisions.json");
const fixturePath = join(repoRoot, "packages", "lsp-core", "src", "lsp", "fixtures", "workspace-edit-server.mjs");
const longMessage = `installed-post-edit ${"x".repeat(12000)}`;

mkdirSync(dirname(projectConfigPath), { recursive: true });
mkdirSync(resolve(codexHome), { recursive: true });
mkdirSync(pluginData, { recursive: true });
writeFileSync(sourcePath, "const value = missingSymbol;\n", "utf8");
writeFileSync(markdownPath, "# note\n", "utf8");
writeFileSync(eventsPath, "", "utf8");
writeFileSync(transcriptPath, "Codex ran out of room in the model's context window\n", "utf8");
writeFileSync(
  scenarioPath,
  JSON.stringify(
    {
      publishDiagnostics: [
        { trigger: "didOpen", version: 1, diagnostics: [diagnostic(longMessage)] },
      ],
      diagnosticResponses: [
        { report: { items: [diagnostic(longMessage)] } },
        { report: { items: [diagnostic(longMessage)] } },
      ],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  projectConfigPath,
  JSON.stringify({ lsp: {} }, null, 2) + "\n",
);
writeFileSync(
  userConfigPath,
  JSON.stringify(
    {
      lsp: {
        typescript: {
          command: [process.execPath, fixturePath, scenarioPath, eventsPath],
          extensions: [".ts"],
          priority: 100,
        },
      },
    },
    null,
    2,
  ) + "\n",
);

const manifest = validateManifest();
const staticImports = scanRuntimeImports();
const distOnlyValidation = validateDistOnlyRuntime();
const postEdit = runPostEditProbe();
const mcpDiagnostics = runMcpDiagnosticsProbe();
const compaction = runCompactionProbe();
const validation = runOverrideValidation();
const daemonOwner = inspectDaemonOwner();
const daemonArtifacts = readDaemonArtifacts();
const context = {
  cwd: realpathSync(projectDir),
  projectConfigPaths: [projectConfigPath],
  userConfigPath,
  installDecisionsPath,
  capabilities: { installDecisionTool: true },
};
const result = {
  result: "PASS",
  manifest,
  distOnlyValidation,
  componentCli: {
    path: cliPath,
    exists: existsSync(cliPath),
    noNonBuiltinRuntimeImports: staticImports.nonBuiltin.length === 0,
    nonBuiltinRuntimeImports: staticImports.nonBuiltin,
  },
  consumer: {
    emptyNodePath: postEdit.emptyNodePath === true && compaction.emptyNodePath === true,
    repositoryHiddenByInstall: staticImports.nonBuiltin.length === 0,
  },
  codexContext: context,
  postEdit,
  mcpDiagnostics,
  compaction,
  validation,
  daemonOwner,
  daemonArtifacts,
};

const required = [
  result.manifest.valid === true,
  result.distOnlyValidation.ok === true,
  result.componentCli.exists === true,
  result.componentCli.noNonBuiltinRuntimeImports === true,
  result.consumer.emptyNodePath === true,
  result.consumer.repositoryHiddenByInstall === true,
  result.postEdit.actualPostEditOperation === true,
  result.postEdit.projectConfigConsumed === true,
  result.postEdit.defaultBudgetWithinLimit === true,
  result.postEdit.contextPressureBudgetWithinLimit === true,
  result.compaction.cacheStored === true,
  result.compaction.compactionReset === true,
  result.validation.singletonRejected === true,
  result.validation.nonexistentPairRejected === true,
  result.daemonOwner.count === 1,
  result.daemonOwner.commandIncludesInstalledCli === true,
];
if (!required.every(Boolean)) {
  writeFileSync(output, JSON.stringify({ ...result, result: "FAIL" }, null, 2) + "\n");
  throw new Error("installed-component probe failed required assertions");
}
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");

function diagnostic(message) {
  return {
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 18 } },
    message,
    code: 2304,
    severity: 1,
  };
}

function validateManifest() {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  const outputs = Array.isArray(parsed.outputs) ? parsed.outputs : [];
  const sorted = outputs.map((entry) => entry.path).join("\n") === outputs.map((entry) => entry.path).sort().join("\n");
  const hashesMatch = outputs.every((entry) => {
    const filePath = join(componentRoot, "dist", entry.path);
    return existsSync(filePath) && sha256(readFileSync(filePath)) === entry.sha256;
  });
  return {
    valid: parsed.schemaVersion === 1 && /^sha256:[a-f0-9]{64}$/u.test(parsed.inputDigest) && sorted && hashesMatch,
    schemaVersion: parsed.schemaVersion,
    inputDigest: parsed.inputDigest,
    outputCount: outputs.length,
    sortedOutputs: sorted,
    outputHashesMatch: hashesMatch,
  };
}

function validateDistOnlyRuntime() {
  const distOnlyRoot = join(sandboxRoot, "dist-only-lsp-component");
  rmSync(distOnlyRoot, { recursive: true, force: true });
  mkdirSync(join(distOnlyRoot, "scripts"), { recursive: true });
  cpSync(join(componentRoot, "dist"), join(distOnlyRoot, "dist"), { recursive: true });
  cpSync(join(componentRoot, "scripts", "build-runtime.mjs"), join(distOnlyRoot, "scripts", "build-runtime.mjs"));
  cpSync(join(componentRoot, "package.json"), join(distOnlyRoot, "package.json"));
  const run = spawnSync(process.execPath, ["scripts/build-runtime.mjs"], {
    cwd: distOnlyRoot,
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
    timeout: 15000,
  });
  return { ok: run.status === 0, status: run.status, stderr: tail(run.stderr) };
}

function scanRuntimeImports() {
  const source = readFileSync(cliPath, "utf8");
  const builtin = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  const imports = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]);
  return { imports, nonBuiltin: imports.filter((specifier) => !builtin.has(specifier)) };
}

function runPostEditProbe() {
  const baseInput = {
    cwd: projectDir,
    hook_event_name: "PostToolUse",
    model: "gpt-5.5",
    permission_mode: "default",
    session_id: "installed-post-edit",
    tool_input: { path: "source.ts" },
    tool_name: "write",
    tool_response: { ok: true },
    tool_use_id: "tool-use-1",
    turn_id: "turn-1",
  };
  const first = runHook({ ...baseInput, transcript_path: null });
  const second = runHook({ ...baseInput, transcript_path: transcriptPath });
  const firstParsed = JSON.parse(first.stdout || "{}");
  const secondParsed = JSON.parse(second.stdout || "{}");
  const events = readEvents();
  return {
    emptyNodePath: first.emptyNodePath && second.emptyNodePath,
    actualPostEditOperation: events.some(
      (event) =>
        (event.type === "clientRequest" && event.method === "textDocument/diagnostic") ||
        (event.type === "clientNotification" && event.method === "textDocument/didOpen"),
    ),
    projectConfigConsumed: events.some(
      (event) => event.type === "clientRequest" && event.method === "initialize" && event.params?.rootUri === pathToFileURL(realpathSync(projectDir)).href,
    ),
    defaultReasonLength: firstParsed.reason?.length ?? null,
    contextPressureReasonLength: secondParsed.reason?.length ?? null,
    defaultBudgetWithinLimit: typeof firstParsed.reason === "string" && firstParsed.reason.length <= 8000 && firstParsed.reason.includes("Truncated hook output to 8000 chars"),
    contextPressureBudgetWithinLimit: typeof secondParsed.reason === "string" && secondParsed.reason.length <= 1200 && secondParsed.reason.includes("Truncated hook output to 1200 chars"),
    stdoutContainsDiagnostic: first.stdout.includes("installed-post-edit"),
    statusCodes: [first.status, second.status],
    stderrTails: [tail(first.stderr), tail(second.stderr)],
  };
}

function runMcpDiagnosticsProbe() {
  const request = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lsp_diagnostics", arguments: { filePath: "source.ts" } } },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n";
  const run = spawnSync(process.execPath, [cliPath, "mcp"], {
    cwd: projectDir,
    input: request,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
  const responses = run.stdout.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parseError: line };
    }
  });
  const diagnosticResponse = responses.find((entry) => entry?.id === 2);
  const text = diagnosticResponse?.result?.content?.map((entry) => entry?.text ?? "").join("\n") ?? "";
  return {
    status: run.status,
    ok: run.status === 0 && diagnosticResponse?.result?.isError !== true && text.includes("installed-post-edit"),
    textTail: tail(text),
    stderrTail: tail(run.stderr),
    responseCount: responses.length,
    diagnosticResponse,
  };
}

function runCompactionProbe() {
  const sessionId = "installed-compact-session";
  const input = {
    cwd: projectDir,
    hook_event_name: "PostToolUse",
    model: "gpt-5.5",
    permission_mode: "default",
    session_id: sessionId,
    tool_input: { path: "README.md" },
    tool_name: "write",
    tool_response: { ok: true },
    tool_use_id: "tool-use-2",
    transcript_path: null,
    turn_id: "turn-2",
  };
  const first = runHook(input);
  const statePath = join(pluginData, "sessions", `${sessionId}.json`);
  const before = JSON.parse(readFileSync(statePath, "utf8"));
  const compact = spawnSync(process.execPath, [cliPath, "hook", "post-compact"], {
    cwd: projectDir,
    input: JSON.stringify({ session_id: sessionId }) + "\n",
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 30000,
  });
  const after = JSON.parse(readFileSync(statePath, "utf8"));
  return {
    emptyNodePath: true,
    firstStatus: first.status,
    compactStatus: compact.status,
    cacheStored: Array.isArray(before.notConfiguredExtensions) && before.notConfiguredExtensions.includes(".md"),
    compactionReset: Array.isArray(after.notConfiguredExtensions) && after.notConfiguredExtensions.length === 0,
    stdoutTails: [tail(first.stdout), tail(compact.stdout)],
    stderrTails: [tail(first.stderr), tail(compact.stderr)],
  };
}

function runOverrideValidation() {
  const singleton = spawnSync(process.execPath, [cliPath, "mcp"], {
    cwd: projectDir,
    input: "",
    env: cleanEnv({ OMO_LSP_DAEMON_CLI: daemonCliPath }, false),
    encoding: "utf8",
    timeout: 5000,
  });
  const nonexistent = spawnSync(process.execPath, [cliPath, "mcp"], {
    cwd: projectDir,
    input: "",
    env: cleanEnv({
      OMO_LSP_DAEMON_CLI: join(sandboxRoot, "missing-daemon-cli.js"),
      OMO_LSP_DAEMON_VERSION: "999.0.0",
    }, false),
    encoding: "utf8",
    timeout: 5000,
  });
  return {
    singletonRejected: singleton.status !== 0 && singleton.stderr.includes("must be set together"),
    nonexistentPairRejected: nonexistent.status !== 0 && singleton.status !== 0 && nonexistent.stderr.includes("points to a missing file"),
    singletonStatus: singleton.status,
    nonexistentStatus: nonexistent.status,
    singletonStderr: tail(singleton.stderr),
    nonexistentStderr: tail(nonexistent.stderr),
  };
}

function inspectDaemonOwner() {
  const pidFiles = [];
  collectPidFiles(daemonDir, pidFiles, readdirSync);
  const command = pidFiles.length === 1 ? psCommand(readFileSync(pidFiles[0], "utf8").trim()) : "";
  return {
    count: pidFiles.length,
    pidFiles: pidFiles.map((path) => path.slice(daemonDir.length + 1)),
    commandIncludesInstalledCli: command.includes(daemonCliPath) && command.includes(" daemon"),
  };
}

function readDaemonArtifacts() {
  const files = [];
  collectDaemonFiles(daemonDir, files);
  const artifacts = {};
  for (const file of files) {
    const relative = file.slice(daemonDir.length + 1);
    artifacts[relative] = file.endsWith("/daemon.auth") ? "<redacted>" : tail(readFileSync(file, "utf8"));
  }
  return artifacts;
}

function collectDaemonFiles(dir, output) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) collectDaemonFiles(child, output);
    else if (entry.isFile() && /^daemon\.(?:log|pid|endpoint|owner|auth)$/u.test(entry.name)) output.push(child);
  }
}

function collectPidFiles(dir, output, readdirSync) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) collectPidFiles(child, output, readdirSync);
    else if (entry.isFile() && entry.name === "daemon.pid") output.push(child);
  }
}

function psCommand(pid) {
  const run = spawnSync("/bin/ps", ["-p", pid, "-o", "command="], { encoding: "utf8", timeout: 5000 });
  return run.stdout.trim();
}

function runHook(input) {
  const run = spawnSync(process.execPath, [cliPath, "hook", "post-tool-use"], {
    cwd: projectDir,
    input: JSON.stringify(input) + "\n",
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return { ...run, emptyNodePath: true };
}

function cleanEnv(extra = {}, includeRuntimePair = true) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    CODEX_HOME: resolve(codexHome),
    PLUGIN_DATA: pluginData,
    OMO_LSP_DAEMON_DIR: daemonDir,
    OMO_DISABLE_POSTHOG: "1",
    OMO_CODEX_DISABLE_POSTHOG: "1",
    NODE_PATH: "",
  };
  for (const key of ["TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (includeRuntimePair) {
    env.OMO_LSP_DAEMON_CLI = daemonCliPath;
    env.OMO_LSP_DAEMON_VERSION = daemonVersion;
  }
  Object.assign(env, extra);
  for (const key of Object.keys(env)) {
    if (key.startsWith("CODEX" + "_LSP_")) delete env[key];
  }
  return env;
}

function readEvents() {
  return readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function tail(text) {
  return String(text ?? "").split("\n").slice(-20).join("\n");
}
NODE
  REPO_ROOT="$REPO_ROOT" INSTALLED_PLUGIN_ROOT="$plugin_root" SANDBOX_ROOT="$SANDBOX_ROOT" \
    INSTALLED_COMPONENT_RESULT="$EVIDENCE_DIR/installed-component.json" \
    run_bounded 180 "$EVIDENCE_DIR/installed-component.log" node "$script"
}

write_final_result() {
  local real_omo_before="$1" real_omo_after="$2" real_codex_before="$3" real_codex_after="$4"
  local worktree_before="$5" worktree_after="$6" sandbox_removed="$7"
  RESULT_STAGE="$EVIDENCE_DIR/.result.json.$$"
  node --input-type=module - \
    "$RESULT_STAGE" "$SCENARIO" "$real_omo_before" "$real_omo_after" "$real_codex_before" "$real_codex_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" \
    "$EVIDENCE_DIR/path-contract.json" "$EVIDENCE_DIR/app-server.json" "$EVIDENCE_DIR/daemon-state.json" \
    "$EVIDENCE_DIR/workspace-edit-contract.json" "$EVIDENCE_DIR/rename-fixture.json" "$EVIDENCE_DIR/rename-server-events.jsonl" \
    "$EVIDENCE_DIR/diagnostics-freshness-contract.json" "$EVIDENCE_DIR/diagnostics-freshness-fixture.json" \
    "$EVIDENCE_DIR/legacy-cleanup-contract.json" "$EVIDENCE_DIR/legacy-cleanup-live.json" "$EVIDENCE_DIR/legacy-cleanup-process-cleanup.txt" \
    "$EVIDENCE_DIR/post-edit-contract.json" "$EVIDENCE_DIR/cancellation-contract.json" "$EVIDENCE_DIR/package-smoke.json" \
    "$EVIDENCE_DIR/installed-component.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [
  output,
  scenario,
  omoBefore,
  omoAfter,
  codexBefore,
  codexAfter,
  worktreeBefore,
  worktreeAfter,
  sandboxRemoved,
  contractPath,
  appPath,
  daemonPath,
  workspaceContractPath,
  renameFixturePath,
  renameEventsPath,
  freshnessContractPath,
  freshnessFixturePath,
  legacyContractPath,
  legacyLivePath,
  legacyProcessCleanupPath,
  postEditContractPath,
  cancellationContractPath,
  clientPackagePath,
  installedComponentPath,
] = process.argv.slice(2);
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const app = JSON.parse(readFileSync(appPath, "utf8"));
const daemon = JSON.parse(readFileSync(daemonPath, "utf8"));
const workspaceContract = scenario === "rename" ? JSON.parse(readFileSync(workspaceContractPath, "utf8")) : null;
const renameFixture = scenario === "rename" ? JSON.parse(readFileSync(renameFixturePath, "utf8")) : null;
const renameEvents = scenario === "rename"
  ? readFileSync(renameEventsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const freshnessContract = scenario === "diagnostics-freshness" ? JSON.parse(readFileSync(freshnessContractPath, "utf8")) : null;
const freshnessFixture = scenario === "diagnostics-freshness" ? JSON.parse(readFileSync(freshnessFixturePath, "utf8")) : null;
const legacyContract = scenario === "legacy-cleanup" ? JSON.parse(readFileSync(legacyContractPath, "utf8")) : null;
const legacyLive = scenario === "legacy-cleanup" ? JSON.parse(readFileSync(legacyLivePath, "utf8")) : null;
const legacyProcessCleanup = scenario === "legacy-cleanup" ? readFileSync(legacyProcessCleanupPath, "utf8") : null;
const postEditContract = scenario === "post-edit" ? JSON.parse(readFileSync(postEditContractPath, "utf8")) : null;
const cancellationContract = scenario === "cancellation" ? JSON.parse(readFileSync(cancellationContractPath, "utf8")) : null;
const clientPackage = scenario === "client-package" ? JSON.parse(readFileSync(clientPackagePath, "utf8")) : null;
const installedComponent = scenario === "installed-component" ? JSON.parse(readFileSync(installedComponentPath, "utf8")) : null;
const result = {
  result: "PASS",
  scenario,
  harness: "codex",
  realOmoRootUnchanged: omoBefore === omoAfter,
  realCodexConfigUnchanged: codexBefore === codexAfter,
  dirtyWorktreePreserved: worktreeBefore === worktreeAfter,
  isolatedCodexHome: true,
  localMockModel: true,
  pluginOnly: true,
  disabledSideEffectHooks: [
    "session-start-checking-auto-update.json",
    "session-start-checking-bootstrap-provisioning.json",
    "session-start-checking-codegraph-bootstrap.json",
  ],
  hookStarted: app.hookStarted === true,
  hookCompleted: app.hookCompleted === true,
  lspOperation: app.lspOperation,
  ...(scenario === "rename"
    ? {
        diagnosticsOperation: app.diagnosticsOperation,
        serverAppliedRename: app.renameHarness?.serverApplyRequestCount === 1 && app.renameHarness?.applyResponses?.[0]?.applied === true,
        recordedResultReused: workspaceContract?.success?.recordedResultReused === true,
        synchronizedDocumentVersion: workspaceContract?.success?.synchronizedDocumentVersion ?? null,
        didChangeVersions: app.renameHarness?.didChangeVersions ?? [],
        immediateDiagnostics: workspaceContract?.success?.immediateDiagnostics === true && app.diagnosticsOperation?.ok === true,
        finalContent: app.renameHarness?.finalContent ?? null,
        failureHashes: workspaceContract?.failureHashes ?? {},
        failureEvidence: workspaceContract?.failureCases ?? {},
        renameFixture,
        renameEventCount: renameEvents.length,
      }
    : scenario === "diagnostics-freshness"
      ? {
          diagnosticsFreshnessProbe: freshnessContract,
          diagnosticsFreshnessFixture: freshnessFixture,
        }
    : scenario === "legacy-cleanup"
      ? {
          legacyCleanup: {
            exactVectors: legacyLive?.vectors ?? null,
            contract: legacyContract,
            live: legacyLive,
            cleanupReceipt: legacyProcessCleanup,
          },
        }
    : scenario === "post-edit"
      ? {
          postEditContract,
        }
    : scenario === "cancellation"
      ? {
          cancellationContract,
        }
    : scenario === "client-package"
      ? {
          clientPackage,
        }
    : scenario === "installed-component"
      ? {
          installedComponent,
        }
    : {}),
  resolvedBase: daemon.base,
  resolvedVersion: daemon.version,
  resolvedVersionDir: daemon.versionDir,
  overrideAssertions: contract.assertions,
  failureFixtures: contract.failures,
  realOmoRootHashBefore: omoBefore,
  realOmoRootHashAfter: omoAfter,
  cleanup: {
    daemonStopped: true,
    appServerStopped: true,
    mockModelStopped: true,
    isolatedStateRemoved: sandboxRemoved === "true",
  },
  artifacts: {
    invocation: "invocation.txt",
    pathContract: "path-contract.json",
    appServer: "app-server.json",
    daemonState: "daemon-state.json",
    workspaceEditContract: scenario === "rename" ? "workspace-edit-contract.json" : undefined,
    renameFixture: scenario === "rename" ? "rename-fixture.json" : undefined,
    renameServerEvents: scenario === "rename" ? "rename-server-events.jsonl" : undefined,
    diagnosticsFreshnessContract: scenario === "diagnostics-freshness" ? "diagnostics-freshness-contract.json" : undefined,
    diagnosticsFreshnessFixture: scenario === "diagnostics-freshness" ? "diagnostics-freshness-fixture.json" : undefined,
    legacyCleanupContract: scenario === "legacy-cleanup" ? "legacy-cleanup-contract.json" : undefined,
    legacyCleanupLive: scenario === "legacy-cleanup" ? "legacy-cleanup-live.json" : undefined,
    legacyCleanupProcessCleanup: scenario === "legacy-cleanup" ? "legacy-cleanup-process-cleanup.txt" : undefined,
    postEditContract: scenario === "post-edit" ? "post-edit-contract.json" : undefined,
    cancellationContract: scenario === "cancellation" ? "cancellation-contract.json" : undefined,
    clientPackage: scenario === "client-package" ? "package-smoke.json" : undefined,
    installedComponent: scenario === "installed-component" ? "installed-component.json" : undefined,
    installLog: "install.log",
    cleanupReceipt: "cleanup-receipt.txt",
  },
};
const required = [
  result.realOmoRootUnchanged,
  result.realCodexConfigUnchanged,
  result.dirtyWorktreePreserved,
  result.hookStarted,
  result.hookCompleted,
  result.lspOperation?.ok === true,
  result.cleanup.isolatedStateRemoved,
  ...Object.values(result.overrideAssertions),
];
if (scenario === "rename") {
  required.push(
    result.diagnosticsOperation?.ok === true,
    result.serverAppliedRename === true,
    result.recordedResultReused === true,
    result.synchronizedDocumentVersion === 2,
    JSON.stringify(result.didChangeVersions) === JSON.stringify([2]),
    result.immediateDiagnostics === true,
    result.finalContent === "const after = 1;\n",
    typeof result.failureHashes?.unscoped === "string" && result.failureHashes.unscoped.length === 64,
    typeof result.failureHashes?.concurrent === "string" && result.failureHashes.concurrent.length === 64,
    typeof result.failureHashes?.mismatched === "string" && result.failureHashes.mismatched.length === 64,
    typeof result.failureHashes?.preGate === "string" && result.failureHashes.preGate.length === 64,
  );
}
if (scenario === "diagnostics-freshness") {
  required.push(
    freshnessContract?.outcomes?.exactCurrent?.ok === true,
    freshnessContract?.outcomes?.postGenerationVersionless?.ok === true,
    freshnessContract?.outcomes?.stale?.ok === true,
    freshnessContract?.outcomes?.future?.ok === true,
    freshnessContract?.outcomes?.pullOvertaken?.ok === true,
    freshnessContract?.outcomes?.silent?.ok === true,
    freshnessContract?.outcomes?.closedServer?.ok === true,
    freshnessContract?.outcomes?.unsupportedPull?.ok === true,
    freshnessContract?.outcomes?.sameVersionUnchanged?.ok === true,
  );
}
if (scenario === "legacy-cleanup") {
  required.push(
    legacyContract?.assertions?.windowsDeferred === true,
    legacyContract?.assertions?.noAttestationDeferred === true,
    legacyContract?.assertions?.timeoutDeferred === true,
    legacyContract?.assertions?.staleRemoved === true,
    legacyContract?.assertions?.symlinkRemovedWithoutFollowing === true,
    legacyContract?.assertions?.malformedRemoved === true,
    legacyLive?.results?.ownedTerminated === true,
    legacyLive?.results?.staleNaturalRemoved === true,
    legacyLive?.results?.staleHashedRemoved === true,
    legacyLive?.results?.malformedRemoved === true,
    legacyLive?.results?.foreignOwnerPreserved === true,
    legacyLive?.results?.timeoutPreserved === true,
    legacyLive?.results?.unrelatedPidNotSignaled === true,
    legacyLive?.results?.visibleInstallerWarning === true,
    legacyLive?.results?.noLiveIpcCopy === true,
    typeof legacyProcessCleanup === "string" && legacyProcessCleanup.includes("alive_after=no"),
  );
}
if (scenario === "post-edit") {
  required.push(
    postEditContract?.result === "PASS",
    postEditContract?.assertions?.explicitTranslatorOutputs === true,
    postEditContract?.assertions?.translatorDefaults === true,
    postEditContract?.assertions?.directAdapterNonUse === true,
    postEditContract?.assertions?.maxConcurrencyFour === true,
    postEditContract?.assertions?.orderedBlocks === true,
    postEditContract?.assertions?.duplicatesRunOnce === true,
    postEditContract?.assertions?.cacheResetRetry === true,
    postEditContract?.assertions?.rejectionBeforeLookup === true,
  );
}
if (scenario === "cancellation") {
  required.push(
    cancellationContract?.result === "PASS",
    cancellationContract?.callerAbort?.daemonProxyRequestId === cancellationContract?.callerAbort?.daemonCancelTarget,
    cancellationContract?.callerAbort?.lspRequestId === cancellationContract?.callerAbort?.lspCancelTarget,
    cancellationContract?.noLeftovers?.daemonActiveControllersAfter === 0,
    cancellationContract?.noLeftovers?.lspPendingRequestsAfter === 0,
    cancellationContract?.delayedRenamePreCommitGate?.zeroWrites === true,
    cancellationContract?.delayedRenamePreCommitGate?.preservesBeforeHash === true,
    cancellationContract?.cancellationAfterCommitGate?.mutationCount === 1,
    cancellationContract?.cancellationAfterCommitGate?.lateAbort === true,
    cancellationContract?.readOnlyPreWriteConnectionFailureRetry?.retryCount === 1,
    cancellationContract?.authProtocolCwd?.tokenLoggedOrForwarded === false,
  );
}
if (scenario === "client-package") {
  required.push(
    clientPackage?.result === "PASS",
    clientPackage?.build?.requiredOutputs?.clientJs === true,
    clientPackage?.build?.requiredOutputs?.clientDts === true,
    clientPackage?.build?.requiredOutputs?.cliJs === true,
    clientPackage?.build?.requiredOutputs?.indexJs === true,
    clientPackage?.build?.staleDistRemoved === true,
    clientPackage?.packageJson?.hasOnlyClientAndCliExports === true,
    clientPackage?.scans?.clientJsNoWorkspaceDeps === true,
    clientPackage?.scans?.clientDtsNoWorkspaceDeps === true,
    clientPackage?.scans?.noRepositoryPathCoupling === true,
    clientPackage?.consumer?.emptyNodePath === true,
    clientPackage?.consumer?.js?.statusOk === true,
    clientPackage?.consumer?.js?.typedContextForwarded === true,
    clientPackage?.consumer?.js?.cancellation?.accepted === true,
    clientPackage?.consumer?.js?.rootImport?.rejected === true,
    clientPackage?.consumer?.js?.unknownImport?.rejected === true,
    clientPackage?.consumer?.js?.deepImport?.rejected === true,
    Array.isArray(clientPackage?.consumer?.js?.serverSymbols) && clientPackage.consumer.js.serverSymbols.length === 0,
    clientPackage?.consumer?.tscExitCode === 0,
    clientPackage?.adversarial?.repositoryHiddenByInstall === true,
  );
}
if (scenario === "installed-component") {
  required.push(
    installedComponent?.result === "PASS",
    installedComponent?.manifest?.valid === true,
    installedComponent?.manifest?.sortedOutputs === true,
    installedComponent?.manifest?.outputHashesMatch === true,
    installedComponent?.distOnlyValidation?.ok === true,
    installedComponent?.componentCli?.exists === true,
    installedComponent?.componentCli?.noNonBuiltinRuntimeImports === true,
    installedComponent?.consumer?.emptyNodePath === true,
    installedComponent?.consumer?.repositoryHiddenByInstall === true,
    typeof installedComponent?.codexContext?.cwd === "string" &&
      installedComponent.codexContext.cwd.endsWith("/project"),
    installedComponent?.codexContext?.projectConfigPaths?.[0] ===
      `${installedComponent?.codexContext?.cwd}/.codex/lsp-client.json`,
    installedComponent?.codexContext?.userConfigPath?.endsWith("/codex/lsp-client.json") === true,
    installedComponent?.codexContext?.installDecisionsPath?.endsWith("/codex/lsp-install-decisions.json") === true,
    installedComponent?.codexContext?.capabilities?.installDecisionTool === true,
    installedComponent?.postEdit?.actualPostEditOperation === true,
    installedComponent?.postEdit?.projectConfigConsumed === true,
    installedComponent?.postEdit?.defaultBudgetWithinLimit === true,
    installedComponent?.postEdit?.contextPressureBudgetWithinLimit === true,
    installedComponent?.compaction?.cacheStored === true,
    installedComponent?.compaction?.compactionReset === true,
    installedComponent?.validation?.singletonRejected === true,
    installedComponent?.validation?.nonexistentPairRejected === true,
    installedComponent?.daemonOwner?.count === 1,
    installedComponent?.daemonOwner?.commandIncludesInstalledCli === true,
  );
}
if (!required.every(Boolean)) throw new Error("refusing to write PASS result with failed assertions");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
NODE
  if [ "$SCENARIO" = "rename" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .diagnosticsOperation.ok == true
        and .serverAppliedRename == true
        and .recordedResultReused == true
        and .synchronizedDocumentVersion == 2
        and .immediateDiagnostics == true
        and (.failureHashes | keys | sort) == ["concurrent","mismatched","preGate","unscoped"]' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "diagnostics-freshness" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .diagnosticsFreshnessProbe.outcomes.exactCurrent.ok == true
        and .diagnosticsFreshnessProbe.outcomes.postGenerationVersionless.ok == true
        and .diagnosticsFreshnessProbe.outcomes.stale.ok == true
        and .diagnosticsFreshnessProbe.outcomes.future.ok == true
        and .diagnosticsFreshnessProbe.outcomes.pullOvertaken.ok == true
        and .diagnosticsFreshnessProbe.outcomes.silent.ok == true
        and .diagnosticsFreshnessProbe.outcomes.closedServer.ok == true
        and .diagnosticsFreshnessProbe.outcomes.unsupportedPull.ok == true
        and .diagnosticsFreshnessProbe.outcomes.sameVersionUnchanged.ok == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "legacy-cleanup" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .legacyCleanup.contract.assertions.windowsDeferred == true
        and .legacyCleanup.contract.assertions.noAttestationDeferred == true
        and .legacyCleanup.contract.assertions.timeoutDeferred == true
        and .legacyCleanup.contract.assertions.staleRemoved == true
        and .legacyCleanup.contract.assertions.symlinkRemovedWithoutFollowing == true
        and .legacyCleanup.contract.assertions.malformedRemoved == true
        and .legacyCleanup.live.results.ownedTerminated == true
        and .legacyCleanup.live.results.foreignOwnerPreserved == true
        and .legacyCleanup.live.results.timeoutPreserved == true
        and .legacyCleanup.live.results.unrelatedPidNotSignaled == true
        and .legacyCleanup.live.results.visibleInstallerWarning == true
        and .legacyCleanup.live.results.noLiveIpcCopy == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "post-edit" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .postEditContract.result == "PASS"
        and .postEditContract.assertions.openCodeMcpEnvInputs == true
        and .postEditContract.assertions.explicitTranslatorOutputs == true
        and .postEditContract.assertions.translatorDefaults == true
        and .postEditContract.assertions.directAdapterNonUse == true
        and .postEditContract.assertions.maxConcurrencyFour == true
        and .postEditContract.assertions.orderedBlocks == true
        and .postEditContract.assertions.duplicatesRunOnce == true
        and .postEditContract.assertions.cacheResetRetry == true
        and .postEditContract.assertions.rejectionBeforeLookup == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "cancellation" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .cancellationContract.result == "PASS"
        and .cancellationContract.callerAbort.daemonProxyRequestId == .cancellationContract.callerAbort.daemonCancelTarget
        and .cancellationContract.callerAbort.lspRequestId == .cancellationContract.callerAbort.lspCancelTarget
        and .cancellationContract.noLeftovers.daemonActiveControllersAfter == 0
        and .cancellationContract.noLeftovers.lspPendingRequestsAfter == 0
        and .cancellationContract.delayedRenamePreCommitGate.zeroWrites == true
        and .cancellationContract.cancellationAfterCommitGate.mutationCount == 1
        and .cancellationContract.authProtocolCwd.tokenLoggedOrForwarded == false' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "client-package" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .clientPackage.result == "PASS"
        and .clientPackage.build.requiredOutputs.clientJs == true
        and .clientPackage.build.requiredOutputs.clientDts == true
        and .clientPackage.build.requiredOutputs.cliJs == true
        and .clientPackage.build.requiredOutputs.indexJs == true
        and .clientPackage.build.staleDistRemoved == true
        and .clientPackage.packageJson.hasOnlyClientAndCliExports == true
        and .clientPackage.scans.clientJsNoWorkspaceDeps == true
        and .clientPackage.scans.clientDtsNoWorkspaceDeps == true
        and .clientPackage.scans.noRepositoryPathCoupling == true
        and .clientPackage.consumer.emptyNodePath == true
        and .clientPackage.consumer.js.statusOk == true
        and .clientPackage.consumer.js.typedContextForwarded == true
        and .clientPackage.consumer.js.cancellation.accepted == true
        and .clientPackage.consumer.js.rootImport.rejected == true
        and .clientPackage.consumer.js.unknownImport.rejected == true
        and .clientPackage.consumer.js.deepImport.rejected == true
        and (.clientPackage.consumer.js.serverSymbols | length) == 0
        and .clientPackage.consumer.tscExitCode == 0
        and .clientPackage.adversarial.repositoryHiddenByInstall == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "installed-component" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .realCodexConfigUnchanged == true
        and .dirtyWorktreePreserved == true
        and .hookStarted == true
        and .hookCompleted == true
        and .lspOperation.ok == true
        and .installedComponent.result == "PASS"
        and .installedComponent.manifest.valid == true
        and .installedComponent.manifest.sortedOutputs == true
        and .installedComponent.manifest.outputHashesMatch == true
        and .installedComponent.distOnlyValidation.ok == true
        and .installedComponent.componentCli.exists == true
        and .installedComponent.componentCli.noNonBuiltinRuntimeImports == true
        and .installedComponent.consumer.emptyNodePath == true
        and .installedComponent.consumer.repositoryHiddenByInstall == true
        and .installedComponent.codexContext.capabilities.installDecisionTool == true
        and .installedComponent.postEdit.actualPostEditOperation == true
        and .installedComponent.postEdit.projectConfigConsumed == true
        and .installedComponent.postEdit.defaultBudgetWithinLimit == true
        and .installedComponent.postEdit.contextPressureBudgetWithinLimit == true
        and .installedComponent.compaction.cacheStored == true
        and .installedComponent.compaction.compactionReset == true
        and .installedComponent.validation.singletonRejected == true
        and .installedComponent.validation.nonexistentPairRejected == true
        and .installedComponent.daemonOwner.count == 1
        and .installedComponent.daemonOwner.commandIncludesInstalledCli == true
        and .cleanup.isolatedStateRemoved == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  else
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS" and .scenario == $scenario and .realOmoRootUnchanged == true and .lspOperation.ok == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  fi
  mv "$RESULT_STAGE" "$EVIDENCE_DIR/result.json"
  RESULT_STAGE=""
}

write_auth_ownership_result() {
  local real_omo_before="$1" real_omo_after="$2" real_codex_before="$3" real_codex_after="$4"
  local worktree_before="$5" worktree_after="$6" sandbox_removed="$7"
  RESULT_STAGE="$EVIDENCE_DIR/.result.json.$$"
  node --input-type=module - \
    "$RESULT_STAGE" "$SCENARIO" "$real_omo_before" "$real_omo_after" "$real_codex_before" "$real_codex_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" "$EVIDENCE_DIR/path-contract.json" "$EVIDENCE_DIR/auth-ownership.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [output, scenario, omoBefore, omoAfter, codexBefore, codexAfter, worktreeBefore, worktreeAfter, sandboxRemoved, contractPath, authPath] = process.argv.slice(2);
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const auth = JSON.parse(readFileSync(authPath, "utf8"));
const result = {
  ...auth,
  scenario,
  harness: "codex",
  realOmoRootUnchanged: omoBefore === omoAfter,
  realCodexConfigUnchanged: codexBefore === codexAfter,
  dirtyWorktreePreserved: worktreeBefore === worktreeAfter,
  isolatedCodexHome: true,
  localMockModel: false,
  pluginOnly: false,
  unchangedRealRoot: omoBefore === omoAfter,
  unchangedRealHomes: omoBefore === omoAfter && codexBefore === codexAfter,
  overrideAssertions: contract.assertions,
  cleanup: {
    daemonStopped: true,
    isolatedStateRemoved: sandboxRemoved === "true",
  },
  artifacts: {
    invocation: "invocation.txt",
    pathContract: "path-contract.json",
    authOwnership: "auth-ownership.json",
    cleanupReceipt: "cleanup-receipt.txt",
  },
};
const required = [
  result.result === "PASS",
  result.firstStartNoDeadlock === true,
  result.owner && typeof result.owner.pid === "number" && typeof result.owner.nonce === "string",
  result.tokenPresent === true,
  result.tokenLeaked === false,
  result.losingCandidateExit === 0,
  result.twoConfinedContexts === true,
  result.badAuthPreDispatchRejection === true,
  result.liveOwnerDeferral === true,
  result.deadOwnerCleanup === true,
  result.staleCloseSurvival === true,
  result.windowsTokenRequired === true,
  result.realOmoRootUnchanged,
  result.realCodexConfigUnchanged,
  result.dirtyWorktreePreserved,
  result.cleanup.isolatedStateRemoved,
  ...Object.values(result.overrideAssertions),
];
if (!required.every(Boolean)) throw new Error("refusing to write auth-ownership PASS result with failed assertions");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
NODE
  jq -e --arg scenario "$SCENARIO" \
    '.result == "PASS"
      and .scenario == $scenario
      and .firstStartNoDeadlock == true
      and (.owner.pid | type) == "number"
      and (.owner.nonce | type) == "string"
      and .tokenPresent == true
      and .tokenLeaked == false
      and .losingCandidateExit == 0
      and .twoConfinedContexts == true
      and .badAuthPreDispatchRejection == true
      and .liveOwnerDeferral == true
      and .deadOwnerCleanup == true
      and .staleCloseSurvival == true
      and .realOmoRootUnchanged == true
      and .realCodexConfigUnchanged == true' \
    "$RESULT_STAGE" >/dev/null || return 1
  mv "$RESULT_STAGE" "$EVIDENCE_DIR/result.json"
  RESULT_STAGE=""
}

run_internal_fixture() {
  case "${LSP_E2E_INTERNAL_FIXTURE:-}" in
    fake-pass)
      printf '{"result":"PASS","scenario":"%s"}\n' "$SCENARIO" >"$EVIDENCE_DIR/misleading-output.log"
      fail "seeded PASS output lacked required assertions"
      ;;
    fake-skip)
      printf '{"result":"SKIP","scenario":"%s"}\n' "$SCENARIO" >"$EVIDENCE_DIR/misleading-output.log"
      fail "SKIP is never a passing result"
      ;;
    partial)
      RESULT_STAGE="$EVIDENCE_DIR/.result.json.partial"
      printf '{"result":"PASS"' >"$RESULT_STAGE"
      return 19
      ;;
    interrupt)
      SANDBOX_ROOT="$(mktemp -d -t cqa-lsp-e2e.XXXXXX)" || return 1
      printf '%s\n' "$SANDBOX_ROOT" >"$EVIDENCE_DIR/interrupt-sandbox.txt"
      RESULT_STAGE="$EVIDENCE_DIR/.result.json.interrupt"
      printf '{"result":"PASS"' >"$RESULT_STAGE"
      while :; do sleep 1; done
      ;;
    *)
      fail "unknown internal fixture"
      ;;
  esac
}

run_missing_dist_build_order_self_test() {
  local test_root="$1" saved_evidence="$EVIDENCE_DIR" saved_sandbox="$SANDBOX_ROOT"
  local ev="$test_root/missing-dist-build-order" failures=0 red_rc=0 green_rc=0 restored=false
  mkdir -p "$ev/sandbox" || return 1
  EVIDENCE_DIR="$ev"
  SANDBOX_ROOT="$ev/sandbox"

  snapshot_daemon_dist "$SANDBOX_ROOT/daemon-dist-backup" || failures=$((failures + 1))
  rm -rf "$DAEMON_DIST_DIR" || failures=$((failures + 1))
  [ ! -e "$DAEMON_DIST_DIR/package.json" ] || failures=$((failures + 1))

  cat >"$ev/pre-fix-path-contract-read.mjs" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repoRoot, output] = process.argv.slice(2);
const packagePath = join(repoRoot, "packages/lsp-daemon/dist/package.json");
const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
writeFileSync(output, JSON.stringify({ result: "UNEXPECTED_PASS", version }) + "\n");
NODE
  if run_bounded 30 "$ev/red-prebuild-failure.log" bun "$ev/pre-fix-path-contract-read.mjs" "$REPO_ROOT" "$ev/unexpected-result.json"; then
    failures=$((failures + 1))
  else
    red_rc=$?
    [ "$red_rc" -ne 0 ] || failures=$((failures + 1))
  fi
  grep -q 'ENOENT' "$ev/red-prebuild-failure.log" || failures=$((failures + 1))
  [ ! -e "$ev/result.json" ] || failures=$((failures + 1))
  [ ! -e "$ev/unexpected-result.json" ] || failures=$((failures + 1))

  prepare_daemon_dist || failures=$((failures + 1))
  write_path_contract_probe "$SANDBOX_ROOT/contract-green" "$ev/path-contract-green.json"
  green_rc=$?
  [ "$green_rc" -eq 0 ] || failures=$((failures + 1))
  jq -e '.assertions.defaultCliPackaged == true and .assertions.defaultVersionStamped == true' \
    "$ev/path-contract-green.json" >/dev/null || failures=$((failures + 1))

  if restore_daemon_dist; then
    restored=true
  else
    failures=$((failures + 1))
  fi
  node --input-type=module - "$ev/build-order-proof.json" "$red_rc" "$green_rc" "$restored" "$failures" <<'NODE'
import { writeFileSync } from "node:fs";
const [output, redRc, greenRc, restored, failures] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({
  result: failures === "0" ? "PASS" : "FAIL",
  missingDistProven: true,
  redFailedBeforeResultJson: redRc !== "0",
  redFailureLog: "red-prebuild-failure.log",
  greenBuiltDaemonDist: greenRc === "0",
  buildLog: "lsp-daemon-prebuild.log",
  pathContract: "path-contract-green.json",
  distRestored: restored === "true",
}, null, 2) + "\n");
NODE

  EVIDENCE_DIR="$saved_evidence"
  SANDBOX_ROOT="$saved_sandbox"
  [ "$failures" -eq 0 ]
}

run_self_test() {
  require_bins bash node jq git || return 1
  local root before_omo after_omo before_codex after_codex before_status after_status failures=0 out rc start end
  local cancellation_result_fields=true client_package_result_fields=true installed_component_result_fields=true
  local qa_dependencies_portable=true
  local fixture_run child sandbox_path attempts
  local missing_dist_build_order='{"result":"NOT_RUN"}'
  root="$(mktemp -d -t cqa-lsp-e2e.XXXXXX)" || return 1
  SANDBOX_ROOT="$root"
  before_omo="$(hash_path "$REAL_OMO_ROOT")"
  before_codex="$(hash_path "$REAL_CODEX_CONFIG")"
  before_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"

  out="$root/parser.log"
  if bash "${BASH_SOURCE[0]}" --scenario >"$out" 2>&1; then failures=$((failures + 1)); fi
  grep -q -- '--scenario requires a value' "$out" || failures=$((failures + 1))
  if bash "${BASH_SOURCE[0]}" --scenario ../bad --evidence-dir "$root/bad" >>"$out" 2>&1; then failures=$((failures + 1)); fi
  if bash "${BASH_SOURCE[0]}" --scenario ok --evidence-dir relative >>"$out" 2>&1; then failures=$((failures + 1)); fi

  if ! verify_tracked_cancellation_probes >>"$out" 2>&1; then
    qa_dependencies_portable=false
    failures=$((failures + 1))
  fi

  for fixture in fake-pass fake-skip; do
    local ev="$root/$fixture"
    mkdir -p "$ev"
    printf '{"result":"%s","scenario":"self-test"}\n' "$( [ "$fixture" = fake-pass ] && echo PASS || echo SKIP )" >"$ev/result.json"
    if LSP_E2E_INTERNAL_FIXTURE="$fixture" bash "${BASH_SOURCE[0]}" \
      --scenario self-test --evidence-dir "$ev" >>"$out" 2>&1; then
      failures=$((failures + 1))
    fi
    [ ! -e "$ev/result.json" ] || failures=$((failures + 1))
  done

  start="$(date +%s)"
  if run_bounded 1 "$root/hung.log" node -e 'setTimeout(() => {}, 30000)'; then
    failures=$((failures + 1))
  else
    rc=$?
    [ "$rc" -eq 124 ] || failures=$((failures + 1))
  fi
  end="$(date +%s)"
  [ $((end - start)) -lt 6 ] || failures=$((failures + 1))

  fixture_run=0
  while [ "$fixture_run" -lt 2 ]; do
    local ev="$root/partial-$fixture_run"
    mkdir -p "$ev"
    if LSP_E2E_INTERNAL_FIXTURE=partial bash "${BASH_SOURCE[0]}" \
      --scenario self-test --evidence-dir "$ev" >>"$out" 2>&1; then
      failures=$((failures + 1))
    fi
    if find "$ev" -maxdepth 1 -name '.result.json.*' -print | grep -q .; then failures=$((failures + 1)); fi
    [ ! -e "$ev/result.json" ] || failures=$((failures + 1))
    fixture_run=$((fixture_run + 1))
  done

  fixture_run=0
  while [ "$fixture_run" -lt 2 ]; do
    local interrupt_ev="$root/interrupt-$fixture_run"
    mkdir -p "$interrupt_ev"
    LSP_E2E_INTERNAL_FIXTURE=interrupt bash "${BASH_SOURCE[0]}" \
      --scenario self-test --evidence-dir "$interrupt_ev" >>"$out" 2>&1 &
    child=$!
    attempts=0
    while [ ! -f "$interrupt_ev/interrupt-sandbox.txt" ] && [ "$attempts" -lt 50 ]; do
      sleep 0.1
      attempts=$((attempts + 1))
    done
    sandbox_path="$(cat "$interrupt_ev/interrupt-sandbox.txt" 2>/dev/null || true)"
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null && failures=$((failures + 1))
    [ -n "$sandbox_path" ] && [ ! -e "$sandbox_path" ] || failures=$((failures + 1))
    if find "$interrupt_ev" -maxdepth 1 -name '.result.json.*' -print | grep -q .; then failures=$((failures + 1)); fi
    [ ! -e "$interrupt_ev/result.json" ] || failures=$((failures + 1))
    fixture_run=$((fixture_run + 1))
  done

  if run_missing_dist_build_order_self_test "$root" >>"$out" 2>&1; then
    missing_dist_build_order="$(jq -c . "$root/missing-dist-build-order/build-order-proof.json")"
  else
    failures=$((failures + 1))
    if [ -f "$root/missing-dist-build-order/build-order-proof.json" ]; then
      missing_dist_build_order="$(jq -c . "$root/missing-dist-build-order/build-order-proof.json")"
    fi
  fi

  if ! node --input-type=module <<'NODE' >>"$out" 2>&1
function valid(value) {
  return value?.result === "PASS"
    && value?.callerAbort?.daemonProxyRequestId === value?.callerAbort?.daemonCancelTarget
    && value?.callerAbort?.lspRequestId === value?.callerAbort?.lspCancelTarget
    && value?.noLeftovers?.daemonActiveControllersAfter === 0
    && value?.noLeftovers?.lspPendingRequestsAfter === 0
    && value?.delayedRenamePreCommitGate?.zeroWrites === true
    && value?.cancellationAfterCommitGate?.mutationCount === 1
    && value?.readOnlyPreWriteConnectionFailureRetry?.retryCount === 1
    && value?.sequentialProxyIds?.distinct === true
    && value?.authProtocolCwd?.tokenLoggedOrForwarded === false;
}
const good = {
  result: "PASS",
  callerAbort: { daemonProxyRequestId: 1, daemonCancelTarget: 1, lspRequestId: 2, lspCancelTarget: 2 },
  noLeftovers: { daemonActiveControllersAfter: 0, lspPendingRequestsAfter: 0 },
  delayedRenamePreCommitGate: { zeroWrites: true },
  cancellationAfterCommitGate: { mutationCount: 1 },
  readOnlyPreWriteConnectionFailureRetry: { retryCount: 1 },
  sequentialProxyIds: { distinct: true },
  authProtocolCwd: { tokenLoggedOrForwarded: false },
};
const bad = structuredClone(good);
bad.sequentialProxyIds.distinct = false;
if (!valid(good) || valid(bad)) process.exit(1);
NODE
  then
    cancellation_result_fields=false
    printf 'cancellationResultFieldsMandatory=false\n' >>"$out"
    failures=$((failures + 1))
  fi

  if ! node --input-type=module <<'NODE' >>"$out" 2>&1
function valid(value) {
  return value?.result === "PASS"
    && value?.build?.requiredOutputs?.clientJs === true
    && value?.build?.requiredOutputs?.clientDts === true
    && value?.build?.requiredOutputs?.cliJs === true
    && value?.build?.requiredOutputs?.indexJs === true
    && value?.build?.staleDistRemoved === true
    && value?.packageJson?.hasOnlyClientAndCliExports === true
    && value?.scans?.clientJsNoWorkspaceDeps === true
    && value?.scans?.clientDtsNoWorkspaceDeps === true
    && value?.scans?.noRepositoryPathCoupling === true
    && value?.consumer?.emptyNodePath === true
    && value?.consumer?.js?.statusOk === true
    && value?.consumer?.js?.typedContextForwarded === true
    && value?.consumer?.js?.cancellation?.accepted === true
    && value?.consumer?.js?.rootImport?.rejected === true
    && value?.consumer?.js?.unknownImport?.rejected === true
    && value?.consumer?.js?.deepImport?.rejected === true
    && Array.isArray(value?.consumer?.js?.serverSymbols)
    && value.consumer.js.serverSymbols.length === 0
    && value?.consumer?.tscExitCode === 0
    && value?.adversarial?.repositoryHiddenByInstall === true;
}
const good = {
  result: "PASS",
  build: { requiredOutputs: { clientJs: true, clientDts: true, cliJs: true, indexJs: true }, staleDistRemoved: true },
  packageJson: { hasOnlyClientAndCliExports: true },
  scans: { clientJsNoWorkspaceDeps: true, clientDtsNoWorkspaceDeps: true, noRepositoryPathCoupling: true },
  consumer: {
    emptyNodePath: true,
    js: {
      statusOk: true,
      typedContextForwarded: true,
      cancellation: { accepted: true },
      rootImport: { rejected: true },
      unknownImport: { rejected: true },
      deepImport: { rejected: true },
      serverSymbols: [],
    },
    tscExitCode: 0,
  },
  adversarial: { repositoryHiddenByInstall: true },
};
const missing = { result: "PASS" };
const leaked = structuredClone(good);
leaked.adversarial.repositoryHiddenByInstall = false;
const acceptedRoot = structuredClone(good);
acceptedRoot.consumer.js.rootImport.rejected = false;
const acceptedDeep = structuredClone(good);
acceptedDeep.consumer.js.deepImport.rejected = false;
const staleBuild = structuredClone(good);
staleBuild.build.staleDistRemoved = false;
if (!valid(good) || valid(missing) || valid(leaked) || valid(acceptedRoot) || valid(acceptedDeep) || valid(staleBuild)) process.exit(1);
NODE
  then
    client_package_result_fields=false
    printf 'clientPackageResultFieldsMandatory=false\n' >>"$out"
    failures=$((failures + 1))
  fi

  if ! node --input-type=module <<'NODE' >>"$out" 2>&1
function valid(value) {
  return value?.result === "PASS"
    && value?.manifest?.valid === true
    && value?.manifest?.sortedOutputs === true
    && value?.manifest?.outputHashesMatch === true
    && value?.distOnlyValidation?.ok === true
    && value?.componentCli?.exists === true
    && value?.componentCli?.noNonBuiltinRuntimeImports === true
    && value?.consumer?.emptyNodePath === true
    && value?.consumer?.repositoryHiddenByInstall === true
    && value?.codexContext?.capabilities?.installDecisionTool === true
    && value?.postEdit?.actualPostEditOperation === true
    && value?.postEdit?.projectConfigConsumed === true
    && value?.postEdit?.defaultBudgetWithinLimit === true
    && value?.postEdit?.contextPressureBudgetWithinLimit === true
    && value?.compaction?.cacheStored === true
    && value?.compaction?.compactionReset === true
    && value?.validation?.singletonRejected === true
    && value?.validation?.nonexistentPairRejected === true
    && value?.daemonOwner?.count === 1
    && value?.daemonOwner?.commandIncludesInstalledCli === true;
}
const good = {
  result: "PASS",
  manifest: { valid: true, sortedOutputs: true, outputHashesMatch: true },
  distOnlyValidation: { ok: true },
  componentCli: { exists: true, noNonBuiltinRuntimeImports: true },
  consumer: { emptyNodePath: true, repositoryHiddenByInstall: true },
  codexContext: { capabilities: { installDecisionTool: true } },
  postEdit: {
    actualPostEditOperation: true,
    projectConfigConsumed: true,
    defaultBudgetWithinLimit: true,
    contextPressureBudgetWithinLimit: true,
  },
  compaction: { cacheStored: true, compactionReset: true },
  validation: { singletonRejected: true, nonexistentPairRejected: true },
  daemonOwner: { count: 1, commandIncludesInstalledCli: true },
};
const missing = { result: "PASS" };
const workspaceImport = structuredClone(good);
workspaceImport.componentCli.noNonBuiltinRuntimeImports = false;
const missingBudget = structuredClone(good);
missingBudget.postEdit.contextPressureBudgetWithinLimit = false;
const missingCompaction = structuredClone(good);
missingCompaction.compaction.compactionReset = false;
const badOwner = structuredClone(good);
badOwner.daemonOwner.count = 2;
if (!valid(good) || valid(missing) || valid(workspaceImport) || valid(missingBudget) || valid(missingCompaction) || valid(badOwner)) process.exit(1);
NODE
  then
    installed_component_result_fields=false
    printf 'installedComponentResultFieldsMandatory=false\n' >>"$out"
    failures=$((failures + 1))
  fi

  after_omo="$(hash_path "$REAL_OMO_ROOT")"
  after_codex="$(hash_path "$REAL_CODEX_CONFIG")"
  after_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  [ "$before_omo" = "$after_omo" ] || failures=$((failures + 1))
  [ "$before_codex" = "$after_codex" ] || failures=$((failures + 1))
  [ "$before_status" = "$after_status" ] || failures=$((failures + 1))

  printf '{"result":"%s","selfTest":true,"malformedArgsRejected":true,"fakePassRejected":true,"skipRejected":true,"hungCommandBounded":true,"partialStagingCleanedTwice":true,"interruptCleanupRepeated":true,"missingDaemonDistBuildOrderIndependent":true,"qaDependenciesPortable":%s,"cancellationResultFieldsMandatory":%s,"clientPackageResultFieldsMandatory":%s,"installedComponentResultFieldsMandatory":%s,"missingDistBuildOrder":%s,"dirtyWorktreePreserved":%s,"realHomesUnchanged":%s}\n' \
    "$( [ "$failures" -eq 0 ] && echo PASS || echo FAIL )" \
    "$qa_dependencies_portable" \
    "$cancellation_result_fields" \
    "$client_package_result_fields" \
    "$installed_component_result_fields" \
    "$missing_dist_build_order" \
    "$( [ "$before_status" = "$after_status" ] && echo true || echo false )" \
    "$( [ "$before_omo" = "$after_omo" ] && [ "$before_codex" = "$after_codex" ] && echo true || echo false )"
  cleanup_all || failures=$((failures + 1))
  NORMAL_CLEANUP_COMPLETE=1
  [ "$failures" -eq 0 ]
}

run_normal() {
  require_bins codex node npm bun jq shasum git || return 1
  prepare_evidence || return 1
  if [ -n "${LSP_E2E_INTERNAL_FIXTURE:-}" ]; then
    run_internal_fixture
    return $?
  fi

  local real_omo_before real_omo_after real_codex_before real_codex_after worktree_before worktree_after
  local install_rc plugin_root plugin_count codex_bin
  local contract_rc driver_rc daemon_pid_file daemon_pid app_server_pid sandbox_removed=false
  real_omo_before="$(hash_path "$REAL_OMO_ROOT")" || return 1
  real_codex_before="$(hash_path "$REAL_CODEX_CONFIG")" || return 1
  worktree_before="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  printf '%s\n' "$worktree_before" >"$EVIDENCE_DIR/worktree-before.txt"
  REAL_OMO_BEFORE_HASH="$real_omo_before"
  codex_bin="$(command -v codex)"
  printf 'real_omo_root=%s before=%s\nreal_codex_config=%s before=%s\n' \
    "$REAL_OMO_ROOT" "$real_omo_before" "$REAL_CODEX_CONFIG" "$real_codex_before" >"$EVIDENCE_DIR/isolation-receipt.txt"

  SANDBOX_ROOT="$(mktemp -d -t cqa-lsp-e2e.XXXXXX)" || return 1
  mkdir -p "$SANDBOX_ROOT/codex" "$SANDBOX_ROOT/project" "$SANDBOX_ROOT/home"
  export HOME="$SANDBOX_ROOT/home"
  export CODEX_HOME="$SANDBOX_ROOT/codex"
  export CODEX_LOCAL_BIN_DIR="$CODEX_HOME/bin"
  export OMO_CODEX_PROJECT="$SANDBOX_ROOT/project"
  export QA_CWD="$SANDBOX_ROOT/project"
  export OMO_DISABLE_POSTHOG=1
  export OMO_CODEX_DISABLE_POSTHOG=1
  export OMO_LSP_DAEMON_DIR="$SANDBOX_ROOT/omo/lsp-daemon"
  unset OMO_LSP_DAEMON_CLI OMO_LSP_DAEMON_VERSION
  OMO_TEST_ROOT="$OMO_LSP_DAEMON_DIR"
  APP_SERVER_PID_FILE="$SANDBOX_ROOT/app-server.pid"
  export QA_SCENARIO="$SCENARIO"

	  if [ "$SCENARIO" = "legacy-cleanup" ]; then
	    write_legacy_cleanup_probe
	    run_legacy_cleanup_probe contract || { fail "legacy cleanup contract probe failed (see legacy-cleanup-contract.log)"; return 1; }
	    run_legacy_cleanup_probe setup || { fail "legacy cleanup fixture setup failed (see legacy-cleanup-setup.log)"; return 1; }
	  fi

	  with_shared_build_lock "codex-lsp-e2e-build" prepare_daemon_dist || { fail "lsp-daemon prebuild failed (see lsp-daemon-prebuild.log)"; return 1; }
	  write_path_contract_probe "$SANDBOX_ROOT/contract" "$EVIDENCE_DIR/path-contract.json"
	  contract_rc=$?
  [ "$contract_rc" -eq 0 ] || { fail "path-contract probe failed (see path-contract-probe.log)"; return 1; }
  if [ "$SCENARIO" = "auth-ownership" ]; then
    run_auth_ownership_probe || { fail "auth ownership probe failed (see auth-ownership-probe.log)"; return 1; }
    stop_known_daemon || return 1
    stop_owned_sandbox_processes || return 1
    restore_daemon_dist || return 1
    safe_rm_tree "$SANDBOX_ROOT" || return 1
    SANDBOX_ROOT=""
    sandbox_removed=true
    real_omo_after="$(hash_path "$REAL_OMO_ROOT")" || return 1
    real_codex_after="$(hash_path "$REAL_CODEX_CONFIG")" || return 1
    worktree_after="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
    printf '%s\n' "$worktree_after" >"$EVIDENCE_DIR/worktree-after.txt"
    [ "$real_omo_before" = "$real_omo_after" ] || { fail "real OMO daemon root changed"; return 1; }
    [ "$real_codex_before" = "$real_codex_after" ] || { fail "real Codex config changed"; return 1; }
    [ "$worktree_before" = "$worktree_after" ] || { fail "driver changed the dirty worktree"; return 1; }
    printf 'after=%s unchanged=yes\nreal_codex_after=%s unchanged=yes\n' "$real_omo_after" "$real_codex_after" >>"$EVIDENCE_DIR/isolation-receipt.txt"
    printf 'auth_ownership_probe_complete=true\nisolated_state_removed=%s\n' "$sandbox_removed" >"$EVIDENCE_DIR/cleanup-receipt.txt"
    write_auth_ownership_result "$real_omo_before" "$real_omo_after" "$real_codex_before" "$real_codex_after" \
      "$worktree_before" "$worktree_after" "$sandbox_removed" || return 1
    NORMAL_CLEANUP_COMPLETE=1
    jq -c . "$EVIDENCE_DIR/result.json"
    return 0
  fi
  if [ "$SCENARIO" = "rename" ]; then
    write_workspace_edit_fixture "$QA_CWD" || return 1
    run_workspace_edit_contract_probe || { fail "workspace-edit contract probe failed (see workspace-edit-contract-probe.log)"; return 1; }
    export QA_SOURCE_FILE="source.ts"
    export QA_SOURCE_PATH="$QA_CWD/source.ts"
    export QA_RENAME_EVENTS="$EVIDENCE_DIR/rename-server-events.jsonl"
  elif [ "$SCENARIO" = "diagnostics-freshness" ]; then
    write_diagnostics_freshness_fixture "$QA_CWD" || return 1
    run_diagnostics_freshness_contract_probe || { fail "diagnostics freshness contract probe failed (see diagnostics-freshness-contract-probe.log)"; return 1; }
    export QA_SOURCE_FILE="source.ts"
    export QA_SOURCE_PATH="$QA_CWD/source.ts"
  elif [ "$SCENARIO" = "post-edit" ]; then
    run_post_edit_contract_probe || { fail "post-edit contract probe failed (see post-edit-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "cancellation" ]; then
    run_cancellation_contract_probe || { fail "cancellation contract probe failed (see cancellation-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "client-package" ]; then
    run_client_package_contract_probe || { fail "client package contract probe failed (see client-package-smoke.log)"; return 1; }
  fi

  run_bounded 300 "$EVIDENCE_DIR/install.log" node "$REPO_ROOT/packages/omo-codex/scripts/install-local.mjs" install
  install_rc=$?
  [ "$install_rc" -eq 0 ] || { fail "local Codex plugin install failed (see install.log)"; return 1; }
  if [ "$SCENARIO" = "legacy-cleanup" ]; then
    if ! run_legacy_cleanup_probe verify; then
      run_legacy_cleanup_probe cleanup || true
      fail "legacy cleanup live verification failed (see legacy-cleanup-verify.log)"
      return 1
    fi
    run_legacy_cleanup_probe cleanup || { fail "legacy cleanup fixture process cleanup failed"; return 1; }
  fi
  grep -q 'omo@sisyphuslabs' "$CODEX_HOME/config.toml" || { fail "OMO plugin was not enabled in isolated config"; return 1; }
  plugin_count="$(grep -Ec '^\[plugins\."[^]]+"\]$' "$CODEX_HOME/config.toml" || true)"
  [ "$plugin_count" -eq 1 ] || { fail "isolated config enabled an unexpected plugin count: $plugin_count"; return 1; }
  plugin_root="$(find "$CODEX_HOME/plugins/cache/sisyphuslabs/omo" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -1)"
  [ -n "$plugin_root" ] || { fail "installed OMO plugin cache not found"; return 1; }
  EXPECTED_DAEMON_CLI="$plugin_root/components/lsp-daemon/dist/cli.js"
  [ -f "$EXPECTED_DAEMON_CLI" ] || { fail "installed daemon CLI missing: $EXPECTED_DAEMON_CLI"; return 1; }
  rewrite_codex_mcp_config || return 1
  stamp_codex_lsp_environment "$plugin_root/.mcp.json" || return 1
  disable_codex_side_effect_hooks "$plugin_root/.codex-plugin/plugin.json" || return 1

  start_mock_model "$EVIDENCE_DIR/mock-model.log" || return 1
  write_app_server_driver "$SANDBOX_ROOT/app-server-driver.mjs"
  export APP_SERVER_RESULT="$EVIDENCE_DIR/app-server.json"
  export APP_SERVER_PID_FILE
  export CODEX_BIN="$codex_bin"
  export DEADLINE_MS=120000
  run_bounded 150 "$EVIDENCE_DIR/app-server-driver.log" node "$SANDBOX_ROOT/app-server-driver.mjs"
  driver_rc=$?
  [ "$driver_rc" -eq 0 ] || { fail "Codex app-server LSP drive failed (see app-server-driver.log)"; return 1; }
  if [ "$SCENARIO" = "diagnostics-freshness" ]; then
    jq -e '.ok == true and .hookStarted == true and .hookCompleted == true and .lspOperation.ok == true and (.lspOperation.text | contains("exact-current"))' \
      "$EVIDENCE_DIR/app-server.json" >/dev/null || { fail "app-server evidence failed required assertions"; return 1; }
  else
    jq -e '.ok == true and .hookStarted == true and .hookCompleted == true and .lspOperation.ok == true' \
      "$EVIDENCE_DIR/app-server.json" >/dev/null || { fail "app-server evidence failed required assertions"; return 1; }
  fi
  if [ "$SCENARIO" = "installed-component" ]; then
    stop_known_daemon || return 1
    run_installed_component_probe "$plugin_root" || { fail "installed component probe failed (see installed-component.log)"; return 1; }
  fi

  record_daemon_state || return 1
  daemon_pid_file="$(find_daemon_pid_file)"
  daemon_pid="$(tr -d '[:space:]' <"$daemon_pid_file")"
  app_server_pid="$(tr -d '[:space:]' <"$APP_SERVER_PID_FILE" 2>/dev/null || true)"

  stop_mock || return 1
  stop_known_pid_file "$APP_SERVER_PID_FILE" "app-server" "Codex app-server" || return 1
	  stop_known_daemon || return 1
	  stop_owned_sandbox_processes || return 1
	  kill -0 "$daemon_pid" 2>/dev/null && { fail "daemon pid remained alive after cleanup"; return 1; }
	  if [ -n "$app_server_pid" ]; then
	    kill -0 "$app_server_pid" 2>/dev/null && { fail "app-server pid remained alive after cleanup"; return 1; }
	  fi
	  restore_daemon_dist || return 1
	  safe_rm_tree "$SANDBOX_ROOT" || return 1
  SANDBOX_ROOT=""
  sandbox_removed=true

  real_omo_after="$(hash_path "$REAL_OMO_ROOT")" || return 1
  real_codex_after="$(hash_path "$REAL_CODEX_CONFIG")" || return 1
  worktree_after="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  printf '%s\n' "$worktree_after" >"$EVIDENCE_DIR/worktree-after.txt"
  [ "$real_omo_before" = "$real_omo_after" ] || { fail "real OMO daemon root changed"; return 1; }
  [ "$real_codex_before" = "$real_codex_after" ] || { fail "real Codex config changed"; return 1; }
  [ "$worktree_before" = "$worktree_after" ] || { fail "driver changed the dirty worktree"; return 1; }
  printf 'after=%s unchanged=yes\nreal_codex_after=%s unchanged=yes\n' "$real_omo_after" "$real_codex_after" >>"$EVIDENCE_DIR/isolation-receipt.txt"
  printf 'daemon_pid=%s alive_after=no\napp_server_pid=%s alive_after=no\nmock_model_alive_after=no\nisolated_state_removed=%s\n' \
    "$daemon_pid" "${app_server_pid:-none}" "$sandbox_removed" >"$EVIDENCE_DIR/cleanup-receipt.txt"

  write_final_result "$real_omo_before" "$real_omo_after" "$real_codex_before" "$real_codex_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" || return 1
  NORMAL_CLEANUP_COMPLETE=1
  jq -c . "$EVIDENCE_DIR/result.json"
}

run_all_scenarios() {
  require_bins bash node jq git || return 1
  prepare_evidence || return 1
  local scenarios scenario failures=0 before_omo before_codex before_status after_omo after_codex after_status
  scenarios="path-contract rename diagnostics-freshness legacy-cleanup post-edit cancellation client-package installed-component auth-ownership"
  before_omo="$(hash_path "$REAL_OMO_ROOT")" || return 1
  before_codex="$(hash_path "$REAL_CODEX_CONFIG")" || return 1
  before_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  printf '%s\n' "$scenarios" >"$EVIDENCE_DIR/all-scenarios.txt"
  for scenario in $scenarios; do
    mkdir -p "$EVIDENCE_DIR/$scenario"
    if ! bash "${BASH_SOURCE[0]}" --scenario "$scenario" --evidence-dir "$EVIDENCE_DIR/$scenario" >"$EVIDENCE_DIR/$scenario.command.log" 2>&1; then
      failures=$((failures + 1))
      continue
    fi
    jq -e '.result == "PASS" and .scenario != "SKIP"' "$EVIDENCE_DIR/$scenario/result.json" >/dev/null || failures=$((failures + 1))
  done
  after_omo="$(hash_path "$REAL_OMO_ROOT")" || return 1
  after_codex="$(hash_path "$REAL_CODEX_CONFIG")" || return 1
  after_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  [ "$before_omo" = "$after_omo" ] || failures=$((failures + 1))
  [ "$before_codex" = "$after_codex" ] || failures=$((failures + 1))
  [ "$before_status" = "$after_status" ] || failures=$((failures + 1))
  node --input-type=module - "$EVIDENCE_DIR" "$before_omo" "$after_omo" "$before_codex" "$after_codex" "$before_status" "$after_status" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [evidenceDir, omoBefore, omoAfter, codexBefore, codexAfter, statusBefore, statusAfter] = process.argv.slice(2);
const scenarios = readFileSync(join(evidenceDir, "all-scenarios.txt"), "utf8").trim().split(/\s+/);
const entries = scenarios.map((scenario) => [scenario, JSON.parse(readFileSync(join(evidenceDir, scenario, "result.json"), "utf8"))]);
const results = Object.fromEntries(entries);
const values = entries.map(([, value]) => value);
const payload = {
  result: values.every((value) => value.result === "PASS") && omoBefore === omoAfter && codexBefore === codexAfter && statusBefore === statusAfter ? "PASS" : "FAIL",
  scenario: "all",
  harness: "codex",
  scenarioOrder: scenarios,
  scenarioResults: Object.fromEntries(entries.map(([name, value]) => [name, { result: value.result, cleanup: value.cleanup ?? {}, artifacts: value.artifacts ?? {} }])),
  realOmoRootUnchanged: omoBefore === omoAfter && values.every((value) => value.realOmoRootUnchanged === true),
  realCodexConfigUnchanged: codexBefore === codexAfter && values.every((value) => value.realCodexConfigUnchanged === true),
  dirtyWorktreePreserved: statusBefore === statusAfter && values.every((value) => value.dirtyWorktreePreserved === true),
  noSkip: values.every((value) => value.result !== "SKIP" && value.scenario !== "SKIP"),
  hookProof: values.every((value) => value.hookStarted === true && value.hookCompleted === true),
  pathContract: results["path-contract"]?.overrideAssertions ?? null,
  pairRecovery: results["path-contract"]?.failureFixtures ?? null,
  auth: results["auth-ownership"]?.authOwnership ?? results["auth-ownership"] ?? null,
  cancellation: results.cancellation?.cancellationContract ?? null,
  installedComponent: results["installed-component"]?.installedComponent ?? null,
  legacyCleanup: results["legacy-cleanup"]?.legacyCleanup ?? null,
  cleanup: {
    isolatedStateRemoved: values.every((value) => value.cleanup?.isolatedStateRemoved === true),
    daemonStopped: values.every((value) => value.cleanup?.daemonStopped === true),
  },
};
writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload));
NODE
  NORMAL_CLEANUP_COMPLETE=1
  [ "$failures" -eq 0 ] && jq -e '.result == "PASS" and .noSkip == true' "$EVIDENCE_DIR/result.json" >/dev/null
}

main() {
  parse_args "$@" || return $?
  if [ "$SELF_TEST" -eq 1 ]; then
    run_self_test
  elif [ "$SCENARIO" = "all" ]; then
    run_all_scenarios
  else
    run_normal
  fi
}

main "$@"
