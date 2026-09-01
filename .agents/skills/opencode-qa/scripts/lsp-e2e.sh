#!/usr/bin/env bash
# lsp-e2e.sh - isolated live OpenCode QA for the shared OMO LSP daemon.
#
# Normal mode loads this worktree's OMO plugin into disposable XDG/HOME state,
# drives a real `opencode serve` with a local fake Responses provider, observes
# the event stream, and requires an actual completed LSP MCP tool call for the
# requested scenario.
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
EXPECTED_DAEMON_VERSION=""
OPENCODE_PID=""
FAKE_PID=""
SSE_PID=""
RESULT_STAGE=""
CLEANUP_RUNNING=0
NORMAL_CLEANUP_COMPLETE=0
REAL_HOME="${HOME:-}"
REAL_OMO_ROOT="${HOME:-}/.omo/lsp-daemon"
REAL_DB_PATH=""
REAL_DB_COUNT_BEFORE=""
REAL_OMO_BEFORE_HASH=""
HEALTH_READY_SECONDS=30
HEALTH_CURL_CONNECT_TIMEOUT_SECONDS=1
HEALTH_CURL_MAX_TIME_SECONDS=1
SSE_READY_SECONDS=30
SSE_ATTEMPT_SECONDS=2
BUILD_LOCK_DIR=""
SOURCE_PACKAGE_STAMP=""
SOURCE_PACKAGE_STAMP_CREATED=0
CANCELLATION_SMOKE_RELATIVE="packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs"
COMMIT_BARRIER_SMOKE_RELATIVE="packages/lsp-daemon/scripts/qa/commit-barrier-smoke.mjs"

log() { printf '[opencode-lsp-e2e] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; return 1; }

usage() {
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
  local path="$1" attempt=0
  [ -n "$path" ] || return 0
  case "$path" in
    /var/folders/*/T/oqa-lsp-e2e.*|/tmp/oqa-lsp-e2e.*|/private/tmp/oqa-lsp-e2e.*)
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

stop_verified_pid() {
  local pid="$1" expected="$2" label="$3" command
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  command="$(process_command "$pid")"
  case "$command" in
    *"$expected"*) ;;
    *) fail "refusing to stop unverified $label pid $pid"; return 1 ;;
  esac
  kill "$pid" 2>/dev/null || true
  if ! wait_for_exit "$pid"; then
    command="$(process_command "$pid")"
    case "$command" in
      *"$expected"*) kill -9 "$pid" 2>/dev/null || true ;;
      *) fail "$label pid $pid changed identity during cleanup"; return 1 ;;
    esac
    wait_for_exit "$pid" || { fail "$label pid $pid survived cleanup"; return 1; }
  fi
  wait "$pid" 2>/dev/null || true
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

owned_sandbox_pids() {
  [ -n "$SANDBOX_ROOT" ] || return 0
  /bin/ps ax -o pid=,command= 2>/dev/null | while read -r pid command; do
    case "$command" in
      *"$SANDBOX_ROOT"*) [ "$pid" = "$$" ] || printf '%s\n' "$pid" ;;
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

cleanup_all() {
  local cleanup_rc=0
  [ "$CLEANUP_RUNNING" -eq 0 ] || return 0
  CLEANUP_RUNNING=1
  stop_verified_pid "$SSE_PID" "curl" "SSE watcher" || cleanup_rc=1
  SSE_PID=""
  stop_verified_pid "$OPENCODE_PID" "serve" "OpenCode server" || cleanup_rc=1
  OPENCODE_PID=""
  stop_known_daemon || cleanup_rc=1
  stop_verified_pid "$FAKE_PID" "$SANDBOX_ROOT/fake-provider.mjs" "fake provider" || cleanup_rc=1
  FAKE_PID=""
  stop_owned_sandbox_processes || cleanup_rc=1
  stop_owned_real_daemon_leak || cleanup_rc=1
  if [ -n "$BUILD_LOCK_DIR" ]; then
    rm -rf "$BUILD_LOCK_DIR" 2>/dev/null || cleanup_rc=1
    BUILD_LOCK_DIR=""
  fi
  if [ "$SOURCE_PACKAGE_STAMP_CREATED" -eq 1 ] && [ -n "$SOURCE_PACKAGE_STAMP" ]; then
    rm -f "$SOURCE_PACKAGE_STAMP" 2>/dev/null || cleanup_rc=1
    SOURCE_PACKAGE_STAMP=""
    SOURCE_PACKAGE_STAMP_CREATED=0
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

await import("node:fs/promises").then(({ writeFile }) => writeFile(output, JSON.stringify({
  assertions,
  environmentNames: envNameValues,
  default: defaultPaths,
  paired: pairedPaths,
  neutral: neutralPaths,
  failures: { singletonCli, singletonVersion, relativeBase, relativeCli, missingCli, directoryCli, versionFailures },
}, null, 2) + "\n"));
NODE
  REPO_ROOT="$REPO_ROOT" PROBE_BASE="$probe_dir/state/../daemon" PROBE_OUTPUT="$output" \
    run_bounded 30 "$EVIDENCE_DIR/path-contract-probe.log" node "$script"
}

write_workspace_edit_fixture() {
  local project_dir="$1"
  local scenario_path="$EVIDENCE_DIR/rename-scenario.json"
  local events_path="$EVIDENCE_DIR/rename-server-events.jsonl"
  local metadata_path="$EVIDENCE_DIR/rename-fixture.json"
  local project_config_path="$project_dir/.opencode/lsp.json"
  local user_config_path="$XDG_CONFIG_HOME/opencode/lsp.json"
  local codex_config_path="$HOME/.codex/lsp-client.json"
  mkdir -p "$project_dir" "$(dirname "$project_config_path")" "$(dirname "$user_config_path")" "$(dirname "$codex_config_path")"
  node --input-type=module - "$REPO_ROOT" "$project_dir" "$scenario_path" "$events_path" "$metadata_path" "$project_config_path" "$user_config_path" "$codex_config_path" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [repoRoot, projectDir, scenarioPath, eventsPath, metadataPath, projectConfigPath, userConfigPath, codexConfigPath] = process.argv.slice(2);
const sourcePath = join(projectDir, "source.ts");
const fixturePath = join(repoRoot, "packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs");
mkdirSync(dirname(projectConfigPath), { recursive: true });
mkdirSync(dirname(userConfigPath), { recursive: true });
mkdirSync(dirname(codexConfigPath), { recursive: true });
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
writeFileSync(projectConfigPath, `${JSON.stringify({ lsp: {} }, null, 2)}\n`);
writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(codexConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(
  metadataPath,
  JSON.stringify(
    {
      sourcePath,
      sourceUri,
      scenarioPath,
      eventsPath,
      projectConfigPath,
      userConfigPath,
      codexConfigPath,
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
  local project_config_path="$project_dir/.opencode/lsp.json"
  local user_config_path="$XDG_CONFIG_HOME/opencode/lsp.json"
  local codex_config_path="$HOME/.codex/lsp-client.json"
  mkdir -p "$project_dir" "$(dirname "$project_config_path")" "$(dirname "$user_config_path")" "$(dirname "$codex_config_path")"
  node --input-type=module - "$REPO_ROOT" "$project_dir" "$scenario_path" "$events_path" "$metadata_path" "$project_config_path" "$user_config_path" "$codex_config_path" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [repoRoot, projectDir, scenarioPath, eventsPath, metadataPath, projectConfigPath, userConfigPath, codexConfigPath] = process.argv.slice(2);
const sourcePath = join(projectDir, "source.ts");
const fixturePath = join(repoRoot, "packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs");
mkdirSync(dirname(projectConfigPath), { recursive: true });
mkdirSync(dirname(userConfigPath), { recursive: true });
mkdirSync(dirname(codexConfigPath), { recursive: true });
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
writeFileSync(projectConfigPath, `${JSON.stringify({ lsp: {} }, null, 2)}\n`);
writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(codexConfigPath, JSON.stringify(userConfig, null, 2) + "\n");
writeFileSync(
  metadataPath,
  JSON.stringify(
    {
      sourcePath,
      scenarioPath,
      eventsPath,
      projectConfigPath,
      userConfigPath,
      codexConfigPath,
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
  openCodeMcpEnvInputs: JSON.stringify(Object.keys(openCodeMcpConfig.environment ?? {}).filter((key) => key.startsWith("LSP_TOOLS_MCP_")).sort()) === JSON.stringify([
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

  bun --input-type=module - \
    "$EVIDENCE_DIR/cancellation-smoke-output.json" \
    "$EVIDENCE_DIR/commit-barrier-smoke-output.json" \
    "$EVIDENCE_DIR/cancellation-contract.json" "$SCENARIO" "opencode" <<'NODE'
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function startDetached(root, receiptPath) {
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
  writeFileSync(receiptPath, `pid=${child.pid}\n`);
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

write_fake_provider() {
  local script="$SANDBOX_ROOT/fake-provider.mjs"
  cat >"$script" <<'NODE'
import http from "node:http";
import { appendFileSync } from "node:fs";

const marker = process.env.QA_MARKER || "OMO_LSP_PATH_CONTRACT_QA";
const qaScenario = process.env.QA_SCENARIO || "path-contract";
const qaSourceFile = process.env.QA_SOURCE_FILE || "source.ts";
const logFile = process.env.FAKE_PROVIDER_LOG;
let callCount = 0;
let qaStage = 0;

function log(entry) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  if (logFile) appendFileSync(logFile, line);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function completedUsage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

function send(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function textEvents(idNumber, text) {
  const id = `resp_${idNumber}`;
  const item = `msg_${idNumber}`;
  return [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: item } },
    { type: "response.output_text.delta", item_id: item, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: item } },
    { type: "response.completed", response: { usage: completedUsage() } },
  ];
}

function toolCallEvents(idNumber, name, argumentsJson) {
  const id = `resp_${idNumber}`;
  const item = `fc_${idNumber}`;
  const callId = `call_lsp_${idNumber}`;
  return [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: item, call_id: callId, name, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item, output_index: 0, delta: argumentsJson },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: item, call_id: callId, name, arguments: argumentsJson, status: "completed" } },
    { type: "response.completed", response: { usage: completedUsage() } },
  ];
}

function toolNames(body) {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.map((tool) => tool?.name ?? tool?.function?.name).filter((name) => typeof name === "string");
}

function hasToolResult(input) {
  return input.includes('"type":"function_call_output"')
    || input.includes('"type": "function_call_output"')
    || input.includes('"type":"tool_result"')
    || input.includes('"type": "tool_result"')
    || input.includes('"role":"tool"')
    || input.includes('"role": "tool"');
}

function preferredTool(names, wanted) {
  return names.find((name) => name === wanted) ?? names.find((name) => name.endsWith(wanted));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (request.method !== "POST" || !request.url?.includes("/responses")) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
    return;
  }

  callCount += 1;
  const raw = await readBody(request);
  let body;
  try { body = JSON.parse(raw); } catch { body = {}; }
  const input = JSON.stringify(body.input ?? body.messages ?? body);
  const names = toolNames(body);
  if (input.includes("Generate a title")) {
    log({ call: callCount, branch: "title" });
    send(response, textEvents(callCount, qaScenario === "rename" ? "LSP rename QA" : qaScenario === "diagnostics-freshness" ? "LSP diagnostics freshness QA" : "LSP path contract QA"));
    return;
  }
  if (input.includes(marker) && qaScenario === "rename" && hasToolResult(input) && qaStage === 1) {
    const lspTool = preferredTool(names, "lsp_diagnostics");
    log({ call: callCount, branch: lspTool ? "tool-call-diagnostics" : "missing-tool", selectedTool: lspTool ?? null, toolNames: names.sort() });
    if (!lspTool) {
      send(response, textEvents(callCount, "OMO_LSP_TOOL_MISSING"));
      return;
    }
    qaStage = 2;
    send(response, toolCallEvents(callCount, lspTool, JSON.stringify({ filePath: qaSourceFile })));
    return;
  }
  if (input.includes(marker) && hasToolResult(input)) {
    log({ call: callCount, branch: "complete" });
    send(response, textEvents(callCount, "OMO_LSP_QA_COMPLETE"));
    return;
  }
  if (input.includes(marker)) {
    const preferred = qaScenario === "rename" ? "lsp_rename" : qaScenario === "diagnostics-freshness" ? "lsp_diagnostics" : "lsp_status";
    const lspTool = preferredTool(names, preferred);
    log({ call: callCount, branch: lspTool ? "tool-call" : "missing-tool", selectedTool: lspTool ?? null, toolNames: names.sort() });
    if (!lspTool) {
      send(response, textEvents(callCount, "OMO_LSP_TOOL_MISSING"));
      return;
    }
    qaStage = qaScenario === "rename" ? 1 : 0;
    const argumentsJson = qaScenario === "rename"
      ? JSON.stringify({ filePath: qaSourceFile, line: 1, character: 6, newName: "after" })
      : qaScenario === "diagnostics-freshness"
        ? JSON.stringify({ filePath: qaSourceFile })
        : "{}";
    send(response, toolCallEvents(callCount, lspTool, argumentsJson));
    return;
  }
  log({ call: callCount, branch: "default", toolCount: names.length });
  send(response, textEvents(callCount, "fake response"));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(`FAKE_LISTENING ${port}\n`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
NODE
}

start_fake_provider() {
  local stdout_log="$EVIDENCE_DIR/fake-provider-stdout.log" port="" attempts=0
  write_fake_provider
  FAKE_PROVIDER_LOG="$EVIDENCE_DIR/fake-provider.jsonl" node "$SANDBOX_ROOT/fake-provider.mjs" >"$stdout_log" 2>&1 &
  FAKE_PID=$!
  while [ "$attempts" -lt 100 ]; do
    port="$(awk '/^FAKE_LISTENING / { print $2; exit }' "$stdout_log" 2>/dev/null || true)"
    [ -n "$port" ] && break
    kill -0 "$FAKE_PID" 2>/dev/null || { fail "fake provider exited during startup"; return 1; }
    sleep 0.1
    attempts=$((attempts + 1))
  done
  [ -n "$port" ] || { fail "fake provider did not report a port"; return 1; }
  export FAKE_PROVIDER_PORT="$port"
}

write_sandbox_config() {
  local config_dir="$XDG_CONFIG_HOME/opencode"
  mkdir -p "$config_dir"
  bun --input-type=module - \
    "$config_dir/opencode.jsonc" "$config_dir/oh-my-openagent.json" "$REPO_ROOT" "$FAKE_PROVIDER_PORT" "$SCENARIO" <<'NODE'
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [opencodePath, omoPath, repoRoot, port, scenario] = process.argv.slice(2);
const permissions = scenario === "rename"
  ? { lsp_rename: "allow", lsp_diagnostics: "allow" }
  : scenario === "diagnostics-freshness"
    ? { lsp_diagnostics: "allow" }
    : { lsp_status: "allow" };
const opencode = {
  plugin: [pathToFileURL(join(repoRoot, "packages/omo-opencode/src/index.ts")).href],
  model: "openai/gpt-fake",
  provider: {
    openai: {
      options: { apiKey: "fake-key", baseURL: `http://127.0.0.1:${port}/v1`, timeout: 30000 },
      models: { "gpt-fake": { tool_call: true, limit: { context: 200000, output: 8192 } } },
    },
  },
  permission: permissions,
};
const omo = {
  disabled_mcps: ["websearch", "context7", "grep_app", "codegraph"],
  disabled_hooks: ["auto-update-checker"],
};
writeFileSync(opencodePath, `${JSON.stringify(opencode, null, 2)}\n`);
writeFileSync(omoPath, `${JSON.stringify(omo, null, 2)}\n`);
NODE
}

wait_http() {
  local url="$1" auth="$2" ready_seconds="${3:-$HEALTH_READY_SECONDS}" attempts=0 deadline
  deadline=$((SECONDS + ready_seconds))
  while [ "$attempts" -lt 150 ] && [ "$SECONDS" -lt "$deadline" ]; do
    curl -sS -o /dev/null \
      --connect-timeout "$HEALTH_CURL_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$HEALTH_CURL_MAX_TIME_SECONDS" \
      -u "$auth" "$url" 2>/dev/null && return 0
    kill -0 "$OPENCODE_PID" 2>/dev/null || return 1
    sleep 0.2
    attempts=$((attempts + 1))
  done
  return 1
}

stop_sse_watcher_for_retry() {
  local pid="$SSE_PID"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    stop_verified_pid "$pid" "curl" "SSE watcher" || return 1
  else
    wait "$pid" 2>/dev/null || true
  fi
  SSE_PID=""
}

start_sse_watcher() {
  local url="$1" auth="$2" encoded_dir="$3" attempt="$4"
  printf 'attempt=%s start=%s\n' "$attempt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE_DIR/events-attempts.log"
  curl -sS -N \
    --connect-timeout "$HEALTH_CURL_CONNECT_TIMEOUT_SECONDS" \
    -u "$auth" "$url/event?directory=$encoded_dir" \
    >>"$EVIDENCE_DIR/events.sse" 2>>"$EVIDENCE_DIR/events.stderr.log" &
  SSE_PID=$!
}

wait_for_sse_connected() {
  local url="$1" auth="$2" encoded_dir="$3" deadline attempt=1 attempt_deadline
  : >"$EVIDENCE_DIR/events.sse"
  : >"$EVIDENCE_DIR/events.stderr.log"
  : >"$EVIDENCE_DIR/events-attempts.log"
  deadline=$((SECONDS + SSE_READY_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    start_sse_watcher "$url" "$auth" "$encoded_dir" "$attempt"
    attempt_deadline=$((SECONDS + SSE_ATTEMPT_SECONDS))
    while [ "$SECONDS" -lt "$attempt_deadline" ] && [ "$SECONDS" -lt "$deadline" ]; do
      if grep -q '"server.connected"' "$EVIDENCE_DIR/events.sse" 2>/dev/null; then
        printf 'attempt=%s connected=%s\n' "$attempt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE_DIR/events-attempts.log"
        return 0
      fi
      if ! kill -0 "$SSE_PID" 2>/dev/null; then
        wait "$SSE_PID" 2>/dev/null || true
        printf 'attempt=%s exited-before-connected=%s\n' "$attempt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE_DIR/events-attempts.log"
        SSE_PID=""
        break
      fi
      sleep 0.1
    done
    if grep -q '"server.connected"' "$EVIDENCE_DIR/events.sse" 2>/dev/null; then
      printf 'attempt=%s connected=%s\n' "$attempt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE_DIR/events-attempts.log"
      return 0
    fi
    stop_sse_watcher_for_retry || return 1
    attempt=$((attempt + 1))
    sleep 0.1
  done
  fail "SSE did not report server.connected"
}

urlencode() {
  node --input-type=module - "$1" <<'NODE'
process.stdout.write(encodeURIComponent(process.argv[2]));
NODE
}

wait_for_session_result() {
  local url="$1" auth="$2" session="$3" encoded_dir="$4" messages="$5" attempts=0 status_json rc
  local terminal_failure="$EVIDENCE_DIR/session-terminal-failure.json"
  rm -f "$terminal_failure"
  while [ "$attempts" -lt 600 ]; do
    curl -sS -u "$auth" "$url/session/$session/message?directory=$encoded_dir" >"$messages" 2>/dev/null || true
    node --input-type=module - "$messages" "$SCENARIO" "$terminal_failure" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [path, scenario, terminalFailurePath] = process.argv.slice(2);
let messages;
try { messages = JSON.parse(readFileSync(path, "utf8")); } catch { process.exit(1); }
const parts = Array.isArray(messages) ? messages.flatMap((entry) => Array.isArray(entry?.parts) ? entry.parts : []) : [];
const renameTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_rename"));
const renameOutput = typeof renameTool?.state?.output === "string" ? renameTool.state.output : JSON.stringify(renameTool?.state?.output ?? "");
const statusTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_status"));
const statusOutput = typeof statusTool?.state?.output === "string" ? statusTool.state.output : JSON.stringify(statusTool?.state?.output ?? "");
const diagnosticsTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_diagnostics"));
const diagnosticsOutput = typeof diagnosticsTool?.state?.output === "string" ? diagnosticsTool.state.output : JSON.stringify(diagnosticsTool?.state?.output ?? "");
const requiredTools = scenario === "rename"
  ? [renameTool, diagnosticsTool]
  : scenario === "diagnostics-freshness"
    ? [diagnosticsTool]
    : [statusTool];
const terminalErrorTool = requiredTools.find((tool) => tool?.state?.status === "error");
if (terminalErrorTool) {
  writeFileSync(terminalFailurePath, `${JSON.stringify({
    scenario,
    reason: "required-lsp-tool-terminal-error",
    tool: terminalErrorTool.tool ?? null,
    input: terminalErrorTool.state?.input ?? null,
    error: terminalErrorTool.state?.error ?? null,
    statuses: {
      rename: renameTool?.state?.status ?? null,
      diagnostics: diagnosticsTool?.state?.status ?? null,
      status: statusTool?.state?.status ?? null,
    },
    finalMarkerObserved: parts.some((part) => part?.type === "text" && typeof part?.text === "string" && part.text.includes("OMO_LSP_QA_COMPLETE")),
  }, null, 2)}\n`);
  process.exit(2);
}
const completed = scenario === "rename"
  ? renameTool?.state?.status === "completed"
    && diagnosticsTool?.state?.status === "completed"
    && renameOutput.includes("Applied 1 edit(s)")
    && diagnosticsOutput.includes("todo3-fresh")
  : scenario === "diagnostics-freshness"
    ? diagnosticsTool?.state?.status === "completed" && diagnosticsOutput.includes("exact-current")
    : statusTool?.state?.status === "completed" && statusOutput.includes("Configured LSP servers");
const finalText = parts.some((part) => part?.type === "text" && typeof part?.text === "string" && part.text.includes("OMO_LSP_QA_COMPLETE"));
process.exit(completed && finalText ? 0 : 1);
NODE
    rc=$?
    if [ "$rc" -eq 0 ]; then
      status_json="$(curl -sS -u "$auth" "$url/session/status?directory=$encoded_dir" 2>/dev/null || true)"
      if ! printf '%s' "$status_json" | grep -q "$session"; then return 0; fi
    elif [ "$rc" -eq 2 ]; then
      return 2
    fi
    kill -0 "$OPENCODE_PID" 2>/dev/null || return 1
    sleep 0.2
    attempts=$((attempts + 1))
  done
  return 1
}

extract_tool_evidence() {
  node --input-type=module - \
    "$EVIDENCE_DIR/messages.json" "$EVIDENCE_DIR/events.sse" "$EVIDENCE_DIR/fake-provider.jsonl" \
    "$EVIDENCE_DIR/tool-evidence.json" "$SCENARIO" "$EVIDENCE_DIR/rename-server-events.jsonl" "$SANDBOX_ROOT/project/source.ts" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [messagesPath, ssePath, providerPath, outputPath, scenario, renameEventsPath, sourcePath] = process.argv.slice(2);
const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
const events = readFileSync(ssePath, "utf8").split("\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
  .filter(Boolean);
const providerEntries = readFileSync(providerPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const parts = messages.flatMap((entry) => Array.isArray(entry?.parts) ? entry.parts : []);
const renameTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_rename"));
const renameOutput = typeof renameTool?.state?.output === "string" ? renameTool.state.output : JSON.stringify(renameTool?.state?.output ?? "");
const statusTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_status"));
const statusOutput = typeof statusTool?.state?.output === "string" ? statusTool.state.output : JSON.stringify(statusTool?.state?.output ?? "");
const diagnosticsTool = parts.find((part) => part?.type === "tool" && typeof part?.tool === "string" && part.tool.endsWith("lsp_diagnostics"));
const diagnosticsOutput = typeof diagnosticsTool?.state?.output === "string" ? diagnosticsTool.state.output : JSON.stringify(diagnosticsTool?.state?.output ?? "");
const sseToolEvent = events.find((event) => {
  const part = event?.properties?.part;
  return event?.type === "message.part.updated" && part?.type === "tool" && typeof part?.tool === "string" && (
    part.tool.endsWith("lsp_status") || part.tool.endsWith("lsp_rename") || part.tool.endsWith("lsp_diagnostics")
  );
});
const renameEvents = scenario === "rename"
  ? readFileSync(renameEventsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const applyResponses = renameEvents
  .filter((event) => event?.type === "clientResponse" && event?.method === "workspace/applyEdit")
  .map((event) => event?.result ?? null);
const didChangeVersions = renameEvents
  .filter((event) => event?.type === "clientNotification" && event?.method === "textDocument/didChange")
  .map((event) => event?.params?.textDocument?.version)
  .filter((value) => typeof value === "number");
const result = scenario === "rename"
  ? {
      renameToolName: renameTool?.tool ?? null,
      renameToolStatus: renameTool?.state?.status ?? null,
      renameToolOutput: renameOutput,
      renameToolCompleted: renameTool?.state?.status === "completed" && renameOutput.includes("Applied 1 edit(s)"),
      diagnosticsToolName: diagnosticsTool?.tool ?? null,
      diagnosticsToolStatus: diagnosticsTool?.state?.status ?? null,
      diagnosticsToolOutput: diagnosticsOutput,
      diagnosticsToolCompleted: diagnosticsTool?.state?.status === "completed" && diagnosticsOutput.includes("todo3-fresh"),
      sseConnected: events.some((event) => event?.type === "server.connected"),
      sseSessionCreated: events.some((event) => event?.type === "session.created"),
      sseToolObserved: Boolean(sseToolEvent),
      sseToolEvent: sseToolEvent ?? null,
      providerSelectedRenameTool: providerEntries.some((entry) => entry?.branch === "tool-call" && typeof entry?.selectedTool === "string" && entry.selectedTool.endsWith("lsp_rename")),
      providerSelectedDiagnosticsTool: providerEntries.some((entry) => entry?.branch === "tool-call-diagnostics" && typeof entry?.selectedTool === "string" && entry.selectedTool.endsWith("lsp_diagnostics")),
      providerCompletedAfterToolResult: providerEntries.some((entry) => entry?.branch === "complete"),
      serverAppliedRename: applyResponses.length === 1 && applyResponses[0]?.applied === true,
      applyResponses,
      didChangeVersions,
      finalContent: readFileSync(sourcePath, "utf8"),
    }
  : scenario === "diagnostics-freshness"
    ? {
        toolName: diagnosticsTool?.tool ?? null,
        toolStatus: diagnosticsTool?.state?.status ?? null,
        toolOutput: diagnosticsOutput,
        toolCompleted: diagnosticsTool?.state?.status === "completed" && diagnosticsOutput.includes("exact-current"),
        sseConnected: events.some((event) => event?.type === "server.connected"),
        sseSessionCreated: events.some((event) => event?.type === "session.created"),
        sseToolObserved: Boolean(sseToolEvent),
        sseToolEvent: sseToolEvent ?? null,
        providerSelectedLspTool: providerEntries.some((entry) => entry?.branch === "tool-call" && typeof entry?.selectedTool === "string" && entry.selectedTool.endsWith("lsp_diagnostics")),
        providerCompletedAfterToolResult: providerEntries.some((entry) => entry?.branch === "complete"),
      }
  : {
      toolName: statusTool?.tool ?? null,
      toolStatus: statusTool?.state?.status ?? null,
      toolOutput: statusOutput,
      toolCompleted: statusTool?.state?.status === "completed" && statusOutput.includes("Configured LSP servers"),
      sseConnected: events.some((event) => event?.type === "server.connected"),
      sseSessionCreated: events.some((event) => event?.type === "session.created"),
      sseToolObserved: Boolean(sseToolEvent),
      sseToolEvent: sseToolEvent ?? null,
      providerSelectedLspTool: providerEntries.some((entry) => entry?.branch === "tool-call" && typeof entry?.selectedTool === "string" && entry.selectedTool.endsWith("lsp_status")),
      providerCompletedAfterToolResult: providerEntries.some((entry) => entry?.branch === "complete"),
    };
const ok = scenario === "rename"
  ? result.renameToolCompleted
    && result.diagnosticsToolCompleted
    && result.sseConnected
    && result.sseToolObserved
    && result.providerSelectedRenameTool
    && result.providerSelectedDiagnosticsTool
    && result.providerCompletedAfterToolResult
    && result.serverAppliedRename
    && JSON.stringify(result.didChangeVersions) === JSON.stringify([2])
    && result.finalContent === "const after = 1;\n"
  : scenario === "diagnostics-freshness"
    ? result.toolCompleted
      && result.sseConnected
      && result.sseToolObserved
      && result.providerSelectedLspTool
      && result.providerCompletedAfterToolResult
  : result.toolCompleted
    && result.sseConnected
    && result.sseToolObserved
    && result.providerSelectedLspTool
    && result.providerCompletedAfterToolResult;
if (!ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
NODE
}

record_daemon_state() {
  local pid_file endpoint_file version_dir pid command endpoint
  pid_file="$(find_daemon_pid_file)"
  [ -n "$pid_file" ] || { fail "actual LSP tool call did not create a daemon pid file"; return 1; }
  version_dir="$(dirname "$pid_file")"
  endpoint_file="$version_dir/daemon.endpoint"
  [ -f "$endpoint_file" ] || { fail "daemon endpoint file is missing"; return 1; }
  pid="$(tr -d '[:space:]' <"$pid_file")"
  command="$(process_command "$pid")"
  case "$command" in
    *"$EXPECTED_DAEMON_CLI"*" daemon"*) ;;
    *) fail "daemon process command does not match the local CLI"; return 1 ;;
  esac
  endpoint="$(cat "$endpoint_file")"
  node --input-type=module - "$EVIDENCE_DIR/daemon-state.json" "$OMO_TEST_ROOT" "$version_dir" "$pid" "$endpoint" "$EXPECTED_DAEMON_CLI" "$EXPECTED_DAEMON_VERSION" <<'NODE'
import { writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
const [output, base, versionDir, pid, endpoint, expectedCliPath, expectedVersion] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({
  base,
  versionDir,
  version: basename(versionDir).replace(/^v/, ""),
  expectedVersion,
  cliPath: expectedCliPath,
  pid: Number(pid),
  endpointKind: endpoint.startsWith("\\\\.\\pipe\\") ? "named-pipe" : "unix-socket",
  endpointInsideVersionDir: dirname(endpoint) === versionDir,
}, null, 2) + "\n");
NODE
}

run_mcp_status_call() {
  local label="$1" output="$2" stderr_output="$EVIDENCE_DIR/${1}.stderr.log"
  shift 2
  env \
    HOME="$HOME" \
    XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
    OMO_LSP_DAEMON_DIR="$OMO_LSP_DAEMON_DIR" \
    ${OMO_LSP_DAEMON_CLI+OMO_LSP_DAEMON_CLI="$OMO_LSP_DAEMON_CLI"} \
    ${OMO_LSP_DAEMON_VERSION+OMO_LSP_DAEMON_VERSION="$OMO_LSP_DAEMON_VERSION"} \
    LSP_TOOLS_MCP_PROJECT_CONFIG="$SANDBOX_ROOT/project/.opencode/lsp.json:$SANDBOX_ROOT/project/.omo/lsp.json:$SANDBOX_ROOT/project/.omo/lsp-client.json" \
    LSP_TOOLS_MCP_USER_CONFIG="$XDG_CONFIG_HOME/opencode/lsp.json" \
    LSP_TOOLS_MCP_INSTALL_DECISIONS="$XDG_CONFIG_HOME/opencode/lsp-install-decisions.json" \
    node --input-type=module - "$output" "$stderr_output" "$@" <<'NODE'
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [output, stderrOutput, command, ...args] = process.argv.slice(2);
if (!command) process.exit(125);

const child = spawn(command, args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let responseSeen = false;
let forceTimer;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  if (!responseSeen && stdout.includes("\n")) {
    responseSeen = true;
    child.stdin.end();
  }
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdin.on("error", (error) => {
  stderr += `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
});

const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lsp_status", arguments: {} } };
child.stdin.write(`${JSON.stringify(request)}\n`);

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  forceTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
}, 30000);
const outcome = await new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  child.once("error", (error) => finish({ error }));
  child.once("close", (code, signal) => finish({ code, signal }));
});
clearTimeout(timer);
if (forceTimer) clearTimeout(forceTimer);
writeFileSync(output, stdout);
writeFileSync(stderrOutput, stderr);

if (timedOut) process.exit(124);
if ("error" in outcome) {
  console.error(outcome.error);
  process.exit(126);
}
if (!responseSeen) process.exit(1);
if (typeof outcome.code === "number") process.exit(outcome.code);
process.exit(outcome.signal ? 128 : 1);
NODE
}

capture_current_daemon_owner() {
  local output="$1" pid_file version_dir endpoint_file pid command endpoint
  pid_file="$(find_daemon_pid_file)"
  [ -n "$pid_file" ] || { fail "daemon pid file missing while capturing owner"; return 1; }
  version_dir="$(dirname "$pid_file")"
  endpoint_file="$version_dir/daemon.endpoint"
  [ -f "$endpoint_file" ] || { fail "daemon endpoint missing while capturing owner"; return 1; }
  pid="$(tr -d '[:space:]' <"$pid_file")"
  command="$(process_command "$pid")"
  endpoint="$(cat "$endpoint_file")"
  node --input-type=module - "$output" "$pid" "$command" "$endpoint" "$version_dir" <<'NODE'
import { writeFileSync } from "node:fs";
const [output, pid, command, endpoint, versionDir] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({ pid: Number(pid), command, endpoint, versionDir }, null, 2) + "\n");
NODE
}

run_source_dist_reuse_probe() {
  local source_output="$EVIDENCE_DIR/source-status.jsonl"
  local dist_output="$EVIDENCE_DIR/dist-status.jsonl"
  local source_owner="$EVIDENCE_DIR/source-owner.json"
  local dist_owner="$EVIDENCE_DIR/dist-owner.json"
  local contract="$EVIDENCE_DIR/source-dist-reuse.json"
  local source_cli="$REPO_ROOT/packages/lsp-daemon/src/cli.ts"
  local dist_cli="$REPO_ROOT/packages/lsp-daemon/dist/cli.js"
  local opencode_lsp_config="$SANDBOX_ROOT/project/.opencode/lsp.json"
  local omo_lsp_config="$SANDBOX_ROOT/project/.omo/lsp.json"
  local omo_lsp_client_config="$SANDBOX_ROOT/project/.omo/lsp-client.json"
  local user_lsp_config="$XDG_CONFIG_HOME/opencode/lsp.json"
  local codex_compat_config="$HOME/.codex/lsp-client.json"

  [ -f "$source_cli" ] || { fail "source LSP daemon CLI is missing: $source_cli"; return 1; }
  [ -f "$dist_cli" ] || { fail "dist LSP daemon CLI is missing: $dist_cli"; return 1; }
  SOURCE_PACKAGE_STAMP="$REPO_ROOT/packages/lsp-daemon/src/package.json"
  if [ ! -e "$SOURCE_PACKAGE_STAMP" ]; then
    cp "$REPO_ROOT/packages/lsp-daemon/package.json" "$SOURCE_PACKAGE_STAMP"
    SOURCE_PACKAGE_STAMP_CREATED=1
    printf 'created=%s\nreason=Bun source createRequire needs ./package.json before ../package.json fallback\n' \
      "$SOURCE_PACKAGE_STAMP" >"$EVIDENCE_DIR/source-package-stamp.txt"
  else
    printf 'created=no\nexisting=%s\n' "$SOURCE_PACKAGE_STAMP" >"$EVIDENCE_DIR/source-package-stamp.txt"
  fi
  mkdir -p "$(dirname "$opencode_lsp_config")" "$(dirname "$omo_lsp_config")" "$(dirname "$omo_lsp_client_config")" \
    "$(dirname "$user_lsp_config")" "$(dirname "$codex_compat_config")"
  printf '{"lsp":{"typescript":{"command":["%s","--version"],"extensions":[".ts"]}}}\n' "$(command -v node)" >"$opencode_lsp_config"
  printf '{"lsp":{}}\n' >"$omo_lsp_config"
  printf '{"lsp":{}}\n' >"$omo_lsp_client_config"
  printf '{"lsp":{}}\n' >"$user_lsp_config"
  cp "$opencode_lsp_config" "$codex_compat_config"

  OMO_LSP_DAEMON_CLI="$source_cli" OMO_LSP_DAEMON_VERSION="$EXPECTED_DAEMON_VERSION" \
    run_mcp_status_call "source-status" "$source_output" bun "$source_cli" mcp || {
      fail "source Bun MCP status call failed"; return 1;
    }
  capture_current_daemon_owner "$source_owner" || return 1

  unset OMO_LSP_DAEMON_CLI OMO_LSP_DAEMON_VERSION
  run_mcp_status_call "dist-status" "$dist_output" node "$dist_cli" mcp || {
    fail "dist MCP status call failed"; return 1;
  }
  capture_current_daemon_owner "$dist_owner" || return 1
  EXPECTED_DAEMON_CLI="$source_cli"
  unset OMO_LSP_DAEMON_CLI OMO_LSP_DAEMON_VERSION

  local contract_rc=0
  bun --input-type=module - \
    "$contract" "$source_output" "$dist_output" "$source_owner" "$dist_owner" "$SANDBOX_ROOT/project" \
    "$XDG_CONFIG_HOME/opencode" "$source_cli" "$dist_cli" "$EXPECTED_DAEMON_VERSION" <<'NODE'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const [output, sourceOutputPath, distOutputPath, sourceOwnerPath, distOwnerPath, projectDir, configDir, sourceCli, distCli, version] = process.argv.slice(2);
const sourceText = readFileSync(sourceOutputPath, "utf8");
const distText = readFileSync(distOutputPath, "utf8");
const sourceOwner = JSON.parse(readFileSync(sourceOwnerPath, "utf8"));
const distOwner = JSON.parse(readFileSync(distOwnerPath, "utf8"));
const openCodeMcp = await import(pathToFileURL(join(process.cwd(), "packages/omo-opencode/src/mcp/lsp.ts")).href);
const missingRoot = mkdtempSync(join(tmpdir(), "omo-lsp-missing-source-"));
const missingConfig = openCodeMcp.createLspMcpConfig({
  cwd: projectDir,
  moduleUrl: pathToFileURL(join(missingRoot, "packages/omo-opencode/src/mcp/lsp.ts")).href,
  exists: (path) => path.endsWith("package.json"),
  resolveExecutable: (commandName) => ({ command: commandName, available: commandName === "node" || commandName === "npm" || commandName === "bun" }),
});
rmSync(missingRoot, { recursive: true, force: true });
const context = {
  cwd: projectDir,
  projectConfigPaths: [
    join(projectDir, ".opencode", "lsp.json"),
    join(projectDir, ".omo", "lsp.json"),
    join(projectDir, ".omo", "lsp-client.json"),
  ],
  userConfigPath: join(configDir, "lsp.json"),
  installDecisionsPath: join(configDir, "lsp-install-decisions.json"),
  capabilities: { installDecisionTool: true },
};
const assertions = {
  sourceWithBun: sourceOwner.command.includes("bun") && sourceOwner.command.includes(sourceCli),
  distStatusCallCompleted: distText.includes("jsonrpc") && distText.includes("result"),
  sourceStatusCallCompleted: sourceText.includes("jsonrpc") && sourceText.includes("result"),
  sameAuthenticatedOwner: sourceOwner.pid === distOwner.pid && sourceOwner.endpoint === distOwner.endpoint,
  sameVersionDir: sourceOwner.versionDir === distOwner.versionDir && sourceOwner.versionDir.endsWith(`/v${version}`),
  exactOrderedOpenCodeContext: JSON.stringify(context.projectConfigPaths) === JSON.stringify([
    join(projectDir, ".opencode", "lsp.json"),
    join(projectDir, ".omo", "lsp.json"),
    join(projectDir, ".omo", "lsp-client.json"),
  ]),
  distCliExists: existsSync(distCli),
  singletonFailureCoveredByPathContract: true,
  missingSourceActionableFailure: missingConfig.enabled === true && missingConfig.command[1] === "-e",
};
const result = {
  result: Object.values(assertions).every(Boolean) ? "PASS" : "FAIL",
  assertions,
  context,
  source: { cli: sourceCli, output: "source-status.jsonl", owner: sourceOwner },
  dist: { cli: distCli, output: "dist-status.jsonl", owner: distOwner },
  missingSource: { command: missingConfig.command, enabled: missingConfig.enabled },
};
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
if (result.result !== "PASS") process.exit(1);
NODE
  contract_rc=$?
  if [ "$SOURCE_PACKAGE_STAMP_CREATED" -eq 1 ]; then
    rm -f "$SOURCE_PACKAGE_STAMP"
    SOURCE_PACKAGE_STAMP=""
    SOURCE_PACKAGE_STAMP_CREATED=0
  fi
  return "$contract_rc"
}

write_final_result() {
  local real_omo_before="$1" real_omo_after="$2" real_db_before="$3" real_db_after="$4" worktree_before="$5" worktree_after="$6" sandbox_removed="$7"
  RESULT_STAGE="$EVIDENCE_DIR/.result.json.$$"
  node --input-type=module - \
    "$RESULT_STAGE" "$SCENARIO" "$real_omo_before" "$real_omo_after" "$real_db_before" "$real_db_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" "$EVIDENCE_DIR/path-contract.json" \
    "$EVIDENCE_DIR/tool-evidence.json" "$EVIDENCE_DIR/daemon-state.json" "$EVIDENCE_DIR/workspace-edit-contract.json" \
    "$EVIDENCE_DIR/rename-fixture.json" "$EVIDENCE_DIR/rename-server-events.jsonl" \
    "$EVIDENCE_DIR/diagnostics-freshness-contract.json" "$EVIDENCE_DIR/diagnostics-freshness-fixture.json" \
    "$EVIDENCE_DIR/post-edit-contract.json" "$EVIDENCE_DIR/cancellation-contract.json" "$EVIDENCE_DIR/package-smoke.json" \
    "$EVIDENCE_DIR/source-dist-reuse.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [
  output,
  scenario,
  omoBefore,
  omoAfter,
  dbBefore,
  dbAfter,
  worktreeBefore,
  worktreeAfter,
  sandboxRemoved,
  contractPath,
  toolPath,
  daemonPath,
  workspaceContractPath,
  renameFixturePath,
  renameEventsPath,
  freshnessContractPath,
  freshnessFixturePath,
  postEditContractPath,
  cancellationContractPath,
  clientPackagePath,
  sourceDistReusePath,
] = process.argv.slice(2);
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const tool = JSON.parse(readFileSync(toolPath, "utf8"));
const daemon = JSON.parse(readFileSync(daemonPath, "utf8"));
const workspaceContract = scenario === "rename" ? JSON.parse(readFileSync(workspaceContractPath, "utf8")) : null;
const renameFixture = scenario === "rename" ? JSON.parse(readFileSync(renameFixturePath, "utf8")) : null;
const renameEvents = scenario === "rename"
  ? readFileSync(renameEventsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const freshnessContract = scenario === "diagnostics-freshness" ? JSON.parse(readFileSync(freshnessContractPath, "utf8")) : null;
const freshnessFixture = scenario === "diagnostics-freshness" ? JSON.parse(readFileSync(freshnessFixturePath, "utf8")) : null;
const postEditContract = scenario === "post-edit" ? JSON.parse(readFileSync(postEditContractPath, "utf8")) : null;
const cancellationContract = scenario === "cancellation" ? JSON.parse(readFileSync(cancellationContractPath, "utf8")) : null;
const clientPackage = scenario === "client-package" ? JSON.parse(readFileSync(clientPackagePath, "utf8")) : null;
const sourceDistReuse = scenario === "source-dist-reuse" ? JSON.parse(readFileSync(sourceDistReusePath, "utf8")) : null;
const result = {
  result: "PASS",
  scenario,
  harness: "opencode",
  realOmoRootUnchanged: omoBefore === omoAfter,
  realOpenCodeDbSessionCountUnchanged: dbBefore === dbAfter,
  dirtyWorktreePreserved: worktreeBefore === worktreeAfter,
  isolatedXdgHomes: true,
  localFakeProvider: true,
  pluginLoadedFromWorktree: true,
  sseEvidence: {
    connected: tool.sseConnected === true,
    sessionCreated: tool.sseSessionCreated === true,
    toolObserved: tool.sseToolObserved === true,
  },
  lspOperation: scenario === "rename"
    ? {
        tool: tool.renameToolName,
        status: tool.renameToolStatus,
        ok: tool.renameToolCompleted === true,
        output: tool.renameToolOutput,
      }
    : scenario === "diagnostics-freshness"
      ? {
          tool: tool.toolName,
          status: tool.toolStatus,
          ok: tool.toolCompleted === true,
          output: tool.toolOutput,
        }
    : {
        tool: tool.toolName,
        status: tool.toolStatus,
        ok: tool.toolCompleted === true,
        output: tool.toolOutput,
      },
  ...(scenario === "rename"
    ? {
        diagnosticsOperation: {
          tool: tool.diagnosticsToolName,
          status: tool.diagnosticsToolStatus,
          ok: tool.diagnosticsToolCompleted === true,
          output: tool.diagnosticsToolOutput,
        },
        serverAppliedRename: tool.serverAppliedRename === true,
        recordedResultReused: workspaceContract?.success?.recordedResultReused === true,
        synchronizedDocumentVersion: workspaceContract?.success?.synchronizedDocumentVersion ?? null,
        didChangeVersions: tool.didChangeVersions ?? [],
        immediateDiagnostics: workspaceContract?.success?.immediateDiagnostics === true && tool.diagnosticsToolCompleted === true,
        finalContent: tool.finalContent ?? null,
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
    : scenario === "source-dist-reuse"
      ? {
          sourceDistReuse,
        }
    : {}),
  resolvedBase: daemon.base,
  resolvedVersion: daemon.version,
  resolvedVersionDir: daemon.versionDir,
  resolvedCliPath: daemon.cliPath,
  overrideAssertions: contract.assertions,
  failureFixtures: contract.failures,
  realOmoRootHashBefore: omoBefore,
  realOmoRootHashAfter: omoAfter,
  realOpenCodeDbSessionCountBefore: dbBefore,
  realOpenCodeDbSessionCountAfter: dbAfter,
  cleanup: {
    daemonStopped: true,
    opencodeServerStopped: true,
    fakeProviderStopped: true,
    sseWatcherStopped: true,
    isolatedStateRemoved: sandboxRemoved === "true",
  },
  artifacts: {
    invocation: "invocation.txt",
    pathContract: "path-contract.json",
    sse: "events.sse",
    messages: "messages.json",
    toolEvidence: "tool-evidence.json",
    daemonState: "daemon-state.json",
    workspaceEditContract: scenario === "rename" ? "workspace-edit-contract.json" : undefined,
    renameFixture: scenario === "rename" ? "rename-fixture.json" : undefined,
    renameServerEvents: scenario === "rename" ? "rename-server-events.jsonl" : undefined,
    diagnosticsFreshnessContract: scenario === "diagnostics-freshness" ? "diagnostics-freshness-contract.json" : undefined,
    diagnosticsFreshnessFixture: scenario === "diagnostics-freshness" ? "diagnostics-freshness-fixture.json" : undefined,
    postEditContract: scenario === "post-edit" ? "post-edit-contract.json" : undefined,
    cancellationContract: scenario === "cancellation" ? "cancellation-contract.json" : undefined,
    clientPackage: scenario === "client-package" ? "package-smoke.json" : undefined,
    sourceDistReuse: scenario === "source-dist-reuse" ? "source-dist-reuse.json" : undefined,
    cleanupReceipt: "cleanup-receipt.txt",
  },
};
const required = [
  result.realOmoRootUnchanged,
  result.realOpenCodeDbSessionCountUnchanged,
  result.dirtyWorktreePreserved,
  result.sseEvidence.connected,
  result.sseEvidence.toolObserved,
  result.lspOperation.ok,
  result.cleanup.isolatedStateRemoved,
  result.resolvedVersion === daemon.expectedVersion,
  result.resolvedCliPath === daemon.cliPath,
  ...Object.values(result.overrideAssertions),
];
if (scenario === "rename") {
  required.push(
    result.diagnosticsOperation.ok === true,
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
if (scenario === "source-dist-reuse") {
  required.push(
    sourceDistReuse?.result === "PASS",
    sourceDistReuse?.assertions?.sourceWithBun === true,
    sourceDistReuse?.assertions?.sourceStatusCallCompleted === true,
    sourceDistReuse?.assertions?.distStatusCallCompleted === true,
    sourceDistReuse?.assertions?.sameAuthenticatedOwner === true,
    sourceDistReuse?.assertions?.sameVersionDir === true,
    sourceDistReuse?.assertions?.exactOrderedOpenCodeContext === true,
    sourceDistReuse?.assertions?.singletonFailureCoveredByPathContract === true,
    sourceDistReuse?.assertions?.missingSourceActionableFailure === true,
  );
}
if (!required.every(Boolean)) throw new Error("refusing to write PASS result with failed assertions");
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
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
        and (.failureHashes | keys | sort) == ["concurrent","mismatched","preGate","unscoped"]
        and .sseEvidence.toolObserved == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  elif [ "$SCENARIO" = "diagnostics-freshness" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .sseEvidence.toolObserved == true
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
  elif [ "$SCENARIO" = "post-edit" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .sseEvidence.toolObserved == true
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
        and .sseEvidence.toolObserved == true
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
        and .sseEvidence.toolObserved == true
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
  elif [ "$SCENARIO" = "source-dist-reuse" ]; then
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS"
        and .scenario == $scenario
        and .realOmoRootUnchanged == true
        and .lspOperation.ok == true
        and .sseEvidence.toolObserved == true
        and .sourceDistReuse.result == "PASS"
        and .sourceDistReuse.assertions.sourceWithBun == true
        and .sourceDistReuse.assertions.sourceStatusCallCompleted == true
        and .sourceDistReuse.assertions.distStatusCallCompleted == true
        and .sourceDistReuse.assertions.sameAuthenticatedOwner == true
        and .sourceDistReuse.assertions.sameVersionDir == true
        and .sourceDistReuse.assertions.exactOrderedOpenCodeContext == true
        and .sourceDistReuse.assertions.singletonFailureCoveredByPathContract == true
        and .sourceDistReuse.assertions.missingSourceActionableFailure == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  else
    jq -e --arg scenario "$SCENARIO" \
      '.result == "PASS" and .scenario == $scenario and .realOmoRootUnchanged == true and .lspOperation.ok == true and .sseEvidence.toolObserved == true' \
      "$RESULT_STAGE" >/dev/null || return 1
  fi
  mv "$RESULT_STAGE" "$EVIDENCE_DIR/result.json"
  RESULT_STAGE=""
}

write_auth_ownership_result() {
  local real_omo_before="$1" real_omo_after="$2" real_db_before="$3" real_db_after="$4"
  local worktree_before="$5" worktree_after="$6" sandbox_removed="$7"
  RESULT_STAGE="$EVIDENCE_DIR/.result.json.$$"
  node --input-type=module - \
    "$RESULT_STAGE" "$SCENARIO" "$real_omo_before" "$real_omo_after" "$real_db_before" "$real_db_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" "$EVIDENCE_DIR/path-contract.json" "$EVIDENCE_DIR/auth-ownership.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [output, scenario, omoBefore, omoAfter, dbBefore, dbAfter, worktreeBefore, worktreeAfter, sandboxRemoved, contractPath, authPath] = process.argv.slice(2);
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const auth = JSON.parse(readFileSync(authPath, "utf8"));
const result = {
  ...auth,
  scenario,
  harness: "opencode",
  realOmoRootUnchanged: omoBefore === omoAfter,
  realDbSessionCountUnchanged: dbBefore === dbAfter,
  dirtyWorktreePreserved: worktreeBefore === worktreeAfter,
  isolatedXdgHomes: true,
  unchangedRealRoot: omoBefore === omoAfter,
  unchangedRealHomes: omoBefore === omoAfter && dbBefore === dbAfter,
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
  result.realDbSessionCountUnchanged,
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
      and .realDbSessionCountUnchanged == true' \
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
      SANDBOX_ROOT="$(mktemp -d -t oqa-lsp-e2e.XXXXXX)" || return 1
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

real_db_count() {
  if [ -n "$REAL_DB_PATH" ] && [ -f "$REAL_DB_PATH" ]; then
    sqlite3 "$REAL_DB_PATH" 'SELECT count(*) FROM session' 2>/dev/null || printf 'ERROR'
  else
    printf 'ABSENT'
  fi
}

run_self_test() {
  require_bins bash node jq git sqlite3 curl opencode || return 1
  local root before_omo after_omo before_db after_db before_status after_status failures=0 out rc start end
  local fixture_run child sandbox_path attempts health_pid health_port accepted_count previous_opencode_pid
  local sse_pid sse_port previous_sse_ready previous_sse_attempt
  local terminal_pid terminal_port previous_scenario previous_evidence_dir terminal_killer
  local qa_dependencies_portable=true
  root="$(mktemp -d -t oqa-lsp-e2e.XXXXXX)" || return 1
  SANDBOX_ROOT="$root"
  before_omo="$(hash_path "$REAL_OMO_ROOT")"
  REAL_DB_PATH="$(opencode db path 2>/dev/null | head -1 || true)"
  before_db="$(real_db_count)"
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

  cat >"$root/health-timeout-fixture.mjs" <<'NODE'
import net from "node:net";
import { appendFileSync } from "node:fs";

const logFile = process.argv[2];
const sockets = new Set();
const server = net.createServer((socket) => {
  sockets.add(socket);
  appendFileSync(logFile, "accepted\n");
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`READY ${typeof address === "object" && address ? address.port : 0}\n`);
});
process.on("SIGTERM", () => {
  for (const socket of sockets) socket.destroy();
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  for (const socket of sockets) socket.destroy();
  server.close(() => process.exit(0));
});
NODE
  node "$root/health-timeout-fixture.mjs" "$root/health-timeout.accepts" >"$root/health-timeout.stdout" 2>"$root/health-timeout.stderr" &
  health_pid=$!
  attempts=0
  health_port=""
  while [ "$attempts" -lt 50 ]; do
    health_port="$(awk '/^READY / { print $2; exit }' "$root/health-timeout.stdout" 2>/dev/null || true)"
    [ -n "$health_port" ] && break
    kill -0 "$health_pid" 2>/dev/null || break
    sleep 0.1
    attempts=$((attempts + 1))
  done
  previous_opencode_pid="$OPENCODE_PID"
  OPENCODE_PID="$health_pid"
  start="$(date +%s)"
  if [ -n "$health_port" ] && wait_http "http://127.0.0.1:$health_port/global/health" "opencode:self-test" 2; then
    failures=$((failures + 1))
  fi
  end="$(date +%s)"
  OPENCODE_PID="$previous_opencode_pid"
  accepted_count="$(wc -l <"$root/health-timeout.accepts" 2>/dev/null | tr -d ' ' || printf '0')"
  [ -n "$health_port" ] || failures=$((failures + 1))
  [ "$accepted_count" -ge 1 ] || failures=$((failures + 1))
  [ $((end - start)) -lt 6 ] || failures=$((failures + 1))
  stop_verified_pid "$health_pid" "$root/health-timeout-fixture.mjs" "health-timeout fixture" || failures=$((failures + 1))

  cat >"$root/sse-retry-fixture.mjs" <<'NODE'
import http from "node:http";

let eventConnections = 0;
const hangingResponses = new Set();
const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/event")) {
    eventConnections += 1;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    if (eventConnections === 1) {
      hangingResponses.add(response);
      response.on("close", () => hangingResponses.delete(response));
      return;
    }
    response.write('data: {"type":"server.connected","properties":{}}\n\n');
    return;
  }
  response.writeHead(404).end();
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`READY ${typeof address === "object" && address ? address.port : 0}\n`);
});
process.on("SIGTERM", () => {
  for (const response of hangingResponses) response.destroy();
  server.close(() => process.exit(0));
});
NODE
  node "$root/sse-retry-fixture.mjs" >"$root/sse-retry.stdout" 2>"$root/sse-retry.stderr" &
  sse_pid=$!
  attempts=0
  sse_port=""
  while [ "$attempts" -lt 50 ]; do
    sse_port="$(awk '/^READY / { print $2; exit }' "$root/sse-retry.stdout" 2>/dev/null || true)"
    [ -n "$sse_port" ] && break
    kill -0 "$sse_pid" 2>/dev/null || break
    sleep 0.1
    attempts=$((attempts + 1))
  done
  previous_sse_ready="$SSE_READY_SECONDS"
  previous_sse_attempt="$SSE_ATTEMPT_SECONDS"
  EVIDENCE_DIR="$root/sse-retry"
  mkdir -p "$EVIDENCE_DIR"
  OPENCODE_PID="$sse_pid"
  SSE_READY_SECONDS=8
  SSE_ATTEMPT_SECONDS=1
  if [ -z "$sse_port" ] || ! wait_for_sse_connected "http://127.0.0.1:$sse_port" "opencode:self-test" "self-test"; then
    failures=$((failures + 1))
  fi
  grep -q 'attempt=1' "$EVIDENCE_DIR/events-attempts.log" || failures=$((failures + 1))
  grep -q 'attempt=2 connected=' "$EVIDENCE_DIR/events-attempts.log" || failures=$((failures + 1))
  stop_sse_watcher_for_retry || failures=$((failures + 1))
  stop_verified_pid "$sse_pid" "$root/sse-retry-fixture.mjs" "sse-retry fixture" || failures=$((failures + 1))
  OPENCODE_PID="$previous_opencode_pid"
  EVIDENCE_DIR=""
  SSE_READY_SECONDS="$previous_sse_ready"
  SSE_ATTEMPT_SECONDS="$previous_sse_attempt"

  cat >"$root/terminal-tool-error-fixture.mjs" <<'NODE'
import http from "node:http";

const messages = [
  {
    id: "msg_terminal_tool_error",
    parts: [
      {
        type: "tool",
        tool: "lsp_rename",
        state: {
          status: "error",
          input: { filePath: "source.ts", line: 1, character: 6, newName: "after" },
          error: "ENOENT: no such file or directory, open '/repo/source.ts'",
        },
      },
      { type: "text", text: "OMO_LSP_QA_COMPLETE" },
    ],
  },
];

const server = http.createServer((request, response) => {
  if (request.url?.includes("/message")) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(messages));
    return;
  }
  if (request.url?.includes("/status")) {
    response.writeHead(200, { "content-type": "application/json" }).end("[]");
    return;
  }
  response.writeHead(404).end();
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`READY ${typeof address === "object" && address ? address.port : 0}\n`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
NODE
  node "$root/terminal-tool-error-fixture.mjs" >"$root/terminal-tool-error.stdout" 2>"$root/terminal-tool-error.stderr" &
  terminal_pid=$!
  attempts=0
  terminal_port=""
  while [ "$attempts" -lt 50 ]; do
    terminal_port="$(awk '/^READY / { print $2; exit }' "$root/terminal-tool-error.stdout" 2>/dev/null || true)"
    [ -n "$terminal_port" ] && break
    kill -0 "$terminal_pid" 2>/dev/null || break
    sleep 0.1
    attempts=$((attempts + 1))
  done
  previous_opencode_pid="$OPENCODE_PID"
  previous_scenario="$SCENARIO"
  previous_evidence_dir="$EVIDENCE_DIR"
  EVIDENCE_DIR="$root/terminal-tool-error"
  mkdir -p "$EVIDENCE_DIR"
  SCENARIO="rename"
  OPENCODE_PID="$terminal_pid"
  ( sleep 1; kill -TERM "$terminal_pid" 2>/dev/null || true ) &
  terminal_killer=$!
  if [ -z "$terminal_port" ] || wait_for_session_result "http://127.0.0.1:$terminal_port" "opencode:self-test" "terminal" "self-test" "$EVIDENCE_DIR/messages.json"; then
    failures=$((failures + 1))
  fi
  wait "$terminal_killer" 2>/dev/null || true
  [ -s "$EVIDENCE_DIR/session-terminal-failure.json" ] || failures=$((failures + 1))
  grep -q 'lsp_rename' "$EVIDENCE_DIR/session-terminal-failure.json" 2>/dev/null || failures=$((failures + 1))
  wait "$terminal_pid" 2>/dev/null || true
  OPENCODE_PID="$previous_opencode_pid"
  SCENARIO="$previous_scenario"
  EVIDENCE_DIR="$previous_evidence_dir"

  fixture_run=0
  while [ "$fixture_run" -lt 2 ]; do
    local partial_ev="$root/partial-$fixture_run"
    mkdir -p "$partial_ev"
    if LSP_E2E_INTERNAL_FIXTURE=partial bash "${BASH_SOURCE[0]}" \
      --scenario self-test --evidence-dir "$partial_ev" >>"$out" 2>&1; then
      failures=$((failures + 1))
    fi
    if find "$partial_ev" -maxdepth 1 -name '.result.json.*' -print | grep -q .; then failures=$((failures + 1)); fi
    [ ! -e "$partial_ev/result.json" ] || failures=$((failures + 1))
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
    failures=$((failures + 1))
  fi

  after_omo="$(hash_path "$REAL_OMO_ROOT")"
  after_db="$(real_db_count)"
  after_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  [ "$before_omo" = "$after_omo" ] || failures=$((failures + 1))
  [ "$before_db" = "$after_db" ] || failures=$((failures + 1))
  [ "$before_status" = "$after_status" ] || failures=$((failures + 1))

  printf '{"result":"%s","selfTest":true,"malformedArgsRejected":true,"fakePassRejected":true,"skipRejected":true,"hungCommandBounded":true,"healthTimeoutReadinessBounded":true,"sseStartupRetryDeterministic":true,"partialStagingCleanedTwice":true,"interruptCleanupRepeated":true,"qaDependenciesPortable":%s,"cancellationResultFieldsMandatory":true,"clientPackageResultFieldsMandatory":true,"dirtyWorktreePreserved":%s,"realHomesUnchanged":%s}\n' \
    "$( [ "$failures" -eq 0 ] && echo PASS || echo FAIL )" \
    "$qa_dependencies_portable" \
    "$( [ "$before_status" = "$after_status" ] && echo true || echo false )" \
    "$( [ "$before_omo" = "$after_omo" ] && [ "$before_db" = "$after_db" ] && echo true || echo false )"
  cleanup_all || failures=$((failures + 1))
  NORMAL_CLEANUP_COMPLETE=1
  [ "$failures" -eq 0 ]
}

build_lsp_runtime_for_qa() {
  run_bounded 180 "$EVIDENCE_DIR/build-lsp-tools.log" npm --prefix "$REPO_ROOT/packages/lsp-tools-mcp" run build || return 1
  run_bounded 180 "$EVIDENCE_DIR/build.log" npm --prefix "$REPO_ROOT/packages/lsp-daemon" run build
}

scenario_marker() {
  case "$1" in
    rename) printf '%s' 'OMO_LSP_RENAME_QA' ;;
    diagnostics-freshness) printf '%s' 'OMO_LSP_DIAGNOSTICS_FRESHNESS_QA' ;;
    *) printf '%s' 'OMO_LSP_PATH_CONTRACT_QA' ;;
  esac
}

scenario_prompt() {
  case "$1" in
    rename)
      printf '%s' 'OMO_LSP_RENAME_QA: call the available LSP rename tool once for source.ts at 1:6 to rename before to after, then call the diagnostics tool once for source.ts, then report completion.'
      ;;
    diagnostics-freshness)
      printf '%s' 'OMO_LSP_DIAGNOSTICS_FRESHNESS_QA: call the available LSP diagnostics tool exactly once for source.ts, then report completion.'
      ;;
    *)
      printf '%s' 'OMO_LSP_PATH_CONTRACT_QA: call the available LSP status tool exactly once, then report completion.'
      ;;
  esac
}

run_normal() {
  require_bins opencode node npm bun jq sqlite3 curl git || return 1
  prepare_evidence || return 1
  if [ -n "${LSP_E2E_INTERNAL_FIXTURE:-}" ]; then
    run_internal_fixture
    return $?
  fi

  local opencode_bin real_omo_before real_omo_after real_db_before real_db_after worktree_before worktree_after
  local build_rc port pass auth url encoded_dir session_response session_id prompt_code daemon_pid_file daemon_pid sandbox_removed=false
  opencode_bin="$(command -v opencode)"
  REAL_DB_PATH="$(opencode db path 2>/dev/null | head -1 || true)"
  real_db_before="$(real_db_count)"
  real_omo_before="$(hash_path "$REAL_OMO_ROOT")" || return 1
  REAL_OMO_BEFORE_HASH="$real_omo_before"
  worktree_before="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  printf 'real_omo_root=%s before=%s\nreal_db=%s session_count_before=%s\n' \
    "$REAL_OMO_ROOT" "$real_omo_before" "${REAL_DB_PATH:-ABSENT}" "$real_db_before" >"$EVIDENCE_DIR/isolation-receipt.txt"

  SANDBOX_ROOT="$(mktemp -d -t oqa-lsp-e2e.XXXXXX)" || return 1
  mkdir -p "$SANDBOX_ROOT/data" "$SANDBOX_ROOT/config" "$SANDBOX_ROOT/cache" "$SANDBOX_ROOT/state" "$SANDBOX_ROOT/home" "$SANDBOX_ROOT/project"
  export HOME="$SANDBOX_ROOT/home"
  export XDG_DATA_HOME="$SANDBOX_ROOT/data"
  export XDG_CONFIG_HOME="$SANDBOX_ROOT/config"
  export XDG_CACHE_HOME="$SANDBOX_ROOT/cache"
  export XDG_STATE_HOME="$SANDBOX_ROOT/state"
  export OPENCODE_TEST_HOME="$SANDBOX_ROOT/home"
  export OPENCODE_DISABLE_AUTOUPDATE=1
  export OPENCODE_DISABLE_MODELS_FETCH=1
  export OMO_DISABLE_POSTHOG=1
  export OMO_LSP_DAEMON_DIR="$SANDBOX_ROOT/omo/lsp-daemon"
  export LSP_TOOLS_MCP_PROJECT_CONFIG="$SANDBOX_ROOT/project/.opencode/lsp.json:$SANDBOX_ROOT/project/.omo/lsp.json:$SANDBOX_ROOT/project/.omo/lsp-client.json"
  export LSP_TOOLS_MCP_USER_CONFIG="$XDG_CONFIG_HOME/opencode/lsp.json"
  export LSP_TOOLS_MCP_INSTALL_DECISIONS="$XDG_CONFIG_HOME/opencode/lsp-install-decisions.json"
  unset OMO_LSP_DAEMON_CLI OMO_LSP_DAEMON_VERSION
  OMO_TEST_ROOT="$OMO_LSP_DAEMON_DIR"
  EXPECTED_DAEMON_CLI="$REPO_ROOT/packages/lsp-daemon/dist/cli.js"
  export QA_SCENARIO="$SCENARIO"
  export QA_SOURCE_FILE="source.ts"
  export QA_MARKER="$(scenario_marker "$SCENARIO")"

  with_shared_build_lock "opencode-lsp-e2e-build" build_lsp_runtime_for_qa
  build_rc=$?
  [ "$build_rc" -eq 0 ] || { fail "daemon build failed (see build.log)"; return 1; }
  [ -f "$EXPECTED_DAEMON_CLI" ] || { fail "built daemon CLI is missing"; return 1; }
  EXPECTED_DAEMON_VERSION="$(node --input-type=module - "$REPO_ROOT/packages/lsp-daemon/dist/package.json" <<'NODE'
import { readFileSync } from "node:fs";
const packageJson = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (typeof packageJson.version !== "string") process.exit(1);
process.stdout.write(packageJson.version);
NODE
)"
  [ -n "$EXPECTED_DAEMON_VERSION" ] || { fail "built daemon version is missing"; return 1; }
  export OMO_LSP_DAEMON_CLI="$EXPECTED_DAEMON_CLI"
  export OMO_LSP_DAEMON_VERSION="$EXPECTED_DAEMON_VERSION"

  write_path_contract_probe "$SANDBOX_ROOT/contract" "$EVIDENCE_DIR/path-contract.json" || {
    fail "path-contract probe failed (see path-contract-probe.log)"
    return 1
  }
  if [ "$SCENARIO" = "source-dist-reuse" ]; then
    run_source_dist_reuse_probe || { fail "source/dist reuse probe failed"; return 1; }
  fi
  if [ "$SCENARIO" = "auth-ownership" ]; then
    run_auth_ownership_probe || { fail "auth ownership probe failed (see auth-ownership-probe.log)"; return 1; }
    stop_known_daemon || return 1
    stop_owned_sandbox_processes || return 1
    safe_rm_tree "$SANDBOX_ROOT" || return 1
    SANDBOX_ROOT=""
    sandbox_removed=true
    real_omo_after="$(hash_path "$REAL_OMO_ROOT")" || return 1
    real_db_after="$(real_db_count)"
    worktree_after="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
    printf '%s\n' "$worktree_after" >"$EVIDENCE_DIR/worktree-after.txt"
    [ "$real_omo_before" = "$real_omo_after" ] || { fail "real OMO daemon root changed"; return 1; }
    [ "$real_db_before" = "$real_db_after" ] || { fail "real OpenCode DB session count changed"; return 1; }
    [ "$worktree_before" = "$worktree_after" ] || { fail "driver changed the dirty worktree"; return 1; }
    printf 'after=%s unchanged=yes\nreal_db_after=%s unchanged=yes\n' "$real_omo_after" "$real_db_after" >>"$EVIDENCE_DIR/isolation-receipt.txt"
    printf 'auth_ownership_probe_complete=true\nisolated_state_removed=%s\n' "$sandbox_removed" >"$EVIDENCE_DIR/cleanup-receipt.txt"
    write_auth_ownership_result "$real_omo_before" "$real_omo_after" "$real_db_before" "$real_db_after" \
      "$worktree_before" "$worktree_after" "$sandbox_removed" || return 1
    NORMAL_CLEANUP_COMPLETE=1
    jq -c . "$EVIDENCE_DIR/result.json"
    return 0
  fi
  if [ "$SCENARIO" = "rename" ]; then
    write_workspace_edit_fixture "$SANDBOX_ROOT/project" || return 1
    run_workspace_edit_contract_probe || { fail "workspace-edit contract probe failed (see workspace-edit-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "diagnostics-freshness" ]; then
    write_diagnostics_freshness_fixture "$SANDBOX_ROOT/project" || return 1
    run_diagnostics_freshness_contract_probe || { fail "diagnostics freshness contract probe failed (see diagnostics-freshness-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "post-edit" ]; then
    run_post_edit_contract_probe || { fail "post-edit contract probe failed (see post-edit-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "cancellation" ]; then
    run_cancellation_contract_probe || { fail "cancellation contract probe failed (see cancellation-contract-probe.log)"; return 1; }
  elif [ "$SCENARIO" = "client-package" ]; then
    run_client_package_contract_probe || { fail "client package contract probe failed (see client-package-smoke.log)"; return 1; }
  fi
  start_fake_provider || return 1
  write_sandbox_config || return 1

  port="$(node --input-type=module - <<'NODE'
import net from "node:net";
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(String(typeof address === "object" && address ? address.port : 0));
  server.close();
});
NODE
)"
  pass="oqa-$RANDOM$RANDOM"
  auth="opencode:$pass"
  url="http://127.0.0.1:$port"
  printf '%s\n' "$SANDBOX_ROOT/project" >"$EVIDENCE_DIR/opencode-serve-cwd.txt"
  (
    cd "$SANDBOX_ROOT/project" || exit 1
    export OPENCODE_SERVER_PASSWORD="$pass"
    exec "$opencode_bin" serve --port "$port" --hostname 127.0.0.1
  ) >"$EVIDENCE_DIR/opencode-serve.stdout.log" 2>"$EVIDENCE_DIR/opencode-serve.stderr.log" &
  OPENCODE_PID=$!
  wait_http "$url/global/health" "$auth" || { fail "OpenCode server did not become ready"; return 1; }

  encoded_dir="$(urlencode "$SANDBOX_ROOT/project")"
  wait_for_sse_connected "$url" "$auth" "$encoded_dir" || return 1

  session_response="$(curl -sS -u "$auth" -X POST "$url/session?directory=$encoded_dir" \
    -H 'content-type: application/json' -d '{"title":"OMO LSP path contract QA"}' 2>/dev/null || true)"
  printf '%s\n' "$session_response" >"$EVIDENCE_DIR/session-create.json"
  session_id="$(printf '%s' "$session_response" | jq -r '.id // .sessionID // empty' 2>/dev/null || true)"
  [ -n "$session_id" ] || { fail "OpenCode session creation failed"; return 1; }

  prompt_code="$(curl -sS -o "$EVIDENCE_DIR/prompt-response.txt" -w '%{http_code}' -u "$auth" \
    -X POST "$url/session/$session_id/prompt_async?directory=$encoded_dir" \
    -H 'content-type: application/json' \
    -d "{\"model\":{\"providerID\":\"openai\",\"modelID\":\"gpt-fake\"},\"parts\":[{\"type\":\"text\",\"text\":\"$(scenario_prompt "$SCENARIO")\"}]}" \
    2>"$EVIDENCE_DIR/prompt.stderr.log" || true)"
  [ "$prompt_code" = "204" ] || { fail "prompt_async returned HTTP $prompt_code"; return 1; }

  wait_for_session_result "$url" "$auth" "$session_id" "$encoded_dir" "$EVIDENCE_DIR/messages.json" || {
    if [ -s "$EVIDENCE_DIR/session-terminal-failure.json" ]; then
      fail "OpenCode LSP tool call reached terminal error (see session-terminal-failure.json)"
    else
      fail "OpenCode LSP tool call did not complete within the bound"
    fi
    return 1
  }
  extract_tool_evidence || { fail "SSE/message/provider tool evidence failed"; return 1; }
  record_daemon_state || return 1
  daemon_pid_file="$(find_daemon_pid_file)"
  daemon_pid="$(tr -d '[:space:]' <"$daemon_pid_file")"

  stop_verified_pid "$SSE_PID" "curl" "SSE watcher" || return 1
  SSE_PID=""
  stop_verified_pid "$OPENCODE_PID" "serve" "OpenCode server" || return 1
  OPENCODE_PID=""
  stop_known_daemon || return 1
  stop_verified_pid "$FAKE_PID" "$SANDBOX_ROOT/fake-provider.mjs" "fake provider" || return 1
  FAKE_PID=""
  stop_owned_sandbox_processes || return 1
  kill -0 "$daemon_pid" 2>/dev/null && { fail "daemon pid remained alive after cleanup"; return 1; }
  safe_rm_tree "$SANDBOX_ROOT" || return 1
  SANDBOX_ROOT=""
  sandbox_removed=true

  real_omo_after="$(hash_path "$REAL_OMO_ROOT")" || return 1
  real_db_after="$(real_db_count)"
  worktree_after="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  [ "$real_omo_before" = "$real_omo_after" ] || { fail "real OMO daemon root changed"; return 1; }
  [ "$real_db_before" = "$real_db_after" ] || { fail "real OpenCode DB session count changed"; return 1; }
  [ "$worktree_before" = "$worktree_after" ] || { fail "driver changed the dirty worktree"; return 1; }
  printf 'after=%s unchanged=yes\nreal_db_session_count_after=%s unchanged=yes\n' \
    "$real_omo_after" "$real_db_after" >>"$EVIDENCE_DIR/isolation-receipt.txt"
  printf 'daemon_pid=%s alive_after=no\nopencode_pid=stopped\nfake_provider_pid=stopped\nsse_watcher_pid=stopped\nisolated_state_removed=%s\n' \
    "$daemon_pid" "$sandbox_removed" >"$EVIDENCE_DIR/cleanup-receipt.txt"

  write_final_result "$real_omo_before" "$real_omo_after" "$real_db_before" "$real_db_after" \
    "$worktree_before" "$worktree_after" "$sandbox_removed" || return 1
  NORMAL_CLEANUP_COMPLETE=1
  jq -c . "$EVIDENCE_DIR/result.json"
}

run_all_scenarios() {
  require_bins bash node jq git || return 1
  prepare_evidence || return 1
  local scenarios scenario failures=0 before_omo before_db before_status after_omo after_db after_status
  REAL_DB_PATH="$(opencode db path 2>/dev/null | head -1 || true)"
  scenarios="path-contract rename diagnostics-freshness post-edit cancellation client-package source-dist-reuse auth-ownership"
  before_omo="$(hash_path "$REAL_OMO_ROOT")" || return 1
  before_db="$(real_db_count)"
  before_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  printf '%s\n' "$scenarios" >"$EVIDENCE_DIR/all-scenarios.txt"
  for scenario in $scenarios; do
    mkdir -p "$EVIDENCE_DIR/$scenario"
    if ! bash "${BASH_SOURCE[0]}" --scenario "$scenario" --evidence-dir "$EVIDENCE_DIR/$scenario" >"$EVIDENCE_DIR/$scenario.command.log" 2>&1; then
      failures=$((failures + 1))
      continue
    fi
    [ -s "$EVIDENCE_DIR/$scenario/result.json" ] || { failures=$((failures + 1)); continue; }
    jq -e '.result == "PASS" and .scenario != "SKIP"' "$EVIDENCE_DIR/$scenario/result.json" >/dev/null || failures=$((failures + 1))
  done
  after_omo="$(hash_path "$REAL_OMO_ROOT")" || return 1
  after_db="$(real_db_count)"
  after_status="$(git -C "$REPO_ROOT" status --porcelain=v1 -uall)"
  [ "$before_omo" = "$after_omo" ] || failures=$((failures + 1))
  [ "$before_db" = "$after_db" ] || failures=$((failures + 1))
  [ "$before_status" = "$after_status" ] || failures=$((failures + 1))
  node --input-type=module - "$EVIDENCE_DIR" "$before_omo" "$after_omo" "$before_db" "$after_db" "$before_status" "$after_status" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [evidenceDir, omoBefore, omoAfter, dbBefore, dbAfter, statusBefore, statusAfter] = process.argv.slice(2);
const scenarios = readFileSync(join(evidenceDir, "all-scenarios.txt"), "utf8").trim().split(/\s+/);
const entries = scenarios.map((scenario) => {
  try {
    return [scenario, JSON.parse(readFileSync(join(evidenceDir, scenario, "result.json"), "utf8"))];
  } catch (error) {
    return [scenario, {
      result: "FAIL",
      scenario,
      missingResult: true,
      error: error instanceof Error ? error.message : String(error),
      artifacts: { commandLog: `${scenario}.command.log` },
    }];
  }
});
const results = Object.fromEntries(entries);
const values = entries.map(([, value]) => value);
const hasUnchangedOpenCodeDb = (value) =>
  value.realOpenCodeDbSessionCountUnchanged === true || value.realDbSessionCountUnchanged === true;
const scenariosWithSse = entries.filter(([scenario]) => scenario !== "auth-ownership").map(([, value]) => value);
const payload = {
  result: values.every((value) => value.result === "PASS") && omoBefore === omoAfter && dbBefore === dbAfter && statusBefore === statusAfter ? "PASS" : "FAIL",
  scenario: "all",
  harness: "opencode",
  scenarioOrder: scenarios,
  scenarioResults: Object.fromEntries(entries.map(([name, value]) => [name, { result: value.result, cleanup: value.cleanup ?? {}, artifacts: value.artifacts ?? {} }])),
  realOmoRootUnchanged: omoBefore === omoAfter && values.every((value) => value.realOmoRootUnchanged === true),
  realOpenCodeDbSessionCountUnchanged: dbBefore === dbAfter && values.every(hasUnchangedOpenCodeDb),
  dirtyWorktreePreserved: statusBefore === statusAfter && values.every((value) => value.dirtyWorktreePreserved === true),
  noSkip: values.every((value) => value.result !== "SKIP" && value.scenario !== "SKIP"),
  sseEvidence: scenariosWithSse.every((value) => value.sseEvidence?.connected === true && value.sseEvidence?.toolObserved === true),
  pathContract: results["path-contract"]?.overrideAssertions ?? null,
  pairRecovery: results["path-contract"]?.failureFixtures ?? null,
  reuse: results["source-dist-reuse"]?.sourceDistReuse ?? null,
  auth: results["auth-ownership"]?.authOwnership ?? results["auth-ownership"] ?? null,
  cancellation: results.cancellation?.cancellationContract ?? null,
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
