# tool-pair-validator: operate on OpenCode's real Part model

Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/6605
Date: 2026-08-05
Change scope: `packages/omo-opencode/src/hooks/tool-pair-validator/` (+ the two
`packages/omo-opencode/src/plugin/messages-transform.test.ts` cases that asserted the old shape).

## WHAT WAS TESTED

1. **Unit, failing-first.** The `conversion-invariant.test.ts` gate run against the OLD
   implementation (the four source files checked out from `origin/dev`, the new tests kept) to
   prove it actually catches the defect. Artifact: `unit-red-before-fix.txt`. `hook.test.ts` is
   deliberately excluded from that run: it asserts `INTERRUPTED_TOOL_ERROR`, a symbol that only
   exists after the fix, so it cannot execute against the old sources and is a green-only suite.
   The failing-first proof rests entirely on the conversion-invariant gate, which is written
   against the shared contract and runs unchanged on both implementations.
2. **Unit, green.** Same tests against the new implementation, plus the surrounding blast radius.
3. **Real OpenCode, hermetic sandbox.** Built the plugin from this worktree, loaded it into a real
   `opencode` 1.18.13 run inside a sandbox that isolates BOTH the XDG dirs and the user home, and
   drove two prompts: a healthy run (all tool parts terminal) and a run over a session containing a
   real `running` tool part. Artifact: `opencode-qa-plugin.log`, transcript below.

## WHAT WAS OBSERVED

### 1. Failing-first (old code, new tests)

```
(fail) conversion invariant > an assistant turn with a stuck tool part
  expect(findOrphanedToolCalls(convertToModelMessages(messages))).toEqual([])
  - []
  + [ "toolu_stuck" ]

(fail) conversion invariant > it added no part type that the conversion would discard
  expect(collectForeignPartTypes(messages)).toEqual([])
  - []
  + [ "tool_result" ]

 1 pass  2 fail  (3 tests, 1 file)
```

The old hook leaves the orphan in place AND injects a `tool_result` part, a type that is not in
OpenCode's `Part` union, so `MessageV2.toModelMessagesEffect` discards it before the request is built.

### 2. Green (new code)

```
bun test packages/omo-opencode/src/hooks/tool-pair-validator packages/omo-opencode/src/plugin/messages-transform.test.ts
  31 pass  0 fail  76 expect() calls

bun test packages/omo-opencode/src/hooks packages/omo-opencode/src/plugin
  2688 pass  0 fail  6168 expect() calls  (340 files)

bun run typecheck    -> exit 0
bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod -> exit 0
```

`bun run build` (the full graph) fails on this Windows host inside the vendored
`packages/lsp-tools-mcp` build (`'rm' is not recognized`). That is pre-existing and unrelated to
this change; the plugin bundle step was run directly and succeeds.

### 3. Real OpenCode, hermetic sandbox

Sandbox `%TEMP%\omo-qa-sandbox2`. Isolated: `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` /
`XDG_CACHE_HOME`, `TMP` / `TEMP`, **and the user home** (`USERPROFILE` / `HOME` / `HOMEDRIVE` /
`HOMEPATH`). Home isolation matters because the Claude Code compatibility loaders read `~/.claude.json`,
`~/.claude/skills` and `~/.agents`; an earlier XDG-only run picked up a host MCP server from
`~/.claude.json`, so that run was discarded and everything below was re-captured hermetically.
Only `auth.json` was copied in (credentials are config, not session state). Plugin registered by
absolute path in the sandbox `opencode.json`.

Host-config leak scan over the captured log: **0** matches for `.claude`, `.agents`, `gitnexus`, and
the plugin reports `Loaded 0 plugins with 0 commands, 0 skills, 0 agents, 0 MCP servers` on both runs.

**Run A - healthy session.** `opencode run "Use the bash tool to run: echo omo-qa-probe ..." --format json --model opencode/deepseek-v4-flash-free`

```
{"type":"tool_use", ... "state":{"status":"completed","input":{"command":"echo omo-qa-probe"},"output":"omo-qa-probe\r\n", ...}}
{"type":"text", ... "text":"DONE"}
OPENCODE_EXIT_A=0
TOOL_PAIR_VALIDATOR_LINES_AFTER_RUN_A=0
HOST_CONFIG_REFERENCES=0
```

Correct: every tool part was terminal, so the hook is a no-op and adds nothing to the request.

**Run B - session containing a real non-terminal tool part.** The completed tool part
`prt_fd0a4cab5001JAgXsKPkj1cPk8` (callID `call_00_oDnN4HwLLjEpi4cnkHMj7440`) was rewritten in the
SANDBOX database to `state.status = "running"`, removing the source of its `tool_result`. Then the
same session was continued:

```
BEFORE part=prt_fd0a4cab5001JAgXsKPkj1cPk8 callID=call_00_oDnN4HwLLjEpi4cnkHMj7440 status=completed
AFTER  part=prt_fd0a4cab5001JAgXsKPkj1cPk8 callID=call_00_oDnN4HwLLjEpi4cnkHMj7440 status=running

opencode run "Reply with exactly OK." --format json --model opencode/deepseek-v4-flash-free --session ses_02f5b6101ffety2kcRS95DU4ua
{"type":"text", ... "text":"OK"}
OPENCODE_EXIT_B=0
```

Plugin log:

```
[2026-08-05T06:42:25.114Z] [tool-pair-validator] Settled unpaired tool parts into a terminal error state
  {"assistantMessageID":"msg_fd0a4a4b4001PYv1wN0u4daqGl",
   "repairedToolCallIDs":["call_00_oDnN4HwLLjEpi4cnkHMj7440"],
   "previousStatuses":["running"]}
```

The hook recognised a REAL OpenCode `tool` part (not the old `tool_use` shape), settled it, and the
request went through. Compare with the old implementation, which on the same class of input logged
`Repaired missing tool_result blocks` and changed nothing on the wire.

**Non-destructive:** the persisted part in the sandbox DB is still `running` after the run
(`SANDBOX_PERSISTED_TOOL_STATUS=running`). The hook only rewrites the per-request transform array
that OpenCode hands it, never stored session state.

### Isolation proof

Measured tightly around a single sandbox run (the host machine is also running an interactive
opencode session, so only a before/after pair bracketing one QA invocation is meaningful):

```
REAL_DB_SESSIONS_BEFORE=2863
SANDBOX_DB_PATH=C:\Users\pss\AppData\Local\Temp\omo-qa-sandbox2\data\opencode\opencode.db
OPENCODE_EXIT=0
REAL_DB_SESSIONS_AFTER=2863
ISOLATION=OK (real session count unchanged)
SANDBOX_SESSIONS=2
```

`opencode db path` inside the sandbox resolves to the sandbox database, and the real
`~/.local/share/opencode/opencode.db` session count is unchanged across the run.

## WHY IT IS ENOUGH

- The failing-first run proves the new tests detect both halves of the defect: the surviving orphan
  and the discarded foreign part type. They cannot pass vacuously.
- The real-OpenCode run proves the rewritten hook fires against genuine `ToolPart` data produced by
  opencode itself, on the exact transform hook that OpenCode also invokes for compaction
  (`compaction.ts:350`), and that a request carrying a settled part succeeds.
- The no-op observation on the healthy run proves the hook does not perturb well-formed sessions.
- The unchanged persisted state proves no session corruption, which was the failure mode behind
  the earlier #3996 regression.

## WHAT WAS OMITTED

- `auth.json` was copied into the sandbox but is not reproduced here; no tokens, API keys, or auth
  headers appear in any artifact.
- `opencode-qa-plugin.log` is the sandbox-local plugin log only. It contains local filesystem paths
  and no credentials.
- The compaction 400 from issue #6605 is NOT claimed to be fixed by this change. Replaying the real
  session rows through `ai@5.0.226` `convertToModelMessages` produces a clean, fully paired array,
  so that particular orphan is introduced below the plugin's last hook point. This change makes the
  guard functional; it does not eliminate the upstream orphan.
