# OMO Full Feature Certification Matrix for Oh My Pi and Pi

Date started: 2026-06-11
Date completed: 2026-06-13

This is the living, feature-by-feature certification record for the Oh My OpenAgent adapters running in:

- Oh My Pi: `omp`
- Pi: `pi`

Every runtime workflow uses:

```text
model: xiaomi-mimo/mimo-v2.5-pro
thinking: high
mode: headless text/print
```

`PASS` requires a real harness workflow and inspected evidence. A focused source test alone is recorded as `SOURCE PASS`, which does not certify the user workflow. `BLOCKED` means an external dependency or unavailable service prevented a truthful runtime result.

## Status Legend

| Status | Meaning |
|---|---|
| `PENDING` | Runtime workflow has not run yet |
| `SOURCE PASS` | Focused regression passed, real harness workflow still required |
| `PASS` | Real harness workflow passed and evidence was inspected |
| `FAIL` | Real harness workflow exposed a defect |
| `BLOCKED` | External dependency prevented the workflow |
| `N/A` | Harness intentionally does not provide the feature |

## Adapter Load and Interoperability

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| A01 | Native extension discovery and load | `PASS` | `PASS` | Diagnostic tools called from normal installed runtimes |
| A02 | Diagnostic command/tool registration | `PASS` | `PASS` | `omo_diagnostic` and `omo_pi_diagnostic` |
| A03 | Normal Pi startup with Hermes installed | `N/A` | `PASS` | Hermes owns `skill` and `session_search`; OMO loads without conflicts |
| A04 | OMO restores canonical tools when Hermes is absent | `N/A` | `PASS` | Isolated Pi runs without Hermes loaded and executed OMO-owned `skill` and `session_search`; focused ownership regression also passed |
| A05 | Node/Electron bundle compatibility | `PASS` | `PASS` | Node imported both patched target bundles as executable extension factories, and installed Pi loaded the Node-target bundle through real workflows |

## Tools

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| T01 | `grep` | `PASS` | `PASS` | Found `needle` in isolated `sample.txt` |
| T02 | `glob` | `PASS` | `PASS` | Found isolated `src/math.ts` |
| T03 | `session_list` | `PASS` | `PASS` | Native target JSONL reader listed freshly persisted project sessions |
| T04 | `session_read` | `PASS` | `PASS` | Read fresh session markers from target transcripts |
| T05 | `session_search` | `PASS` | `PASS` | Found fresh session markers; Pi uses Hermes canonical implementation when enabled |
| T06 | `session_info` | `PASS` | `PASS` | Returned IDs, CWD, message counts, model, thinking level, and paths |
| T07 | `skill` discovery and load | `PASS` | `PASS` | Loaded canonical and legacy project skills; Pi uses Hermes canonical implementation when enabled |
| T08 | `background_output` with `task_id` | `PASS` | `PASS` | Real background Sisyphus runs completed after schema fix |
| T09 | `background_output` with `taskId` alias | `PASS` | `PASS` | Deterministic real workflows started a background agent, called `background_output` using camel-case `taskId`, found the task, returned no tool error, and exited 0 |
| T10 | `background_cancel` running task | `PASS` | `PASS` | Cancelled live 90-second Sisyphus child before marker output |
| T11 | `background_cancel` completed/unknown task | `PASS` | `PASS` | Cancelled state observable; unknown ID rejected |
| T12 | `task` foreground named-agent delegation | `PASS` | `PASS` | Sisyphus foreground exact-marker routes passed through `task` |
| T13 | `task` background named-agent delegation | `PASS` | `PASS` | Sisyphus background exact-marker routes completed and were retrieved through `background_output` |
| T14 | `call_omo_agent` foreground named-agent delegation | `PASS` | `PASS` | Sisyphus returned exact foreground markers |
| T15 | `call_omo_agent` background named-agent delegation | `PASS` | `PASS` | Returned `OMP_BACKGROUND_SISYPHUS_OK` and `PI_BACKGROUND_SISYPHUS_OK` |
| T16 | Category delegation through Sisyphus Junior | `PASS` | `PASS` | `task` category `quick` returned exact markers through Sisyphus Junior routing |
| T17 | `task_create` | `PASS` | `PASS` | Created isolated certification tasks |
| T18 | `task_get` | `PASS` | `PASS` | Retrieved created tasks |
| T19 | `task_list` | `PASS` | `PASS` | Completed tasks correctly absent from active list |
| T20 | `task_update` | `PASS` | `PASS` | Updated tasks to `completed` |
| T21 | Task persistence under project `.omo/tasks` | `PASS` | `PASS` | Inspected persisted task JSON files |
| T22 | Hashline `edit` valid anchor | `PASS` | `PASS` | Reused corrected `2#NW` anchor and changed line 2 |
| T23 | Hashline `edit` stale anchor rejection | `PASS` | `PASS` | Both rejected deliberate stale `2#ZZ` and returned context |
| T24 | `look_at` local image | `PASS` | `PASS` | Both identified generated red PNG |
| T25 | `interactive_bash` when tmux is available | `PASS` | `PASS` | Scoped tmux create/display/cleanup lifecycle |
| T26 | Tool error normalization | `PASS` | `PASS` | JSON traces show invalid OMO tool calls as `toolResult.isError: true` after target error-bridge fix |

## LSP, AST-grep, and MCP

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| M01 | `mcp_servers` inventory | `PASS` | `PASS` | Real workflows listed five servers |
| M02 | `lsp_goto_definition` | `PASS` | `PASS` | Resolved call site to declaration |
| M03 | `lsp_find_references` | `PASS` | `PASS` | Found declaration and call site |
| M04 | `lsp_symbols` | `PASS` | `PASS` | Listed function and exported constant |
| M05 | `lsp_diagnostics` | `PASS` | `PASS` | Clean fixture returned no diagnostics |
| M06 | `lsp_prepare_rename` | `PASS` | `PASS` | Returned rename range |
| M07 | `lsp_rename` | `PASS` | `PASS` | Renamed `add` to `sum` across fixture |
| M08 | `ast_grep_search` | `PASS` | `PASS` | Found TypeScript function declaration |
| M09 | `ast_grep_replace` | `PASS` | `PASS` | Applied `result` to `answer` structural rewrite and verified |
| M10 | `skill_mcp` tool operation | `PASS` | `PASS` | Real stdio fixture returned tool markers with JSON-string arguments |
| M11 | `skill_mcp` resource operation | `PASS` | `PASS` | Real stdio fixture returned `RESOURCE_OK` markers |
| M12 | `skill_mcp` prompt operation | `PASS` | `PASS` | Real stdio fixture returned `PROMPT` markers |
| M13 | Skill MCP per-session isolation | `PASS` | `PASS` | Distinct headless sessions returned distinct fixture process instance IDs and left no child processes |
| M14 | Claude-compatible project MCP config discovery | `PASS` | `PASS` | `mcp_servers` reported disposable `cert_project_mcp` with `project` source |
| M15 | Claude-compatible user MCP config discovery | `PASS` | `PASS` | `mcp_servers` reported disposable `cert_user_mcp` with `user` source; fixture removed afterward |

## Agents and Categories

Each named agent must pass foreground and background delegation unless its policy intentionally prevents the requested action.

| ID | Agent/category | Oh My Pi | Pi | Required proof |
|---|---|---:|---:|---|
| G01 | `sisyphus` | `PASS` | `PASS` | Foreground and background exact-marker workflows passed |
| G02 | `hephaestus` | `PASS` | `PASS` | Foreground and background exact-marker routes passed |
| G03 | `prometheus` markdown-only policy | `PASS` | `PASS` | Foreground/background routes and markdown-only mutation policy passed |
| G04 | `atlas` | `PASS` | `PASS` | Foreground and background exact-marker routes passed |
| G05 | `sisyphus-junior` | `PASS` | `PASS` | Foreground and background exact-marker routes passed |
| G06 | `metis` read-only policy | `PASS` | `PASS` | Foreground/background routes and representative read-only mutation rejection passed |
| G07 | `momus` read-only policy | `PASS` | `PASS` | Foreground/background routes and representative read-only mutation rejection passed |
| G08 | `oracle` read-only policy | `PASS` | `PASS` | Foreground/background routes and direct mutation rejection passed |
| G09 | `librarian` read-only policy | `PASS` | `PASS` | Foreground/background routes passed; shared read-only policy was directly verified |
| G10 | `explore` read-only policy | `PASS` | `PASS` | Foreground/background routes passed; shared read-only policy was directly verified |
| G11 | `multimodal-looker` read-only policy | `PASS` | `PASS` | Foreground/background and image routes passed; shared read-only policy was directly verified |
| G12 | Category `visual-engineering` | `PASS` | `PASS` | Exact-marker category delegation |
| G13 | Category `ultrabrain` | `PASS` | `PASS` | Exact-marker category delegation |
| G14 | Category `deep` | `PASS` | `PASS` | Exact-marker category delegation |
| G15 | Category `artistry` | `PASS` | `PASS` | Exact-marker category delegation |
| G16 | Category `quick` | `PASS` | `PASS` | Exact-marker category delegation |
| G17 | Category `unspecified-low` | `PASS` | `PASS` | Exact-marker category delegation |
| G18 | Category `unspecified-high` | `PASS` | `PASS` | Exact-marker category delegation |
| G19 | Category `writing` | `PASS` | `PASS` | Exact-marker category delegation |
| G20 | Unknown agent/category rejection | `PASS` | `PASS` | Useful errors with no fabricated run |

## Intent Modes, Commands, Skills, and Resources

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| R01 | `ultrawork` intent injection | `PASS` | `PASS` | Headless context probes observed `<ultrawork-mode>` with MiMo/high |
| R02 | `search` intent injection | `PASS` | `PASS` | Headless context probes observed `[search-mode]` with MiMo/high |
| R03 | `analyze` intent injection | `PASS` | `PASS` | Headless context probes observed `[analyze-mode]` with MiMo/high |
| R04 | `team` intent injection | `PASS` | `PASS` | Headless context probes observed `[team-mode]` with MiMo/high |
| R05 | Slash command bypasses intent injection | `PASS` | `PASS` | Pi explicit `/omo-slash-probe-search` command dispatched its raw argument marker; a transformed mode-prefixed input would not have matched the registered slash command |
| R06 | Duplicate mode block suppression | `PASS` | `PASS` | Real headless context probes observed one mode block only |
| R07 | `/ralph-loop` | `PASS` | `PASS` | Bounded one-iteration real commands returned the configured `RALPH_OK` completion promise |
| R08 | `/ulw-loop` | `PASS` | `PASS` | Bounded real commands returned the configured `ULW_LOOP_OK` completion promise |
| R09 | `/cancel-ralph` | `PASS` | `PASS` | Real command lifecycle completed on both harnesses after idle-wait fix |
| R10 | `/refactor` | `PASS` | `PASS` | Real command expansion and bounded no-change workflows returned `REFACTOR_COMMAND_OK` |
| R11 | `/start-work` | `PASS` | `PASS` | Real commands read disposable `.omo/plans/cert.md` and returned its `START_WORK_OK` instruction |
| R12 | `/stop-continuation` | `PASS` | `PASS` | Real commands dispatched the stop-continuation instruction and reported inactive continuation state |
| R13 | `/remove-ai-slops` | `PASS` | `PASS` | Real clean-branch command workflows returned `REMOVE_SLOPS_OK` |
| R14 | `/handoff` | `PASS` | `PASS` | Real command workflows produced bounded handoffs containing `HANDOFF_OK` |
| R15 | `/hyperplan` | `PASS` | `PASS` | Real headless `/hyperplan` commands expanded the builtin template, loaded the bundled Hyperplan skill, and completed the full bounded workflow at high thinking |
| R16 | Project `.agents/command` discovery | `PASS` | `PASS` | `/cert-command` substituted harness-specific argument and returned canonical marker |
| R17 | Project `.opencode/command` discovery | `PASS` | `PASS` | `/legacy-command` substituted harness-specific argument and returned legacy marker |
| R18 | Project `.agents/skills` discovery | `PASS` | `PASS` | `skill` loaded `cert-skill` marker |
| R19 | Project `.opencode/skills` discovery | `PASS` | `PASS` | `skill` loaded `legacy-cert-skill` marker |
| R20 | Bundled shared-skill discovery | `PASS` | `PASS` | `skill` loaded bundled `hyperplan` instructions |

## Hooks, Guards, Continuation, and Recovery

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| H01 | Existing-file write guard | `PASS` | `PASS` | Real `write` calls on unread existing files returned `File already exists. Read it first or use edit.` with `isError: true` |
| H02 | Read-then-write allowance | `PASS` | `PASS` | Real `read` then `write` workflows replaced fixture content with `NEW_ALLOWED` |
| H03 | Bash simple-file-read guard | `PASS` | `PASS` | Real `bash` calls using `cat simple.txt` were rejected with the dedicated Read-tool guidance and `isError: true` |
| H04 | Comment checker after mutation | `PASS` | `PASS` | Real writes containing an unnecessary comment appended `COMMENT/DOCSTRING DETECTED` to the tool result after bundled-vendor resolver fix |
| H05 | Background completion follow-up queue | `PASS` | `PASS` | Both completed without active-processing delivery errors |
| H06 | Duplicate completion wake collapse | `PASS` | `PASS` | Real completion-follow-up workflows exited without duplicate turns or active-processing errors; focused concurrent-dispatch regression proved duplicate keys collapse to one prompt |
| H07 | Session compaction continuation | `PASS` | `PASS` | Real manual compaction on each harness emitted `session_compact`, injected the preserved-work continuation as a user turn, completed the follow-up assistant turn, and exited 0 |
| H08 | Oh My Pi auto-compaction continuation | `PASS` | `N/A` | Deterministic high-usage response triggered real OMP threshold compaction; OMP emitted one successful compaction, ran exactly one native developer continuation turn, and exited 0 |
| H09 | Provider fallback after retryable failure | `PASS` | `PASS` | Deterministic local provider fixture returned 429 on the primary and success on the fallback; each harness switched once, emitted one logical native retry, returned `PROVIDER_FIXTURE_SUCCESS`, and exited 0 |
| H10 | Provider fallback does not replay after success | `PASS` | `PASS` | Deterministic success-path fixture received exactly one completion request from each harness with no retry or replay |
| H11 | Context tool-call/result validation | `PASS` | `PASS` | Real tool workflows on both harnesses produced valid tool-call/result pairs and thinking blocks; focused observer test confirmed validation is non-mutating |
| H12 | OpenClaw session-created dispatch | `PASS` | `PASS` | Real command-gateway workflows recorded `session.created` from both harnesses |
| H13 | OpenClaw session-deleted dispatch | `PASS` | `PASS` | Real command-gateway workflows recorded `session.deleted` from both harnesses |

## Team Mode

All Team Mode workflows run with `OMO_TEAM_MODE=1`.

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| E01 | Team tools absent when disabled | `PASS` | `PASS` | With `OMO_TEAM_MODE` unset, real model-visible tool inventories omitted `team_list` and both runs returned `TEAM_LIST_UNAVAILABLE` |
| E02 | `team_create` with eligible members | `PASS` | `PASS` | Created Sisyphus/Atlas teams with worktrees and tmux layouts |
| E03 | `team_create` `name` alias | `PASS` | `PASS` | Real lifecycles used `name` |
| E04 | Hard-rejected member rejection | `PASS` | `PASS` | Oracle creation rejected |
| E05 | Conditional member handling | `PASS` | `PASS` | Hephaestus creation and cleanup passed |
| E06 | `team_list` | `PASS` | `PASS` | Existing active teams listed |
| E07 | `team_status` | `PASS` | `PASS` | Runtime state and rejection metadata inspected |
| E08 | `team_send_message` | `PASS` | `PASS` | Team message persisted during full lifecycle |
| E09 | `team_task_create` | `PASS` | `PASS` | Team task files created |
| E10 | `team_task_get` | `PASS` | `PASS` | Retrieved task ID 1 |
| E11 | `team_task_list` | `PASS` | `PASS` | Listed persisted team task |
| E12 | `team_task_update` | `PASS` | `PASS` | Valid owner and status transitions passed; cross-owner guard also passed |
| E13 | `team_shutdown_request` | `PASS` | `PASS` | Shutdown requests persisted |
| E14 | `team_approve_shutdown` | `PASS` | `PASS` | Approval persisted |
| E15 | `team_reject_shutdown` | `PASS` | `PASS` | Rejection metadata persisted after adapter fix |
| E16 | `team_delete` and state cleanup | `PASS` | `PASS` | New runs remove index, owned tmux session, runtime, and worktree |
| E17 | Team state persistence | `PASS` | `PASS` | Inspected runtime state, task, inbox, and index artifacts |
| E18 | Hyperplan end-to-end Team Mode orchestration | `PASS` | `PASS` | Each installed harness created the lead plus five required category members, ran 15 real target member subprocess turns over three rounds, completed the foreground `plan` alias handoff, requested and approved five shutdowns, deleted the team, and left zero runtime/worktree/tmux residue |

## Installation and Configuration

| ID | Feature | Oh My Pi | Pi | Evidence |
|---|---|---:|---:|---|
| C01 | Source-linked development install | `PASS` | `PASS` | Current live environment |
| C02 | Installer target selection | `PASS` | `PASS` | Public `install-targets --target oh-my-pi|pi|both` linked only the requested disposable-home roots; focused selection regression passed |
| C03 | Fresh isolated install | `PASS` | `PASS` | Fresh disposable-home installs discovered OMO, executed each harness diagnostic tool through a real model/tool/result workflow, returned the fixture success marker, and exited 0 |
| C04 | Project-local extension discovery | `PASS` | `PASS` | Empty-home runs discovered OMO only from project-local `.omp/extensions` and `.pi/extensions`, executed diagnostics, and exited 0 |
| C05 | User-global extension discovery | `PASS` | `PASS` | Current live environment |
| C06 | Configuration reload | `PASS` | `PASS` | Real `/reload-probe` command completed; OMP retained OMO diagnostic execution after reload, and isolated Pi re-ran extension factory, session start, and resource discovery before exiting 0 |
| C07 | Missing optional dependency behavior | `PASS` | `PASS` | Isolated PATH without `tmux` omitted `interactive_bash` while each harness completed a real provider turn and exited 0 |
| C08 | Invalid tool input errors | `PASS` | `PASS` | Missing prompt, unknown category, and missing background ID produced precise harness errors |
| C09 | Child-agent cancellation and cleanup | `PASS` | `PASS` | Deterministic real workflows started long-running child processes, invoked `background_cancel`, observed `Cancelled bg_*`, received SIGTERM in each child, left no live child, and exited 0 |
| C10 | Headless parent exits with running background task | `PASS` | `PASS` | Each headless parent returned its final marker and exited 0 while shutdown cancelled the still-running child; both children observed SIGTERM and left no process residue |

## Defects Found During Certification

| Defect | Status | Fix/evidence |
|---|---|---|
| Pi Hermes conflicts on `skill` and `session_search` | Fixed | OMO yields only duplicate canonical tools when configured Hermes is installed |
| Pi stripped `task_id` from `background_output` and `background_cancel` | Fixed | Explicit JSON schema for `task_id` and `taskId`; real Pi background run passed |
| Background completion injection attempted during active processing | Fixed | Continuations now queue using `deliverAs: "followUp"` |
| Oh My Pi headless model can choose to stop while a task is still running | Observed, feature still passed | Forced retrieval run completed; deliberate parent-exit cleanup test remains |
| Xiaomi emitted malformed split SSE JSON events during Oh My Pi summaries | Fixed in OMP source and live runtime | Xiaomi-scoped incomplete-JSON SSE recovery passed 27 focused stream/provider tests; real MiMo/high turn and previously failing OMP background routes replayed cleanly |
| Target comment-checker silently skipped packaged vendor binary | Fixed | Resolver now checks `vendor/<platform>-<arch>/comment-checker`; focused CLI/guard tests, typecheck, and real OMP/Pi post-write warning workflows passed |
| Concurrent Oh My Pi startup can fail with `SQLiteError: database is locked` | Fixed in OMP source and live runtime | SQLite busy timeout now applies before lock-sensitive schema pragmas; two simultaneous MiMo/high headless workflows exited 0 with distinct markers and no lock error |
| Pi omitted `interactive_bash` despite tmux being installed | Fixed | Availability gate now uses cross-runtime `bunWhich`; real Pi tmux lifecycle passed |
| Background completion after Pi session replacement crashed on stale extension context | Fixed | Notification failures are recorded on tasks and no longer reject the background promise; real parent-exit replay passed |
| Target `team_reject_shutdown` attempted illegal reverse transition | Fixed | Rejection now mirrors core Team behavior and persists rejection metadata |
| Target `team_delete` left index, tmux, and worktree residue | Fixed | Delete now cleans target-owned runtime resources; real fresh-team cleanup passed |
| Oh My Pi headless mode prompts skipped intent injection because `input` is interactive-only | Fixed | `before_agent_start` and immutable `context` fallback now inject headless prompts; all four real mode probes passed on both harnesses |
| Target slash commands dispatched fire-and-forget turns that OMP dropped and Pi could hang on | Fixed | Command handlers now wait through target preflight and agent-idle transitions; `/cancel-ralph` and project commands passed on both |
| Target `session_*` tools read OpenCode storage instead of OMP/Pi JSONL sessions | Fixed | Native target JSONL list/read/search/info tools passed against freshly persisted sessions |
| Pi-family target tools returned error-shaped results as successful tool calls | Fixed | Target error bridge now rejects failed executions; 30 focused tests passed and real OMP/Pi JSON traces show `isError: true` |
| Target `skill_mcp` leaked stdio children and kept Pi headless sessions alive | Fixed | Target operations disconnect their session MCP client in `finally`; real Pi tool/resource/prompt runs exited normally with no child residue |
| Xiaomi nested object arguments caused OMP to heal leaked markup into a nameless tool call | Fixed for target `skill_mcp` | Target schema now requests JSON-string arguments; real OMP/Pi argument-bearing MCP tool calls passed without nameless calls |
| Target provider fallback manually replayed a failed prompt while Pi native retry also replayed it | Fixed | Target fallback now switches models at the failed-turn boundary and leaves replay ownership to the harness; deterministic Pi workflow made one failing request and one successful fallback request |
| Oh My Pi extension model switches could deadlock or lose the pending native retry | Fixed in OMP source and live runtime | Extension model switching now skips duplicate auth/post-switch re-entry while preserving retry state; deterministic fallback reached the replacement provider |
| Oh My Pi print mode disposed before asynchronous `agent_end` retry handling settled | Fixed in OMP source and live runtime | Agent-event tasks are tracked and drained before post-prompt recovery; focused retry regression passed and real OMP fallback returned the recovered response before exit |
| Pi manual compaction dropped the extension-triggered continuation turn | Fixed in Pi source and live runtime | Extension `sendUserMessage` promises propagate and Pi reconnects event handling before `session_compact`; real compaction continuation completed and exited 0 |
| OMO duplicated Oh My Pi's native auto-compaction continuation | Fixed | OMO now suppresses its user-message continuation during OMP native auto-compaction while preserving manual-compaction continuation; focused regression and real threshold workflow produced exactly one follow-up model request |
| `install-targets` exposed no public single-harness selection despite installer-core support | Fixed | Added `--target oh-my-pi|pi|both`; disposable-home installs and focused selection regression passed |
| Target headless shutdown orphaned still-running background-agent child processes | Fixed | Target background manager now cancels every running task on `session_shutdown`; deterministic OMP/Pi parent-exit workflows delivered SIGTERM and left no live child |
| Pi logged a spurious active-processing extension error before queuing a background completion follow-up | Fixed | Background completion dispatch now requests follow-up delivery directly while compaction retains immediate-turn semantics; focused continuation tests and real Pi cancellation replay passed without extension errors |
| Target `team_create` ignored Hyperplan `inline_spec` category rosters | Fixed | Target Team Mode now normalizes and validates inline specs using the core parser, preserves category identities in runtime state, and injects the eligible caller lead |
| Target `skill` tool exposed no packaged skills even though resource discovery found them | Fixed | Target skill execution now merges package/project resource roots; real `/hyperplan` runs loaded the bundled Hyperplan skill with no tool error |
| Target `task(subagent_type="plan")` had no planner alias | Fixed | Target routing maps `plan` to the Prometheus planner policy; both real Hyperplan handoffs returned planner output |
| Target Team Mode messages persisted to inboxes without executing member agents | Fixed | Direct lead-to-member messages now run the routed target subprocess agent, return its response, and persist the reply to the lead inbox; each Hyperplan replay proved 15 member turns plus one planner turn |
