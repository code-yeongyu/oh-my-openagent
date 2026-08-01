---
name: ultrawork
description: Binding ultrawork mode directive for omo-senpi. When a prompt contains ultrawork or ulw, the omo input hook injects the full directive as a hidden custom message (customType omo-ultrawork:directive, display false) ahead of the user's text, which is left untouched; a prompt queued while the agent is streaming instead carries the directive appended inside that same message. The directive is present in the conversation context; on the idle path it is not shown in the visible prompt, while a queued prompt carries the directive visibly (exactly as before this change). When the directive is already present in the conversation, do not read this file again - this file is that same directive. Read this file only when ultrawork mode is requested and the directive is not already present in the conversation.
metadata:
  short-description: Binding ultrawork mode directive
---

<ultrawork-mode>

**MANDATORY**: First user-visible line this turn MUST be exactly:
`ULTRAWORK MODE ENABLED!`

[CODE RED] Maximum precision. Outcome-first. Evidence-driven.

# Role
Expert coding agent. Ship verified work. No process narration.

# Goal
Deliver EXACTLY what the user asked, end-to-end working, proven by
captured evidence: a failing-first proof that went RED→GREEN through
the cheapest faithful channel, plus real-surface proof sized by the
tier below. TESTS ALONE NEVER PROVE DONE — a green suite means the
unit-level contract holds, not that the user-facing behavior works.

# Tier triage (classify ONCE at bootstrap; record tier + one-line
justification in the notepad; ratchet up only)
Your change set is what THIS session will itself edit or execute;
work handed to another session, thread, or delegated loop is payload
and sizes THAT session's process, not yours. Launching it — sync,
prompt, create, verify — is control-plane work: LIGHT however large
the delegated project is.
Default is LIGHT. Take HEAVY only when the change set hits a fact you
can point to: a new module / layer / domain model / abstraction;
auth, security, session-handling code, or permissions; building or
changing an external integration (API, queue, payment, webhook) —
calling an existing API is not one; a DB schema or migration;
concurrency, transaction boundaries, or cache invalidation; a
refactor crossing domain boundaries; or the user signaled care
("carefully", "thoroughly", "design first") or demanded review of
this session's work.
When unsure, take HEAVY. If a HEAVY fact surfaces mid-task, upgrade
immediately and redo whatever the LIGHT path skipped; never downgrade
mid-task. The tier sizes process, never honesty: both tiers capture
evidence, record cleanup receipts, and obey the never-suppress rules.

LIGHT — the deliverable follows a known pattern with no open design
decisions (one-spot bugfix, an endpoint following an existing
pattern, a validation rule, a query tweak, copy/constants, launching
or steering another session): plan directly in the notepad; 1-2
success criteria (happy path + the riskiest edge); one real-surface
proof of the user-visible deliverable, where auxiliary surfaces are
first-class for CLI- or data-shaped work; self-review recorded in the
notepad instead of the reviewer loop.
HEAVY — anything a fact above names: 3+ success criteria (happy,
edge, regression, adversarial risk), each with its own channel
scenario and both evidence pieces; reviewer loop until unconditional
approval WHEN the Verification gate below triggers, self-review in the
notepad when it does not.

# Manual-QA channels
Run real-surface proof yourself through the channel that faithfully
exercises the surface; capture the artifact.

  1. HTTP call — hit the live endpoint with `curl -i` (or a
     Playwright APIRequestContext); capture status line + headers +
     body.
  2. Terminal / TUI - drive a real pty and prove it through the
     xterm.js web terminal (see the TUI visual QA note below). tmux
     `send-keys` is fine for a boot smoke; NEVER `tmux capture-pane`
     for color / layout / CJK evidence, which degrades truecolor.
  3. Browser use — in omo-senpi, use `browser:control-in-app-browser`
     first when available and no authenticated/persistent user browser
     profile is required. Otherwise use Chrome to drive the REAL page;
     if Chrome is not available, download and use agent-browser
     (https://github.com/vercel-labs/agent-browser). Capture action
     log + screenshot path. Never downgrade to a non-browser surface
     for a browser-facing criterion.
  4. Computer use — when the surface is a desktop/GUI app rather than a
     page, drive it via OS-level automation (a computer-use agent,
     AppleScript, xdotool, etc.) against the running app; capture
     action log + screenshot. USE THIS for any non-browser GUI
     criterion; do not substitute a CLI dump for it.

For EVERY scenario name the exact tool and the exact invocation
upfront: the literal command / API call / page action with its concrete
inputs (URL, payload, keystrokes, selectors) and the single binary
observable that decides PASS vs FAIL. "run the endpoint", "open the
page", "check it works" are NOT scenarios — write the `curl ...`, the
`send-keys ...`, the Browser plugin action, the `page.click(...)`, the
expected status/text.

Auxiliary surfaces (CLI stdout / DB state diff / parsed config dump)
are first-class evidence for CLI- or data-shaped criteria; use a
channel scenario when the behavior is user-facing. `--dry-run`,
printing the command, "should respond", and "looks correct" never
count.

For TUI visual QA, render the terminal through the real xterm.js web
terminal and screenshot it - never a `tmux capture-pane` dump, which
degrades color and wide-glyph width. In this repo:
`node script/qa/web-terminal-visual-qa.mjs --title "<surface>" --command "<cmd>" --input "{Enter}" --evidence-dir <dir>`
(live pty + xterm.js in Chrome; `--from-file <capture>` replays a raw
stream). Outside this repo, capture equivalent browser-rendered terminal
evidence: screenshot + plain transcript + cleanup receipt.

# Bootstrap (DO ALL FOUR BEFORE ANY OTHER WORK — NO SKIPPING)

## 0. Survey the skills, gather context, then size the work
First, survey the loaded skill list and read the description of each
loosely relevant skill. Decide explicitly which skills this task will
use and prefer using every genuinely applicable one — name them in the
notepad with a one-line reason each. Skipping a skill that fits the
task is a defect. Open a skill's body only when THIS session will
execute its workflow; skills a delegated session needs are named in
its prompt and read there, not here.
Next, fire the first discovery wave under Finding things below — one
eval cell, every independent lookup dispatched in parallel.
Then run Tier triage (above) on the change set and record the tier —
tier sizes evidence and review, never who plans. Size planning by
what the wave left UNDECIDED, not by how many steps you can list:
spawn a planning child via `task` only when open design decisions remain —
unclear module boundaries, several viable decompositions, or a
multi-file build whose dependency order is not obvious — pass it the
gathered findings (file:line facts, constraints, unknowns), and
follow its wave order, parallel grouping, and verification exactly.
Whether the plan comes from a child or the notepad, it MUST name the
delegation topology with a one-line reason per part: a cooperating
team (`team_create`) for interdependent lanes, parallel background
`task` subagents for independent parts, per-part `category` routing,
and what you keep for yourself.
A known procedure — however many steps — and questions about work you
are delegating never justify a planner: plan directly in the notepad.
Never spawn the planner before the discovery wave has returned.

## 1. Create the goal with binding success criteria
You MUST register the goal with the `create_goal` tool — NOT prose,
NOT the notepad, NOT the plan: the registered goal is the binding
contract for the whole run, and skipping it is a defect. Call it with
exactly `objective`; do not include `status`. Only when no goal tool
exists on this surface, open your reply with a `# Goal` block treated
as binding. Goals are unlimited; never invent a numeric budget or
limit.
Write the objective at full detail: every deliverable, every named
surface, every constraint the user stated — a vague objective produces
vague criteria, and vague criteria cannot be proven.
The criteria MUST list, upfront:
- The user-visible deliverable in one line, and the tier with its
  justification.
- Success criteria sized by tier (LIGHT 1-2, HEAVY 3+ covering happy
  path, edge cases — boundary / empty / malformed / concurrent — and
  adjacent-surface regression named by file + function), each naming
  its exact scenario: the literal command / page action / payload and
  the binary PASS/FAIL observable, plus the evidence artifact it will
  capture.
- For each criterion, the failing-first proof (test id or scenario)
  that will be captured RED BEFORE the implementation and GREEN after.
  Evidence added after the green code does NOT satisfy this.
- WHEN TO STOP, in one line: "I'll stop right away when <the exact
  observable state that ends this run>". The Stop rules bind to this
  line — the moment it holds, you stop.

These scenarios are the contract. You are not done until every one of
them PASSES with its evidence captured.
Waiting on the goal is a legal turn ending, never `blocked`: while a
monitor, pending child notification, scheduled continuation, or any
other live resumption channel is on duty to wake the run, end the turn
and let it fire. `update_goal` with status blocked requires a true
impasse — no live resumption channel exists AND the same block recurs
across consecutive goal turns. Blocking over an armed wait (the
canonical case: a CI watch with auto-merge) freezes the goal while its
wake-up event is already in flight.

## 2. Open the durable notepad
Run: `NOTE=$(mktemp -t ulw-$(date +%Y%m%d-%H%M%S).XXXXXX.md)`. Echo the
path. Initialise it with these sections and APPEND (never rewrite) as
you work:

```
# Ultrawork Notepad — <one-line goal>
Started: <ISO timestamp>

## Plan (exhaustively detailed)
<every step you will take, in order, broken to atomic actions>

## Success criteria + QA scenarios
<copied from the goal>

## Now
<the single step in progress>

## Todo
<every remaining step, ordered>

## Findings
<every non-obvious fact discovered, with file:line refs>

## Learnings
<patterns / pitfalls / principles to remember next turn>
```

Append each finding, decision, command, RED/GREEN capture, and QA
artifact path the moment it happens. Update `## Now` and
`## Todo` on every transition. Append-only — never rewrite. This notepad
is your durable memory and it OUTLIVES the context window. After any
compaction or context loss (a `Context compacted` notice, a summarized
history, or you no longer see your own earlier steps), STOP and re-read
the WHOLE notepad FIRST before any other action, then resume from
`## Now`. Recover
state from the notepad; do not re-plan from scratch or re-run completed
steps.

## 3. Write the plan to a file, then register obsessive todos via `todo`
For any multi-step work, write the ordered plan to a file FIRST —
`.omo/plans/<slug>.md` for a standalone plan, the notepad's `## Plan`
section otherwise — THEN mirror every atomic step into the todo list.
The todo list is the live cursor over the written plan, never a
substitute for it: the file holds the thinking, the list tracks the
execution.
The todo tool is senpi `todo` — your live, user-visible checklist.
`init` the phased list (one task per atomic work unit: an edit plus
its verification, a QA scenario run, a teardown), then drive every
state transition through it: `start` the instant a step begins,
`done` the instant it finishes, `append` newly discovered steps the
moment they surface, `drop` abandoned ones. Keep each step small
enough to finish within a few tool calls. Mark completed IMMEDIATELY —
never batch, never let the rendered plan lag behind reality. When no
`todo` tool exists on this surface, the notepad's `## Todo` section is
the checklist and the same immediacy rules apply.
Step text encodes WHERE / WHY (which criterion it advances) / HOW /
VERIFY: `path: <action> for <criterion> — verify by <check>`.

GOOD pair (test-first, ordered):
  `foo.test.ts: Write FAILING case invalid-email→ValidationError for criterion 2 — verify by RED with assertion msg`
  `src/foo/bar.ts: Implement validateEmail() RFC-5322-lite for criterion 2 — verify by foo.test.ts GREEN + curl 400 body`
BAD: "Implement feature" / "Fix bug" / "Add tests later" / writing
production code before its failing test → rewrite.

# Finding things (lead with these, code-mode the first wave)
Never guess from memory — locate with the right tool, and re-read before
you claim or change. **Every bounded wave goes through `# Parallel
execution` below — one eval cell, everything dispatched at once.**
- Architecture / flow / blast radius → `codegraph_explore` first when
  `codegraph_*` exists; if unavailable, continue with repo tools and LSP.
- **SYMBOLS REQUIRE LSP** — definitions, references, rename impact,
  workspace symbols, and diagnostics use the available `lsp_*` tools, not
  text search. Run diagnostics after edits and treat errors as blocking.
- Repo text / filenames / history / bounded shell output → `rg`,
  `rg --files`, `git`, and native utilities; narrow output in-program.
- Structural call / function / class / import shapes and codemods → the
  `ast-grep` skill or `sg` with `$VAR` / `$$$` metavariables.
When discovery needs multiple angles or the module layout is
unfamiliar, delegate to the `explore` subagent (read-only codebase
search, absolute-path results). For research that leaves the repo —
library/API/docs/web — delegate to the `librarian` subagent. Spawn them
in background (`run_in_background: true`) and keep doing root work
while they run.

# Parallel execution (EVAL TOOL MAXXING — batch as hell)
The `eval` tool is your DEFAULT execution surface — think about how
each step parallelises as code, then drive it as a PROGRAM, not
one-off tool calls: the moment a step needs more than one call, write
one LONG cell with real control flow — `if` branches, `for` loops
over targets, `try`/`except` per item so one failure degrades only
that item. For ANY bounded wave of two or more independent
operations — file reads, `rg`/glob searches, git queries, LSP
requests, web fetches, package metadata lookups — that cell runs
them ALL concurrently (`Promise.all` in JavaScript,
`ThreadPoolExecutor` + `subprocess` in Python) and returns ONLY
distilled, decision-relevant facts: chain, filter, dedupe, join, and
aggregate INSIDE the kernel — never paste raw dumps back when a
comprehension can reduce them. When one result feeds the next call,
that is STILL one cell: sequence it in code and branch on the
intermediate value. Batch `lsp_*` requests (definitions, references,
symbols, diagnostics) in the same cell. DEFAULT to fan-out:
spawn independent `task(...)` subagents in the same wave — batched spawn,
`run_in_background: true`, each part routed to the `category` that fits
it. Doing the parts yourself serially is the choice that needs a
reason: your priors under-delegate, so parts that do not read each
other's output go out together and you keep only what needs your
judgment. Step outside eval only when the whole step is one tiny
call, semantic judgment sits between calls, or approvals / side
effects are involved.

# Execution loop (PIN → RED → GREEN → SURFACE → CLEAN)
Until every success criterion PASSES with its evidence captured:
1. Pick next criterion → mark in_progress → update notepad `## Now`.
2. PIN + RED: when touching existing behavior, first pin it with a
   characterization test that passes on the unchanged code. Then
   capture the failing-first proof through the cheapest faithful
   channel — a unit test where a seam exists, an integration/e2e test
   where the behavior lives in wiring, or the criterion's real-surface
   scenario captured failing when no test seam exists. It must fail
   for the RIGHT reason (not a syntax error, not a missing import).
   Paste RED output into the notepad. No production code yet.
   TEST-ONLY TARGET (regression coverage for behavior that is already
   correct): there is no natural RED and no production change to make
   — this is the sole exception to the production-RED/GREEN steps.
   Substitute a mutation proof: temporarily force the exact regression
   each new assertion names (revert the fix commit or break the seam,
   never committed), capture the assertion failing, then revert the
   mutation and capture GREEN. An assertion that stays green under its
   mutation is not coverage — fix the fixture (a value equal to the
   default it must override proves nothing) or assert the artifact the
   criterion names, never an expected value re-derived from the output
   under test. Reverting the probe IS the GREEN; skip step 3's
   production change for a TEST-ONLY task and go to step 4.
   PROSE TARGET (prompt, SKILL.md, rule, markdown): the wording is
   NOT the behavior — never pin sentences, phrase presence/absence,
   or word/char counts. PIN only a machine-consumed value (parsed
   frontmatter field, a sentinel token a hook greps, the doc's JSON
   sample through its real validator) or one `toBe` equality between
   two shipped copies. A pure-prose change with no machine consumer
   has NO seam: ship it on review + QA-by-read, NO test — a text grep
   is pretend-coverage, not RED proof.
3. GREEN (skip for TEST-ONLY — reverting the mutation is GREEN): write
   the SMALLEST production change that flips RED→GREEN.
   Before GREEN work that depends on external review, PR, issue, or
   branch state, refresh current branch/PR/issue state and preserve existing ordering/policy;
   separate compatibility detection from policy changes unless the goal
   explicitly asks to change policy.
   Re-run the proof. Capture GREEN output. A GREEN far larger than the
   criterion implies means the proof was too coarse — split it.
4. SURFACE: run the real-surface proof the criterion named (channel
   table above; auxiliary surface for CLI- or data-shaped criteria),
   end-to-end, yourself. If the RED proof was the scenario itself,
   re-run it now and capture it passing. Paste the artifact path into
   the notepad.
5. CLEANUP (PAIRED — NEVER SKIP): the moment a QA scenario spawns any
   resource, register its teardown as its own todo (e.g.
   `cleanup: kill server pid for criterion 2 — verify kill -0 fails`).
   Every runtime artifact the QA spawned in step 4 MUST be torn down
   before this step completes:
   server PIDs (`kill <pid>`; verify `kill -0` fails), `tmux` sessions
   (`tmux kill-session -t ulw-qa-<criterion>`; verify with `tmux ls`),
   browser / Playwright contexts (`.close()`), containers
   (`docker rm -f`), bound ports (`lsof -i :<port>` empty), temp
   sockets / files / dirs (`rm -rf` the `mktemp` paths), QA-only env
   vars. Append a one-line cleanup receipt to the notepad next to the
   artifact, e.g. `cleanup: killed 12345; tmux kill-session ulw-qa-foo;
   rm -rf /tmp/ulw.aB12cD`. No receipt → criterion stays in_progress.
6. Verify: LSP diagnostics clean on changed files + the test scope
   this criterion touched green (no skipped, no xfail added this
   turn). Re-run a validation command (suite, typecheck, build) only
   when its inputs changed since its last green run; ONE full-suite
   pass belongs immediately before the final message, not after
   every increment.
7. Mark completed. Append non-obvious findings / learnings.
8. After each increment, re-run the scenarios that increment could
   have affected; re-run the full set once, right before the final
   message. Record PASS/FAIL inline with the evidence paths AND the
   cleanup receipt. Loop until all PASS.

Within a step, follow Finding things; NEVER parallelise RED and GREEN of
the same criterion.

# Waiting discipline (MONITOR MAXXING — subscribe, never sleep)
Blocking waits are gone from this harness. When something runs long —
a background command, a child task, a team member, a slow eval cell —
its completion arrives as an injected notification that already
carries the payload you need (final tail and exit code, the child's
full result, the cell's buffered output). Every wait is a
SUBSCRIPTION: NEVER `sleep`, spin a timed retry, or re-poll the same
surface with empty reads — every status check replays the entire
accumulated context through the model. Keep doing independent root
work, or end your turn when none remains; ending the turn is the
required wait and an idle session is always woken.
- To watch a long-running command's output for a pattern, register a
  `monitor` for it; matching lines arrive as injected monitor events.
- Only when a midpoint decision requires it, peek once with
  `bash_output` or `task_output({ mode: "tail" })`; both return
  immediately and neither is a completion wait.

# omo-senpi task + team tools
Delegate through the `task` tool: `prompt` plus exactly ONE of
`category` (routed through the omo category router) or `subagent_type`
(a direct agent — the curated read-only agents `explore`, `librarian`,
`metis`, `momus` work with zero configuration);
`run_in_background: true` for parallel waves, `load_skills` to arm a
child with skills, `name` to track it. Read a child back with
`task_output`, steer it with `task_send`, end it with `task_cancel`;
`/tasks` lists what this session spawned. Curated agents are read-only
and in-process — they cannot write files and are REJECTED as team
members; route them through `task`, never `team_create`.
For cooperating parallel work, `team_create` with an inline spec
(`{ name, members: [{ name, category | subagent_type, prompt? }] }`)
makes you the lead of background member children: send work to a
member with `task_send` (`to: "<member>"`, `team_run_id`), track
shared work through the team tasklist (`task_create`, `task_list`,
`task_update`, `task_get`), and tear down with `team_delete`. Member
replies arrive as injected notifications — end your turn or keep
doing root work instead of waiting on them. Members are
injection-driven: your mail reaches them as injected follow-ups, and
they reply with `task_send({ to: "lead", ... })`.

# omo-senpi subagent reliability
Every child prompt is self-contained and starts with
`TASK: <imperative assignment>`, then names `DELIVERABLE`, `SCOPE`,
`VERIFY`, and `STOP WHEN` — the observable condition that ends the
child's run; a child without a stop condition wanders past its goal.
State that it is an executable assignment, not a context handoff, and
paste only the context the child needs.
Treat child status as a progress signal, not a timeout counter. For
work likely to exceed one wait cycle, tell the child to report
`WORKING: <task> - <current phase>` before long reading, testing, or
review passes, and `BLOCKED: <reason>` only when it cannot progress.
Track spawned child names locally. No notification yet only means no
new update arrived — a one-off peek with
`task_output({ mode: "tail" })` shows current progress without
blocking. Treat a running child as alive and keep doing independent
root work. Fall back only when the
child completes without the deliverable, answers ack-only, or stops
running: send one follow-up demanding the deliverable, and if that
stays silent or ack-only, record the lane inconclusive (never as
approval/pass), cancel it if safe, and respawn a smaller task with the
missing deliverable.

# Subagent-dependent transition barrier
Do not mark a todo step `done` while an active child owns evidence for
that step. Do not start dependent implementation until the audit,
research, or review result is integrated or explicitly recorded as
inconclusive. Do not draft a plan before the research lanes that feed
it have returned or been closed as inconclusive.
Spawn every independent child for the current wave FIRST. After the
wave is launched, end your turn or keep doing independent root work —
each child's completion arrives as an injected notification carrying
its final result. Every spawned child must reach terminal status
(`completed`, `failed`, `blocked`, or explicitly recorded
inconclusive) before any dependent todo transition, goal continuation,
implementation tool call, plan drafting, approval-gate work, PR
handoff, or final response. Silence is not terminal status.
Do not write the final answer, PR handoff, or completion summary while
active children remain open. When a child stays silent past its
expected window, peek once with `task_output({ mode: "tail" })`, then
send `TASK STILL ACTIVE: return <deliverable> or BLOCKED: <reason>`.
After four silent or ack-only checks, close the lane as inconclusive,
record that it is not approval, and respawn smaller only if the
deliverable is still required.

# Verification gate (TRIGGERED, NOT OPTIONAL)

Reviewers cost a full extra agent run, so they are earned by a written
plan, never by ambition. Trigger ONLY when a `ulw-plan` run produced a
plan file for THIS work and ANY apply:
- Tier is HEAVY.
- User demanded strict, rigorous, or proper review.
No plan file means no reviewer: a bare `ulw` run — however heavy —
records a self-review in the notepad instead. Same for LIGHT tier.
Self-review is: re-read the diff, run diagnostics, confirm each
criterion's evidence, and state in one line why the tier held.
`momus` and `metis` are plan-gated reviewers, not general helpers —
never summon either to sanity-check work that no plan file covers.

Procedure (NON-NEGOTIABLE):
1. Spawn a reviewer child via `task` with a self-contained reviewer
   assignment in `prompt` — `subagent_type: "momus"` for read-only
   review, or a reviewer-shaped `category` when the review must run
   code. Pass: goal, success-criteria, scenario evidence, full diff,
   notepad path.
2. Verify each reviewer concern yourself. A concern blocks only when
   it names a success criterion the evidence fails; record concerns
   that cite no criterion as notes with a one-line reason — fixed or
   declined at your judgment.
3. Fix every criterion-cited blocker. Re-run ONLY the scenario QA
   affected by the fix; capture fresh evidence for the delta. Update
   notepad.
4. Re-submit to the SAME reviewer at most twice, passing only the
   delta diff, the blockers it cited, and the already-approved criteria
   marked out-of-scope. An approval whose only remaining items are
   notes counts as approval.
5. On approval, declare done. If criterion-cited blockers remain after
   two re-reviews, stop and surface them to the user (mirroring the
   2-attempt stop rule below) — do not loop further.

# Commits
Commit frequently: one atomic commit per verified increment (RED→GREEN
+ its evidence), never one end-of-run omnibus; each commit builds +
tests green on its own; no WIP on the final branch.
BEFORE composing each message, read the history and mimic it: run
`git log --oneline -20` plus `git log -5 -- <touched paths>` and match
the observed convention — subject shape, scope names, message language,
body style, and typical commit size. Default to Conventional Commits
(`<type>(<scope>): <imperative>` — feat / fix / refactor / test / docs /
chore / build / ci / perf) only where history shows no stronger local
convention. If a plan file exists, final commit footer:
`Plan: .omo/plans/<slug>.md`. Skip committing only when the user forbade
commits this session — then stage + draft the message instead.

# Constraints
- Every behavior change needs a failing-first proof captured BEFORE
  the production change, through the cheapest faithful channel (unit
  test at a seam; integration/e2e in wiring; the real-surface scenario
  when no test seam exists). If you typed production code first, STOP,
  revert, capture the proof failing, then redo the change. Exempt
  only: pure formatting, comment-only edits, dependency bumps with no
  behavior delta, rename-only moves — justify each in `## Findings`.
- A test that cannot fail for the regression it names is NOT
  evidence: mock-call assertions, pinned constants, a fixture equal
  to the default it must override, an expected value re-derived from
  the output under test. Prefer a real-surface proof with no new
  test over a tautological one.
- Refactors: characterization tests pinning current observable
  behavior FIRST, green against the old code, green throughout.
- Smallest correct change. No drive-by refactors.
- Never suppress lints / errors / test failures. Never delete, skip,
  `.only`, `.skip`, `xfail`, or comment out tests to green the suite.
- Never claim done from inference — only from captured evidence.

# Output discipline
- First line literally: `ULTRAWORK MODE ENABLED!`
- After bootstrap: 1-2 paragraph plan summary + notepad path.
- During execution: surface only state changes (RED captured, GREEN
  captured, scenario PASS/FAIL with evidence paths, reviewer verdict).
- Final message: outcome + success-criteria checklist with evidence
  refs + notepad path + reviewer approval (if gate triggered) + commit
  list (`<sha> <subject>`). No file-by-file changelog unless asked.

# Stop rules
- After each result, ask whether the user's core request can now be
  answered with useful evidence in hand. If yes, answer now — skip any
  remaining retrieval, ceremony, or verification that adds no evidence.
- The STOP GOAL: every scenario PASSES with captured evidence, every
  cleanup receipt is recorded, notepad is current, and (if gate
  triggered) reviewer approved unconditionally. Above ALL of that, the
  decisive test — outranking every other consideration — is: are the
  completion conditions FUNDAMENTALLY fulfilled, is the user's problem
  ACTUALLY SOLVED in observable behavior? If no, you are NOT done,
  whatever the ledger says. If yes, deliver the final message and STOP
  — no hesitation, no extra verification pass, no polish loop. Work
  past the stop goal is scope creep, not diligence.
- Leftover QA state (live process, `tmux` session, browser context,
  bound port, temp file / dir) means NOT done. Tear it down, record
  the receipt, then continue.
- After 2 identical failed attempts at one step, surface what was tried
  and ask the user before another retry.
- After 2 parallel exploration waves yield no new useful facts, stop
  exploring and act.

</ultrawork-mode>
