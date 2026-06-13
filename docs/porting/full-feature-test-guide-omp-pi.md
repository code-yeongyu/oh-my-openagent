# Full Feature Test Guide for Oh My Pi and Pi

Date: 2026-06-13

This guide is the step-by-step field test for the Oh My OpenAgent target adapters:

- Oh My Pi, executable `omp`
- Pi, executable `pi`

It is designed to prove real harness behavior without running the entire root test suite by default. The full root suite is resource-heavy and slow; run it only when you intentionally want a release-grade whole-repo check.

The guide uses Xiaomi MiMo v2.5 Pro at high thinking level because that is the requested dogfood model used for the final headless proof:

```bash
--model xiaomi-mimo/mimo-v2.5-pro --thinking high
```

## What This Proves

The complete pass should prove these feature groups in both target harnesses:

- Native extension discovery and load
- Diagnostic tool registration
- Built-in command registration
- Resource discovery for skills and prompts
- Always-on tools: `grep`, `glob`, session tools, `skill`
- MCP inventory: `mcp_servers`
- MCP-backed tools: LSP and ast-grep tools
- Task tools and task file persistence
- Hashline edit path and stale edit rejection
- Gated runtime tools: `look_at`, `interactive_bash` when tmux/shell support exists
- Background manager behavior through target task paths
- Team Mode tools when `OMO_TEAM_MODE=1`
- Hook/event registration through targeted source regressions
- Provider fallback and Skill MCP OAuth through targeted source regressions
- Real headless tool-use flow through `omp --mode text --print` and `pi --mode text --print`

The model can claim success without doing the work. Treat the final answer as a hint, then verify files and command outputs. Tiny lie detector, very healthy for the soul.

## Safety Rules

Run from the source repo:

```bash
cd /home/supreme/oh-my-openagent
```

Do not paste or print API keys. The commands below copy model config files when needed, but they never display their contents.

Use temp working directories for harness runs. The guide creates task/team state under the temp project `.omo/` directory so your real repos stay clean.

Use an isolated Pi agent directory for full Pi testing. The normal `/home/supreme/.pi/agent` may contain unrelated extensions and child processes. OMO now yields duplicate canonical tools such as `skill` and `session_search` when configured Hermes owns them, but isolation still makes reload and process-lifecycle results attributable to OMO.

## Prerequisites

Check executables and versions:

```bash
command -v bun
command -v omp
command -v pi
omp --version
pi --version
```

Expected shape from the current machine:

```text
omp/15.10.8
0.78.1
```

Check that the requested model is visible to both harnesses:

```bash
omp --mode text --print --list-models mimo-v2.5-pro
pi --mode text --print --list-models mimo-v2.5-pro
```

Expected:

- A provider/model row for `xiaomi-mimo/mimo-v2.5-pro`
- Thinking levels include `high`

If this fails, fix model configuration before continuing. Do not print the model config file.

## Guarded Update of Both Harnesses

Use the repository updater when Oh My Pi or Pi releases a new version and you want to keep the local runtime edits while rebuilding and relinking the current OMO source:

```bash
cd /home/supreme/oh-my-openagent
bun run update:harnesses -- --dry-run
bun run update:harnesses
```

The real run asks you to type `UPDATE BOTH`. It then:

- Fully backs up the four installed harness packages.
- Downloads the exact old registry packages as pristine merge bases.
- Updates with `omp update --force` and `pi update pi --force`.
- Three-way merges compatible local installed-package edits onto the new versions.
- Stops on merge conflicts before installing any merged result.
- Runs the full OMO build and relinks OMO into both harnesses.
- Runs the focused target suite, OMO typecheck, bundle import checks, and live adapter diagnostics.

Backups and merge workspaces are written under `~/.omo/harness-update-backups/<timestamp>/`. Each run includes `restore-before-update.sh`. Agent state is also snapshotted without large session, registry, memory, and cache directories.

Useful options:

```bash
bun run update:harnesses -- --yes
bun run update:harnesses -- --skip-live-verification
bun run update:harnesses -- --backup-dir /path/to/backup
bun run update:harnesses -- --resume ~/.omo/harness-update-backups/<timestamp>
```

Use `--yes` only in an attended automation context. A package merge conflict still stops the script and prints the exact merge workspace and restore command. The updater never embeds or prints an API key. Override diagnostic models with `OMO_UPDATE_VERIFY_MODEL` and `OMO_UPDATE_FALLBACK_MODEL`.

The merge uses the installed packages as the local-edit source of truth because those are the files the harness update replaces. The separate `/home/supreme/pr-work/oh-my-pi` and `/home/supreme/pi-mono` worktrees are recorded in the backup workspace but are not copied over a newer installed release.

After resolving and committing a reported merge conflict inside its printed merge workspace, continue the same update with `--resume`. Resume mode validates every saved merge, completes packages that had not been merged yet, and continues rebuild/testing without running either harness update command again.

## Build The Adapter Bundle

For a full source-to-runtime pass:

```bash
bun run build
```

If you only changed target host entrypoints and want a faster local rebuild:

```bash
bun build src/hosts/oh-my-pi/index.ts src/hosts/pi/index.ts --root src --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
bun run build:node-require-shim
```

The shim step must patch all three bundles:

```text
dist/index.js
dist/hosts/oh-my-pi/index.js
dist/hosts/pi/index.js
```

Run the focused bundle and adapter smoke checks:

```bash
bun test src/hosts/pi/register-diagnostics.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/shared/dist-bundle-bun-globals.test.ts
node --input-type=module -e "const pi = await import('./dist/hosts/pi/index.js'); const omp = await import('./dist/hosts/oh-my-pi/index.js'); console.log(typeof pi.default + ':' + typeof omp.default)"
```

Expected:

- `7 pass`
- Node smoke prints `function:function`

## Link The Extension

Oh My Pi uses `~/.omp/agent/extensions`:

```bash
mkdir -p /home/supreme/.omp/agent/extensions
ln -sfn /home/supreme/oh-my-openagent /home/supreme/.omp/agent/extensions/oh-my-openagent-dev
```

Pi normal install root uses `~/.pi/agent/extensions`, but the full guide uses an isolated Pi agent dir to avoid conflicts:

```bash
export OMO_PI_AGENT="$(mktemp -d /tmp/omo-pi-agent-XXXXXX)"
mkdir -p "$OMO_PI_AGENT/extensions"
ln -sfn /home/supreme/oh-my-openagent "$OMO_PI_AGENT/extensions/oh-my-openagent-dev"
cp /home/supreme/.pi/agent/models.json "$OMO_PI_AGENT/models.json"
test ! -f /home/supreme/.pi/agent/auth.json || cp /home/supreme/.pi/agent/auth.json "$OMO_PI_AGENT/auth.json"
test ! -f /home/supreme/.pi/agent/oauth.json || cp /home/supreme/.pi/agent/oauth.json "$OMO_PI_AGENT/oauth.json"
```

The copy commands preserve local credentials without showing them.

For a non-isolated Pi smoke, you can also link the normal root:

```bash
mkdir -p /home/supreme/.pi/agent/extensions
ln -sfn /home/supreme/oh-my-openagent /home/supreme/.pi/agent/extensions/oh-my-openagent-dev
```

If normal Pi fails or hangs because another extension owns conflicting tools or leaves children active, use the isolated `PI_CODING_AGENT_DIR` path above and record the external extension separately.

The public installer can select one or both target harnesses. Use disposable homes when testing installer behavior:

```bash
HOME="$(mktemp -d /tmp/omo-install-omp-XXXXXX)" bun src/cli/index.ts install-targets --target oh-my-pi
HOME="$(mktemp -d /tmp/omo-install-pi-XXXXXX)" bun src/cli/index.ts install-targets --target pi
HOME="$(mktemp -d /tmp/omo-install-both-XXXXXX)" bun src/cli/index.ts install-targets --target both
```

Expected:

- `oh-my-pi` creates only the OMP extension link
- `pi` creates only the Pi extension link
- `both` creates both links

## Create Test Workspaces

Create two separate temp projects, one for each harness:

```bash
export OMO_RUN_ROOT="$(mktemp -d /tmp/omo-full-harness-XXXXXX)"
export OMO_OMP_WORK="$OMO_RUN_ROOT/omp-work"
export OMO_PI_WORK="$OMO_RUN_ROOT/pi-work"
mkdir -p "$OMO_OMP_WORK/src" "$OMO_PI_WORK/src"
```

Create identical fixtures:

```bash
for work in "$OMO_OMP_WORK" "$OMO_PI_WORK"; do
  cat > "$work/package.json" <<'JSON'
{
  "type": "module",
  "scripts": {
    "check": "bun test"
  }
}
JSON

  cat > "$work/src/math.ts" <<'TS'
export function add(left: number, right: number): number {
  return left + right
}

export function multiply(left: number, right: number): number {
  return left * right
}

export const sampleValue = add(2, 3)
TS

  cat > "$work/src/math.test.ts" <<'TS'
import { expect, test } from "bun:test"
import { add, multiply } from "./math"

test("math helpers", () => {
  expect(add(2, 3)).toBe(5)
  expect(multiply(4, 5)).toBe(20)
})
TS

  printf 'alpha\nbeta\n' > "$work/sample.txt"
done
```

Create a small image fixture for `look_at`:

```bash
for work in "$OMO_OMP_WORK" "$OMO_PI_WORK"; do
  python3 - "$work/look-at-red.png" <<'PY'
import struct
import sys
import zlib

path = sys.argv[1]
width = 64
height = 64
raw = b"".join(b"\x00" + (b"\xff\x00\x00" * width) for _ in range(height))

def chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw))
    + chunk(b"IEND", b"")
)

with open(path, "wb") as handle:
    handle.write(png)
PY
done
```

Set common model variables:

```bash
export OMO_MODEL="xiaomi-mimo/mimo-v2.5-pro"
export OMO_THINKING="high"
```

## Oh My Pi Full Harness Pass

### 1. Diagnostic Load

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call omo_diagnostic. Final answer exactly: DIAG=<one-line tool result>. Use ASCII only.'
```

Expected:

- Exit 0
- Output mentions `Oh My OpenAgent Oh My Pi adapter loaded`

### 2. Core Tool Flow

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Headless OMO adapter proof. Use tools, do not answer from memory. Call omo_diagnostic. Call mcp_servers and verify lsp exists. Call task_create with subject "omp full core flow". Read sample.txt using an available read/search tool. Final answer with labels DIAG_LOADED, MCP_LSP, TASK_CREATED, SAMPLE_READ. Use ASCII only.'
```

Verify the task artifact:

```bash
find "$OMO_OMP_WORK/.omo/tasks" -maxdepth 5 -type f -print -exec sed -n '1,120p' {} \;
```

Expected:

- Exit 0
- Final answer says all four labels passed
- A `.omo/tasks/*.json` file exists with subject `omp full core flow`

### 3. MCP And Code Intelligence

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. First call mcp_servers. Then call lsp_symbols on src/math.ts with document scope. Then call ast_grep_search for TypeScript function declarations in src/math.ts. Final answer with labels MCP_SERVERS, LSP_SYMBOLS, AST_GREP. Include the discovered function names. Use ASCII only.'
```

Expected:

- `mcp_servers` includes `lsp` and `ast_grep`
- `lsp_symbols` finds `add` and `multiply`
- `ast_grep_search` finds function declarations

### 4. Search, Glob, Session, And Skill Tools

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call glob for src/**/*.ts. Call grep for sampleValue. Call session_info or session_list. Call skill with an empty or listing-style request if available. Final answer with labels GLOB, GREP, SESSION, SKILL. Use ASCII only.'
```

Expected:

- `glob` finds `src/math.ts` and `src/math.test.ts`
- `grep` finds `sampleValue`
- Session tool returns a result or a graceful empty result
- Skill tool returns available skill information or a graceful no-match result

### 5. Hashline Edit

```bash
cd "$OMO_OMP_WORK"
cp src/math.ts src/hashline-target.ts
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Read src/hashline-target.ts so you have line hash IDs. Then use the hashline edit tool to rename sampleValue to hashlineValue in src/hashline-target.ts. After that, intentionally attempt a stale or wrong-hash edit against the old text and confirm it is rejected. Final answer with labels HASHLINE_EDIT_APPLIED, STALE_HASH_REJECTED. Use ASCII only.'
```

Verify:

```bash
rg -n "hashlineValue|sampleValue" "$OMO_OMP_WORK/src/hashline-target.ts"
```

Expected:

- File contains `hashlineValue`
- Stale or wrong-hash edit is rejected
- If the model does not perform the stale edit, mark this step inconclusive and run the targeted regression:

```bash
cd /home/supreme/oh-my-openagent
bun test src/host-tools/hashline-edit-tool.test.ts
```

### 6. Gated Runtime Tools

`look_at` spends provider tokens because it calls a model with an image. Run it only when you want the multimodal proof:

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call look_at on look-at-red.png and describe the dominant color. Final answer with label LOOK_AT_COLOR. Use ASCII only.'
```

Expected:

- Exit 0
- Final answer identifies red or a red square

If `interactive_bash` is enabled in the environment, test it:

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. If interactive_bash is available, run printf "interactive-ok\n". If it is unavailable, report unavailable. Final answer with label INTERACTIVE_BASH. Use ASCII only.'
```

Expected:

- Either `interactive-ok` or a clear unavailable result

### 7. Task And Background Behavior

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Create a task with subject "omp task lifecycle". Then get it, update its status or description if the tool supports that, and list tasks. Final answer with labels TASK_CREATE, TASK_GET, TASK_UPDATE_OR_SKIP, TASK_LIST. Use ASCII only.'
```

Verify:

```bash
find "$OMO_OMP_WORK/.omo/tasks" -maxdepth 5 -type f -print -exec sed -n '1,160p' {} \;
```

Expected:

- A task file with subject `omp task lifecycle`
- `task_get` and `task_list` return coherent data

### 8. Team Mode

Team Mode requires `OMO_TEAM_MODE=1`.

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 420s omp --mode text --print --no-title --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Create a team named ompfull with members sisyphus and atlas. Then call team_status, team_task_create with subject "team proof", team_task_list, team_send_message with body "hello from full guide", and team_list. Final answer with labels TEAM_CREATE, TEAM_STATUS, TEAM_TASK, TEAM_MESSAGE, TEAM_LIST. Use ASCII only.'
```

Verify state:

```bash
find "$OMO_OMP_WORK/.omo/target-team-mode" -maxdepth 6 -type f -print | sort
find "$OMO_OMP_WORK/.omo/target-team-mode" -maxdepth 6 -type d -print | sort | sed -n '1,120p'
tmux list-sessions 2>/dev/null | rg 'omo-target-team|ompfull' || true
```

Expected:

- Team state files exist
- Worktree/member directories exist
- `team_task_list` includes `team proof`
- If tmux is installed and available, a target team tmux session may be present

Clean up tmux sessions created by the test:

```bash
tmux list-sessions -F '#S' 2>/dev/null | rg '^omo-target-team' | xargs -r -n1 tmux kill-session -t
```

## Pi Full Harness Pass

Use the isolated Pi agent directory from the setup section:

```bash
export PI_CODING_AGENT_DIR="$OMO_PI_AGENT"
```

### 1. Diagnostic Load

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call omo_pi_diagnostic. Final answer exactly: DIAG=<one-line tool result>. Use ASCII only.'
```

Expected:

- Exit 0
- Output mentions `Oh My OpenAgent Pi adapter loaded`

If this fails in the normal Pi agent dir with conflicts such as `Tool "skill" conflicts`, rerun with `PI_CODING_AGENT_DIR="$OMO_PI_AGENT"`.

### 2. Core Tool Flow

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Headless OMO adapter proof. Use tools, do not answer from memory. Call omo_pi_diagnostic. Call mcp_servers and verify lsp exists. Call task_create with subject "pi full core flow". Read sample.txt using an available read/search tool. Final answer with labels DIAG_LOADED, MCP_LSP, TASK_CREATED, SAMPLE_READ. Use ASCII only.'
```

Verify:

```bash
find "$OMO_PI_WORK/.omo/tasks" -maxdepth 5 -type f -print -exec sed -n '1,120p' {} \;
```

Expected:

- Exit 0
- Final answer says all four labels passed
- A `.omo/tasks/*.json` file exists with subject `pi full core flow`

### 3. MCP And Code Intelligence

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. First call mcp_servers. Then call lsp_symbols on src/math.ts with document scope. Then call ast_grep_search for TypeScript function declarations in src/math.ts. Final answer with labels MCP_SERVERS, LSP_SYMBOLS, AST_GREP. Include the discovered function names. Use ASCII only.'
```

Expected:

- `mcp_servers` includes `lsp` and `ast_grep`
- `lsp_symbols` finds `add` and `multiply`
- `ast_grep_search` finds function declarations

### 4. Search, Glob, Session, And Skill Tools

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call glob for src/**/*.ts. Call grep for sampleValue. Call session_info or session_list. Call skill with an empty or listing-style request if available. Final answer with labels GLOB, GREP, SESSION, SKILL. Use ASCII only.'
```

Expected:

- `glob` finds `src/math.ts` and `src/math.test.ts`
- `grep` finds `sampleValue`
- Session tool returns a result or a graceful empty result
- Skill tool returns available skill information or a graceful no-match result

### 5. Hashline Edit

```bash
cd "$OMO_PI_WORK"
cp src/math.ts src/hashline-target.ts
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Read src/hashline-target.ts so you have line hash IDs. Then use the hashline edit tool to rename sampleValue to hashlineValue in src/hashline-target.ts. After that, intentionally attempt a stale or wrong-hash edit against the old text and confirm it is rejected. Final answer with labels HASHLINE_EDIT_APPLIED, STALE_HASH_REJECTED. Use ASCII only.'
```

Verify:

```bash
rg -n "hashlineValue|sampleValue" "$OMO_PI_WORK/src/hashline-target.ts"
```

Expected:

- File contains `hashlineValue`
- Stale or wrong-hash edit is rejected
- If the model does not perform the stale edit, mark this step inconclusive and run the targeted regression:

```bash
cd /home/supreme/oh-my-openagent
bun test src/host-tools/hashline-edit-tool.test.ts
```

### 6. Gated Runtime Tools

Multimodal `look_at`:

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Call look_at on look-at-red.png and describe the dominant color. Final answer with label LOOK_AT_COLOR. Use ASCII only.'
```

Expected:

- Exit 0
- Final answer identifies red or a red square

Interactive bash, when available:

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. If interactive_bash is available, run printf "interactive-ok\n". If it is unavailable, report unavailable. Final answer with label INTERACTIVE_BASH. Use ASCII only.'
```

Expected:

- Either `interactive-ok` or a clear unavailable result

### 7. Task And Background Behavior

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Create a task with subject "pi task lifecycle". Then get it, update its status or description if the tool supports that, and list tasks. Final answer with labels TASK_CREATE, TASK_GET, TASK_UPDATE_OR_SKIP, TASK_LIST. Use ASCII only.'
```

Verify:

```bash
find "$OMO_PI_WORK/.omo/tasks" -maxdepth 5 -type f -print -exec sed -n '1,160p' {} \;
```

Expected:

- A task file with subject `pi task lifecycle`
- `task_get` and `task_list` return coherent data

### 8. Team Mode

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 420s pi --mode text --print --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  'Use tools. Create a team named pifull with members sisyphus and atlas. Then call team_status, team_task_create with subject "team proof", team_task_list, team_send_message with body "hello from full guide", and team_list. Final answer with labels TEAM_CREATE, TEAM_STATUS, TEAM_TASK, TEAM_MESSAGE, TEAM_LIST. Use ASCII only.'
```

Verify:

```bash
find "$OMO_PI_WORK/.omo/target-team-mode" -maxdepth 6 -type f -print | sort
find "$OMO_PI_WORK/.omo/target-team-mode" -maxdepth 6 -type d -print | sort | sed -n '1,120p'
tmux list-sessions 2>/dev/null | rg 'omo-target-team|pifull' || true
```

Expected:

- Team state files exist
- Worktree/member directories exist
- `team_task_list` includes `team proof`
- If tmux is installed and available, a target team tmux session may be present

Clean up tmux sessions:

```bash
tmux list-sessions -F '#S' 2>/dev/null | rg '^omo-target-team' | xargs -r -n1 tmux kill-session -t
```

## Hyperplan Full Workflow

Hyperplan is more than command expansion. A valid pass must prove the bundled skill loads, the inline category roster survives normalization, every direct member message executes a target child agent, the planner alias runs in the foreground, and cleanup removes all target-owned state.

Run the real command on Oh My Pi:

```bash
cd "$OMO_OMP_WORK"
OMO_TEAM_MODE=1 timeout 1800s omp --mode json --print --no-title --auto-approve \
  --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  '/hyperplan Plan a safe migration of a small API endpoint.'
```

Run the real command on isolated Pi:

```bash
cd "$OMO_PI_WORK"
PI_CODING_AGENT_DIR="$OMO_PI_AGENT" OMO_TEAM_MODE=1 timeout 1800s pi --mode json --print \
  --model "$OMO_MODEL" --thinking "$OMO_THINKING" \
  '/hyperplan Plan a safe migration of a small API endpoint.'
```

Inspect each JSONL trace. A complete workflow has:

- One successful `skill` call for `hyperplan`
- One successful `team_create` with members `skeptic`, `validator`, `researcher`, `architect`, and `creative`, plus the caller lead
- Five successful `team_send_message` calls for each of the three rounds, 15 total
- Every direct member message returns a member response from a routed `sisyphus-junior` child process
- One successful foreground `task` call using `subagent_type: "plan"`, routed to Prometheus
- Five `team_shutdown_request` calls and five `team_approve_shutdown` calls
- One successful `team_delete`
- No tool result with `isError: true`

Verify cleanup after each run:

```bash
cat .omo/target-team-index.json
find .omo/target-team-mode/runtime -mindepth 1 -maxdepth 1 -type d -print
find .omo/target-team-mode/worktrees -mindepth 1 -print
tmux list-sessions -F '#S' 2>/dev/null | rg '^omo-target-team' || true
```

Expected:

- Index contains `{}`
- No runtime directories
- No worktree entries
- No target-owned tmux session

For deterministic control-flow certification, use a local OpenAI-compatible fixture provider that emits the exact tool sequence above and local child executables that record each subprocess start. This removes provider queue variance while still executing the installed harness, extension, target tools, filesystem state, tmux lifecycle, subprocess routing, planner alias, and cleanup. The final certification observed 16 child starts per harness: 15 `sisyphus-junior` member turns and one Prometheus planner turn.

## Reload, Optional Dependencies, And Child Cleanup

Run Pi reload tests with an isolated `PI_CODING_AGENT_DIR`. A normal global Pi home may load unrelated Hermes extensions; Hermes can leave its own MCP children active after reload and keep the process alive. That external behavior is not an OMO reload failure when an isolated OMO-only Pi reload passes.

Test missing tmux support with a temporary `PATH` that excludes `tmux`. Both harnesses should omit `interactive_bash`, complete a provider turn, and exit 0.

Test background cleanup twice:

- Explicit cancellation: start a long-running background `call_omo_agent`, call `background_cancel`, verify the child receives `SIGTERM`, and verify no child remains.
- Parent exit: start a long-running background child, let the headless parent finish without explicit cancellation, and verify `session_shutdown` terminates the child before process exit.

Use deterministic local child executables for these lifecycle checks. They should record `START` and `TERM` events and wait long enough that an unhandled orphan is observable.

## Targeted Regression Pass

Run these after code changes. This is the recommended high-signal test pass instead of full `bun test`:

```bash
cd /home/supreme/oh-my-openagent
timeout 240s bun test \
  src/host-tools/gated-runtime-tools.test.ts \
  src/host-tools/look-at-tool.test.ts \
  src/host-hooks/provider-fallback.test.ts \
  src/host-tools/team-tools.test.ts \
  src/host-tools/always-on-tools.test.ts \
  src/host-agents/agent-routing.test.ts \
  src/features/team-mode/team-state-store/store.test.ts \
  src/features/mcp-oauth/discovery.test.ts \
  src/features/mcp-oauth/provider.test.ts \
  src/features/mcp-oauth/provider-live-local.test.ts \
  src/plugin/consensus-removal.test.ts
```

Expected: every selected test passes. Exact counts can change as focused regressions are added.

Expanded adapter pass:

```bash
cd /home/supreme/oh-my-openagent
timeout 180s bun test \
  src/host-resources/command-registration.test.ts \
  src/host-resources/resource-discovery.test.ts \
  src/host-hooks/hook-registration.test.ts \
  src/host-hooks/message-transforms.test.ts \
  src/host-hooks/continuation.test.ts \
  src/host-hooks/tool-guards.test.ts \
  src/host-hooks/openclaw.test.ts \
  src/host-agents/agent-routing.test.ts \
  src/host-tools/always-on-tools.test.ts \
  src/host-tools/mcp-backed-tools.test.ts \
  src/host-tools/hashline-edit-tool.test.ts \
  src/host-tools/task-tools.test.ts \
  src/host-tools/tool-normalization.test.ts \
  src/hosts/oh-my-pi/register-diagnostics.test.ts \
  src/hosts/pi/register-diagnostics.test.ts \
  src/cli/install-targets/install-target-extensions.test.ts
```

Expected: every selected test passes. Exact counts can change as focused regressions are added.

Typecheck:

```bash
timeout 300s bun run typecheck
```

Build:

```bash
timeout 300s bun run build
```

## Optional Full Root Suite

Run only when you intentionally want the expensive check:

```bash
cd /home/supreme/oh-my-openagent
timeout 900s bun test
```

This is not part of the default guide because it is resource-heavy.

## Update Safety

Updating `omp` or `pi` is reasonable, but package updates can overwrite installed-runtime patches. Preserve and replay the source changes deliberately.

Before an update:

```bash
git -C /home/supreme/oh-my-openagent status --short
git -C /home/supreme/pr-work/oh-my-pi status --short
git -C /home/supreme/pi-mono status --short
```

Commit or stash the source-repository changes you intend to keep. Also capture diffs for any files changed directly under `/home/supreme/.bun/install/global/node_modules/`, because those installed copies will be replaced by an update.

What survives:

- Edits in `/home/supreme/oh-my-openagent` survive harness package updates. Rebuild the OMO target bundles afterward.
- Edits in `/home/supreme/pr-work/oh-my-pi` survive an installed OMP update, but the installed OMP runtime will not automatically use those source edits.
- Edits in `/home/supreme/pi-mono` survive an installed Pi update, but the installed Pi runtime will not automatically use those source edits.
- Source-linked OMO extension symlinks continue pointing at this repository unless an installer replaces or removes them.

What is overwritten:

- Any edits under `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/`
- Any edits under `/home/supreme/.bun/install/global/node_modules/@earendil-works/`

After an update:

```bash
cd /home/supreme/oh-my-openagent
bun build src/hosts/oh-my-pi/index.ts src/hosts/pi/index.ts --root src --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
bun run build:node-require-shim
bun run typecheck
```

Then reapply or install the durable harness-source patches into the updated runtime, rerun diagnostic discovery, provider fallback, compaction, background cleanup, Team Mode, and Hyperplan. Do not replace the installed OMP package wholesale with the current local OMP source checkout without checking versions; the installed OMP runtime may be newer than that checkout.

## Oh My Pi Source Checks

Use these when validating the Oh My Pi source patch for symlink package discovery and resource consumption:

```bash
cd /home/supreme/pr-work/oh-my-pi
timeout 600s bun run check
timeout 300s bun test packages/coding-agent/test/sdk-skills.test.ts
timeout 300s bun run ci:test:smoke
```

Expected from the latest certification: all three passed.

## Pi Source Check Caveat

Pi source check has a documented build precondition:

```bash
cd /home/supreme/pi-mono
timeout 600s npm run check
```

Known current behavior:

- Before dependency install: fails with `biome: command not found`
- After `npm ci`: fails in `packages/web-ui` because workspace `.d.ts` outputs are missing
- The Pi README says `npm run check` requires `npm run build` first

If the current goal forbids Pi `npm run build`, classify this as blocked by the repo precondition, not as an OMO adapter failure.

## Evidence Checklist

Record these for a complete certification note:

- `omp --version`
- `pi --version`
- Model list confirms `xiaomi-mimo/mimo-v2.5-pro` and `high`
- Build command and result
- Focused bundle tests result
- Oh My Pi diagnostic result
- Oh My Pi `.omo/tasks/*.json` proof
- Oh My Pi MCP proof includes `lsp` and `ast_grep`
- Oh My Pi LSP/ast-grep result names `add` and `multiply`
- Oh My Pi hashline file diff or targeted hashline regression
- Oh My Pi Team Mode state under `.omo/target-team-mode`
- Pi diagnostic result with `PI_CODING_AGENT_DIR`
- Pi `.omo/tasks/*.json` proof
- Pi MCP proof includes `lsp` and `ast_grep`
- Pi LSP/ast-grep result names `add` and `multiply`
- Pi hashline file diff or targeted hashline regression
- Pi Team Mode state under `.omo/target-team-mode`
- Hyperplan trace proves skill load, 15 member turns, planner handoff, shutdown, and zero residue
- Explicit background cancellation and parent-exit cleanup leave no child process
- Isolated reload passes; unrelated global extension behavior is recorded separately
- Any tmux sessions cleaned up
- Any normal Pi extension conflicts noted
- Full root suite status: skipped by instruction, passed, failed, or not run

## Cleanup

Remove temp dirs when done:

```bash
tmux list-sessions -F '#S' 2>/dev/null | rg '^omo-target-team' | xargs -r -n1 tmux kill-session -t
rm -rf "$OMO_RUN_ROOT"
rm -rf "$OMO_PI_AGENT"
```

Keep the extension symlinks if you want ongoing dogfood:

```text
/home/supreme/.omp/agent/extensions/oh-my-openagent-dev
/home/supreme/.pi/agent/extensions/oh-my-openagent-dev
```

Remove them if you want to restore a completely clean harness environment:

```bash
rm -f /home/supreme/.omp/agent/extensions/oh-my-openagent-dev
rm -f /home/supreme/.pi/agent/extensions/oh-my-openagent-dev
```
