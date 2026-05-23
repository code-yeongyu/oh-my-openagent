---
name: opencode-session-debugging
description: "Debug broken OpenCode sessions by locating sessions from an id, title, or directory, recursively inspecting child sessions, correlating transcripts, logs, background tasks, and current OpenCode source, then driving a TDD fix in an isolated PR worktree when code changes are needed. Use whenever the user mentions OpenCode session corruption, background task completion, child sessions, session ids, or a broken session transcript."
---

# OpenCode Session Debugging

Use this skill to investigate a broken OpenCode session from evidence first, then fix the responsible code only after the failure mechanism is pinned by a test.

## Non-Negotiables

1. Inspect the latest OpenCode source before relying on OpenCode behavior.
2. Find every child session recursively. A parent transcript alone is incomplete evidence.
3. Build a timestamped timeline from transcripts, OpenCode logs, plugin logs, and background-task state.
4. Use git history and blame for the failing subsystem before changing code.
5. If a fix is needed, switch to `work-with-pr`: create a new worktree, write the failing test first, open a PR, and do not merge until all required gates pass.
6. Treat raw `session.prompt` and `session.promptAsync` paths as suspect until the shared prompt gate has been audited.

## Phase 0: Capture Inputs

Accept any of these as the starting point:

- Session id, for example `ses_...`
- Session title
- Project directory where the session happened
- A symptom such as "background task completed and the session got corrupted"

If multiple inputs are present, use all of them. Do not ask for a narrower input when a search can disambiguate it.

## Phase 1: Update OpenCode Source

Keep a current OpenCode checkout outside the target repository. Prefer an existing sibling checkout; otherwise clone into `/tmp`.

```bash
# Existing sibling checkout, when present
cd ../opencode
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD

# Fresh temporary checkout, when needed
git clone https://github.com/sst/opencode /tmp/opencode-source
cd /tmp/opencode-source
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD
```

Use this source to verify current session, prompt, logging, storage, and background-task behavior. Do not assume older OpenCode behavior still applies.

## Phase 2: Locate the Session

Search by the strongest identifier first.

Prefer first-class session tools when they are available:

- `session_info` for one known session id
- `session_read` for transcript content
- `session_search` for title, directory, symptom, and message text
- `session_list` to find nearby sessions when only the directory or title is known

Fall back to direct file search when tool access is unavailable or incomplete.

By session id:

```bash
rg -n "ses_[A-Za-z0-9]+" ~/.claude/transcripts ~/.local/share/opencode 2>/dev/null
rg -n "TARGET_SESSION_ID" ~/.claude/transcripts ~/.local/share/opencode .opencode .omo 2>/dev/null
```

By title:

```bash
rg -n "TITLE_FRAGMENT" ~/.claude/transcripts ~/.local/share/opencode .opencode .omo 2>/dev/null
```

By directory:

```bash
rg -n "ABSOLUTE_PROJECT_DIRECTORY" ~/.claude/transcripts ~/.local/share/opencode .opencode .omo 2>/dev/null
```

Common evidence locations:

- `~/.claude/transcripts/*.jsonl`
- `~/.local/share/opencode/log/*.log`
- `~/.local/share/opencode`
- Project `.opencode/background-tasks`
- Project `.omo`
- OS temp logs such as `oh-my-opencode.log`

Record exact paths and timestamps for every artifact used.

## Phase 3: Recursively Find Child Sessions

For each discovered transcript, extract references to:

- `sessionID`, `session_id`, and `ses_...`
- `call_omo_agent`, `task`, delegate, and background-agent tool calls
- Background task ids and parent wake messages
- `session.prompt`, `promptAsync`, idle, error, compacting, and autocontinue events

Search each child session id again through transcripts and logs. Repeat until no new child ids appear. Return a parent-to-child tree with evidence paths.

Use this tree shape:

```text
ses_parent <title or first prompt> [transcript path]
├─ ses_child_a via <task/call/background id> at <timestamp> [transcript path]
│  └─ ses_grandchild via <task/call/background id> at <timestamp> [transcript path]
└─ ses_child_b via <task/call/background id> at <timestamp> [transcript path]
```

## Phase 4: Build the Failure Timeline

Create a timeline with absolute timestamps. Include:

- User prompts and assistant turns
- Background task creation, completion, output delivery, and cancellation
- Parent wake enqueue, dispatch, reservation, requeue, and skip events
- OpenCode session lifecycle events such as idle, error, compacting, and aborted process
- Any duplicate internal prompt or repeated assistant stream

For live or recently finished background tasks, prefer `background_output` to inspect task state before reading disk files. Use `background_cancel` only for an actually running stray task that is part of cleanup, and record why cancellation is safe.

Correlate this timeline with the latest OpenCode source. Label facts from runtime logs separately from inferences from source code.

## Phase 5: Prompt Gate Audit

Session corruption often comes from internal prompt injection. Audit this invariant before changing code:

- Production code may call `session.prompt` or `session.promptAsync` only through the shared gate path.
- New internal message routes must use `dispatchInternalPrompt` or an equivalent gate.
- Suspect patterns: duplicate idle/error/completion edges, `postDispatchHoldMs: 0`, raw prompt fallback when no session state is found, and routes that restore no state when dispatch is skipped.
- Check `src/shared/prompt-async-gate.ts`, `src/shared/prompt-async-route-audit.test.ts`, and the route-specific tests for the failing subsystem.

## Phase 6: History and Blame

Before changing code, run history searches for the failing mechanism:

```bash
git log --oneline -- path/to/suspect-file.ts
git log -S "suspect symbol or string" -- path/to/suspect-file.ts
git log -G "suspect regex" -- path/to/suspect-file.ts
git blame -L START,END path/to/suspect-file.ts
```

Use blame to identify the intent of the current behavior. Use `git show` on relevant commits and compare their tests to the current failure.

## Phase 7: TDD Fix Workflow

If the evidence points to a code defect:

1. Invoke `work-with-pr` and create a fresh task worktree.
2. Write a regression test that fails without the fix.
3. Make the smallest code change that turns the test green.
4. Run focused tests, adjacent tests, typecheck, build, and the full suite when risk warrants it.
5. Open a PR to `dev`.
6. Do not merge until CI, review-work, Cubic, and GPT-5.2 xhigh or Momus review all pass.
7. Remove the worktree only after the merge commit succeeds.

## Report Template

Use this shape for the investigation report:

```markdown
Root cause:
<one mechanism, tied to runtime evidence>

Evidence:
- Parent session: <path>
- Child sessions: <ids and paths>
- OpenCode source: <checkout path and commit>
- Timeline: <key timestamped events>
- History: <relevant commits and blame lines>

Fix:
- PR: <number or link>
- Test proving the bug: <test file and test name>
- Validation: <commands and results>

Blocked gates:
- <only include if a required gate could not run or did not pass>
```
