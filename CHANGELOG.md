# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.0-beta.62] - 2026-09-13

### Engine: senpi 2026.9.13

**OMO Native now runs on the fully upstream-synced senpi harness.** senpi merged the upstream engine (earendil-works/pi) across the session and storage layer, the protocol v8 / Chord transport, the fullscreen TUI renderer, the clipboard natives, and the model catalogs, while every fork invariant — CalVer, the CLI, the JSONL RPC surface, the Astra overlays, themes, gist share, and the held dependency pins — survived the merge. The changes below are the ones you can see.

**Extensions can stream model calls.** `ctx.modelRegistry.stream()` and `streamSimple()` let an extension drive a configured provider with resolved authentication, so extension-authored tools talk to models the way the core does.

**Compaction is tunable per model.** `compaction.modelOverrides` adds per-model `reserveTokens` and `keepRecentTokens`, falling back to the ordinary compaction settings; `compaction.model` still picks the summarizer.

**The async ask-user question is reachable without a chord.** Pressing Enter on an empty editor or running `/answer` opens the pending question when a terminal, multiplexer, or rival keymap swallows the shortcut, and the shortcut itself is now the rebindable `app.question.answer` keybinding (default `alt+a`, `option+a` on macOS) listed in `/hotkeys`. The widget above the editor now shows the pending question and its options inline.

**Built-in tools sample against their schemas by default.** `read`, `bash`, `powershell`, `edit`, and `write` now use strict-prefer JSON-schema sampling without the experimental flag; an extension can opt a tool out with `constrainedSampling: false`.

**Fullscreen transcript polish.** Hold Alt to scroll the wheel five times faster, click "Jump to latest message" (or the `tui.altScreen.bottom` shortcut) to return to the bottom, and search stays fast on large transcripts through cached results and visible-only highlighting.

**Retries stay responsive.** Agent-level retry backoff is capped at `retry.maxAgentDelayMs` (60s by default) so a long transient outage no longer stalls behind an ever-growing delay; the retry profiles and jitter still shape the wait under that ceiling.

**Direct RPC steering runs the full input path.** `steer` and `follow_up` over the stdio RPC now go through extension `input` handlers and skill/template expansion instead of bypassing them.

**Devin SWE-2 effort variants route correctly.** `swe-2-high`, `swe-2-max`, `swe-2-low`, and `swe-2-high-lite` resolve to the Kimi K3 preset.

**Trusted Notification hooks.** Builtin hooks v1 gained a `Notification` event for ask-user question settlements (answer or timeout), so a user-defined trusted command can fire a desktop or mobile push on `ask-user-timeout` while hooks are enabled.

**A batch of upstream correctness fixes.** No more premature missing-model errors after login (the catalog is awaited first), extension tools without a parameter schema are rejected at registration instead of breaking requests, OpenAI Codex SSE terminal events without a trailing blank line now parse, skills stay available when Bash is the only enabled tool, image EXIF orientation survives non-EXIF APP1 segments, imported sessions no longer overwrite a same-named session, session forks keep their compaction boundary, and managed `fd`/ripgrep downloads work on musl Linux and without the GitHub Releases API.

## [5.0.0-beta.60] - 2026-09-12

### Engine: senpi 2026.9.12-2

**Cursor keeps the whole conversation.** Admission used to enforce a fixed 50 KB aggregate budget on every Cursor request and delete the oldest whole turns when blanking tool results was not enough: a conversation with zero tool calls could lose its first turn, and a nominal 1M-token window was reduced to roughly 6K tokens of retained history. Admission now caps each tool result, blanks the oldest tool bodies if the model input still exceeds the effective window, and never deletes a turn. The effective window follows the ceiling Cursor itself reports for the model on every conversation checkpoint — recorded per model id, persisted across restarts, and applied to context usage and compaction thresholds — with the committed capability table as the bootstrap. An oversized history is admitted, logged, and answered by overflow compaction instead of being silently shortened (senpi #1603, #1624).

**Long-lived RPC hosts never starve session spawns.** A worker's 64 session-write grants counted every path it had ever been granted for the life of the worker, so after about 40-60 turns of helper sessions, forks and switches every sub-agent, task and workflow spawn inside one conversation died permanently with `session_path_in_use`. Grants now track writers that are still alive: the worker reports its live session-write paths on every snapshot, the host releases superseded grants, an explicit open no longer burns a phantom grant on a path that is never created, and a genuinely exhausted budget reports the distinct `session_reservation_limit` instead of a path conflict (senpi #1612, #1622).

**The async ask-user shortcut works in default macOS terminals.** Terminals that let Option compose characters (Terminal.app, iTerm2, Ghostty, kitty) deliver `option+a` as `å`, so the advertised `option+a` expansion did nothing there; on macOS the composed glyph now expands the pending question too, `alt+a` keeps working everywhere, and other platforms keep treating those glyphs as text (senpi #1620, #1621).

### Agent toolkit

**The toolkit SDK is typed.** Workflow and task code drive the toolkit through a typed ULW SDK with an in-process Native adapter instead of stringly command shapes, and the toolkit is exposed as a typed tool; the packed plugin pins the lazy toolkit runtime with a deterministic no-spawn proof (#8172).

**The plugin installer knows the toolkit bundle.** The required-artifact manifest lists the new lazy toolkit bundle, so a fresh local install no longer misses it.

### Breaking

**The retired `metis` / `momus` agent ids are gone.** Their one-release read alias shipped in 5.0.0-beta.51 and is now removed: `omo.json` `agents.metis` / `agents.momus` no longer resolve to `plan-consultant` / `plan-reviewer` (such a key now defines an ordinary custom agent under that name and emits no startup notice), `subagent_type: "metis"|"momus"`, `allowed_subagents` entries, team members, and workflow node routes are all taken verbatim, and the deprecation notices that named them are gone. Rename them to `plan-consultant` / `plan-reviewer`.

## [5.0.0-beta.56] - 2026-09-12

Devin chats again, and the resident Kibitzer is now the only recall path.

### Devin

**Every Devin turn used to fail with `HTTP 404: {"detail":"Not Found"}` right after a successful login.** The OAuth flow handed the engine the login host, and the engine overlaid that host onto the model, so the Cascade chat call was posted to the REST API instead of the model server. The token now stays with the login flow and chat goes where the model says.

**Behind the 404 sat six more layers, all fixed together.** A Devin turn now runs the way the released Devin CLI runs it: the account's user JWT is minted through `GetUserJwt` before every turn and carried on the correct protobuf field (it was serialized as a team override), the API host that call names replaces the seeded one when the account is provisioned elsewhere, the request presents the released CLI identity instead of a dev-channel one, conversation, execution and message ids are UUID-shaped, and the completion configuration matches the CLI's — including a clamp for a temperature of exactly zero, which Cascade rejects with an opaque `invalid_argument`.

**Tool calls execute.** Cascade sends a tool call's id only on its first argument chunk; later chunks were opened as separate nameless calls, so file reads, shell commands and edits never ran even when text streamed. Chunks now merge into one call whose arguments accumulate across frames.

**Rejections are visible.** A Connect error trailer (`invalid_argument`, `permission_denied`) ended the turn as an empty success; it now ends as an error carrying the server's code and message.

**Models and routing.** Discovery speaks the CLI's dev-channel identity as a bare-protobuf unary call (the streaming frame it sent before was answered 415), reads the account's context window, output cap, cost and image support from the catalog, and marks server-side routers. A router such as `adaptive` is resolved through `AssignModel` before the turn. The bundled seed lists the plan-available SWE-2 effort lanes — `swe-2-high` first, then `swe-2-max`, `swe-2-low`, `swe-2-high-lite` — beside SWE-1.6; the bare `swe-2` uid, which Cascade rejects, is gone. Images attached to a prompt or returned by a tool travel inline.

### Memory

**The resident Kibitzer is the live path, and the one-shot judge is gone.** Recall runs as one read-only sidecar per main session, created on that session's first hook. Wakes are admitted through a machine-wide counting lease (two slots by default) with dead-owner recovery, bounded by the configured tool budget, token cap and event caps; a hook event captured while the child was still starting is no longer dropped at the seed boundary. The one-shot runner, its per-run artifacts and the compaction-epoch bookkeeping are removed end to end; a stored pending-nudges file that still carries the old field is consumed normally.

**Wakes are observable and bounded on disk.** Every settled wake appends one redacted, size-capped line to `wakes.ndjson` next to the sidecar transcript — status, cause, model, cursor span, tool calls, duration, slot wait, token usage and nudged paths. Three consecutive diagnostic failures emit exactly one gate notice; any normal settlement resets the streak. Sidecar directories idle for seven days are pruned unless a live process owns them.

### Windows

**Process identity and teardown.** The process start-identity probe gained a Windows branch, so wake-lock and recall-lock recovery no longer treat every Windows process as unidentifiable, and test teardown retries the file-lock errors Windows raises (`EBUSY`, `EPERM`, `ENOTEMPTY`). The changelog path embedded in the local launcher is normalized to forward slashes so the brand identity check passes on Windows.

### Engine: senpi 2026.9.12

The Devin fixes above live in the engine and ship with this release.

## [5.0.0-beta.55] - 2026-09-11

OmO Native stops greeting you with its entire history, and memory gains a resident Kibitzer.

### Startup

**The changelog no longer replays itself on every launch.** The engine compared the version it was told it was running against changelog headings written in a different version space, so nothing ever matched and every start re-rendered the whole history. Version tokens are now preserved in full, calendar versions order correctly across hotfixes, and entries are selected only above what you last saw and no newer than what you are running. Comparisons across unrelated version spaces are refused rather than guessed, so a development build and a released engine can never be ordered against each other.

**OmO Native shows its own release notes.** The product ships its own changelog in the npm and compiled payloads, and every launcher hands that source to the engine. Development builds deliberately carry no version, so they stay silent. Branded installs no longer report to the upstream engine's install endpoint.

### Memory

**A resident Kibitzer.** Recall now runs as a bounded resident sidecar with its own prompt contract, read-only tools, an event stream, and a wake lock, instead of paying full startup on every fire. Automatic reflection backs off after repeated failures rather than retrying into the same error.

### Releases

**Release notes are written before the release, not after.** The notes you are reading were authored under `[Unreleased]` and stamped into this section when the release state was prepared, so the published commit carries them. The GitHub release body is extracted from that exact section and fails closed: an absent, empty, or duplicated section aborts the release instead of publishing blank notes.

### Engine: senpi 2026.9.11

The changelog selection fix above lives in the engine and ships with this release. Also included: a cold-start fix for the RPC host, a goal-contract correction so a harness goal advises the loop instead of gating it, and Windows fixes for thread-socket discovery and a DAG race.


## [5.0.0-beta.1] - 2026-08-09

- 13db09a1a Merge pull request #6676 from code-yeongyu/release/v5.0.0-beta.1-source-state
- 1e6669c6a Merge pull request #6675 from code-yeongyu/fix/reflection-child-pty-pipe
- b836400d4 fix(omo-native): report posix artifact paths and normalize windows fixtures
- 82220eb2e test(memory-core): windows-safe assertions (LF fixtures attr, drive-qualified paths, git-canonical hooks dir, win32 lock fail-close pin)
- adb0767a0 Merge pull request #6674 from code-yeongyu/feat/memory-letta-parity
- 938e02319 fix(omo-native): drive the setup consent prompt on a portable pty
- 55148baec fix(omo-native): restore const declarations in the sqlite-gated suites
- b5b7574b3 fix(omo-native): keep the setup suites runnable without node:sqlite
- 79c1ac72d Merge pull request #6671 from code-yeongyu/feat/omo-ai-beta-release
- da73c5d10 fix(script): align repo audits with the omo-ai payload surfaces
- 5bd7bfb2f test(qa): isolated install smoke with mock-provider plugin-load proof
- 16782bad4 feat(omo-native): consent-gated credential inheritance for omo setup
- da17ab19a feat(omo-native): staged plugin payload build with completeness gate
- 12e6b1d6b ci(publish): beta-only OIDC omo-ai publish with dist-tag guard and live verification
- b22c225bc feat(omo-native): omo setup detection for sibling coding-agent stores
- c2e102151 test(omo-native): pin the published package contract
- cd969ebc4 fix(script): register omo-native in the package audit taxonomy
- 9e5702ab3 docs(release): omo-ai beta channel runbook and install docs
- 46f40b0e3 ci(publish): omo-ai tarball payload whitelist verifier
- 70e0f5032 Merge pull request #6667 from code-yeongyu/feat/omo-agent-toolkit-rename
- 791f560f4 test(audit): give the tracked-source scan a real time budget
- 461d0cd9d fix(skills): finish the half-migrated ulw-loop resolver and widen the audit
- 0018c0687 docs(evidence): record the aggregate install-smoke and gate results
- d8d30e94d build(codex): regenerate the installer bundle for the symlink reclamation fix
- 0f123c15e fix(cli): close the rename gaps the verification wave found
- e72f94bd2 refactor(prompts): migrate remaining agent commands to omo-agent-toolkit with an audit gate
- 89f09c90c feat(codex)!: rename runtime wrapper to omo-agent-toolkit and remove legacy omo
- 5e0323896 refactor(skills): migrate skill sources to omo-agent-toolkit commands
- 9de47ad28 docs(release)!: document the omo-agent-toolkit rename and omo removal
- 8b4ab463a refactor(prompts): migrate ulw-loop continuation and CLI help strings to omo-agent-toolkit
- 4abd085af feat(cli)!: rename omo bin to omo-agent-toolkit
- bfd445cae Merge pull request #6664 from code-yeongyu/docs/light-readme-logo
- 8e366c225 Merge pull request #6661 from code-yeongyu/code-yeongyu/cache-hit-wake-source
- 5c977be07 docs(readme): replace rock logo with light mark
- 8b33ac959 Merge pull request #6662 from code-yeongyu/feat/ub-surrogate-tier
- f13bcbb17 feat(skills): monitor every dispatched subagent to its completion condition
- 40151449d docs(skills): require provenance in cited research claims
- 04b3e5f5d docs(shared-skills): correct archive/reader guidance from live probes
- 50d03b419 chore(shared-skills): route WAF profiles through the surrogate step
- ea9aee36e feat(shared-skills): add Phase 2.5 surrogate retrieval to the fetch chain
- ef81f68a9 feat(shared-skills): reject surrogate dead ends and label fetch provenance
- 22526d44d Merge pull request #6659 from code-yeongyu/feature/fallback-architect-runtime-gate
- 7d2e622d2 Merge pull request #6660 from code-yeongyu/code-yeongyu/docs-drift-audit
- acba42e44 docs: sync user-facing docs with current code across 17 files
- b76764a23 Merge pull request #6658 from code-yeongyu/code-yeongyu/fix-doctor-deprecated-key-scan
- ac85d1f3c fix(omo-opencode): stop doctor re-flagging provider_options passthrough
- 778279535 Merge pull request #6500 from MoerAI/fix/start-work-external-blocker
- dab01f20d Merge pull request #6485 from MoerAI/fix/oracle-claude-temperature-6338
- b06be3b50 Merge pull request #6395 from MoerAI/fix/6376-shared-skills-root-path
- 8340a05dc Merge pull request #6375 from MoerAI/fix/6141-hephaestus-bedrock-model-id
- 2b6c729f1 Merge pull request #6569 from MoerAI/fix/6320-uninstall-bin-links
- 76b9aa8d3 Merge pull request #6647 from code-yeongyu/feat/ulw-research-latex
- 4655571ec feat(skills): add a LaTeX final-materials route to ulw-research
- a5cdb6ac0 Merge pull request #6645 from code-yeongyu/fix/ulw-research-design-spec
- fcfbc7f0c fix(codex): track the reworded ulw-research delivery gates in the sync overlay
- 7e7db9bc0 fix(skills): bind ulw-research report assets to a design-spec contract
- fd79bf49b Merge pull request #6632 from code-yeongyu/code-yeongyu/init-deep-agents-md-refresh
- afebde982 docs(agents-md): refresh knowledge base to v4.19.4 snapshot (init-deep update pass)
- 51ab1e5b6 Merge pull request #6630 from code-yeongyu/fix/ci-failing-tests
- aa3a16dea Merge pull request #6629 from code-yeongyu/feat/momus-one-shot-plan-review
- 77e469797 Merge pull request #6629 from code-yeongyu/feat/momus-one-shot-plan-review
- db0e19b22 merge: sync dev into feat/momus-one-shot-plan-review (regenerate extension bundle)
- d872b0ef9 Merge pull request #6628 from code-yeongyu/chore/bump-skills-deps-20260807
- e483826a5 chore(skills): bump pinned dep versions across ultimate-browsing + ast-grep
- 554236b1b fix(omo-config-core): index dynamic task settings
- 4fabb3ede Merge pull request #6623 from Tinycute00/fix/ast-grep-scan-grok-object-oneof-20260806220324
- 222162698 fix(ast-grep-mcp): make scan oneOf branches object-typed
- 69a1855e6 Merge pull request #5638 from Hungdoan565/codex/test-boulder-plan-progress-20260627
- 63e2c7f66 Merge pull request #5659 from JSap0914/fix/ulw-title-injection-order-5586
- 987a74180 Merge pull request #5672 from Hungdoan565/codex/fix-5300-glm-max-reasoning-20260628
- 9ffcab37f Merge pull request #6583 from ThunderRonin/fix/prompt-async-gate-path-compat-undefined
- 7801ff35e Merge pull request #6550 from berkshirehathaways/codex/fix-flag-prefixed-installer-command
- 6f29c4f21 Merge pull request #6591 from Atmospenguin/fix/goal-slash-objective
- cbee00743 Merge pull request #6617 from scw1109/fix/build-time-reasoning-to-variant-lowering
- 0133893ff Merge pull request #6545 from berkshirehathaways/codex/fix-bootstrap-invalid-only
- 077be21d3 Merge pull request #6463 from niStee/fix/github-actions-repository-guards
- 526b4a059 Merge pull request #6465 from niStee/chore/workflow-permissions-hardening
- 67711137d Merge pull request #6301 from gdaegeun539/fix/lsp-initialized-param
- ad652683a Merge pull request #6342 from WhiteGiverMa/fix/test-env-password-isolation
- 2fbdeb629 Merge pull request #6122 from cyllas/fix-websearch-tool-name
- 630bfca59 Merge pull request #6481 from eadbcf/patch-1
- fc107113a fix(omo-opencode): lower canonical reasoning to variant at agent config build time
- 74dd740e0 Merge remote-tracking branch 'origin/dev' into fix/6320-uninstall-bin-links
- d2c0874e4 Merge remote-tracking branch 'origin/dev' into fix/start-work-external-blocker
- 0ce3f1216 Merge remote-tracking branch 'origin/dev' into fix/6376-shared-skills-root-path
- 42b38b1e2 Merge remote-tracking branch 'origin/dev' into manage/pr-6375
- 643b5976b fix(model-core): canonicalize suffixed aliases
- 4fcd53e99 fix(model-core): preserve canonical alias snapshots
- 9673333c6 Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
- 0da12bf1c fix(model-core): prefer provider snapshot entries
- c235b2ac2 fix(model-core): resolve suffixed snapshot IDs
- aa4b9961c fix(model-core): resolve prefixed capability IDs
- 40265f7a9 fix(model-core): preserve deep-research temperature
- 4ca872b57 Merge pull request #6610 from code-yeongyu/fix/continuation-stop-on-unrecoverable-error
- 1d1249035 docs(evidence): note the two dispatch paths added during review
- c922bd53f fix(todo-continuation-enforcer): keep the stop flag across split internal messages
- 62c961648 fix(todo-continuation-enforcer): stop on a non-retryable direct dispatch failure
- 0b93ee1c7 fix(todo-continuation-enforcer): wire the unrecoverable-error stop flag
- 3267e2983 docs(evidence): record continuation fail-safe QA
- f210cb831 fix(todo-continuation-enforcer): stop re-injecting after a non-retryable request error
- 6984f3128 fix(shared-skills): record complete Codex QA evidence
- 302c5eaec Merge pull request #6607 from code-yeongyu/fix/tool-pair-validator-real-part-model
- f03dcd026 docs(evidence): scope the failing-first run to the conversion gate
- 0bbef82fe docs(evidence): re-capture opencode QA with the user home isolated
- c47dd1fec test(shared-skills): prove the installed marketplace wrapper resolves ast-grep
- 937b42084 docs(evidence): capture the real failing-first output
- 4d6c8052c docs(evidence): record tool-pair-validator real-part QA
- cd6478569 test(messages-transform): assert tool-pair repair with real tool parts
- 3873af48d test(tool-pair-validator): gate repairs on the conversion invariant
- 5f576e6e9 fix(tool-pair-validator): operate on OpenCode's real Part model
- a5316f6bf fix(start-work): keep the Codex stop contract out of other harnesses
- 10098b7cf fix(omo-codex): detect a stale committed installer bundle
- 19abf74fe Merge pull request #6603 from code-yeongyu/improve/ulw-fanout-categories
- aa1469c3f Merge pull request #6602 from code-yeongyu/fix/config-migration-model-chains
- 989636bc5 fix(omo-opencode): accept migrated agent model chains
- b33a4250f Merge pull request #6594 from code-yeongyu/fix/ultrawork-once-per-session
- e2b0102aa Merge remote-tracking branch 'origin/dev' into fix/ultrawork-once-per-session
- bbd1c74a4 Merge pull request #6597 from code-yeongyu/feat/subagent-session-resume-revival
- 2f2634052 Merge origin/dev into fix/ultrawork-once-per-session
- c5f860433 Merge remote-tracking branch 'origin/dev' into feat/subagent-session-resume-revival
- fa61dd871 style: remove em-dash comment and empty catch from F2 review
- 9cee074da Merge pull request #6588 from 1vivy/fix/monitor-terminal-parent-wake
- 0788a4414 Merge pull request #6595 from code-yeongyu/fix/6574-exdev-migration
- 27c9e28ca test(omo-opencode): record EXDEV migration evidence
- 9d2abc9d4 fix(omo-opencode): warn when config migration fails
- f8db79608 fix(omo-opencode): handle cross-device migration backups
- 27138a7ab fix(omo-opencode): force only terminal batches over the monitor defer ceiling
- 9ca64eab9 docs(qa): record authentic user-session reproduction of 'got undefined' dispatch failure
- c6cf711ce fix(shared-skills): resolve the skills directory in the Codex marketplace layout
- 454f0bfa4 docs: suspend/revive lifecycle and resume_children documentation
- a3af6c96d fix(model-core): resolve provider metadata for reasoning-suffixed model ids
- c5b121518 Merge pull request #6537 from Hungdoan565/fix/6489-bug-report-opencode-version
- 1d6f9eba9 Merge pull request #6466 from niStee/dependabot/npm_and_yarn/packages/web/next-15.5.21
- 38f80a4d2 Merge pull request #6297 from leeyazhou/fix-tmux
- b906e7ef0 Merge pull request #6227 from H-TTTTT/fix/lsp-mcp-cwd
- 7f186480a Merge pull request #6225 from H-TTTTT/fix/session-search-sort
- 6d56a9120 fix(omo-opencode): ignore expanded skills in goal fallback
- 36274751b Merge pull request #6314 from code-yeongyu/fix/issue-6313-upstream-fallback
- 0f5bec113 Merge pull request #6467 from niStee/fix/hashline-test-multi-model-syntax
- af3b22c47 feat(omo-config-core): task.resume_children opt-out key (default on)
- 36f3ebcb6 Merge pull request #6590 from code-yeongyu/fix/team-create-inline-precedence
- f63fa583e fix(evidence): read the same database for both session counts in the #6376 driver
- 09547db5d fix(start-work): require a stated blocker before the marker ends the turn
- 0da7458f7 test(omo-opencode): record monitor terminal wake QA evidence
- c7cd882cc fix(omo-opencode): wake parent on monitor terminal output
- d1fffa14c fix(start-work): teach the initial skill the external-blocker marker, and harden its QA
- 4ee7c7131 fix(omo-codex): keep uninstall able to find the bins it installed
- f2e79e578 test(utils): make sg probe-contract assertions Windows-aware
- 975245983 fix(model-core): infer temperature support from model family when metadata is silent
- 8f8b0deee Merge pull request #6585 from code-yeongyu/fix/lsp-daemon-stale-node-path
- 07e639c54 test(ast-grep-mcp): make runner process fixtures cross-platform
- 23f965837 fix(lsp-daemon): recover from stale Node executable
- 3f8b1ed5a docs(qa): add real OpenCode harness evidence for path-compat fix
- e1a769fc1 docs(qa): record QA evidence for prompt-async-gate path-compat fix
- 938d35003 fix(utils): support 'got undefined' error in prompt path compatibility retry
- 4fca987ee test(omo-codex): drive the installed uninstaller and record why it cannot run
- f39f1b0c3 fix(omo-codex): remove legacy-marketplace bins on uninstall
- 9fdb65b6d test(shared-skills): fail the drivers on unexercised probes and unreadable counts
- b39f1e6e0 test(shared-skills): make the evidence driver fail and add the OpenCode case
- c024911d4 test(omo-codex): cover a user-owned bin under an installer name
- d6ea16e31 test(omo-codex): record the Codex compatibility gate on Linux
- 07a5e5d4b fix(omo-codex): scope uninstall bin removal to installer bin names
- 7cfe8862e fix(ast-grep-mcp): enforce aggregate payload cap and async test discipline
- 55ea9490b Merge pull request #6570 from code-yeongyu/fix/ulw-test-proportionality
- 4ebfcc840 chore(ast-grep-mcp): complete package registration and regenerate packed bundles
- aaf2a02e7 fix(ultrawork): proportion test mandates to code seams across injected prompts
- dd5048efe feat(ast-grep-mcp): stdio MCP server on mcp-stdio-core
- 12be076fd fix(omo-codex): remove installer bin links on uninstall
- a174404f9 feat(ast-grep-mcp): scan tool with explicit-source YAML rules
- 680a5471a feat(ast-grep-mcp): search tool with normalized NDJSON results
- 7ebf6283a feat(ast-grep-mcp): rewrite tool with two-pass apply safety
- 24f42d53b feat(ast-grep-mcp): bounded NDJSON sg runner with salvage and normalization
- 2410fa810 feat(ast-grep-mcp): pattern-hint validation and metavariable preflight
- 52a86ec50 feat(utils): five-tier ast-grep sg binary resolution with strict probe contract
- c930964d4 feat(ast-grep-mcp): scaffold stdio MCP package and workspace wiring
- fce80d9c0 Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
- e4a3ddc61 test(codex): enforce the Stop hook in the live app-server QA
- 0e8659e04 Merge remote-tracking branch 'upstream/dev' into fix/start-work-external-blocker
- b4156b579 Merge pull request #6553 from code-yeongyu/feat/skill-routing-parallelism-prompts
- 3bf4d682c docs(evidence): drop the maintainer-local absolute path from the QA note
- 58fd101be docs(evidence): record cache hit rate QA
- da90d7963 docs(evidence): record skill routing QA evidence
- 7ecfb8a48 feat(skills): require a recommended task executor category per ulw-plan todo
- 6ac5eb0a6 feat(skills): add a delegation router and parallel delivery lanes to start-work
- e67c528fe Keep flag-prefixed LazyCodex maintenance commands on the Node installer path
- 641981b0f chore(deps): bump next from 15.5.18 to 15.5.21 in /packages/web
- 50540275b fix(codex): reject unknown bootstrap step filters
- b8b58f248 docs(evidence): record QA for issue-template version bump
- e243389cd docs(issue-template): update stale OpenCode version placeholder (fixes #6489)
- 400661aba fix(codex): allow blockers after ultrawork opener
- 896e9460b Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
- 27be3651c Merge remote-tracking branch 'upstream/dev' into fix/start-work-external-blocker
- d9337779e test(codex): record live app-server QA
- 4c9dd3ea3 fix(model-core): honor explicit temperature support
- 2e856c1ca fix(codex-start-work): let a conclusive external blocker end the turn
- f16cad014 fix(plugin): normalize capability lookup IDs
- a6a78bc2c fix(plugin): apply bundled agent capabilities
- b4740a745 Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
- 4c39b4e03 fix(plugin): preserve model suffix compatibility and agent order (fixes #6338)
- 8d6d687bb Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
- d9a125f8e Merge remote-tracking branch 'upstream/dev' into fix/6376-shared-skills-root-path
- 342016de9 fix(agents): harden bedrock registration QA (fixes #6141)
- 3fbc94a7a Merge remote-tracking branch 'upstream/dev' into fix/6141-hephaestus-bedrock-model-id
- 9442455c0 fix(plugin): strip unsupported agent temperature (fixes #6338)
- 8b08e972b fix(hephaestus): rerun isolated OpenCode QA evidence (fixes #6141)
- a79b94981 add --verbose flag to `bunx oh-my-openagent doctor` command
- 36e5f4b16 fix(hephaestus): record session-count QA proof (fixes #6141)
- 3679d4ad8 test(hashline): fix missing closing brace in multi-model test runner
- 6d53e7d39 ci(workflows): add repository guard checks to deployment workflows
- 8821ddaa4 fix(shared-skills): make the root-path test symlink-safe and self-cleaning
- 83d510b98 Merge remote-tracking branch 'upstream/dev' into fix/6376-shared-skills-root-path
- 916c84340 fix(shared-skills): resolve the skills directory from non-root bundles
- 81eaf29a7 Merge remote-tracking branch 'upstream/dev' into fix/6141-hephaestus-bedrock-model-id
- 9aa474b61 chore(evidence): record the mandated session-count proof for the #6141 QA
- b057ae54b fix(hephaestus): recognize AWS Bedrock vendor-prefixed gpt-5 model ids
- 63e57da0a Merge latest dev before password isolation
- accad8905 Merge debugging metadata fix before password isolation
- 78f6400bd fix(skills): synchronize debugging metadata
- a59ed0823 fix(model-core): add "upstream request failed" to retryable patterns (fixes #6313)
- 70bf3fa16 fix(tmux-subagent): auto-activate panes within grace window without requiring focus
- 1b1211fcb fix(lsp): send initialized notification params
- ce5ad49ec fix(lsp-mcp): pass project cwd into local MCP config
- 1b270382a fix(session-search): sort sessions by time.updated before scan limit
- 8cfdf0e19 fix(shared-skills): remove hardcoded WebSearch tool name from ultimate-browsing skill
- 3930f0d63 fix(model-core): support GLM max reasoning effort
- 283073ee3 fix(keyword-detector): append mode instructions after user text to preserve session title
- a4ab5c39f test(boulder-state): cover plan progress parsing

**Thank you to 5 community contributors:**
- @MoerAI:
  - fix(model-core): infer temperature support from model family when metadata is silent
  - fix(omo-codex): keep uninstall able to find the bins it installed
  - fix(start-work): teach the initial skill the external-blocker marker, and harden its QA
  - fix(start-work): require a stated blocker before the marker ends the turn
  - fix(evidence): read the same database for both session counts in the #6376 driver
  - Merge pull request #6467 from niStee/fix/hashline-test-multi-model-syntax
  - Merge pull request #6314 from code-yeongyu/fix/issue-6313-upstream-fallback
  - Merge pull request #6225 from H-TTTTT/fix/session-search-sort
  - Merge pull request #6227 from H-TTTTT/fix/lsp-mcp-cwd
  - Merge pull request #6297 from leeyazhou/fix-tmux
  - Merge pull request #6466 from niStee/dependabot/npm_and_yarn/packages/web/next-15.5.21
  - Merge pull request #6537 from Hungdoan565/fix/6489-bug-report-opencode-version
  - fix(model-core): resolve provider metadata for reasoning-suffixed model ids
  - fix(shared-skills): resolve the skills directory in the Codex marketplace layout
  - fix(omo-codex): detect a stale committed installer bundle
  - fix(start-work): keep the Codex stop contract out of other harnesses
  - fix(tool-pair-validator): operate on OpenCode's real Part model
  - test(tool-pair-validator): gate repairs on the conversion invariant
  - test(messages-transform): assert tool-pair repair with real tool parts
  - docs(evidence): record tool-pair-validator real-part QA
  - docs(evidence): capture the real failing-first output
  - test(shared-skills): prove the installed marketplace wrapper resolves ast-grep
  - docs(evidence): re-capture opencode QA with the user home isolated
  - docs(evidence): scope the failing-first run to the conversion gate
  - Merge pull request #6607 from code-yeongyu/fix/tool-pair-validator-real-part-model
  - fix(shared-skills): record complete Codex QA evidence
  - fix(todo-continuation-enforcer): stop re-injecting after a non-retryable request error
  - docs(evidence): record continuation fail-safe QA
  - fix(todo-continuation-enforcer): wire the unrecoverable-error stop flag
  - fix(todo-continuation-enforcer): stop on a non-retryable direct dispatch failure
  - fix(todo-continuation-enforcer): keep the stop flag across split internal messages
  - docs(evidence): note the two dispatch paths added during review
  - Merge pull request #6610 from code-yeongyu/fix/continuation-stop-on-unrecoverable-error
  - fix(model-core): preserve deep-research temperature
  - fix(model-core): resolve prefixed capability IDs
  - fix(model-core): resolve suffixed snapshot IDs
  - fix(model-core): prefer provider snapshot entries
  - Merge remote-tracking branch 'upstream/dev' into fix/oracle-claude-temperature-6338
  - fix(model-core): preserve canonical alias snapshots
  - fix(model-core): canonicalize suffixed aliases
  - Merge remote-tracking branch 'origin/dev' into manage/pr-6375
  - Merge remote-tracking branch 'origin/dev' into fix/6376-shared-skills-root-path
  - Merge remote-tracking branch 'origin/dev' into fix/start-work-external-blocker
  - Merge remote-tracking branch 'origin/dev' into fix/6320-uninstall-bin-links
  - Merge pull request #6569 from MoerAI/fix/6320-uninstall-bin-links
  - Merge pull request #6375 from MoerAI/fix/6141-hephaestus-bedrock-model-id
  - Merge pull request #6395 from MoerAI/fix/6376-shared-skills-root-path
  - Merge pull request #6485 from MoerAI/fix/oracle-claude-temperature-6338
  - Merge pull request #6500 from MoerAI/fix/start-work-external-blocker
- @1vivy:
  - fix(omo-opencode): wake parent on monitor terminal output
  - test(omo-opencode): record monitor terminal wake QA evidence
- @ThunderRonin:
  - docs(qa): record authentic user-session reproduction of 'got undefined' dispatch failure
- @scw1109:
  - fix(omo-opencode): lower canonical reasoning to variant at agent config build time
- @Tinycute00:
  - fix(ast-grep-mcp): make scan oneOf branches object-typed

## [5.0.0-beta.2] - 2026-08-10

- b2018610e Merge pull request #6679 from code-yeongyu/release/v5.0.0-beta.2-source-state

## [5.0.0-beta.3] - 2026-08-10

- a8ec7b130 Merge pull request #6684 from code-yeongyu/release/v5.0.0-beta.3-source-state
- fd7a19588 Merge pull request #6683 from code-yeongyu/feat/beta3-memory
- 4a4a24bba Merge pull request #6682 from code-yeongyu/docs/memory-letta-attribution

## [5.0.0-beta.4] - 2026-08-10

- ea2b38717 Merge pull request #6693 from code-yeongyu/release/v5.0.0-beta.4-source-state
- f065c0fcd Merge pull request #6688 from code-yeongyu/fix/memory-surface-direct
- 8357cb5d0 docs(agents-md): refresh knowledge base against HEAD

## [5.0.0-beta.5] - 2026-08-10

- b5feb7746 Merge pull request #6707 from code-yeongyu/release/v5.0.0-beta.5-source-state
- 56593dc78 Merge pull request #6708 from code-yeongyu/fix/npm-ci-stale-node-modules
- 1b06566ed fix(windows): stage over a removed target and assert the launcher PATH prepend
- a4d64b14b fix(windows): resolve the hoisted shim bin dir and give git tests a real timeout
- b91a7f595 test(omo-native): gate POSIX-only contracts on Windows and surface build stderr
- 82e76554c test(omo-opencode): wait for the clock to advance instead of a fixed sleep
- 7bd338df6 Merge pull request #6695 from code-yeongyu/feat/omo-brand-unification
- 65c9fc7fc test(omo-native): expand Windows short paths in the launcher fixture
- efdd7aa4f chore(script): re-pin the publish-shape audit hit after the comment shift
- 7ef6a432e fix(script): make the publish-shape test line-ending independent
- 05604df78 test(omo-native): assert OMO_BIN by target instead of path spelling
- b2ca09401 test(omo-native): guard against pinning an engine that ignores the brand
- c3cb6c832 docs(omo-native): document the brand contract, flat home and update channel
- 4ea82b508 feat(omo-native): hand the omo brand profile and update channel to the engine

## [5.0.0-beta.6] - 2026-08-11

# OMO 5.0.0-beta.6

Beta.6 coordinates the OpenCode and Codex editions around a more reliable
shared runtime. It fixes LSP behavior in symlinked worktrees, adds a
privacy-bounded telemetry/config surface, improves Windows Git discovery, and
refreshes the generated Codex and LazyCodex payloads.

### Highlights

#### LSP operations now work through symlinks and worktrees

Read-only LSP tools preserve valid lexical workspace paths while safely
resolving canonical ancestors. Diagnostics, definitions, references, symbols,
and prepare-rename no longer fail merely because a monorepo or task worktree is
reached through a symlink. Rename keeps strict canonical write confinement.

#### Shared telemetry is typed and privacy-bounded

The shared telemetry core now provides:

- per-event property allowlists;
- primitive-only, length-bounded payloads;
- explicit rejection of prompt, path, text, and IP fields;
- batching and bounded shutdown;
- `DO_NOT_TRACK` support;
- configurable GeoIP behavior;
- fail-closed handling for placeholder project keys.

Unified configuration can disable telemetry with:

```json
{
  "telemetry": {
    "enabled": false
  }
}
```

Upgrade shared config consumers together before using this strict new key.

#### Memory is more reliable on Windows

Memory repositories expose commit timestamps, and Git execution now retries
standard Git-for-Windows locations only after a normal `ENOENT` failure. Other
execution failures retain their existing behavior.

#### Codex and LazyCodex payloads are current

The generated Codex installer honors `DO_NOT_TRACK`, disables telemetry for the
explicit placeholder key, and ships refreshed CodeGraph, LSP, configuration,
and installer artifacts.

### Edition impact

#### OMO Ultimate for OpenCode

Beta.6 primarily consumes the shared LSP worktree fix. It introduces no new
OpenCode hook, tool, CLI, schema, or agent migration relative to beta.5.

#### OMO Light for Codex

Beta.6 refreshes installer and marketplace payloads with current telemetry,
configuration, CodeGraph, and LSP behavior.

### Migration note for users coming from 4.x

The runtime command introduced during the 5.0 beta line remains:

```text
omo ...  ->  omo-agent-toolkit ...
```

Rerunning the installer removes only installer-managed legacy wrappers and
preserves user-owned `omo` files.

### Release surfaces

- `oh-my-opencode@5.0.0-beta.6`
- `oh-my-openagent@5.0.0-beta.6`
- `lazycodex-ai@5.0.0-beta.6`
- Codex marketplace plugin `omo@sisyphuslabs`
- platform launcher packages stamped `5.0.0-beta.6`

**Full diff:** https://github.com/code-yeongyu/oh-my-openagent/compare/v5.0.0-beta.5...v5.0.0-beta.6

---

### Complete generated changelog

- 55326d2a8 Merge pull request #6760 from code-yeongyu/fix/windows-memory-lock-beta6
- 807b62f62 test(memory): budget Windows lazy initialization
- 1a9d0e7da fix(memory): tolerate Windows lock sharing races
- 150a06992 Merge pull request #6750 from code-yeongyu/release/v5.0.0-beta.6-source-state
- 0dd0ec220 Merge pull request #6743 from code-yeongyu/fix/lsp-symlink-worktree
- b542b7c2c fix(lsp-core): preserve resolved read paths
- b75406420 fix(lsp-core): allow lexical symlink reads
- b1574d648 Merge pull request #6737 from code-yeongyu/fix/omo-native-geoip-on
- bceb9cf76 Merge pull request #6736 from code-yeongyu/fix/omo-memory-windows-git-fallback
- 19e3d3ae3 Merge pull request #6735 from code-yeongyu/fix/coding-agent-sessions-omo
- f332aaff8 docs(qa): record Windows memory git fallback evidence
- f4d77d7fc test(omo-memory): allow for Windows Git latency
- ded9d68bc fix(omo-memory): locate standard Git on Windows
- ca95292c7 Merge pull request #6733 from code-yeongyu/fix/omo-native-placeholder-key
- 77210223c docs(qa): record OMO session discovery proof
- 7ad95a80b fix(telemetry-core): treat the unconfigured OmO Native placeholder key as telemetry disabled
- 1b91e9771 Merge pull request #6721 from code-yeongyu/fix/memory-footer-evidence-eol
- 16cbd41ef docs(qa): normalize memory footer ANSI evidence
- 0ead4568c docs(qa): correct Git-free harness evidence
- b3b7c54cd docs(qa): record Git-free wiring proof
- 8ffba7fb6 Merge pull request #6719 from code-yeongyu/fix/posix-test-timeout-clobber
- aa17a3270 docs(qa): correct deduplicated memory suite counts
- e05f337cb docs(qa): record telemetry sync and Windows fixes
- 7f198bb24 fix(ci): normalize stale-package report paths
- d5b49adcb merge: sync telemetry dev before memory footer merge
- 911c9ffe0 docs(evidence): pin the preload vs per-file timeout semantics
- 7dbe42d00 fix(test): raise the CI test-timeout floor in the preload
- 79bbfe0f8 docs(qa): record isolated Windows status proof
- e0f90f923 Merge pull request #6718 from code-yeongyu/feat/omo-native-telemetry
- d2c590f33 docs(evidence): correct the timeout mechanism with the per-file probe
- 31bc2c286 fix(test): remove the no-op windows timeout floor
- 0c476edab revert: restore the per-file windows test budgets
- 1b8370a51 docs(qa): align Windows retry evidence
- 337d3a287 docs(qa): correct Windows teardown evidence
- ca0aac153 docs(qa): record event-bound Windows reset proof
- 1fab035f4 fix(test): stop lowering the global test timeout on posix
- 6571ee0dc docs(qa): record Windows wiring cleanup proof
- 07e12a548 docs(qa): record latest dev sync proof
- e5dcc27be fix(telemetry-core): let allowlisted non-string flags pass the content-suffix guard
- 7e146e161 feat(telemetry-core): typed event capture wrapper with allowlist and batching
- 93506997a feat(telemetry-core): honor DO_NOT_TRACK opt-out standard
- 5ded3b243 merge: sync final dev before memory footer merge
- 2837bbbef docs(qa): record stale self-package cleanup proof
- 57cf761a3 fix(ci): remove stale self-package tests
- de2d4acdf Merge pull request #6713 from code-yeongyu/fix/windows-ci-root-causes
- 26db2b775 test(omo-codex): give the git bash hooks install a real windows budget
- 511a23dd0 docs(qa): correct final memory suite evidence
- 92fda8980 docs(qa): record final memory lifecycle proof
- d4f675773 docs(evidence): record the green windows required-check run
- 4aea47c1a merge: sync dev after Windows baseline repair
- fcaf05d28 merge: sync dev after the shared build fix landed
- 4cecf37b7 Merge pull request #6700 from code-yeongyu/fix/windows-root-ci-baseline
- 64006f3e7 docs(qa): record final Windows timeout proof
- cb874f655 test(ci): budget Windows integration fixtures
- dc5c27bef docs(evidence): record the windows ci root-cause qa
- d7e62e628 docs(agents): forbid bypassing a red required check
- ee8cdb7aa docs(qa): record staging backup cleanup proof
- f67d2c1c0 docs(qa): record final bundle freshness proof
- 864c9eb59 merge: sync dev after npm install repair
- 194175c30 docs(qa): record Windows CI round three evidence
- 9264e7194 merge: sync dev into Windows CI baseline
- e2e781bd5 test(omo-codex): allow Windows installer latency
- 14b19c787 merge: sync dev into Windows CI baseline
- 9cb2b3763 fix(omo-native): preserve Windows PATH casing
- 1495ca6e0 test(omo-native): compare canonical Windows bin paths
- 2826d2754 test(omo-native): respect Windows test contracts
- abbd63d3b test(memory-core): reuse validation fixtures
- 3ce89e30f style(omo-native): restore fixture indentation
- f4aaa82ee test(omo-native): canonicalize Windows fixture paths
- e638c8de4 fix(ci): pin workflow yaml to LF
- 95cbd30b7 feat(memory-core): expose HEAD commit timestamps

**Thank you to 1 community contributor:**
- @ashmoonori-afk:
  - fix(omo-memory): locate standard Git on Windows
  - test(omo-memory): allow for Windows Git latency

## [5.0.0-beta.7] - 2026-08-12

### OMO Native: your favorites stay put, and updates that just work

**Favorite models stop disappearing** — if a provider was momentarily unauthenticated or unreachable, opening the model picker and touching favorites used to silently erase every favorite that provider owned, sometimes wiping the list entirely. The picker only ever sees models that resolve right now, and that filtered view was being written straight back to your settings. Favorites that do not resolve at that moment are now preserved untouched.

**Latest Senpi engine** — OMO Native (`omo-ai`) now runs on `@code-yeongyu/senpi@2026.8.12-4`, with every workspace pin (root, native launcher, Senpi adapter, task engine) moved in lockstep.

**Updates that respect your installer** — `omo update` now detects whether you installed with Bun or npm and prints the command that matches your setup. Bun global installs get a proper `bun add -g` path; npm installs keep `npm i -g`. Reinstall errors quote the same detected command, so recovery advice is never for the wrong package manager.

**Update guidance safe from any install path** — custom install locations with spaces, `$`, or quotes now produce correctly shell-quoted update commands on both POSIX and Windows.

**One agent home, even nested** — nested Senpi processes (reflection, child agents) now share the single `$HOME/.omo/agent` state directory instead of resolving their own, so identity and configuration survive every child launch.

Plus shared memory-engine improvements that ship through the OmO memory runtime: active learning (facts, people cards, dream consolidation) now defaults on, with per-agent overrides.

---

ade persona seed v2 + identity.md in <self>
- f35dd0966 docs(memory): record the unconditional full-scope APPROVED verdict
- e2e781bd5 test(omo-codex): allow Windows installer latency
- 6cf4e8589 fix(memory): forbid destructive recovery that can discard user memory edits
- f10944019 fix(memory-core): narrow optional observations in the people card tests
- 67093ab26 docs(memory): record round 31 verdict, the empirical IC-6 defect, and round 32 bind
- 374a6bf31 fix(memory): close the abrupt-supervisor-death deadline hole and pin the facts watermark ordering
- 3347fd4cc fix(memory-core): allow kind and aliases in the pre-commit frontmatter hook
- c5cf7ea46 feat(memory): durable facts queue with crash reconcile
- 82c967666 docs(memory-config): document the memory configuration surface
- 3a56dac04 docs(memory): record round 30 verdicts and round 31 bind
- eb8a46895 fix(memory): specify Windows supervisor containment and reconciliation
- a4dd860bc feat(memory-core): dream persona (consolidation + skill audit + people phases)
- 224638c56 feat(memory-core): people card + observation formats and human card seed
- 30ce8cf20 docs(memory): record full-scope review round 30 and self-audit receipt
- 2bba9d7b4 feat(memory): skills-usage ledger for dream audit
- 8d0a1a5b1 feat(memory-core): seed memory-discipline skill
- 3e00693d8 feat(memory-config): default active learning on + nudge/facts/dream/people/soul settings
- 5bca65f69 feat(memory-core): sharpen always-on memory reminder (attention-first rewrite)
- 14b19c787 merge: sync dev into Windows CI baseline
- 6a50215b0 docs(memory): add memory v2 active-learning work plan
- 9cb2b3763 fix(omo-native): preserve Windows PATH casing
- 1495ca6e0 test(omo-native): compare canonical Windows bin paths
- 2826d2754 test(omo-native): respect Windows test contracts
- abbd63d3b test(memory-core): reuse validation fixtures
- 3ce89e30f style(omo-native): restore fixture indentation
- f4aaa82ee test(omo-native): canonicalize Windows fixture paths
- e638c8de4 fix(ci): pin workflow yaml to LF
- 95cbd30b7 feat(memory-core): expose HEAD commit timestamps

**Thank you to 2 community contributors:**
- @ashmoonori-afk:
  - fix(omo-memory): locate standard Git on Windows
  - test(omo-memory): allow for Windows Git latency
- @MoerAI:
  - docs: explain the three OMO editions
  - docs: add edition choice guidance
  - Merge pull request #6769 from code-yeongyu/docs/three-editions
  - Merge pull request #6771 from code-yeongyu/docs/choose-edition

## [5.0.0-beta.8] - 2026-08-17

# OMO 5.0.0-beta.8

This release is about doing more work at once and trusting what runs in the background. OMO can now run dozens of agents in parallel and recover if something crashes mid-run. You can sign in with your Cursor subscription, and Grok 4.6 is supported out of the box. The background memory system, which learns from your conversations, got a major reliability overhaul after an incident where it filled a disk with retries. Rounding it out: your settings now survive every update, planning asks fewer questions, and Windows got smoother.

### Highlights

#### Run dozens of agents at once

Give OMO a big task and it can now break it into parts, run them as parallel waves of agents, collect the results, and move on to the next wave. Before, agents mostly ran one at a time. If a crash happens partway through, OMO picks up where it left off instead of losing the work. Nothing to configure, big tasks just fan out on their own.

#### Sign in with Cursor, and Grok 4.6 support

You can now connect your Cursor Pro, Ultra, or Teams subscription. Run `/login cursor`, approve in your browser, and you're signed in. For now this is authentication only. Cursor models don't show up in the model picker yet, but the groundwork is in place.

Grok 4.6 is now a first-class model. It gets a system prompt tuned for how Grok actually works instead of a generic fallback, and when OMO picks a model for quick, lightweight tasks, Grok 4.6 is the new default.

#### Memory that doesn't eat your disk

OMO quietly extracts facts from your conversations so it remembers things about you and your projects. On August 14 that system hit an infinite retry loop and consumed 388GB of disk. This release fixes all five root causes:

- Failed extractions back off and stop retrying after a few attempts instead of looping forever.
- Disk usage is bounded. Old extraction runs are cleaned up automatically and payloads are capped at 128KiB.
- You can check what the memory system is doing with `/facts status` and retry a failed extraction with `/facts retry`.
- Background memory consolidation no longer silently fails on many model providers. If its preferred model isn't available, it falls back to whatever is.
- Model names with slashes in them (like `openrouter/deepseek-ai/deepseek-v4-pro`) are no longer invisible to the memory system.

There's new smarts here too. Memory consolidation now decides between reusing your active session (faster, cache-warm) and starting fresh (more reliable) based on actual token cost. And the planning review loop can no longer run indefinitely; it's capped at 5 rounds.

#### Your settings survive every update

Updating OMO used to sometimes wipe your favorite models, fallback chains, or auth tokens, because different parts of the system looked for settings in different places. Now there's one home for your config, `~/.omo/agent`, and everything (launchers, child agents, doctor, setup, the installer) uses it. A one-time migration moves your existing settings there automatically.

#### Smarter planning when you don't spell everything out

When you ask for something without specifying budget, tech stack, scale, or compliance needs, OMO used to either assume nothing or interrogate you. Now it derives sensible defaults, records what it assumed so you can review it, and asks only the one question that genuinely needs your input.

#### See how much time parallel work saves

OMO now measures the wall-clock time saved by running tool calls in parallel and reports it. The old standalone `/omo-telemetry` command is removed; the measurement is built in now.

#### Smoother on Windows

Spawning a background agent on Windows no longer flashes a console window, thanks to community contributor @sanguneo. A batch of timeout and race condition fixes landed across Windows and macOS as well.

#### Agents doing UI work now actually study design

OMO ships a library of design references for frontend work, but agents mostly skimmed past it: across thousands of real sessions, only about 2 in 10 ever opened it, and almost none followed through. The router now makes the reference stops binding instead of advisory, adds a dedicated layout-mechanics reference, and requires the agent to name which references it actually loaded before writing UI code. Expect more design-grounded frontends, fewer generic ones.

#### Fresher web automation under the hood

The bundled browser automation stack (the stealth browser and its controller) is refreshed to the current releases, with a newer Playwright baseline. Web research, login-gated scraping, and screenshot workflows track modern browser behavior instead of last quarter's.

#### Team Mode gets boundary repairs

Team Mode, the experimental parallel-agent coordination feature, had runtime boundary defects where members could step outside their assigned scope. Those boundaries are repaired, and read-only shell output is now capped so a chatty command can no longer blow up an agent's context window.

### Edition impact

#### OMO Ultimate for OpenCode

The frontend design routing and browser automation refresh land here first. Grok 4.6 becomes the default for quick tasks, planning derives constraints instead of asking, and the memory reliability fixes apply through the shared memory core. Your settings now live in the canonical config directory and survive updates.

#### OMO Light for Codex

The planning constraint improvements reach the Codex skills, CodeGraph is refreshed, and the Git Bash installer is hardened. No new Codex hooks, tools, or CLI commands this release.

#### OMO Native

Everything above, plus the full Senpi engine upgrade below: Cursor sign-in, Grok 4.6, JSONC settings, mass parallel orchestration, parallelism telemetry, the memory disk fix with the new `/facts` commands, and the Windows console flash fix. The `/omo-telemetry` command is removed.

### Senpi engine upgrade to 2026.8.16

Senpi is the engine that powers OMO Native (the `omo-ai` package). This release upgrades it from 2026.8.14 to 2026.8.16.

New things you can do:

- **Sign in with Cursor.** `/login cursor` opens your browser, you approve with your Cursor account, and you're connected. Authentication only for now.
- **Grok 4.6 tuned prompt.** Grok 4.6 gets a system prompt designed for how it thinks instead of a generic one.
- **Custom system prompts work again.** The `--system-prompt` and `--append-system-prompt` flags are restored after being broken since July 19, and they compose correctly with model-specific presets.
- **JSONC settings.** Your settings file can have comments and trailing commas. If both `settings.jsonc` and `settings.json` exist, JSONC wins.
- **GLM 5.3 support.** GLM 5.3 models get a tuned system prompt too.
- **Per-model reasoning memory.** OMO remembers each model's thinking level and fast-tier setting across sessions. New `/reasoning` and `/efforts` commands let you check and change them, and `/fast` now persists.
- **Dollar skill invocation.** Type `$skill-name` in the composer to run a skill directly.
- **Eval execution events** are now published for desktop clients.

Things that are fixed:

- Background tasks no longer crash in restricted environments where they can't create a lock file. They degrade gracefully instead.
- Aborted or oversized conversation compactions no longer freeze your session, and when a compaction doesn't apply, you're told why.
- Claude authentication is more reliable: tokens stay scoped to the right request, are isolated from subprocesses, and the auth probe window no longer flashes on macOS.

### Migration note for users coming from 4.x

The `omo` to `omo-agent-toolkit` rename from the 5.0 beta line remains in effect:

    omo ...  ->  omo-agent-toolkit ...

Rerunning the installer removes only installer-managed legacy wrappers and preserves any `omo` files you created yourself.

### Release surfaces

- `oh-my-opencode@5.0.0-beta.8`
- `oh-my-openagent@5.0.0-beta.8`
- `lazycodex-ai@5.0.0-beta.8`
- `omo-ai@5.0.0-0.beta.8` (beta channel only: `npm i -g omo-ai@beta`)
- Codex marketplace plugin `omo@sisyphuslabs`
- platform launcher packages stamped `5.0.0-beta.8`

Thanks to community contributor @sanguneo for the Windows console flash fix.

**Full diff:** https://github.com/code-yeongyu/oh-my-openagent/compare/v5.0.0-beta.7...v5.0.0-beta.8

---

- ea02aa016 Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state
- 43b51518b Merge pull request #6956 from code-yeongyu/fix/release-pr-read-retries
- 600089df8 fix(ci): retry every release-state PR read on HTTP 5xx
- 988c753b7 Merge pull request #6949 from code-yeongyu/fix/release-wait-loop-resilience
- 1d25873c2 fix(ci): retry gh pr view on transient HTTP 5xx in release-state wait loop
- 581881f38 Merge pull request #6925 from code-yeongyu/fix/ci-real-sharding
- 917e29dd8 Merge pull request #6943 from code-yeongyu/fix/sdk-message-lookup-non-array
- 001d7ec11 Merge pull request #6947 from code-yeongyu/fix/quick-luna-fast-provider
- 6c1ff1657 Merge pull request #6946 from code-yeongyu/fix/release-gates
- 08a10e652 Merge pull request #6941 from code-yeongyu/fix/rpc-parity-local-cli
- 054340164 Merge pull request #6939 from code-yeongyu/fix/lazycodex-parallel-fixture
- 010ff3fe9 fix(model-core): use openai-codex provider for quick luna-fast rung
- 3f260e801 fix(memory-core): retry git init under lock contention
- bbebf5e1c test(opencode): cover resolved message lookup failures
- 557ff51d7 fix(opencode): preserve array SDK response contracts
- dbf600533 Merge pull request #6933 from code-yeongyu/feat/publish-post-verify
- e3b6860f2 Merge pull request #6945 from code-yeongyu/fix/windows-dag-happy-timeout
- 5b02fd4f0 docs(evidence): record release-gate repair verification
- 469b05847 test(omo-codex): isolate LazyCodex installer source fixtures
- 0b025ec23 Merge pull request #6942 from code-yeongyu/test/windows-dag-residency-budget
- 397d5346b Merge pull request #6936 from code-yeongyu/docs/release-resume-path
- 89a37db40 Merge pull request #6940 from code-yeongyu/fix/publish-rpc-parity-launcher
- b57dcd825 Merge pull request #6928 from code-yeongyu/perf/slow-test-seams
- 05ef1837e fix(publish): stop post-publish probes from stranding a release
- d9cdf024c Merge pull request #6935 from code-yeongyu/feat/publish-gate-reuse
- 4c4553fd7 docs(release): document failed publish recovery
- f057c7e94 ci(publish): reuse successful release gates
- c2895ee74 test(release): pin publish resume guards
- 105258b24 Merge pull request #6932 from code-yeongyu/fix/frontend-reference-enforcement
- 386975a36 Merge pull request #6920 from code-yeongyu/fix-beta8-command-audit
- 2509bfcbd Merge pull request #6931 from code-yeongyu/fix/test-parallel-worker-isolation
- 2ff7f7da7 fix(frontend): route layout mechanics beside the pattern catalog
- aa576072f fix(frontend): make routed references binding instead of advisory
- b280c3f6a feat(frontend): add StyleGallery spatial-structure reference
- 2925acc11 fix(audit): make the command-string allowlist line-number-free
- 97e0ec36c test(lsp-core): stabilize cold diagnostics delivery
- 04ccd5943 Merge pull request #6924 from code-yeongyu/chore/dep-pins-latest
- 1ef6b2800 docs(evidence): attribute the Windows shard 2/2 attempt-1 failure
- 7c239c001 docs(evidence): record post-review verification for the pin refresh
- 32f380f92 fix(script): correct stale agent-command allowlist line pins
- 1ade4ef4b chore(deps): advance tsgo to the current native-preview release
- 8bd0dee3c chore(shared-skills): refresh ultimate-browsing Tier-2 runtime pins
- 3dd88267f docs: refresh knowledge base snapshot and add component guides
- 1f87b56d2 test(memory): stabilize time-sensitive CI cases
- 7921e9cbe docs(evidence): record executable path hardening
- 82f3aebf0 docs(evidence): record final root verification
- ff469464b test(team-mode): avoid global fake timers
- b89272be7 docs(evidence): record security blocker repairs
- 01eb5fb87 docs(evidence): record final Windows proof
- c69a29440 test(memory-core): budget Windows cache integration
- 174b31787 docs(evidence): record Windows CI root causes
- ce3ff3002 test(memory): inject terminal lock record fixture
- 0947b5055 test(init-deep): build drift history with fast-import
- 5d097ae93 fix(memory-core): serialize worktree administration
- ee63da500 docs(evidence): record brutal review repair
- 8ce91d0d7 test(omo-codex): bound Git Bash installer fixture
- 26cc99667 Merge pull request #6913 from code-yeongyu/feat/unspecified-low-grok-4.6
- 9d0536a44 fix: keep grok-4.6 snapshot-backed on unspecified-low
- 8825a9c36 docs: document unspecified-low grok-4.6 first lane
- c86e34ade feat(omo-opencode): default unspecified-low to xai/grok-4.6 xhigh
- 828c252a1 feat(model-core): put grok-4.6 xhigh first on unspecified-low
- 8eca0d052 Merge pull request #6906 from code-yeongyu/feat/memory-facts-payload-cap
- aeddcb5dd Merge pull request #6910 from code-yeongyu/cursor/grok-sisyphus-prompt-4c49
- 19ea2c357 feat(memory-core): lossless byte-capped facts batch selection
- 03b7df006 Merge pull request #6900 from code-yeongyu/feat/memory-facts-retention
- 0661a22c0 Merge pull request #6899 from code-yeongyu/feat/memory-facts-backoff
- bd0dc3e75 fix(memory-core): keep parked facts failures parked and reject non-ISO instants
- d17b2fd76 feat(memory-core): durable facts failure-streak store
- feeaede24 Merge pull request #6901 from code-yeongyu/fix/memory-journal-lock-contention
- daa231036 fix(memory): make transcript journal lock crash-proof against contention
- 40c4e04c4 Merge remote-tracking branch 'origin/dev' into cursor/grok-sisyphus-prompt-4c49
- dcd43eda6 Merge pull request #6897 from code-yeongyu/feat/telemetry-parallel-latency
- a725cbca3 docs(plan): record completed plan checkboxes for parallelism telemetry
- 2ae457ccc docs(evidence): record verification verdicts and final QA artifacts for parallelism telemetry
- fe9bd2ea6 docs(evidence): record post-commit bundle verification transcript
- c1b64ca1c Merge pull request #6909 from code-yeongyu/fix/reflection-completion-stale-fixture
- 4586c6229 docs(evidence): record Grok Sisyphus prompt QA evidence
- a88f1e2c7 feat(sisyphus): route Grok 4.5/4.6 to a native model-specific prompt
- 7ab5376d6 feat(model-core): add Grok 4.5/4.6 family detectors
- 0512e0c72 test(memory): use a module-level recent timestamp instead of a hardcoded date in completion fixtures
- 3cb1d63c4 Merge pull request #6904 from code-yeongyu/feat/ulw-plan-constraint-sweep
- 004fe9dd4 Merge pull request #6903 from code-yeongyu/feat/ulw-loop-assumed-constraints
- 381738a96 feat(ulw-plan): sweep extrinsic constraints (budget/stack/scale/audience) across editions
- 1301238f2 feat(ulw-loop): derive assumed constraints when the brief is silent
- bd9987e75 Merge pull request #6892 from code-yeongyu/fix/memory-facts-sandbox
- c8614e617 Merge pull request #6896 from code-yeongyu/fix/windows-soul-watermark-timeout
- 9e86f635a Merge pull request #6865 from code-yeongyu/feat/mass-ulw-dag-orchestration
- 0360dae3d test(utils): extend codegraph upgrade test timeout
- e00eaef7f test(memory): stabilize Windows RPC cleanup
- c58d45e7c Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-orchestration
- 8ff6182df test(init-deep): avoid Git drift fixtures
- ec7d53e06 Merge remote-tracking branch 'origin/dev' into fix/windows-soul-watermark-timeout
- 4751bb1ee Merge pull request #6893 from code-yeongyu/fix/remove-omo-telemetry-command
- 5c3110e12 docs(evidence): record criterion-named Team Mode QA artifacts
- 429556b83 docs(evidence): record Team Mode repair QA evidence
- 589c33675 test(memory): harden soul watermark timeout
- 7a15e51a5 Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-orchestration
- 27fc628b5 docs(evidence): commit full-suite transcript for telemetry command removal
- 95fe3be52 Merge pull request #6890 from code-yeongyu/fix/ci-optimization
- 79e5e3ca4 test(memory): harden memory tool and integration tests for windows CI
- 84e3381be Merge pull request #6891 from code-yeongyu/fix/work-with-pr-monitor
- 775cb95a5 Merge pull request #6889 from code-yeongyu/fix/6881-memory-prompt-cache-stability
- c03937076 Merge remote-tracking branch 'origin/dev' into fix/6881-memory-prompt-cache-stability
- 25cb7c7dc Merge pull request #6886 from code-yeongyu/fix/plan-gate-user-request-channels
- 76a6d5fbb fix(ci): build full codex plugin for platform smoke tests
- 63d873b19 docs(work-with-pr): replace polling loops with monitor subscribe
- 578c25b3e Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-orchestration
- 15ad6e617 Merge pull request #6885 from code-yeongyu/fix/windows-reflection-fork-test-timeout
- bdc712fe3 Merge remote-tracking branch 'origin/dev' into fix/plan-gate-user-request-channels
- f5959d220 Merge remote-tracking branch 'origin/dev' into fix/6881-memory-prompt-cache-stability
- 6f04a3461 Merge pull request #6884 from code-yeongyu/fix/memory-model-catalog-slash-ids
- b448cfe85 test(memory): harden command fixture timeouts
- 58cfd7450 Merge remote-tracking branch 'origin/dev' into fix/6881-memory-prompt-cache-stability
- 06645393b Merge remote-tracking branch 'origin/dev' into fix/memory-model-catalog-slash-ids
- 1b593cf88 Merge pull request #6888 from code-yeongyu/fix/6883-quick-chain-qwen-flash
- 4296367cd Merge remote-tracking branch 'origin/dev' into fix/plan-gate-user-request-channels
- aa7e475c9 Merge remote-tracking branch 'origin/dev' into fix/windows-reflection-fork-test-timeout
- 3e324d983 docs(evidence): record memory prompt cache QA
- 472d1e262 fix(memory): stabilize compiled prompt projection
- 98f08396b test(memory-core): stop racing git worktree add in the concurrency test
- 51b502857 Merge remote-tracking branch 'origin/dev' into fix/6883-quick-chain-qwen-flash
- eca1d87e5 Merge remote-tracking branch 'origin/dev' into fix/memory-model-catalog-slash-ids
- f2956f9c8 Merge pull request #6887 from code-yeongyu/fix/6880-rpc-child-error-classification
- 6e583b3bc test(memory): pin the shared launch preflight for both memory surfaces
- 56a0f52ec docs: align quick fallback providers
- 75b82be7e fix(model-core): correct OpenCode Go quick fallback
- 32cc2197e test(memory): harden reflection fork timeouts
- 3536c86d4 Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-orchestration
- 2d55567fd fix(memory): name the model when the child reports it cannot see one
- 6cdb81d9c fix(memory): keep slash-containing model ids visible to preflight
- 8726d98c2 test(memory): harden Windows process tests
- 0684852a0 fix(dag): defer in-process teardown past cancellation
- 598bd778c fix(dag): wire shipped handles and recovery cancellation
- 24db42bf0 fix(dag): compose cancellation runtime surfaces
- 6974ab639 fix(dag): avoid viewer protocol fsync cost
- 1d2d814e8 fix(dag): close final conformance remainders
- c3a0221cc Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-orchestration
- 108bffa04 fix(script): pin dag eval sdk in omo-ai payload guard
- 038ed0cbb Merge pull request #6864 from code-yeongyu/feat/memory-fork-cost-routing
- 3122f5672 fix(memory): judge fork cache reuse from session usage, not assumption
- 6ab5399fb feat(memory): route reflection between fork and quick by cost
- be73200cd feat(memory): model fork-vs-quick launch cost per turn
- b2273e997 fix(memory): honor the child sentinel as a hard disable
- 28f184c5a Merge pull request #6859 from code-yeongyu/fix/memory-reflection-runtime-model
- 81a21ec0a Merge remote-tracking branch 'origin/dev' into fix/memory-reflection-runtime-model
- 3bbdf6004 Merge pull request #6860 from code-yeongyu/fix/omo-agent-dir-unification
- 6de0f2d2c test(memory): cover the session seam and registry scan
- a047dcb2c test(memory): pin the resolution ladder order
- 6bd290ba4 fix(omo-native): type the adoption result and categorize the new command strings
- f612eb661 docs(evidence): record the canonical agent-directory QA
- 5254268cc docs: state the canonical omo agent directory and its invariant
- ee71abff3 fix(memory): point category failures at the real fix
- 46a3ebebc fix(memory): resolve reflection models from the live runtime
- 0d1505be8 feat(omo-native): add the shared agent-directory resolver
- 259fd760d Merge pull request #6856 from code-yeongyu/fix/ulw-plan-bounded-review-convergence
- 13a034b83 fix(ulw-plan): bound high-accuracy review convergence
- 8e71c1be5 Merge pull request #6851 from code-yeongyu/fix/windows-facts-reservation-timeout
- 29ec975fa test(memory): budget reservation finalization on Windows
- ac650406c Merge pull request #6839 from code-yeongyu/fix/macos-tmux-manager-timer-isolation
- 9cfe40b76 Merge origin/dev into fix/macos-tmux-manager-timer-isolation
- 6d206e1e9 Merge pull request #6838 from code-yeongyu/fix/windows-agent-toolkit-timeout
- b8ae9f77b Merge pull request #6837 from code-yeongyu/fix/windows-port-auto-selection-race
- 4d951e39c test(omo-opencode): isolate tmux polling timers
- 9ab4cd9d1 test(utils): make port auto-selection deterministic
- 30d7ed5af test(memory): bound cache variant coverage
- 6d3c24f41 test(omo-native): verify provider registry map
- c26b8febd Merge pull request #6825 from code-yeongyu/fix/memory-core-git-lock-contention
- 1bc6dd662 Merge remote-tracking branch 'origin/dev' into fix/memory-core-git-lock-contention
- ca30face6 Merge pull request #6824 from code-yeongyu/fix/memory-journal-stale-lock
- ee11fba21 test(memory): pin that an unclearable lock still fails loudly
- 564d6da58 docs(memory): state which proof covers which criterion
- b4b6aa2b7 test(memory): assert every concurrent worktree commit lands
- 82efbe728 docs(memory): record the git lock contention evidence
- 164dca834 fix(memory): retry the remaining lock-taking git mutations
- dddcbd269 fix(memory): apply the git lock retry to mutating repo operations
- 3d03d1cc3 fix(memory): retry git operations that lose a lock race
- a93f43869 fix(memory): use the real commit author shape in the contention probe
- ea82b1459 test(memory): probe concurrent git mutations for Windows lock contention
- 6281e9cc6 fix(memory): reclaim stale transcript journal locks from dead owners
- 00bd5b2fc Merge pull request #6821 from code-yeongyu/refactor/memory-module-split-runner
- 9c077f24c fix(memory): make runner deadline assertion deterministic
- cb96c44d5 Merge remote-tracking branch 'origin/dev' into refactor/memory-module-split-runner
- 757f50621 Merge pull request #6817 from code-yeongyu/feat/memory-tui-entry-polish
- 378d56074 Merge remote-tracking branch 'origin/dev' into feat/memory-tui-entry-polish
- f0d8e1dcc refactor(memory): split runner and sandbox modules
- 7a00a415d Merge pull request #6812 from code-yeongyu/refactor/memory-health-alert-split
- dc878dee8 Merge remote-tracking branch 'origin/dev' into feat/memory-tui-entry-polish
- f59bec68a Merge remote-tracking branch 'origin/dev' into refactor/memory-health-alert-split
- 55aaa316f Merge pull request #6814 from code-yeongyu/refactor/memory-module-split-bridge
- 703d11d20 Merge remote-tracking branch 'origin/dev' into feat/memory-tui-entry-polish
- 9008e11c2 Merge remote-tracking branch 'origin/dev' into feat/memory-tui-entry-polish
- 0b39fa303 Merge pull request #6816 from code-yeongyu/fix/omo-ai-bun-global-install
- b20c1417d Merge pull request #6820 from code-yeongyu/fix/format-beta7-changelog
- 2eea2f9c6 fix: format the beta.7 changelog entry
- de6e55a90 Merge pull request #6819 from code-yeongyu/docs/record-beta7-release
- 74b700488 docs: record the OmO beta.7 release
- 4c59f889e Merge remote-tracking branch 'origin/dev' into refactor/memory-module-split-bridge
- 5295ad32d Merge remote-tracking branch 'origin/dev' into refactor/memory-health-alert-split
- 4e3c361f3 Merge pull request #6811 from code-yeongyu/fix/memory-sandbox-escape-visibility
- c2b2375c4 fix(omo-native): honor Windows runtime home for migration
- e71d0faa8 Merge remote-tracking branch 'origin/dev' into refactor/memory-module-split-bridge
- e0961dc5f Merge remote-tracking branch 'origin/dev' into refactor/memory-health-alert-split
- dd4986b23 Merge remote-tracking branch 'origin/dev' into fix/memory-sandbox-escape-visibility
- 530c2c34d Merge pull request #6815 from code-yeongyu/refactor/memory-module-split-wiring
- b8996a61a Merge remote-tracking branch 'origin/dev' into feat/memory-tui-entry-polish
- ceb9d4af1 docs(qa): record before/after evidence for the memory entry restyle
- 03982613e test(memory): pin the rendered shape and semantic colour of memory entries
- 2619e8c65 fix(omo-native): repair legacy Bun global manifests
- 073cfdee2 Merge remote-tracking branch 'origin/dev' into fix/memory-sandbox-escape-visibility
- 25cd1d18d Merge remote-tracking branch 'origin/dev' into refactor/memory-module-split-wiring
- e65d76148 Merge remote-tracking branch 'origin/dev' into refactor/memory-module-split-bridge
- 628c8e27c Merge remote-tracking branch 'origin/dev' into refactor/memory-health-alert-split
- d1b1be69d Merge pull request #6810 from code-yeongyu/refactor/memory-shared-launch-preflight
- 25ee0b988 fix(memory): label facts sandbox warnings
- 61f6247e9 refactor(memory): split session wiring responsibilities
- 91cca1d3b refactor(memory): split rpc and completion modules
- 38baf468e docs(evidence): record health alert split and spinner assertion proof
- f6db62e40 docs(qa): record sandbox visibility evidence
- c93efdc4c refactor(memory): share launch preflight
- c83c62a78 fix(memory): surface sandbox degradation
- ca64bff41 test(memory): pin literal spinner glyphs instead of deriving from the frame table
- dad9472be refactor(memory): move reflection health alert out of read-only health module

**Thank you to 1 community contributor:**
- @cursoragent:
  - feat(model-core): add Grok 4.5/4.6 family detectors
  - feat(sisyphus): route Grok 4.5/4.6 to a native model-specific prompt
  - docs(evidence): record Grok Sisyphus prompt QA evidence
  - Merge remote-tracking branch 'origin/dev' into cursor/grok-sisyphus-prompt-4c49

## [5.0.0-beta.9] - 2026-08-17

### OMO 5.0.0-beta.9

**Senpi 2026.8.17 engine + beta releases that publish themselves correctly**

#### Changed

- **Latest Senpi engine** — OMO Native now runs on `@code-yeongyu/senpi@2026.8.17` ([#6977](https://github.com/code-yeongyu/oh-my-openagent/pull/6977)). Every workspace pin, lock surface, and the provider compatibility map moved in lockstep. The engine brings the cursor-cli-oauth fallback lane, ignored tool-call loop hard-stop, retry-exhausted steering resume, `-fast` codex variants, and Cloudflare-gateway/Cerebras catalog fixes.
- **Explicit beta publishes** — `/publish` now accepts an exact semver such as `5.0.0-beta.9` and dispatches it with exact run-ID ownership ([#6970](https://github.com/code-yeongyu/oh-my-openagent/pull/6970)). No more accidental stable-line bumps from the beta channel.
- **Beta release notes done right** — beta changelogs compare against the previous beta in the same channel, non-semver release tags are ignored safely, and GitHub releases are explicitly marked pre-release ([#6970](https://github.com/code-yeongyu/oh-my-openagent/pull/6970)).

#### Fixed

- Windows root tests no longer run under Git Bash ([#6957](https://github.com/code-yeongyu/oh-my-openagent/pull/6957)); release validation is deduplicated through gate reuse; RPC model-admission diagnostics got a hardened port with preserved probe environments.
- Memory: reflection entries render as senpi notices, stale reflection-failure streaks stop alerting, and the reflection reservation is released on abort ([#6971](https://github.com/code-yeongyu/oh-my-openagent/pull/6971), [#6967](https://github.com/code-yeongyu/oh-my-openagent/pull/6967), #6978 pending).
- Codex: spawn callee boundary anchored; on-complete hooks inject the correct shell platform.

#### Added

- Parallel local test path-group runner for faster suites ([#6974](https://github.com/code-yeongyu/oh-my-openagent/pull/6974)); `@babel/parser` shipped for bundled Senpi codemode ([#6965](https://github.com/code-yeongyu/oh-my-openagent/pull/6965)).

**Install / upgrade:**
```
bun i -g oh-my-opencode@beta
bun i -g oh-my-openagent@beta
bun i -g lazycodex-ai@beta
npm i -g omo-ai@beta
```

## [5.0.0-beta.10] - 2026-08-18

### Reliable installs, faster CI, safer releases

#### Ast-grep setup now fails clearly instead of hanging

OpenCode and LazyCodex installation now enforce a live timeout for ast-grep
provisioning, terminate stuck child installers, and report a clear bounded
failure if the child refuses to exit. Install commands no longer sit
indefinitely behind a silent provisioning process.

#### Faster validation without source-coverage shortcuts

Web/docs-only changes and verified generated release-state merges can skip
unnecessary root jobs, while missing diffs, normal source changes, and
release-looking non-merge commits still run full validation.

#### Releases are tied to one validated source SHA

Publication now reuses the successful full CI workflow for the exact prepared
commit instead of running a second release-local matrix that could diverge
from the code being shipped.

#### Release credentials stay out of build scripts

Repository-controlled generation runs without the release PAT. The token is
available only for the push/PR step, and the credential-bearing remote is
removed even when publication fails.

#### More predictable Windows release checks

Native-shell execution, Bun 1.3.14, Windows-safe script resolution, and
targeted serial execution remove known environment mismatches and timeout
instability from the release path.

---

#### A reliability-focused beta

`v5.0.0-beta.10` is a focused hardening release for installation, continuous integration, and the synchronized publish pipeline. There are no breaking user-facing changes in this beta. The main result is that failed setup work now stops predictably, release builds are validated against the exact source being published, credentials have a narrower exposure window, and Windows checks run closer to real Windows behavior.

#### What changed

##### Installer timeouts now finish predictably

The shared ast-grep provisioning path no longer relies on an unreferenced timer that could be starved while a child process remained stuck. The installer now:

- keeps the primary 30-second deadline active;
- terminates a child that exceeds that deadline;
- gives termination one second to settle; and
- reports an explicit failure if the child ignores termination instead of hanging indefinitely.

This matters most on failure paths: a broken shell, stalled download, or unresponsive installer should now produce a bounded result rather than holding the CLI or CI job open until a much larger outer timeout expires.

##### Releases reuse validation from the exact source SHA

The publish workflow no longer starts a second, redundant test/typecheck/compatibility matrix. Instead, it requires a successful full CI workflow for the exact prepared release SHA and fails closed when that proof is unavailable.

The gate handles both valid release paths: the release-state pull request's exact-SHA run and the post-merge push run. It retries temporary GitHub API failures, waits for active validation to finish, stops when completed runs have no success, and enforces a bounded overall timeout. This makes the release faster while preserving the important guarantee: the source that passed CI is the source that gets published.

##### Release credentials are more tightly isolated

Release-state generation and privileged publication are now separate steps. Dependency installation, version synchronization, lockfile updates, and generated-artifact rebuilds run without the release PAT. The token is present only in the step that pushes the prepared branch and manages its pull request.

The authenticated git remote is also protected by an `EXIT` trap, so it is restored to a clean token-free URL even when a push fails. This reduces the chance of a credential remaining in repository configuration for later commands or diagnostic output.

##### CI skips expensive work only when it can prove that it is safe

A new changed-path classifier identifies two narrow cases that do not need the full repository matrix:

- generated release-state merge commits with verified merge provenance; and
- changes confined to the web/docs surface.

Everything else continues to run heavy validation. If the base SHA is unavailable, the diff cannot be read, classifier inputs are malformed, or a commit merely imitates a release message without being the expected merge shape, CI defaults to the full matrix. The fast path therefore reduces repeated work without turning uncertainty into a skip.

##### Windows validation now matches the supported runtime more closely

Repository workflows are pinned consistently to Bun `1.3.14`, with cache keys aligned to that version. Windows root tests execute under native PowerShell rather than Git Bash where shell-sensitive behavior could observe Unix-like environment variables and launch paths. File-URL handling in the CI classifier tests also uses native path conversion, including Windows drive-letter paths.

These changes are aimed at reducing Windows-only hangs and false failures while preserving the existing platform coverage for OpenCode/OpenAgent and Codex installations.

#### Per-layer highlights

##### omo pure components

- ast-grep provisioning has a real, bounded timeout and kill-grace path;
- a child that ignores termination becomes an actionable failed result rather than an endless wait; and
- reusable CI classification fails safe when provenance or changed-path information is incomplete.

##### omo opencode

- publish gates reuse complete CI from the exact prepared SHA instead of rerunning the same validation;
- release-state generation cannot access the release PAT;
- push/PR automation has bounded retries and recovery checks; and
- generated-release and web/docs-only changes receive a safe CI fast path.

##### omo codex

- Codex compatibility and platform publication use the same exact-SHA release guarantee;
- `lazycodex-ai` publication remains behind successful synchronized validation;
- Windows installer and compatibility checks run with native shell semantics; and
- Codex consumers inherit the bounded ast-grep installer failure path.

#### Breaking changes

**None.** Existing commands, package entry points, configuration, and installation flows remain compatible with beta.9.

#### Install or upgrade

Install or upgrade the beta with:

```bash
npm i -g omo-ai@beta
```

After installation, `omo --version` should report the beta.10-mapped package version once the release is available on npm.

#### Discord announcement

**omo v5.0.0-beta.10 is out — a reliability-focused beta.**

This release hardens the paths around installation and publication: ast-grep setup can no longer hang indefinitely after a stalled child process, release jobs reuse successful CI from the exact source SHA instead of running duplicate gates, and the release PAT is isolated from repository-controlled generation steps. CI also gains safe fast paths for generated release merges and web/docs-only changes, while unknown cases still run the full matrix. Windows checks now use Bun 1.3.14 consistently and run shell-sensitive root tests under native PowerShell.

No user-facing breaking changes.

```bash
npm i -g omo-ai@beta
```

## [5.0.0-beta.11] - 2026-08-19

### 🧠 Memory That Feels Pressure — And Acts On It

Your agent's memory now knows when it's getting full. Memory pressure is surfaced directly to the agent, and when it crosses the threshold, dream runs (memory consolidation) launch automatically instead of waiting for a quiet moment. Dreams now carry enforced token budgets with committed per-file estimates, and a new memory-file access ledger records which files actually get read — so dream tier rebalancing is driven by evidence, not guesswork.

### 🔧 Memory Children Actually Spawn On npm Installs

If you installed omo via npm, memory reflection and people-ask children died within milliseconds with `node: bad option: --fork` — the Senpi CLI entry was silently dropped from the spawn argv, so node received CLI flags it doesn't understand. The CLI entry is now forwarded everywhere: reflection, fork mode, and people-ask launches. Reflection also retries through provider outages instead of dying on the first 500.

### 🕸️ mass-ulw Grows Teeth

The dag boundary now enforces planning discipline: mass-ulw runs start with advisory planning warnings, dag agent-node dispatch goes through the spawn policy, and reloading the extension is blocked while a DAG run is in flight — with a notification when the run pauses instead of a silent mid-run reload.

### 👥 Team & Task Fixes That Were Bugging You

Completed resident team members no longer vanish from the team widget. Category selection gates route back to the caller instead of swallowing the decision, and when a category's model is unavailable, the fallback chain actually advances to the next model. On the OpenCode side, your `permission.task` setting is now respected on main agents.

### 🖼️ Bundled Senpi 2026.8.18-3

The Senpi upgrade alone is worth the update:

- **Paste images straight into the TUI** — clipboard pastes attach as `[Image #N]` markers that ride your message in reading order, instead of dumping a temp file path into the composer.
- **Cursor, corrected** — context windows fixed (Claude and GPT 5.5/5.6 at 1M, Grok at 500K), reasoning levels now drive both Cursor surfaces, and catalogs collapse into clean selectable model identities.
- **Goals that resume** — an active goal no longer parks forever after a flooded session load or a settings hot-reload; sending a message re-engages it.
- **Retries that use their full budget** — transient provider stream-start timeouts were being aborted 60s before their own deadline; the watchdog now honors the full configured retry budget.
- **Compaction stops eating your typing** — messages typed while auto-compaction runs are queued and delivered after it settles, not silently discarded.
- **Headless OAuth continuity** — `-p -c` sends only your new turn, verified against a private sidecar; imports, forks, and drift fail closed.
- **Linux glibc hosts** now get the glibc Claude binary before the musl variant, and published tarballs keep their Babel 8 closure so the codemode sidecar starts cleanly.

### 🪟 Windows Fixes

Memory-file access tracking recorded its ledger keys with Windows path separators, so the dream tier's usage counts never matched the POSIX keys every consumer reads — reads on Windows effectively went uncounted. Keys are now normalized, and the reflection health report no longer mis-reports a dormant streak.

### 🔧 Tooling Fixes

The LSP tools refused to answer for any file outside the session's working directory, so diagnostics, definitions, and references silently came back empty when you worked across a worktree or a sibling checkout. Read-only LSP requests now resolve those paths.

---

- 6259bfeda Merge pull request #7035 from code-yeongyu/release/v5.0.0-beta.11-source-state
- 44c97b8d1 Merge pull request #7036 from code-yeongyu/fix/zod-copy-windows-timeout
- b16ef0f84 test(omo-opencode): give the MCP server loader hooks a windows budget
- 2dd90cf9d test(omo-opencode): raise the host-zod copy ceiling windows overshoots
- b0f0e1bc5 Merge pull request #7031 from code-yeongyu/fix/lsp-out-of-cwd-readonly
- 5e13e4ab8 Merge remote-tracking branch 'origin/dev' into fix/lsp-out-of-cwd-readonly
- 246ad8bcc Merge pull request #7034 from code-yeongyu/fix/doctor-stale-reflection-streak-test
- 8e94c333e Merge remote-tracking branch 'origin/dev' into fix/lsp-out-of-cwd-readonly
- 8275b2481 Merge pull request #7030 from code-yeongyu/fix/ast-grep-mcp-cursor-safe-schema
- 8d58e75c6 fix(lsp-core): allow read-only LSP tools on files outside request cwd
- f63ae64dd fix(ast-grep-mcp): drop oneOf/not from the advertised scan schema
- 71f354d0a Merge pull request #7015 from code-yeongyu/feat/memory-usage-ledger
- c966d2aca Merge pull request #7011 from code-yeongyu/feat/memory-system-token-budget
- 84ed0dfe1 Merge remote-tracking branch 'origin/dev' into feat/memory-system-token-budget
- 5cd9b1eb1 Merge pull request #7004 from code-yeongyu/fix/memory-reflection-provider-fallback
- 93a35a2c3 Merge remote-tracking branch 'origin/dev' into fix/memory-reflection-provider-fallback
- 6f9e952ac Merge remote-tracking branch 'origin/dev' into feat/memory-system-token-budget
- 035a77768 Merge pull request #7005 from code-yeongyu/feat/mass-ulw-dag-gate
- e6ceba048 Merge remote-tracking branch 'origin/dev' into fix/memory-reflection-provider-fallback
- 62d48bbc3 Merge pull request #7013 from code-yeongyu/fix/lsp-daemon-test-timeout-budget
- 208f2696e test(lsp-daemon): budget per-test timeouts above subprocess guards
- c46a29603 Merge remote-tracking branch 'origin/dev' into feat/memory-system-token-budget
- ccc80e4bd Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-gate
- 0f526f601 Merge pull request #7003 from code-yeongyu/fix/issue-6922-team-widget-resident-members
- 78d4ddfb0 Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-gate
- 4283d1212 Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- 81b084afd Merge pull request #7008 from code-yeongyu/feat/memory-pressure-dream-origin
- 5b60be0e8 Merge pull request #7006 from code-yeongyu/feat/memory-pressure-line
- 2bbe38800 Merge remote-tracking branch 'origin/dev' into feat/mass-ulw-dag-gate
- eb506c560 Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- 3f8941d09 Merge pull request #7002 from code-yeongyu/fix/dag-reload-guard
- 80bde3b26 Merge remote-tracking branch 'origin/dev' into feat/memory-pressure-line
- 8dbddc532 Merge remote-tracking branch 'origin/dev' into fix/memory-reflection-provider-fallback
- 1663e26f8 Merge branch 'dev' into fix/dag-reload-guard
- 6b5f65d95 Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- 301de7a3f Merge pull request #6997 from code-yeongyu/fix/issue-6972-category-chain-availability
- c2eb13442 Merge pull request #7001 from code-yeongyu/fix/issue-6944-selection-gate-to-caller
- 154d469a5 Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- e10a30f50 Merge remote-tracking branch 'origin/dev' into fix/issue-6972-category-chain-availability
- 56ef26b87 Merge pull request #7000 from code-yeongyu/fix/issue-6990-permission-task-override
- 15d1c24a1 Merge branch 'dev' into fix/dag-reload-guard
- 15611121f Merge remote-tracking branch 'origin/dev' into fix/issue-6944-selection-gate-to-caller
- 5cc701d6f Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- b9d59e33c Merge remote-tracking branch 'origin/dev' into fix/issue-6922-team-widget-resident-members
- 85d63bd06 Merge remote-tracking branch 'origin/dev' into fix/issue-6972-category-chain-availability
- 50a9b6378 Merge remote-tracking branch 'origin/dev' into fix/issue-6990-permission-task-override
- d930d10cb fix(task): route category gates to caller (#6944)
- 43e8d5903 fix(opencode): respect user permission.task on main agents (#6990)
- 25629db71 fix(delegate-task): advance unavailable category chains (#6972)

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7035 from code-yeongyu/release/v5.0.0-beta.11-source-state

## [5.0.0-beta.12] - 2026-08-19

- ec3d5afaa Merge pull request #7057 from code-yeongyu/fix/beta12-lockfile-sync
- 23db3d9cb fix(deps): sync bun.lock with the v5.0.0-beta.12 version bump
- 65f8540b3 Merge pull request #7056 from code-yeongyu/fix/windows-team-idle-wake-budget
- c63d47342 Merge pull request #7054 from code-yeongyu/release/windows-bun-direct-beta12
- 74557647c Merge pull request #7052 from code-yeongyu/fix/windows-kill-facts
- 09f70aab7 Merge pull request #7050 from code-yeongyu/fix/rpc-steer-delivery
- 5f7e9e877 Merge pull request #7047 from code-yeongyu/fix/win2-timeout-family
- 1c46238f6 Merge pull request #7048 from code-yeongyu/fix/test-tempdir-collisions-round2
- 6b7619c7e Merge pull request #7046 from code-yeongyu/fix/test-tempdir-collisions
- d507bd276 Merge pull request #7044 from code-yeongyu/fix/model-admission-confirm-probe
- d9cb02fec Merge pull request #7043 from code-yeongyu/fix/mcp-scope-filtering-test-race
- c2ece6788 Merge pull request #7039 from code-yeongyu/fix/memory-sandbox-absent-path-enoent
- 2086f2db6 Merge pull request #7038 from code-yeongyu/ci/ubuntu-first-pr-matrix
- c0dc53a32 feat(ci): classify when a pull request needs the full 3-OS matrix
- 61c6938de Merge pull request #7037 from code-yeongyu/feat/memory-notice-style
- ff47efb8b Merge remote-tracking branch 'origin/dev' into feat/memory-notice-style
- 460b456e1 Merge remote-tracking branch 'origin/dev' into feat/memory-notice-style
- 20985fe53 feat(memory-core): add sized ls-tree and single-call system token estimator

## [5.0.0-beta.13] - 2026-08-20

### OMO 5.0.0-beta.13 — Recoverable Graphs, Side Conversations, and a Faster Senpi 2026.8.20-2

The center of gravity: **a failed DAG run is no longer a total loss**, **`/btw` gives you a second conversation without burning your main context**, and the bundled **Senpi 2026.8.20-2** engine ships a large performance + Cursor-correctness wave.

### 🕸️ mass-ulw: retry, steer, and amend a live graph

A graph that lost one node to a flaky tool call used to mean re-running the whole thing and paying for every child again. Not anymore:

- **`dag retry`** returns failed, cancelled, and skip-cascaded nodes to a fresh attempt while every completed node keeps its cached result. Prompt-corrected retries (`retry` + `prompt`) are supported for exactly one node.
- **`dag send`** routes a message to one node's child with real delivery semantics — `steer` into a running child, `revive` a finished-but-resident child with its context intact, `queued` with a durable queue position when the child cannot take it yet. Non-continuable children get typed refusals (`node_not_continuable`, `node_has_no_task`; an unknown node gets `node_not_found`) that name the remedy.
- **`dag amend`** accepts an edited definition against the same run, SHA-256-fingerprint-diffs every node, and re-runs only changed + added nodes plus their transitive dependents. `load_skills` is deliberately outside the fingerprint, so a skills-only edit re-runs nothing.
- Per-node result artifacts are written atomically (temp file + fsync + rename), so a crash mid-retry can no longer leave a truncated result a reader would trust.
- Three new journaled event types — `dag.node.retried`, `dag.node.steered`, `dag.definition.amended` — record every deliberate re-run and amendment explicitly in the journal. All strictly additive: `schemaVersion` stays 1, documented in `docs/reference/mass-ulw-protocol.md` with an explicit no-break guarantee.
- The status widget shows an `x<attempt>` badge on re-run nodes; `/dag` shows `amended x<n>` and prefixes node errors with the error **code**. A lost amend race is now a clean `run_still_active` refusal instead of a run wedged on journal replay.
- The JS SDK gains `retry`, `send`, and `amend` wrappers, and the mass-ulw skill documents the full refusal matrix.

### 💬 `/btw` — ask a side question without polluting the main thread

`/btw <question>` (alias `/side`) opens a temporary session on the same model and agent. `Ctrl+/` toggles between main and side; `Ctrl+C` on an empty side composer closes it. The side thread sees your recent main context as **read-only background** (capped at 64 messages / 64 KiB behind a boundary that tells the side model to keep its hands off files and subagents unless you explicitly ask), and its Q&A never enters the main transcript. Parent deletion, crash re-adoption, BTW-in-BTW nesting, and cancellation ordering are all explicitly handled, so side sessions don't leak. Guide: `docs/guide/btw.md`.

### 🔁 Model fallback stops going quiet (#6579)

Community fix by @MoerAI (#6611):

The repeated-error stall is fixed at its root: the retry-dedupe key didn't include the failing model, so the same error on a *different* model looked like a duplicate and was dropped — the session just went silent. Now:

- Dedupe keys are scoped per model; a skipped retry returns its key instead of burning it forever.
- Internal fallback retries carry an explicit marker so they stop being discarded as synthetic traffic.
- Model identity travels as provider/model **plus variant** through the whole fallback path — your reasoning-effort selection survives a fallback and a recovery.
- Watchdog timers are generation-scoped, so a timer from an abandoned attempt can never hijack a later turn.
- A manual model change resets the fallback watchdog, in-flight retry flag, and the retry-key set.

### 🖼️ One notice language across the transcript

Fallback-architect notices, tips, task-completion cards, team-member liveness warnings, and every memory notice (reflection, health, soul-update, write receipts, nudges) now render through one shared padded notice box. Completion cards lead with a tone glyph (`●`/`✗`/`⚠`/`◐`) and the task name, keep `id · target/model · duration · tokens · tools · tps` on a dim second row, and hold continuation hints behind expansion.

### 🩺 `/doctor` reflection health is deterministic

Reflection-health severity was a function of the wall clock — `[warn]` decayed to `[ok]` by pure passage of time. The check now reads an injectable clock, so the verdict is a pure function of your reflection data.

### 🧪 CI and tests stop lying

The Senpi adapter is now a first-class mandatory-QA surface with a machine-enforced evidence-path contract. Two DAG `wait`-hang classes (resident-cap saturation, terminalization during subscription setup) are pinned by bounded regression tests. Memory-test teardown retries narrowly on `EFAULT` only, and three Windows-slow suites got honest ceilings with waits left event-driven.

### 🧰 Bun 1.4.0 stable, everywhere

Bun 1.4 went stable today, and this release train rides it end to end:

- **omo**: every CI, publish, and platform-build workflow moved from Bun 1.3.14 to **1.4.0** (cache keys included), and the committed omo-senpi extension bundles were regenerated under stable 1.4.0 so the CI freshness gate and your installed extension agree byte-for-byte.
- **senpi 2026.8.20-2** (same-day re-release on top of 2026.8.20): the compiled `senpi` binary is now built with Bun **1.4.0 stable** (was 1.3.14), and npm publishing graduated from the Bun canary channel to stable 1.4.
- **Safe dependency refresh** riding along — omo: posthog-node 5.49, puppeteer-core 25.8, @clack/prompts 1.7, MCP SDK 1.30, js-yaml 4.3.1, picomatch 4.0.5, bun-types 1.4.0; senpi: Biome 2.5.9, @types/node 26.2.0, vitest + coverage 4.1.11, AWS Bedrock/Smithy patches, protobuf 2.14.0. Deliberately excluded: anything major, the Anthropic SDKs (OAuth-lane sensitivity), @google/genai, @mistralai.

---

### ⚙️ Bundled Senpi 2026.8.20-2 — the engine wave

#### Faster everywhere

- **`/resume` no longer stalls on big sessions**: exact byte-bounded streaming summaries are reused for unchanged files, and the visible transcript tail paints first while older messages warm progressively.
- **Startup sheds 680 modules**: the 1.2 MB Claude Agent SDK bundle and the jsdom/Readability/turndown HTML stack now load on first use, not at boot (14,203 → 13,523 modules).
- **One process lighter per launch**: `cli.ts` runs the agent in-process unless an Inspector option or custom exec args genuinely require a child (measured -75 ms, -6.2% on `--help`).
- **On-disk compile cache**: Node's `enableCompileCache()` is on for both CLI entries and published to children, so second launches skip recompiling the engine graph.
- **Hot reload off the critical path**: recursive config watchers run in a worker thread on macOS too, watcher teardown leaves the reload path (1.5–62 s of shutdown stall eliminated), and MCP reconnect no longer blocks a reload.
- **Watch scope fixed**: recursive watch targets now open one non-recursive subscription per in-scope directory — an extensions dir containing `node_modules` no longer drives `fseventsd` to 123% CPU and multi-GB RSS.
- **Retry spinners throttle** on sessions with 1,000+ persisted entries; the countdown stays.

#### The TUI stops freezing

- Goal footer tickers retire themselves on a stale extension context instead of ticking dead forever — the "Pursuing goal" label and continuation countdown no longer freeze the session after a reload.
- TUI mode switches detach live components instead of disposing them; spinners and widget intervals survive the switch.
- A vetoed or failed `/reload` no longer destroys live extension footers and task widgets.
- Assistant text that arrives after the last tool call renders below the tool cards, so approval questions stay visible.

#### claude-sdk-oauth: the $1,084 retry-storm fix (#723)

Stream-start-timeout retries now fork the SDK conversation at the last assistant boundary instead of re-sending the whole conversation — each retry re-bills only its own turn on a prefix-cache read. Before: cache writes grew ~8K/attempt, $25/6min, $1,084/3days on worker dispatch.

#### Cursor, seriously corrected (community wave — thanks @leeseunguk and @HeiTuz)

- 0-token `resource_exhausted` is treated as overflow: surface on first failure → compact before any rotation; rotation persists under the agent dir and survives TUI restarts; a rotation skip at the 3-rotation cap remints a fresh wire id instead of poisoning the session.
- Same-model retry after remint/compact instead of falling back to another provider; too-small overflow compacts drop to the last user turn; implausible billed `cacheRead` (3×/8× the live window) can no longer force useless compacts.
- Mid-turn compaction refuses while a native Run is live, so `conversationId` can't get poisoned mid-flight.
- Turns that end `stop` with pending toolCalls continue as `toolUse`; turns idle after completed tools end normally instead of hanging to the idle timeout.
- ANTML invoke recovery is skipped on `cursor-agent`, so Claude-named Cursor models stop rejecting parallel tool starts.
- Native `todo` calls persist even when the server resolves them without a local op; late `tool_execution_end` events draw their card instead of orphaning results; streamed task args survive an empty `{}` completion.
- Explicit thinking levels resolve to catalog suffix variant ids (`claude-fable-5-thinking-low`) on both the native and CLI lanes — no more `Connect error not_found`.
- Exec-bridge ownership is airtight: handlers bind to the owning run's abort signal, fail closed without a captured run, re-check ownership after approval prompts, and emit `tool_execution_end` errors so nothing dangles.
- Session titles use the session model's own summarization auth — no more `unauthenticated` title calls under an explicit compaction model.

#### Long-running sessions stop burning money

- Goal continuations are **append-only**: per-request history rewriting invalidated the provider's cache prefix, so long team-mode sessions paid a full uncached re-read every turn and drove themselves into 429 storms.
- Same-model 429 retries floor every wait with the exponential schedule — a provider answering with the same tiny `retry-after` hint can't pin the cadence at milliseconds anymore.

#### Config reload behaves in shared-agent-dir setups (thanks @Indosaram, #1006)

Routine-preference saves (like `defaultModel`) from another session no longer cascade a reload; the handoff snapshot is cleared unconditionally after `requestReload()` settles, so a stale plaintext settings snapshot can't survive.

#### For extension authors

The notice-box primitives are public API now: `buildNoticeBox`, `noticeMessageRenderer`, `noticeEntryRenderer`, and the `NoticeSpec`/`NoticeLine`/`NoticeTone` types — render your transcript notices in the shared visual family instead of re-implementing it.

Full engine changelog: [senpi v2026.8.20](https://github.com/code-yeongyu/senpi/releases/tag/v2026.8.20) (+ [v2026.8.20-2](https://github.com/code-yeongyu/senpi/releases/tag/v2026.8.20-2), the same-day Bun 1.4 re-release)

---

- 5d2742bf7 Merge pull request #7075 from code-yeongyu/fix/omo-ci-bun-1314-until-windows-tail
- b4d52a803 fix(test): build the absent-store fixture absent instead of deleting it back out
- 3d91936a9 fix(test): give the Windows setup fixtures a real absent store and a real home
- 38092867c fix(test): let win32 teardown leak an OS-owned temp root instead of failing
- 8cff72082 fix(test): widen the Windows EBUSY teardown budget with escalating backoff
- f92deb89b fix(test): make the Windows suites correct under bun 1.4
- 3a6fa0f65 test(omo-opencode): pin ResolveMessage identity instead of its prototype for bun 1.4
- 8d6a66fa0 Merge pull request #7074 from code-yeongyu/fix/btw-parent-remote-revalidation
- 8aee39439 test(qa): check in BTW revalidation evidence
- fc2c5aa09 fix(opencode): require remote BTW parent confirmation
- aff84c753 fix(qa): keep resolver imports side-effect free
- d92429e21 Merge pull request #7071 from code-yeongyu/feat/dag-node-resume-steer
- 37c5d6e5f Merge pull request #7068 from code-yeongyu/test/dag-happy-timeout-contract
- 5a6f21d9b docs(omo): state the additive compatibility stance for dag node-control events
- 1bbc2aa7d docs(omo): mass-ulw protocol additions for per-node retry/steer/amend
- 26b2506d1 Merge pull request #7067 from code-yeongyu/fix/tui-notice-block-style
- 56df6d7fc Merge pull request #7066 from code-yeongyu/fix/dag-wait-residency-regression
- 81344928f Merge pull request #6611 from MoerAI/fix/6579-runtime-fallback-dedup
- 3932c9c66 fix(runtime-fallback): mark reused internal retry parts
- b401eb4fc fix(runtime-fallback): clear first skipped retry key
- 51573a146 fix(runtime-fallback): scope retry marker to fallback generation
- 23057207d fix(runtime-fallback): recover skipped retry status keys
- d5c5918d5 test(qa): verify PR 6611 after dev rebase
- 2ad216f3a test(qa): record pre-push fork head
- 486844975 test(qa): record PR 6611 fallback evidence
- fc1c6312d fix(opencode): route only marked fallback retries
- b7ee41a64 fix(runtime-fallback): preserve explicit retry effort
- 62491bd6c fix(runtime-fallback): restore effective primary variants
- 3aba9d1d6 fix(runtime-fallback): index registered category models
- 891937ea1 fix(runtime-fallback): bind timeouts to state generations
- f603b5b37 fix(runtime-fallback): own queued retry generations
- 0b097b73b fix(runtime-fallback): reject stale timeout generations
- f4517c42b fix(runtime-fallback): acknowledge synthetic retries
- 0616cd628 fix(runtime-fallback): align created fallback identity
- 8bcfcc6c7 fix(runtime-fallback): retain queued fallback state
- 88d7cb4b4 test(lsp): isolate Windows compatibility checks
- 671f69b0e fix(runtime-fallback): honor explicit retry variants
- 895b9d469 fix(runtime-fallback): align retry reasoning state
- 06eab0f71 fix(runtime-fallback): isolate retry generations
- 3e24b3942 fix(runtime-fallback): preserve effective retry state
- c09d25876 test(runtime-fallback): wire generation acknowledgment
- c42be3ebd fix(runtime-fallback): align fallback generations
- 9af2747b4 fix(runtime-fallback): scope model-less retry dedupe
- 8c465e42b fix(runtime-fallback): preserve variant lifecycle state
- a5f5fee77 fix(runtime-fallback): persist effective fallback variant
- 8310d911d fix(runtime-fallback): preserve fallback variants
- f01536361 fix(runtime-fallback): read variant from chat output
- 5f7b005ab test(runtime-fallback): prove source-current OpenCode QA
- bee902117 test(runtime-fallback): record variant reset QA
- e6fa807d4 fix(runtime-fallback): reset retry keys on variant change
- b586cef81 fix(runtime-fallback): reset retry keys on manual model change
- 26a2a8fbe fix(runtime-fallback): retain active retry keys
- 5e3a12e74 fix(runtime-fallback): distinguish retry variants
- 11798f876 fix(runtime-fallback): dedupe model-less retry statuses
- 617400982 fix(runtime-fallback): prevent repeated-error stalls (fixes #6579)
- e676fef9d Merge pull request #7062 from code-yeongyu/refactor/doctor-health-clock-thread
- b8b7b0954 Merge pull request #7060 from code-yeongyu/test/memory-teardown-efault-retry
- 9dc8116e2 Merge pull request #7058 from code-yeongyu/feat/btw-codex-side-ui
- 6eb7e8cae fix(opencode): revalidate BTW parents
- 198a1963c docs(opencode): update BTW hook inventory
- 12807167b fix(opencode): preserve BTW cancellation semantics
- 28284f29c fix(opencode): reject deleted pending BTW
- e4ce3f658 docs(opencode): index BTW feature module
- bc2f49662 fix(opencode): preserve BTW route ownership
- 1be110282 fix(opencode): own every BTW cleanup
- 786d1955b fix(opencode): await pending BTW creation
- b174d9872 fix(opencode): await BTW cleanup on dispose
- cdc106126 fix(opencode): close final BTW boundary gaps
- ed8682862 fix(opencode): propagate BTW classification failures
- 369be3608 fix(opencode): retry BTW session classification
- f3a3c0b5b fix(opencode): restrict unverified BTW sessions
- 399ddb8fd fix(opencode): retry persisted BTW adoption
- e015f8e7a fix(opencode): validate persisted BTW parents
- 8b423d959 fix(opencode): enforce BTW execution bounds
- 113b49354 fix(opencode): bound BTW prompt inheritance
- 680973669 fix(opencode): block orphaned BTW nesting
- baf7d9255 fix(opencode): reject deleted BTW parents
- b3f4f0be1 fix(opencode): re-adopt persisted BTW sessions
- 3cbeeebc1 fix(opencode): cancel BTW on parent deletion
- a3981b98d fix(opencode): discard stale BTW adoption
- 4586d135b fix(opencode): cancel pending BTW navigation
- 960947c42 fix(opencode): harden BTW deletion lifecycles
- 559b3e22e fix(opencode): address BTW review feedback
- b5eb04896 feat(opencode): align BTW side conversation with Codex
- ec3d5afaa Merge pull request #7057 from code-yeongyu/fix/beta12-lockfile-sync
- 23db3d9cb fix(deps): sync bun.lock with the v5.0.0-beta.12 version bump
- 65f8540b3 Merge pull request #7056 from code-yeongyu/fix/windows-team-idle-wake-budget

**Thank you to 1 community contributor:**
- @MoerAI:
  - feat(opencode): align BTW side conversation with Codex
  - fix(opencode): address BTW review feedback
  - fix(opencode): harden BTW deletion lifecycles
  - fix(opencode): cancel pending BTW navigation
  - fix(opencode): discard stale BTW adoption
  - fix(opencode): cancel BTW on parent deletion
  - fix(opencode): re-adopt persisted BTW sessions
  - fix(opencode): reject deleted BTW parents
  - fix(opencode): block orphaned BTW nesting
  - fix(opencode): bound BTW prompt inheritance
  - fix(opencode): enforce BTW execution bounds
  - fix(opencode): validate persisted BTW parents
  - fix(opencode): retry persisted BTW adoption
  - fix(opencode): restrict unverified BTW sessions
  - fix(opencode): retry BTW session classification
  - fix(opencode): propagate BTW classification failures
  - fix(opencode): close final BTW boundary gaps
  - fix(opencode): await BTW cleanup on dispose
  - fix(opencode): await pending BTW creation
  - fix(opencode): own every BTW cleanup
  - fix(opencode): preserve BTW route ownership
  - docs(opencode): index BTW feature module
  - fix(opencode): reject deleted pending BTW
  - fix(opencode): preserve BTW cancellation semantics
  - docs(opencode): update BTW hook inventory
  - fix(opencode): revalidate BTW parents
  - Merge pull request #7058 from code-yeongyu/feat/btw-codex-side-ui
  - fix(runtime-fallback): prevent repeated-error stalls (fixes #6579)
  - fix(runtime-fallback): dedupe model-less retry statuses
  - fix(runtime-fallback): distinguish retry variants
  - fix(runtime-fallback): retain active retry keys
  - fix(runtime-fallback): reset retry keys on manual model change
  - fix(runtime-fallback): reset retry keys on variant change
  - test(runtime-fallback): record variant reset QA
  - test(runtime-fallback): prove source-current OpenCode QA
  - fix(runtime-fallback): read variant from chat output
  - fix(runtime-fallback): preserve fallback variants
  - fix(runtime-fallback): persist effective fallback variant
  - fix(runtime-fallback): preserve variant lifecycle state
  - fix(runtime-fallback): scope model-less retry dedupe
  - fix(runtime-fallback): align fallback generations
  - test(runtime-fallback): wire generation acknowledgment
  - fix(runtime-fallback): preserve effective retry state
  - fix(runtime-fallback): isolate retry generations
  - fix(runtime-fallback): align retry reasoning state
  - fix(runtime-fallback): honor explicit retry variants
  - test(lsp): isolate Windows compatibility checks
  - fix(runtime-fallback): retain queued fallback state
  - fix(runtime-fallback): align created fallback identity
  - fix(runtime-fallback): acknowledge synthetic retries
  - fix(runtime-fallback): reject stale timeout generations
  - fix(runtime-fallback): own queued retry generations
  - fix(runtime-fallback): bind timeouts to state generations
  - fix(runtime-fallback): index registered category models
  - fix(runtime-fallback): restore effective primary variants
  - fix(runtime-fallback): preserve explicit retry effort
  - fix(opencode): route only marked fallback retries
  - test(qa): record PR 6611 fallback evidence
  - test(qa): record pre-push fork head
  - test(qa): verify PR 6611 after dev rebase
  - fix(runtime-fallback): recover skipped retry status keys
  - fix(runtime-fallback): scope retry marker to fallback generation
  - fix(runtime-fallback): clear first skipped retry key
  - fix(runtime-fallback): mark reused internal retry parts
  - Merge pull request #6611 from MoerAI/fix/6579-runtime-fallback-dedup
  - fix(opencode): require remote BTW parent confirmation
  - test(qa): check in BTW revalidation evidence
  - Merge pull request #7074 from code-yeongyu/fix/btw-parent-remote-revalidation

## [5.0.0-beta.14] - 2026-08-21

### OMO 5.0.0-beta.14 — Retained Side Sessions, OpenGateway, and a Snappier Senpi 2026.8.21-2

The center of gravity: **`/btw` grows into a retained multi-session picker**, **a new credential-gated OpenGateway provider ships 60 tool-capable models**, **commit attribution becomes configurable**, and the bundled **Senpi 2026.8.21-2** engine kills two CPU-spin freezes, paints your messages instantly, and stops Cursor turns from hanging for five minutes.

### 💬 `/btw` keeps every side conversation (#7086, #7087)

**Side sessions now persist until you delete them, and a picker lets you hold several at once.** Contributed by @ToToKr:

- `/btw <question>` creates *another* side instead of reusing the last one; starting BTW while viewing a side creates a sibling under the same main conversation.
- Bare `/btw` opens a picker with three sections: Main conversation, retained sides listed oldest-first as `BTW #1`, `BTW #2` with question summaries, and a New BTW action. The current destination is preselected, and the picker and long transcripts scroll with the mouse wheel.
- **Key semantics changed, retrain your fingers:** `Esc Esc` returns to Main *without deleting* the side (closing BTW used to delete it), `Ctrl+C` from an empty composer deletes only the visible side, and `Ctrl+/` opens the picker from any related view, now also recognized on terminals that encode it as `Ctrl+7`.
- The 64-message / 64 KiB read-only context inheritance and the guarantee that side traffic never touches the main transcript are unchanged.

Follow-up review fixes in #7087 (also @ToToKr) guard BTW creation when no parent prompt exists, preserve promptless picker access, and revalidate the parent prompt at selection time so a stale boundary is never reused. Guide: `docs/guide/btw.md`.

### 🌐 OpenGateway provider, gated on your key (#7078)

**Set `OPENGATEWAY_API_KEY` (or add an `opengateway` entry to opencode's `auth.json`) and 60 tool-capable models appear with correct context windows and pricing.** OpenGateway's `/v1/models` serves bare ids with no metadata, so a new generator enriches them from the owning provider's models.dev catalog with OpenRouter as fallback, and excludes models without tool capability. The injection is credential-gated on purpose: without a key you see nothing new instead of dead models. User config wins at every level, and repo-retired GPT models were screened out of the catalog (62 to 60 entries).

### ✍️ Commit attribution is yours to configure (#7092)

**The omo commit footer and the sisyphus-dev-ai co-author trailer can now be turned off.** A new `git_master` section in `omo.jsonc` carries `commit_footer` (`true` for the builtin footer, a string to replace it, `false` to disable) and `include_co_authored_by` (default true). Both default to today's behavior, the settings flow into delegated children, and the schema, `docs/reference/omo-json.md`, and `docs/reference/configuration.md` document the whole block.

### 📊 Delegation telemetry, honestly scoped (#7091)

**Two new anonymous native event families measure how delegation actually performs: `delegation_completed` and `category_config`.** The projection is an explicit scalar allowlist, so prompts, responses, names, paths, and error text are excluded by construction, with an exact-key-set test making sure a new field can never ride along silently. User category, agent, provider, and model names mask to `custom`; only counts leave the machine. Data quality is reported rather than guessed: a missing cost is never a zero cost, token and duration fields carry status flags, and reconciled or crashed rows are marked so they cannot bias aggregates. The model vocabulary now covers every rung a builtin category can route to, fixing 126 provider/model pairs that previously exported as `custom/custom`. PostHog also derives an approximate country server-side now; the app still never authors or stores an IP, and `docs/legal/privacy-policy.md` discloses all of it.

### 🧭 ulw-plan adapts to how you answer (#7089)

**The planner calibrates question delivery to your planning stance instead of interrogating everyone the same way.** Three renderers over the same surviving forks: batch, one-by-one, and examples-first for users who answer better by critiquing concrete options than by facing a blank page. The opening stance is derived from planning-style episodes in projected memory, override phrases like "you decide" pass three gates and never silently authorize an irreversible or spend decision, and the profile is an append-only episode log with no scores or cached persona. Onboarding can seed a hypothesis from other harnesses' session history, always at low confidence, style-only, never content.

### 🖨️ Paged output becomes a first-class deliverable (#7099, #7098)

**PDF reports and print pipelines get a real authoring reference and a real verification doctrine.** The frontend skill gains a `print-paged-media.md` design reference covering the page box, break control, and the keep-together side effect that strands a callout alone on a near-empty page; visual-qa now admits paginated documents, evidenced by every page rendered to an image, with extracted text explicitly ruled out as evidence. The mass-ULW verification wave learns the same lesson: a paginated deliverable is verified by rendering and inspecting every page, sampling is a failure. `ulw-research` also activates on combined "mass ulw research" invocations so the delivery gates load from either path.

### 🕸️ DAG runs get harder to fool and harder to break

- **Revived nodes stay in the run (#7106).** A node you revive mid-flight is now tracked by the scheduler itself; a run can no longer declare itself finished while your revived node is still working, and it fails loudly if it ever could.
- **Parent-side verification directive (#7080).** DAG completion payloads now tell the orchestrating parent to treat the claim as false until proven: read the artifacts, run the commands, and send corrective instructions back to the exact node until its own verification passes. Non-DAG completions are byte-identical.
- **Real errors, surfaced (#7105).** The eval SDK used to swallow non-start DAG errors as successes and report a `definition_conflict` as "no run_id". Every response now routes through a choke point that rethrows the tool's own code and message.
- **Windows lock contention (#7107).** Filesystems that refuse hard links (`EPERM`/`EACCES` on NTFS ACLs, ReFS, network shares) no longer crash the losing racer; the lock falls back to an equally atomic exclusive open and the loser waits as designed.

### 🪟 Windows: the console flashes are gone

**Nineteen spawn sites across three PRs stop popping black console windows on the desktop.** @sanguneo diagnosed the root cause in #7082: the detached memory reflection supervisor runs console-less, so its children allocated fresh visible consoles on every deadline or cleanup, and pinned the whole launch chain with a source-level `windowsHide` audit. @grim-susemi covered 11 recurring detached and background sites in #6991 (lsp-daemon, MCP OAuth, codegraph, comment checkers, ulw-loop status). #7102 finished the sweep on the last three sites (`spawnNode`, memory people-ask, model preflight). No-op off Windows.

### 🔁 ulw-loop respects session boundaries (#6914, #7112, #7103)

**Two omo sessions in the same repo no longer stomp on each other's ULW plan.** @feelsodev scoped every ulw-loop write to a per-session ledger in #6914, complete with a cross-session isolation probe and Windows fixture hardening. #7112 (co-authored with Altair Li and @feelsodev) closed the read side: the status probe now resolves the host session id from the event context and passes it explicitly, failing closed when none is available instead of adopting repo-global state. And #7103 makes every steering submit in a repo with no active plan ~36ms faster by skipping the status spawn entirely when no ledger directory exists.

### 🧰 Bun 1.4.0 and the dependency wave (#7079, #7075)

**CI, publishing, and every committed bundle now run on Bun 1.4.0**, after #7075 briefly rolled back to 1.3.14 while the Windows tail was finished. Floors moved with it: OpenCode plugin ABI 1.15.13 to **1.18.19**, OpenTUI 0.2.16 to **0.5.6**, commander 15, js-yaml 5. Anyone pinning an older OpenCode host needs to move.

---

### ⚙️ Bundled Senpi 2026.8.21-2 — the engine wave (#7094, #7111)

The host pin moves from the previous beta's engine to **2026.8.21** and then **2026.8.21-2**. What you feel:

#### 2026.8.21

- **Your message paints instantly.** Enter now renders an optimistic pending bubble at once instead of waiting for the provider round-trip; the canonical message replaces it in place, and rejected or command-handled inputs remove it.
- **The TUI stops pegging a core under provider-error storms.** Contended settings-lock waiters used to busy-spin on the main thread and freeze the render loop; they now sleep through `Atomics.wait`, fallback-chain canonicalization is memoized per error burst, and OAuth-lane settings loads are cached by mtime and size.
- **Settings reads are lock-free.** Writers publish atomically via temp file plus rename, so reads never join a lock convoy and never observe a torn write.
- **Claude policy refusals fail immediately** on the `claude-sdk-oauth` lane with the real reason, instead of hanging ~90 seconds into the watchdog and re-billing the conversation on retry.
- **`monitor` prompting matches the real PTY contract**, with worked recipes so the agent waits the way the tool actually behaves.
- **Provider catalogs refreshed:** the vercel-ai-gateway Grok vendor slug moved `xai/` to `spacexai/`, and opencode delisted `deepseek-v4-flash-free`.

#### 2026.8.21-2

- **The auth store gets the same lock-spin fix**, so multi-session OAuth-refresh contention can no longer burn a core.
- **The model picker releases before the auth round trip.** Choosing a subscription-OAuth model like Cursor no longer freezes a frame of the previous model on screen while the network call resolves.
- **Cursor turns end when the server says they ended.** A decoded `turnEnded` is definitive completion with a 5s drain, and silent streams fail in 30s (90s if heartbeat-only) instead of sitting out the 5-minute idle timeout.
- **JavaScript eval cells accept `local://`** paths like every other kernel.

Full engine changelogs: [senpi v2026.8.21](https://github.com/code-yeongyu/senpi/releases/tag/v2026.8.21) and [v2026.8.21-2](https://github.com/code-yeongyu/senpi/releases/tag/v2026.8.21-2).

---

### 🧹 Roundup

- **mass-ULW answers to more names (#7076):** `ulw mass`, `ulwmass`, `mulw`, and `meth` now trigger it alongside the existing spellings; the guard that keeps `ulw-plan` from matching is intact.
- **Background completion notifications reach the right project (#7077):** the live server route now carries its registered directory into the SDK client instead of defaulting to the server's.
- **The ultrawork build fails loudly on stale tokens (#7081):** `wait_for` joined the forbidden-token list, so a directive can never again tell the model to call a tool that does not exist. #7085 briefly dropped the goal-registration mandate and #7088 restored it verbatim, netting to no change in the shipped directive.
- **Docs caught up with the code (#7093):** a 22-file sweep corrects `config migrate`, documents the `update` command, fixes `boulder` and `--codex-autonomous` claims, and describes the telemetry identifier and cleanup scope accurately.
- **Provenance gate diagnoses partial clones (#7101):** an uninitialized submodule now reports itself, with the exact `git submodule update --init --recursive` fix, instead of raising a false license-pin alarm.

---

**Thank you to the community contributors in this release:**
- @ToToKr: the multi-session BTW picker (#7086) and its review follow-ups (#7087)
- @feelsodev: ulw-loop session isolation (#6914) and co-authorship on the status-probe fix (#7112)
- @sanguneo: the win32 memory reflection worker console fix with its windowsHide audit (#7082)
- @grim-susemi: windowsHide across 11 detached and background spawn sites (#6991)
- Altair Li: co-author on the ulw-loop status-probe session scoping (#7112)

## [5.0.0-beta.15] - 2026-08-21

- 024cd9fe0 Merge pull request #7116 from code-yeongyu/release/v5.0.0-beta.15-source-state

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7116 from code-yeongyu/release/v5.0.0-beta.15-source-state

## [5.0.0-beta.16] - 2026-08-22

### OMO 5.0.0-beta.16 — Formula-Sized init-deep, One ULW Keyword Table, and a Steadier Senpi 2026.8.22

The center of gravity: **`init-deep` stops flooding your main session and runs as a formula-sized DAG map-reduce**, **every ULW keyword now routes through one exception-free skill-pointer table so composite invocations load everything they name**, and the bundled **Senpi 2026.8.22** engine stops Cursor streams from dying under heartbeats, keeps shutdown from throwing on pending permission prompts, and lets Ruby and Julia kernels boot under load without timing out.

### 🗺️ init-deep becomes a formula-sized DAG map-reduce (#7123)

**Large repos no longer blow the orchestrator's context exactly when hierarchical `AGENTS.md` coverage matters most.** The old flow collected every explore result into the main session; the new one replaces discovery and generation with a DAG map-reduce whose shape is computed by one formula in an eval cell, not vibes:

- **Quick scanner nodes** extract per-chunk facts into bounded file reports. Chunks are 400 KB of source, roughly 100k tokens against a ~150k usable quick window, so `N_quick = ceil(S / CHUNK)`, bin-packed by directory.
- **Unspecified-high writer nodes** own disjoint subtrees and write the `AGENTS.md` files from about 12 reports each: `N_high = ceil(N_quick / 12)`.
- A **root writer** consumes only per-subtree digests, and a **verify node** gates every produced file before the run can claim success.
- The **always-reduce rule** makes context protection structural rather than aspirational: the main session reads only the verify verdict, never chunk reports or raw node output.

Small repos (`N_quick < 4`) keep an inline path, and repos that would exceed `task.dag.max_nodes_per_run` chain one run per top-level directory instead of overflowing. The scoring matrix, templates, file-writing rule, and the Phase 5 snapshot/mode contract that the init-deep-advisor reads are all preserved unchanged. The rewrite even nets out 512 characters smaller.

### 🎯 Composite ULW invocations load every skill they name (#7120)

**"mass ulw loop" used to arm ultrawork and point at mass-ulw, then quietly drop the ulw-loop skill the phrase names.** "mass ulw research" had the same gap. A new component detects `ulw loop` / `ulw-loop` / `ulwloop` and the research equivalents in any case and injects one hidden skill pointer per matched skill, so a composite invocation loads ultrawork, mass-ulw, and the named skill together in a single turn.

Suppressions mirror mass-ulw per skill: extension-source inputs, a raw `/skill:` command for the same skill, and an already-expanded skill block never inject. Queued prompts carry the pointers appended inside the one message, so the group survives senpi's one-at-a-time queue drain intact. A new e2e (`ulw-skill-pointers-e2e.mjs`) drives the built plugin through a sandboxed live senpi run per prompt and asserts each pointer rides as a hidden `custom_message` in the session JSONL, that plain "mass ulw" stays pointer-free, and that the real agent dir is untouched.

### 🧮 One exception-free ULW keyword table (#7122)

**The mass-ulw and ulw-skill-pointers components were the same mechanism written twice, and their `ulw(?!-)` lookaheads silently swallowed overlapping mentions: "mass ulw-loop" fired neither mass-ulw nor ultrawork.** Both are now replaced by a single `skill-pointers` component holding one uniform target table (mass-ulw with its aliases, ulw-plan, ulw-loop, ulw-research) with no cross-keyword exceptions. Overlapping keywords all fire, and each matched skill gets its own hidden pointer. The ultrawork trigger likewise drops the `(?!-)` guard, so any `ulw` mention arms it.

What changes at your keyboard:

- Typing **"mass ulw-loop"** now loads ultrawork + mass-ulw + ulw-loop together instead of nothing.
- **"ulw plan"** loads ultrawork + ulw-plan, via the new `omo-ulw-plan:skill-pointer` custom type.
- Existing custom types (`omo-mass-ulw:skill-pointer`, `omo-ulw-loop/-research:skill-pointer`) stay stable.
- **Flag consolidation:** `omo-senpi-mass-ulw-disabled` and `omo-senpi-ulw-skill-pointers-disabled` are replaced by a single `omo-senpi-skill-pointers-disabled`. Move your flag if you had one set.

Only structural dedup remains: extension-source inputs, raw `/skill:` commands for the same skill, expanded skill blocks, and the `<ultrawork-mode>` tag-pair guard. The e2e was rebuilt as `skill-pointers-e2e.mjs`, proving the overlap case ("mass ulw-loop" carries the directive plus both pointers), the new plan pointer, and that plain "mass ulw" stays loop- and research-free; `mass-ulw-prompts-e2e.mjs` is unchanged and still passes.

### 📐 mass-ULW planning sizes waves by work grain (#7121)

**The old "target 5-8 nodes per wave" cap is gone.** Wave sizing is now grain-based: one node per genuinely independent chunk, with coverage-beats-cost scoped to quick map and research waves, and an explicit fan-in contract for waves wider than about 10 nodes, where aggregator and verification nodes read bounded per-node file reports instead of raw output. The capacity numbers are reframed as config defaults (`task.dag.max_nodes_per_run` / `max_runs_per_session`) with queue-time framing rather than "hard caps / slot budget" wording. Mass harvests get a sharding rule of their own: nodes aren't units of work, so `N_nodes = ceil(total_items / items_per_node)`, with roughly 50 to 200 items per quick node bounded by the <=5k-token report contract, and chained runs plus per-run aggregators once one run's cap is exceeded.

### 📚 Docs stamped against dev HEAD

A sweep refreshed stale claims across the `AGENTS.md` files: the root stamp moved to 2026-08-22, the tools (15 dirs) and features (25 modules) counts were corrected, the CI Bun pin now reads 1.4.0 with the lagging devcontainer 1.3.12 pin called out, the Windows CI sharding claim matches the workflow table (2 shards), and the omo-senpi component list was corrected from fifteen to the eighteen actually registered (native-badge, onboarding, and init-deep-advisor were missing), with agent-home noted as a non-component resolver.

---

### ⚙️ Bundled Senpi 2026.8.22 — the engine wave

The host pin moves to **2026.8.22**. What you feel:

- **Cursor streams survive heartbeats and checkpoints.** The provider now matches the official Cursor CLI's stream recovery: its 30s health deadline is refreshed on every inbound frame, and pre-`turnEnded` stalls or transport deaths are silently retried with bounded backoff, resuming from the latest conversation checkpoint with the originally pinned model. Long-running local tools and long `xhigh` thinking turns previously died with `Cursor stream ended before turnEnded: inbound stream stalled` and immediately rotated the fallback chain.
- **Clean shutdown with prompts pending.** The `permission-system` builtin extension no longer turns a rejection during `session_shutdown` into an unhandled promise rejection / `uncaughtException` when permission prompts are still pending.
- **Ruby and Julia kernels boot safely under load.** Eval cells now wait for the subprocess `ready` signal before execution timeouts arm, so interpreter startup under load can no longer time out a state-setting cell and silently restart the kernel before the next cell runs.

Full engine changelog: [senpi v2026.8.22](https://github.com/code-yeongyu/senpi/releases/tag/v2026.8.22).

---

### 🧹 Roundup

- **Dependency pins:** the omo package now depends on **senpi 2026.8.22**, and `bun-types` moved **1.3.14 to 1.4.0** in the Codex plugin shared manifest, finishing the Bun 1.4 graduation started in beta.13.
- **Bundle freshness:** the committed omo-senpi extension bundles were regenerated on Linux after each ULW component change, so the CI freshness gate and your installed extension agree byte-for-byte.

---

**Install / upgrade:**
```
bun i -g oh-my-opencode@beta
bun i -g oh-my-openagent@beta
bun i -g lazycodex-ai@beta
npm i -g omo-ai@beta
```

## [5.0.0-beta.17] - 2026-08-22

- 0902c4a80 Merge pull request #7143 from code-yeongyu/release/v5.0.0-beta.17-source-state
- 9faba4727 Merge pull request #7142 from code-yeongyu/fix/beta17-bun-path-fixtures
- dcbe734a6 test(omo-native): make path fixtures platform explicit
- 2a2323575 Merge pull request #7140 from code-yeongyu/fix/beta17-bun-path-delimiter
- 74aa8ac58 fix(omo-native): honor target path semantics
- 63bfdb770 Merge pull request #7134 from code-yeongyu/feature/task-lane-spill
- 41a957e33 docs(omo-json): name lane saturation as the common spill trigger
- fd759e564 feat(omo-config-core): add task.global_concurrency schema and default
- 13a00bf1f Merge pull request #7130 from code-yeongyu/feat/task-concurrency-zero-unlimited
- b57a9d346 build(assets): regenerate JSON schemas for zero-as-unlimited caps
- bab473831 docs(reference): document 0 as unlimited for task concurrency caps
- a51e454f7 fix(omo-opencode): allow 0 defaultConcurrency as unbounded
- a208a9444 feat(omo-config-core): accept 0 as unlimited sentinel in task concurrency and residency settings
- fa0603139 Merge pull request #7129 from code-yeongyu/feat/launcher-bun-auto-runtime
- 27ba9b56a test(omo-native): keep the bare-omo-binary audit green for the new module
- 0a6a1b1e1 feat(omo-native): re-exec the launcher under bun for bun-installed users

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7143 from code-yeongyu/release/v5.0.0-beta.17-source-state

## [5.0.0-beta.18] - 2026-08-24

### OMO 5.0.0-beta.18

**Safer worktree cleanup, current Senpi, and sturdier native sessions**

**Worktree cleanup is now a first-class command** - `omo worktree-sweep` finds
stale task worktrees, normalizes platform-specific paths, and applies the same
separator rules on Windows, macOS, and Linux.

**Review workers keep their checkout until every lane finishes** - parallel
review agents no longer lose the worktree while late lanes are still reading
or validating it.

**OmO Native now rides Senpi 2026.8.23** - the release carries the latest
session, runtime, and codemode fixes behind the beta channel.

This release also tightens OmO naming consistency and ignores both historical
debug-log filename casings during Senpi cleanup.

---

- 04acd0311 Merge pull request #7154 from code-yeongyu/release/v5.0.0-beta.18-source-state
- b7da83e17 Merge branch 'dev' into release/v5.0.0-beta.18-source-state
- 04535ba13 Merge pull request #7156 from code-yeongyu/fix/worktree-sweep-test-separator-parity
- 0201f6744 fix(cli): finish worktree-sweep separator parity for Windows
- 5c35a1a0a Merge branch 'dev' into release/v5.0.0-beta.18-source-state
- 83f8efa56 Merge pull request #7155 from code-yeongyu/fix/worktree-sweep-path-normalize
- 550fd5e1d fix(cli): normalize worktree-sweep porcelain paths at the parse boundary
- 306a90633 test(omo-native): move SENPI_PIN contract to 2026.8.23
- de5a42282 Merge pull request #7151 from code-yeongyu/feat/worktree-sweep
- 5a21af66c fix(review-work): tear down the review worktree only after lanes finish
- 5685d3b62 fix(review-work): lock and tear down review worktrees
- f447933bc feat(cli): add omo-agent-toolkit worktree-sweep command
- 70b959499 Merge pull request #7149 from code-yeongyu/fix/omo-brand-casing
- 9d10bab17 Merge pull request #7148 from code-yeongyu/fix/omo-brand-casing
- dcb02c95a fix(schema): use canonical OmO title
- 04c92a514 fix(omo-native): preserve OmO display casing
- e7c8186d8 Merge pull request #7147 from code-yeongyu/fix/telemetry-model-id-vocabulary-disclosure
- 703431e6e docs(telemetry): align the privacy disclosure with provider-independent model ids
- bc0f7ec9a feat(telemetry): export known model ids regardless of routing provider

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7154 from code-yeongyu/release/v5.0.0-beta.18-source-state

## [5.0.0-beta.19] - 2026-08-24

- b48ab1086 Merge pull request #7207 from code-yeongyu/release/v5.0.0-beta.19-source-state
- 02ba00c7f Merge pull request #7203 from code-yeongyu/release/20260824-beta19-pin
- 37bcb9cd0 Merge pull request #7198 from code-yeongyu/release/20260824-beta18
- b26fafa99 test(deps): raise picomatch safety floor
- 845d63211 chore(deps): refresh beta runtime dependencies
- 8833800ae Merge pull request #7176 from code-yeongyu/fix/residual-followups-20260824
- d982014de test(omo): capture residual followup evidence
- 924c0c5c6 chore(web): pin biome to locked 2.4.15
- 3f88bfb10 ci(codex): gate every plugin component check
- ea8ee43b7 Merge pull request #7175 from code-yeongyu/feat/massulw-goal-verify
- 76daf86b9 feat(skills): bind mass-ulw runs to a goal carrying result verification
- a2eeacabb Merge pull request #7174 from code-yeongyu/initdeep-refresh-20260824
- f7cdde8b5 docs(agents): refresh knowledge base for 2026-08-24 HEAD
- 2a28ea8cd Merge pull request #7173 from code-yeongyu/fix/ulw-loop-component-check-20260824
- 66de4fc15 chore(omo-codex): clean every plugin component check
- 46aacea73 chore(omo-codex): clean ulw-loop component checks
- f8ad86e0b Merge pull request #7171 from code-yeongyu/fix/ulw-checkpoint-snapshot-20260824
- 680fa0dd8 Merge pull request #7170 from code-yeongyu/docs/main-profile-safety
- a90944990 Merge pull request #7168 from code-yeongyu/docs/main-profile-safety
- 7222b21aa fix(omo-codex): accept title-based goal snapshots
- 302f3dd0d chore(ulw-loop): resync bundled ultrawork directive
- da0d7bd54 chore(ultrawork): resync codex directive copies
- 5eb9e6f4a docs(skills): require cloned profiles for agent-driven browser clears
- f3642fcda Merge pull request #7167 from code-yeongyu/feat/start-work-dag-lanes
- cabecc588 feat(skills): route dependency-ordered start-work lanes through a dag run
- 0f06ba45e Merge pull request #7163 from code-yeongyu/feat/dag-tui-live-status

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7207 from code-yeongyu/release/v5.0.0-beta.19-source-state

## [5.0.0-beta.20] - 2026-08-25

# OmO beta.20

Beta.20 is the current beta release of the OmO multi-harness distribution and
native edition.

- OmO: `5.0.0-beta.20`
- OmO Native: `omo-ai@5.0.0-0.beta.20`
- Senpi engine: `@code-yeongyu/senpi@2026.8.25`

### Senpi 2026.8.25

This release includes the current upstream-integrated Senpi line, including
the upstream RPC queue-clearing surface from `upstream/main@a79b37334`,
preserved prompt/message ordering, deterministic RPC coverage, and the
fork-specific compatibility repairs recorded after the sync.

Provider recovery is stronger in this release:

- Cursor quota exhaustion is classified separately from context overflow.
- Stream-stall retries use explicit profiles, shared budgets, classifiers,
  backoff planning, and failure diagnostics.
- Anthropic refusal fallback preserves returned-model pricing.
- OpenAI-compatible reasoning controls and provider-neutral `toolChoice`
  remain available.
- Reasoning replay, Bedrock redacted reasoning, Z.AI metadata, Azure
  `toolChoice`, Google thinking mappings, Kimi cached-token accounting, and
  Copilot policy-rate handling receive compatibility fixes.
- xAI uses the Responses API path with encrypted reasoning replay, with Grok
  4.6 as the refreshed default.

Credential and session continuity also improve:

- Credential pools support slot-preserving mutations and slot-specific logout.
- OAuth refresh preserves sibling and pinned credential slots.
- Compaction no longer assumes provider usage is present.
- Truncated summaries are rejected rather than replayed as complete.
- Settings diagnostics identify exact file and key paths.
- State-file permissions, BOM handling, and invalid-settings behavior have
  regression coverage.

The release also carries extension and CLI fixes for cleanup after failed
extension factories, nested skill discovery, malformed streamed tool-call
arguments, corrected `toolcall_start` metadata, branded resume hints, and
cross-platform shell behavior.

### OmO beta.20

#### Exact native dependency

`omo-ai@5.0.0-0.beta.20` depends exactly on:

```text
@code-yeongyu/senpi: 2026.8.25
```

The native package is published on npm's `beta` channel. `latest` remains the
intentional placeholder, so install the beta tag or the exact prerelease.

#### Configuration and migration

The unified `~/.omo/omo.jsonc` surface remains the cross-harness configuration
contract. Legacy configuration migration is lock- and journal-backed, with
no-clobber diagnostics, migration markers, resumable backups, and dry-run/JSON
modes.

#### Skill and command migration

| Previous name | Beta.20 name | Migration |
|---|---|---|
| `/start-work` and `start-work` | `/ulw-execute` and `ulw-execute` | Hard cutover; no old-name alias. |
| `start-work-continuation` | `ulw-execute-continuation` | Update component paths and hooks. |
| `omo-senpi-start-work-continuation-disabled` | `omo-senpi-ulw-execute-continuation-disabled` | Rename the flag. |
| `skill_loaded: start-work` | `skill_loaded: ulw-execute` | Update telemetry queries. |
| `start_work` | `ulw_execute` | Old key reads for one release with a warning; new key wins. |
| `omo` executable | `omo-agent-toolkit` | Update direct invocations. |

The current native inventory includes `mass-ulw`, `ultrawork`, `ulw-plan`,
`ulw-loop`, `ulw-research`, `hyperplan`, `init-deep`, `dag-library`,
`onboarding`, and `give-me-tips`. This inventory is not a claim that every
listed skill was introduced in beta.20.

#### Reliability and orchestration

The beta.20 OmO line includes dependency-frontier DAG admission, honest paused
run headers and resume leases, non-blocking reattach paths, reflection run-id
collision protection, Bubblewrap degradation, lock-free journal scans and
flushes, Atlas cleanup on early exits, surface/install attribution telemetry,
and compiled native launcher/asset parity.

### Upgrade instructions

#### Native edition

```bash
npm install -g omo-ai@beta
# or:
npm install -g omo-ai@5.0.0-0.beta.20
```

#### Multi-harness edition

```bash
bun install -g oh-my-openagent@5.0.0-beta.20
# or:
npm install -g oh-my-opencode@5.0.0-beta.20
```

Replace direct `omo` invocations with `omo-agent-toolkit`. Rename
`start_work` to `ulw_execute` and use the new continuation-disable flag.

### Verification

The release chain was verified in order:

1. Senpi release dry-run, release gates, npm publication, and GitHub tag.
2. OmO exact dependency/version checks, native payload, generated bundle
   freshness, frozen install, and package containment checks.
3. npm beta metadata for `omo-ai`, the wrapper packages, and platform package
   surfaces.
4. Rich release content was applied above the generated GitHub changelog while
   preserving the generated content below it.

### Compatibility and known limitations

- This remains a beta release; provider availability and quotas are external.
- `/start-work` has no compatibility alias.
- `start_work` is a one-release compatibility read path and emits a warning.
- `omo-ai` is beta-only and `latest` remains a placeholder.
- Platform smoke jobs may depend on runner/container runtime libraries; their
  failure does not invalidate the npm package payload when the package gates
  and platform publication checks pass.

### Evidence sources

- Senpi: `v2026.8.24..v2026.8.25`, `af5f53b0d`, `a79b37334`, `99c711255`.
- OmO: `package.json`, `packages/omo-native/package.json`,
  `CHANGELOG.md`, `.github/workflows/publish.yml`, and the
  `get-unpublished-changes` procedure.
- Skill migration: `e3cb1486d`, `cc57d3908`, `2aece77f4`.
- QA evidence: `local-ignore/qa-evidence/beta20/`.

Desktop runtime work remains internal QA evidence for this release and is not
being exposed as a public Desktop download from the OmO beta release.

## [5.0.0-beta.21] - 2026-08-26

### OmO 5.0.0-beta.21 — hotfix

**If beta.20 killed your sessions, this is the release you want.**

#### The crash that killed sessions (beta.20) — fixed
`Error: The @earendil-works/pi-tui barrel was accessed before it was loaded` terminating the whole OmO process during mass-ulw / DAG / task work (#7339, #7340, #7351). Root cause: `omo-task.js` ships as an independent bundle with its own private copy of the lazy pi-tui state; the compose-level warm-up only warmed `omo.js`'s copy, the minifier collapsed the cold accessor into an unconditional throw, and the status-widget timer detonated it outside any try/catch.

The fix (#7354) is three layers deep:
- **Shared warm-up state across bundle copies** — both lazy boundaries (pi-tui and the senpi engine barrel) keep their memoized state on `globalThis` under process-wide symbols, so warming any copy satisfies every copy.
- **The task bundle warms its own copy at registration** — keeping its dynamic import alive through minification.
- **Render-fault containment** — task/DAG status widgets render from bare timers; a faulting frame now logs once and skips instead of killing your session. Ever again.
- Plus artifact-level regression tests that inspect the *built bundles* so minification can never silently strand a lazy barrel again.

#### Compaction reliability (the beta.19 complaints) — Senpi 2026.8.26 (#1124)
- Long sessions no longer stop compacting after ten successful compactions (the absolute cap is telemetry-only now; the failure circuit breaker still guards runaways).
- Todo snapshots no longer recursively retain full history (KB -> MB growth that refilled context right after compaction).
- A manual `/compact` with nothing to summarize no longer aborts an in-flight continuation.

#### Install hygiene (#1125)
- `bun i -g omo-ai@beta` no longer warns `incorrect peer dependency "@anthropic-ai/sdk@0.91.1"` — the SDK pin now satisfies claude-agent-sdk's `>=0.93.0` peer range (audited symbol-by-symbol, additive-only).

#### Credits
Community diagnosis nailed this one: @sanguneo (#7350), @NetVar1337 (#7341), @amsminn (#7352) — all three independently identified the bundle-copy split; their approaches are co-authored into the fix commits. Compaction fixes by @haamsuk-collab (#1124).

Install: `npm i -g omo-ai@beta`

---

- a17b91cdc Merge pull request #7356 from code-yeongyu/release/20260826-beta21-pin
- 1007748e5 Merge pull request #7354 from code-yeongyu/fix/pi-tui-cross-bundle-warmup

## [5.0.0-beta.22] - 2026-08-27

# OmO 5.0.0-beta.22 Release Summary

This release rides on Senpi 2026.8.26-2 and focuses on process lifecycle correctness: the launcher no longer orphans engines, `omo doctor` can find and clean up the orphans older versions left behind, broken installs fail fast with a real diagnosis, and DAG runs survive session restarts instead of getting stuck. It also reworks the default model fallback lanes and fixes home-directory config watching.

### Launcher and engine lifecycle (omo-native)

#### Signal forwarding: no more orphaned engines
Previously, both launcher layers (`node bin/omo.js` -> engine, plus the bun re-exec in between) blocked in `spawnSync`, where no JavaScript handler can run. A `SIGTERM` killed the launcher on the spot and left the engine reparented to pid 1, still holding your terminal. Those orphans later showed up as stdin `EIO` crashes and engine processes lingering for days.

Both layers now spawn asynchronously and:

- forward `SIGTERM` and `SIGHUP` to the engine
- give it a bounded grace window to shut down cleanly (10s, tunable via `OMO_SIGNAL_GRACE_MS`)
- re-raise the signal on themselves if the child ignores it, so supervisors still see the death they asked for

`SIGINT` (Ctrl-C) is deliberately not forwarded, since the terminal already delivers it to the whole foreground process group; the launcher just stops dying underneath the engine. Exit codes and signal-death status pass through unchanged. Windows installs no signal handlers.

#### `omo doctor` finds and reaps stale engines
`omo doctor` now lists interactive engine processes that earlier launcher versions orphaned (reparented to pid 1), with pid, age, and tty. Cleanup is explicit and per-pid:

```
omo doctor --reap <pid> [pid...]
```

It re-checks the live process table and refuses any pid that isn't an orphaned interactive engine at that moment (live sessions, rpc/app-server engines, or non-engine processes are never touched). There's no pattern-matching kill.

#### Corrupt install diagnosis at launch
A field report on Windows showed npm dying mid-install with EBUSY (a running engine locks native modules), leaving a tree with senpi's `dist/cli.js` intact but core modules missing. Launch then crashed with a raw `ERR_MODULE_NOT_FOUND` stack. The launcher preflight now verifies the brand contract module next to the CLI and, on a partial tree, fails fast with one actionable line: the missing file, the interrupted-upgrade diagnosis, and the reinstall command. On Windows it additionally explains that running omo/senpi processes cause exactly this partial state.

### Senpi 2026.8.26-2 and the config-watch fix

The pinned engine moves from 2026.8.26 to 2026.8.26-2 across the root workspace, `omo-ai` launcher, adapter, and task engine, aligned with the config-watch compatibility work (issue #7064, tracked by this worktree).

Senpi's config-reload host rejects watch registrations that cover protected agent-dir paths (`auth.json`, `sessions/`, `logs/`) unless root-anchored filter globs prove each watched path avoids them. OmO previously dropped any target whose path merely contained a protected path, which silently killed home-directory config watching. The filter now inspects the target's globs: targets whose root-anchored globs provably avoid the protected paths are kept, so `~/.omo/omo.jsonc` changes are picked up live again, while unsafe targets are still never emitted. The user-config creation watch also derives its glob set from the actual config directory name instead of a hardcoded `/omo`.

### DAG: detached waits and restart recovery

- **Wait detaches by default.** A model-facing `dag` wait used to hold the tool call open until the run settled, freezing the session turn for the whole run (38+ minutes observed in the wild). It now returns immediately with a detached envelope and a live snapshot; node completions and the terminal run wake still reach the session through the idle coordinator. Pass `detach: false` to restore blocking. The eval SDK and dag library keep blocking semantics internally, and an already-terminal run still returns its final result at once.
- **Orphaned runs get adopted.** A paused run whose parent session id never returns (fork, compaction, restart under a new id) was skipped forever as foreign. Recovery now adopts a run when there's proof of abandonment: the lease holder is this process or a dead pid. Live foreign holders and absent-holder records stay untouched. Adopted runs are fully re-homed (parent and root) and the resume is journaled.
- **Bridge attaches after recovery.** The RPC bridge used to attach before paused runs resumed, so its first `omo.dag.updated` snapshot showed stale paused state and downstream consumers flipped threads to Ready while children kept working. The first pushed snapshot is now the recovered one.
- **Status UI** rows and formatting were updated alongside the detach work.

### Model and fallback policy

- The `unspecified-high` chain is rebuilt opus-first: `claude-opus-5 xhigh -> glm-5.3 max -> kimi-k3 max` (previously kimi-k3-led). The category default follows the new head on both harnesses.
- The `vercel` provider leaves every builtin fallback lane; vercel-only registries fall through to the pinned system default, and the vercel-only `minimax-m2.7-highspeed` rung is dropped from explore/librarian.
- `quotio-openai` is purged from chain sources; every rung listing `openai` now also carries `openai-codex`.
- Telemetry vocabulary drops the `quotio-openai` key and gains `glm-5.3` for zai-coding-plan/opencode-go; the bundled capabilities snapshot gains the bare `glm-5.3` entry.
- The dead-chain category alert (all providers of one builtin category unconnected) is now an info-level notice instead of a yellow warning, since every other category remains usable. Suppression config and once-per-session dedup are unchanged.

If your setup depended on the vercel or quotio-openai default lanes, configure those providers explicitly.

### Skills and ulw-loop CLI

- `omo-agent-toolkit ulw-loop help` (and bare `help`/`--help`/no-args) now prints real subcommand help instead of a self-referential pointer or an unknown-component error; each subcommand answers `--help`/`-h`.
- The ulw-loop skill gets a minimal explicit 5-step run contract, drops a 40-line CLI-resolution bash blob in favor of the resolved CLI path now carried in the skill pointer, and fixes an `update_plan` leak (senpi exposes `todo`).
- When the ulw-loop pointer accompanies the directive, bootstrap defers to the loop's run contract, ending the dual-bootstrap confusion.
- mass-ulw, ultrawork, and dag-library skill docs are updated for the detached-wait default.

### Toolchain, CI, and build

- **Bun 1.4.0** is now the pinned workspace runtime in both CI and the devcontainer (previously 1.3.12 in the container), with a test guarding against drift.
- Root-test CI now shards every OS two ways, extending the proven Windows shape: shard 1 covers `packages/omo-opencode` + `packages/memory-core` in one serial process, and shard 2 runs a shared serial quarantine (one source of truth in `script/root-test-serial-quarantine.ts`) before the remainder. Job-level sharding replaced in-job `bun test --parallel` on Linux and macOS, which re-ran the heavy preload per file under `--isolate` and OOM-killed the 7 GB hosted runners; the dead `bunfig.root.parallel.toml` was removed. Two Windows tests that were running twice per shard now run once.
- Parallel lsp-daemon build artifacts are isolated to avoid dist races.
- Committed Senpi extension bundles and the generated model-capabilities snapshot are regenerated fresh for this release, so shipped runtime payloads match the source and the 2026.8.26-2 pin.

### Breaking changes

No new breaking changes in beta.22 itself. Note two behavior shifts: the DAG `wait` action detaches by default (pass `detach: false` for the old blocking behavior), and default fallback chains no longer include vercel or quotio-openai lanes.

### Upgrade

```
npm i -g omo-ai@beta
```

The beta channel contract is unchanged: every version is a prerelease published under `--tag beta`. After upgrading, run `omo doctor` once; if it lists stale orphaned engines from earlier launcher versions, clean them up with `omo doctor --reap <pid>`. Devcontainer users should rebuild the container to pick up Bun 1.4.0.

## [5.0.0-beta.23] - 2026-08-27

- 43d9c058e Merge pull request #7448 from code-yeongyu/fix/release-arm64-musl-smoke
- 8307b47c9 fix(release): install musl runtime for arm64 smoke
- f056bdcfb Merge pull request #7447 from code-yeongyu/fix/omo-native-windows-inprocess
- f9f483753 fix(omo-native): avoid Windows self-reexec
- 5e53d2733 Merge pull request #7445 from code-yeongyu/fix/omo-native-windows-argv-identity
- 650aee784 fix(omo-native): stop Windows self-provisioning loop
- 09fe012d6 Merge pull request #7443 from code-yeongyu/fix/omo-native-windows-copy
- 24c3c1611 fix(omo-native): copy Windows runtime without rename
- 1679b0fcd Merge pull request #7442 from code-yeongyu/fix/windows-ci-time-budgets
- 8897ead88 test(windows): widen integration time budgets
- 73a023c02 Merge pull request #7440 from code-yeongyu/fix/omo-native-windows-provisioning
- cf15df923 fix(omo-native): avoid locked Windows self-provisioning target
- 61f9583d3 Merge pull request #7439 from code-yeongyu/fix/release-platform-smoke-runtime
- db060f555 fix(release): align platform smoke runtime contracts
- 7eef11790 Merge pull request #7436 from code-yeongyu/fix/windows-lsp-daemon-build-shell
- 68211da9d fix(lsp-daemon): preserve spaced Windows runtime paths
- 4de49c0a0 Merge pull request #7434 from code-yeongyu/release/v5.0.0-beta.23-source-state
- 4e0ced272 fix(test): preserve Windows RPC admission timeout
- d3d294adc Merge pull request #7435 from code-yeongyu/chore/beta23-changelog-followups
- dfa171ce8 Merge pull request #7433 from code-yeongyu/fix/worktree-sweep-windows-timeout
- 0a5cf16c8 docs(changelog): record post-beta23 merges
- 5c2f56b99 Merge pull request #7430 from code-yeongyu/feature/post-mutation-pipeline
- 8323d15a2 merge: sync latest dev
- 462e21a59 test(debugging): give answering dap sessions a realistic request timeout
- 6939f6a62 test(debugging): tolerate cold-start latency in dap session waits
- b9631886e Merge pull request #7427 from code-yeongyu/release/v5.0.0-beta.23-source-state
- cdeaba6f7 merge: sync latest dev
- 3e1e6b377 Merge remote-tracking branch 'origin/dev' into release-beta23-source-refresh
- c6b1d190e Merge pull request #7432 from code-yeongyu/fix/windows-release-portability
- a7204c8a1 merge: sync dev into post-mutation pipeline
- faec5fe96 test(formatter): cover required policy override
- c890495e7 docs(formatter): clarify opt-in policy
- b7a094cda docs(qa): note CI bundle refresh
- 430cc5638 test(omo-opencode): raise worktree sweep clone timeout
- ae1e8370f Merge remote-tracking branch 'origin/dev' into fix/windows-release-portability
- 261a62cd2 fix(codex): preserve installer executable mode
- edf1fa369 fix(windows): harden dap and atomic persistence
- 9f420d5db fix(config): preserve absent format settings
- a5bb28c60 Merge pull request #7429 from code-yeongyu/fix/codex-650k-context-window
- d9d83ee03 fix(omo-codex): raise GPT-5.6 context window to 650k
- 8776e8025 Merge pull request #7420 from bokjk/fix/config-watch-duplicate-extension-standdown
- f356d1781 Merge pull request #7428 from code-yeongyu/feature/lsp-format-capability
- 8c4981fef test(lsp-core): prove a stale format edit cannot corrupt the file
- 3ccbfafcd test(lsp-tools-mcp): pin the format tool in the exported surface
- 884d5dda2 docs(lsp): record format capability QA evidence
- 3fa101d66 test(lsp-daemon): live QA driver for the format request
- 9033c2df3 feat(lsp-daemon): expose the format request on the client surface
- cbf5ea049 feat(lsp-core): expose formatting as an LSP tool
- 7eff4762e feat(lsp-core): format documents through the resident language server
- 84cae2987 feat(lsp-core): cap resident language server clients
- 0a8194d3c Merge pull request #7426 from code-yeongyu/release/20260827-beta23-pin
- 4c44bc7c1 Merge remote-tracking branch 'origin/dev' into release/20260827-beta23-pin
- ef2587905 Merge pull request #7425 from code-yeongyu/feat/debugging-dap-client
- 5fad12bfd Merge remote-tracking branch 'origin/dev' into feat/debugging-dap-client
- 2dc8f0cd9 feat(debugging): add zero-dependency DAP client script
- 339833ad5 Merge pull request #7424 from code-yeongyu/feature/lsp-core-local-binary-resolution
- e93fd066d fix(lsp-core): keep node-launched servers selectable
- c07e1d04e docs(lsp-core): describe repo-local binary resolution
- 224c233f9 test(lsp-core): live QA driver for repo-local binary resolution
- a0227ed27 feat(lsp-core): offer the repo-local install before the global one
- 106e626df feat(lsp-core): spawn the resolved server binary
- 1a33d028f feat(lsp-core): resolve repo-local language server binaries
- 0163d75d8 Merge pull request #7422 from code-yeongyu/feat/debugging-instruments
- 200531da1 docs(debugging): add Frida, structured-interface, and instrument references
- 7cf71e77b Merge pull request #7416 from code-yeongyu/fix/thread-receipts-followup
- 9e23380f3 docs(thread): name both routes to an uncertain receipt
- 63d0c1573 fix(thread): degrade to uncertain when a receipt side effect throws
- 1b046c39b Merge pull request #7415 from code-yeongyu/feat/thread-tools
- 20e456d0c docs(thread): component guide
- 1c0432b9e test(thread): resilience and restart scenarios
- 506835076 test(thread): cross-surface and ui-exposure qa
- 33ba9a60b feat(thread): ordered delivery mailbox
- 9aaf75259 feat(thread): cross-session prompt routing
- fda4e6d86 feat(thread): durable receipts and idempotency
- 533f23075 feat(thread): cross-project address book
- 5b01772c2 feat(thread): bounded transcript reader
- 998c1d933 feat(thread): addressing and scope resolution
- 6c498804c feat(thread): tool contracts and error taxonomy
- dde5d6898 Merge pull request #7406 from code-yeongyu/fix/7325-subagent-model-resolution
- 636c76342 fix(delegate): refresh subagent models and preserve fallback providers (#7325)
- 87d6aa41e Merge pull request #7403 from code-yeongyu/fix/7337-false-complete
- f2e7bec11 Merge pull request #7414 from code-yeongyu/test/dag-fallback-abort-waiter-guard
- 5e67b4575 fix(task): reject empty background completions (#7337)
- dc1ab0fd9 Merge pull request #7413 from code-yeongyu/fix/dag-owner-completion-loss
- 35ea43a38 Merge pull request #7409 from code-yeongyu/fix/7344-sdk-oauth-result
- 5f234ad9f Merge pull request #7407 from code-yeongyu/fix/1143-dag-start-barrel
- 0819b8bc4 test(claude-sdk-oauth): document patched runtime seam (#7344)
- f21b2e892 fix(claude-sdk-oauth): preserve unclaimed result causes (#7344)
- b98042a30 Merge pull request #7405 from code-yeongyu/fix/7355-pitui-barrel
- 9b127df82 Merge pull request #7404 from code-yeongyu/fix/7335-holdlock-orphan

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7427 from code-yeongyu/release/v5.0.0-beta.23-source-state

## [5.0.0-beta.24] - 2026-08-28

- e0ce56f0e Merge pull request #7453 from code-yeongyu/release/v5.0.0-beta.24-source-state

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7453 from code-yeongyu/release/v5.0.0-beta.24-source-state

## [5.0.0-beta.25] - 2026-08-28

### v5.0.0-beta.25 — stability rollback release

**This release re-ships the stable v5.0.0-beta.22 codebase as the newest beta.** beta.23/beta.24 introduced multiple regressions (interactive session/TUI defects among them), so beta.25 rolls the beta channel back to the last known-good tree while those changes are reworked on `dev`.

#### What's inside
- Product code identical to v5.0.0-beta.22 (senpi engine pin `2026.8.26-2`).
- One targeted backport: `fix(lsp-daemon): preserve spaced Windows runtime paths` (68211da9d), so Windows platform packages build from source instead of failing in the release pipeline.
- Release-infrastructure updates only (no runtime impact): current publish workflows adopted on the release lane — npm registry propagation retry, musl smoke `libstdc++`, Windows `USERPROFILE` provisioning.

#### Not inside
Post-beta.22 features and fixes that landed on `dev` are intentionally absent. They return in a future beta once the beta.22-parity audit passes.

#### Upgrade
```
npm i -g omo-ai@beta   # resolves to 5.0.0-0.beta.25
```

#### Verification
- Full 3-OS CI green on the release SHA `549009348`.
- 24/24 platform packages live on npm at `5.0.0-beta.25`.
- Fresh-install smoke: `omo 5.0.0-0.beta.25 (engine: senpi 2026.8.26-2)`.

## [5.0.0-beta.26] - 2026-08-29

- 727cf8432 Merge pull request #7470 from code-yeongyu/release/v5.0.0-beta.26-source-state
- 64d89819e Merge pull request #7457 from code-yeongyu/fix/publish-platform-gate-propagation
- c996037dd Merge pull request #7451 from MoerAI/fix/team-message-fallback-wake
- 2d9cb3295 fix(release): preserve the wrapper-refusal contract string in the gate
- bafe08f1d fix(team-mode): avoid retrying ambiguous fetch failures
- ada6d2e7f docs(qa): record post-merge validation
- 6084150ee fix(release): tolerate npm registry propagation in the platform gate
- bf0b2cc01 Merge upstream/dev into fix/5317-team-message-fallback-wake
- f113c5025 fix(team-mode): retry unreachable fallback routes
- ef1c392f1 Merge pull request #7455 from sanguneo/fix/windows-formatter-bin-shim-enoent
- 7ad84e9b1 Merge remote-tracking branch 'origin/dev' into fix/windows-formatter-bin-shim-enoent
- e0ce56f0e Merge pull request #7453 from code-yeongyu/release/v5.0.0-beta.24-source-state
- d9653750f fix(team-mode): persist fallback wake retries
- 5408b3189 fix(team-mode): bound fallback wake recovery
- 332c4905d docs(qa): record final transport retry proof
- 64fab24f5 fix(team-mode): retry fallback transport failures
- 7a042e176 fix(team-mode): skip pending mailbox wakes
- ffc24cad6 fix(prompt-gate): bound fallback revalidation
- b75e72a89 fix(team-mode): preserve unreadable fallback wakes
- 0194ccf85 fix(team-mode): cancel deleted-team fallback wakes
- 52d1f0d49 fix(team-mode): retry fallback revalidation
- 0237a1d15 fix(team-mode): retain coalesced fallback wakes
- c52c9b3ed fix(team-mode): preserve fallback delivery guards
- 7b5cbee74 docs(qa): record real team fallback route
- 6b395c51f fix(team-mode): drain pending delivery fallback wakes
- ccc847f3c fix(team-mode): attach issue 5317 QA command outputs
- 6b185475e fix(team-mode): condense issue 5317 verification evidence
- 555c81b75 fix(team-mode): wake idle members after delivery fallback (fixes #5317)
- 43d9c058e Merge pull request #7448 from code-yeongyu/fix/release-arm64-musl-smoke
- 8307b47c9 fix(release): install musl runtime for arm64 smoke
- f056bdcfb Merge pull request #7447 from code-yeongyu/fix/omo-native-windows-inprocess
- f9f483753 fix(omo-native): avoid Windows self-reexec
- 5e53d2733 Merge pull request #7445 from code-yeongyu/fix/omo-native-windows-argv-identity
- 650aee784 fix(omo-native): stop Windows self-provisioning loop
- 09fe012d6 Merge pull request #7443 from code-yeongyu/fix/omo-native-windows-copy
- 24c3c1611 fix(omo-native): copy Windows runtime without rename
- 1679b0fcd Merge pull request #7442 from code-yeongyu/fix/windows-ci-time-budgets
- 8897ead88 test(windows): widen integration time budgets
- 73a023c02 Merge pull request #7440 from code-yeongyu/fix/omo-native-windows-provisioning
- cf15df923 fix(omo-native): avoid locked Windows self-provisioning target
- 61f9583d3 Merge pull request #7439 from code-yeongyu/fix/release-platform-smoke-runtime
- db060f555 fix(release): align platform smoke runtime contracts
- 7eef11790 Merge pull request #7436 from code-yeongyu/fix/windows-lsp-daemon-build-shell
- 68211da9d fix(lsp-daemon): preserve spaced Windows runtime paths
- 4de49c0a0 Merge pull request #7434 from code-yeongyu/release/v5.0.0-beta.23-source-state
- 4e0ced272 fix(test): preserve Windows RPC admission timeout
- d3d294adc Merge pull request #7435 from code-yeongyu/chore/beta23-changelog-followups
- dfa171ce8 Merge pull request #7433 from code-yeongyu/fix/worktree-sweep-windows-timeout
- 0a5cf16c8 docs(changelog): record post-beta23 merges
- 5c2f56b99 Merge pull request #7430 from code-yeongyu/feature/post-mutation-pipeline
- 8323d15a2 merge: sync latest dev
- 462e21a59 test(debugging): give answering dap sessions a realistic request timeout
- 6939f6a62 test(debugging): tolerate cold-start latency in dap session waits
- b9631886e Merge pull request #7427 from code-yeongyu/release/v5.0.0-beta.23-source-state
- cdeaba6f7 merge: sync latest dev
- 3e1e6b377 Merge remote-tracking branch 'origin/dev' into release-beta23-source-refresh
- c6b1d190e Merge pull request #7432 from code-yeongyu/fix/windows-release-portability
- a7204c8a1 merge: sync dev into post-mutation pipeline
- faec5fe96 test(formatter): cover required policy override
- c890495e7 docs(formatter): clarify opt-in policy
- b7a094cda docs(qa): note CI bundle refresh
- 430cc5638 test(omo-opencode): raise worktree sweep clone timeout
- ae1e8370f Merge remote-tracking branch 'origin/dev' into fix/windows-release-portability
- 261a62cd2 fix(codex): preserve installer executable mode
- edf1fa369 fix(windows): harden dap and atomic persistence
- 9f420d5db fix(config): preserve absent format settings
- a5bb28c60 Merge pull request #7429 from code-yeongyu/fix/codex-650k-context-window
- d9d83ee03 fix(omo-codex): raise GPT-5.6 context window to 650k
- 8776e8025 Merge pull request #7420 from bokjk/fix/config-watch-duplicate-extension-standdown
- f356d1781 Merge pull request #7428 from code-yeongyu/feature/lsp-format-capability
- 8c4981fef test(lsp-core): prove a stale format edit cannot corrupt the file
- 3ccbfafcd test(lsp-tools-mcp): pin the format tool in the exported surface
- 884d5dda2 docs(lsp): record format capability QA evidence
- 3fa101d66 test(lsp-daemon): live QA driver for the format request
- 9033c2df3 feat(lsp-daemon): expose the format request on the client surface
- cbf5ea049 feat(lsp-core): expose formatting as an LSP tool
- 7eff4762e feat(lsp-core): format documents through the resident language server
- 84cae2987 feat(lsp-core): cap resident language server clients
- 0a8194d3c Merge pull request #7426 from code-yeongyu/release/20260827-beta23-pin
- 4c44bc7c1 Merge remote-tracking branch 'origin/dev' into release/20260827-beta23-pin
- ef2587905 Merge pull request #7425 from code-yeongyu/feat/debugging-dap-client
- 5fad12bfd Merge remote-tracking branch 'origin/dev' into feat/debugging-dap-client
- 2dc8f0cd9 feat(debugging): add zero-dependency DAP client script
- 339833ad5 Merge pull request #7424 from code-yeongyu/feature/lsp-core-local-binary-resolution
- e93fd066d fix(lsp-core): keep node-launched servers selectable
- c07e1d04e docs(lsp-core): describe repo-local binary resolution
- 224c233f9 test(lsp-core): live QA driver for repo-local binary resolution
- a0227ed27 feat(lsp-core): offer the repo-local install before the global one
- 106e626df feat(lsp-core): spawn the resolved server binary
- 1a33d028f feat(lsp-core): resolve repo-local language server binaries
- 0163d75d8 Merge pull request #7422 from code-yeongyu/feat/debugging-instruments
- 200531da1 docs(debugging): add Frida, structured-interface, and instrument references
- 7cf71e77b Merge pull request #7416 from code-yeongyu/fix/thread-receipts-followup
- 9e23380f3 docs(thread): name both routes to an uncertain receipt
- 63d0c1573 fix(thread): degrade to uncertain when a receipt side effect throws
- 1b046c39b Merge pull request #7415 from code-yeongyu/feat/thread-tools
- 20e456d0c docs(thread): component guide
- 1c0432b9e test(thread): resilience and restart scenarios
- 506835076 test(thread): cross-surface and ui-exposure qa
- 33ba9a60b feat(thread): ordered delivery mailbox
- 9aaf75259 feat(thread): cross-session prompt routing
- fda4e6d86 feat(thread): durable receipts and idempotency
- 533f23075 feat(thread): cross-project address book
- 5b01772c2 feat(thread): bounded transcript reader
- 998c1d933 feat(thread): addressing and scope resolution
- 6c498804c feat(thread): tool contracts and error taxonomy
- dde5d6898 Merge pull request #7406 from code-yeongyu/fix/7325-subagent-model-resolution
- 636c76342 fix(delegate): refresh subagent models and preserve fallback providers (#7325)
- 87d6aa41e Merge pull request #7403 from code-yeongyu/fix/7337-false-complete
- f2e7bec11 Merge pull request #7414 from code-yeongyu/test/dag-fallback-abort-waiter-guard
- 5e67b4575 fix(task): reject empty background completions (#7337)
- dc1ab0fd9 Merge pull request #7413 from code-yeongyu/fix/dag-owner-completion-loss
- 35ea43a38 Merge pull request #7409 from code-yeongyu/fix/7344-sdk-oauth-result
- 5f234ad9f Merge pull request #7407 from code-yeongyu/fix/1143-dag-start-barrel
- 0819b8bc4 test(claude-sdk-oauth): document patched runtime seam (#7344)
- f21b2e892 fix(claude-sdk-oauth): preserve unclaimed result causes (#7344)
- b98042a30 Merge pull request #7405 from code-yeongyu/fix/7355-pitui-barrel
- 9b127df82 Merge pull request #7404 from code-yeongyu/fix/7335-holdlock-orphan

**Thank you to 2 community contributors:**
- @sisyphus-dev-ai:
  - Merge pull request #7427 from code-yeongyu/release/v5.0.0-beta.23-source-state
  - Merge pull request #7453 from code-yeongyu/release/v5.0.0-beta.24-source-state
  - Merge pull request #7470 from code-yeongyu/release/v5.0.0-beta.26-source-state
- @MoerAI:
  - fix(team-mode): wake idle members after delivery fallback (fixes #5317)
  - fix(team-mode): condense issue 5317 verification evidence
  - fix(team-mode): attach issue 5317 QA command outputs
  - fix(team-mode): drain pending delivery fallback wakes
  - docs(qa): record real team fallback route
  - fix(team-mode): preserve fallback delivery guards
  - fix(team-mode): retain coalesced fallback wakes
  - fix(team-mode): retry fallback revalidation
  - fix(team-mode): cancel deleted-team fallback wakes
  - fix(team-mode): preserve unreadable fallback wakes
  - fix(prompt-gate): bound fallback revalidation
  - fix(team-mode): skip pending mailbox wakes
  - fix(team-mode): retry fallback transport failures
  - docs(qa): record final transport retry proof
  - fix(team-mode): bound fallback wake recovery
  - fix(team-mode): persist fallback wake retries
  - fix(team-mode): retry unreachable fallback routes
  - Merge upstream/dev into fix/5317-team-message-fallback-wake
  - docs(qa): record post-merge validation
  - fix(team-mode): avoid retrying ambiguous fetch failures
  - Merge pull request #7451 from MoerAI/fix/team-message-fallback-wake

## [5.0.0-beta.28] - 2026-08-30

- e885b64f7 Merge pull request #7504 from code-yeongyu/release/v5.0.0-beta.28-source-state
- 4d9150d8a Merge pull request #7502 from code-yeongyu/fix/test-fast-lifecycle-guard
- 35784893f fix(test): shut down surviving test-fast groups when a spawn fails
- de415501d test(script): pin the test-fast production spawn wiring and entry guard
- e72b97b7a test(script): compare full test-fast tiling scopes instead of package dirs
- d09f4363c fix(test): escalate SIGKILL to retained test-fast process groups
- 2b0fe9b1c refactor(test): narrow the raced-child kill error without a cast
- 3b9e8cf9f docs(script): describe the test-fast lifecycle guard and re-entry marker
- d38a44c59 refactor(test): inject the test-fast logger so unit tests capture banners
- d1c78941f test(script): pin the test-fast group partition against the bunfig tiling
- 89c5daf45 fix(test): kill test-fast group children when the parent is signalled
- e1adc57b8 fix(test): block test-fast re-entry with an env marker guard
- 6c5ace409 fix(omo-native): materialize runtime before the version fast-path
- e40b92191 Merge pull request #7503 from code-yeongyu/fix/bunfs-cursor-oauth-registration
- 59f56836a fix(omo-native): register bundled cursor OAuth flows
- 354a66883 Merge pull request #7501 from code-yeongyu/release/v5.0.0-beta.27-source-state
- ffd1519a0 merge: dev into rel/audit2-pin-bump; port launch guard and restore package-dir pin
- 59d0a674c Merge pull request #7499 from code-yeongyu/perf/compile-entry-fastpath
- 9261a81af Merge pull request #7498 from code-yeongyu/fix/dev-push-ci
- c5dca00b0 perf(omo-native): answer fast paths before provisioning and banner interactive boots
- 40f945fd0 refactor(omo-native): split embedded runtime provisioning out of compile-entry
- 6c34a9332 merge: fix/binary-startup into rel/audit2-pin-bump
- b4e0094c0 Merge pull request #7484 from code-yeongyu/fix/memory-lock-fixtures-win32
- 619c241be Merge pull request #7478 from code-yeongyu/fix/ulw-loop-cli-sb
- 817c4e082 Merge pull request #7476 from code-yeongyu/fix/drvfs-config-watch-sb
- 2e9e66891 Merge pull request #7477 from code-yeongyu/fix/lsp-session-cwd-sb
- 9ae3cf867 Merge pull request #7479 from code-yeongyu/fix/memory-lock-fixtures-sb
- fac61bafc Merge pull request #7482 from code-yeongyu/fix/data-scientist-uv-default-contradictions
- 89cd17c14 fix(shared-skills): purge stale uv-default wording after py-kernel change
- b13afc289 Merge pull request #7481 from code-yeongyu/feat/data-scientist-eval-py-default
- 35dbdda50 feat(shared-skills): make the resident py kernel the default polars surface
- 42e106cb4 Merge pull request #7480 from code-yeongyu/feat/data-scientist-hybrid-rewrite
- bc513358f fix(shared-skills): tighten data-scientist failure wording per review
- 082c54789 feat(shared-skills): rewrite data-scientist around resident kernels and placement
- 999c57113 fix(lsp): plumb session directory into request context
- 1e22cf258 fix(omo-native): skip the redundant 114MB self-copy on every launch
- 134b61b38 fix(omo-native): start the compiled binary without re-exec or a self-copy
- 7d874efc4 Merge pull request #7475 from code-yeongyu/feat/workflow-tool-rename
- 19d571cce merge: origin/dev into feat/workflow-tool-rename
- c034b5313 Merge pull request #7474 from code-yeongyu/feat/mass-ulw-research
- 87e1e9e9a Merge branch 'fix/thread-cursor-revision' into hotfix/regression-audit2
- 12b6c2f18 Merge branch 'fix/tui-sidebar-freeze' into hotfix/regression-audit2
- b137ea099 fix(tui): refresh sidebar content during renders
- 10c853a57 Merge branch 'fix/installer-tuple-plugins' into hotfix/regression-audit2
- 3a8076045 fix(omo-opencode): handle tuple-style opencode plugin entries
- 11665238d test(omo-opencode): cover tuple plugin entries in install detection and legacy toast
- ae9366464 test(omo-opencode): cover tuple-style opencode plugin entries
- ca87be2f1 fix(todo-continuation): preserve flat model variants
- 2b0fee2e3 test(todo-continuation): cover flat model variant preservation

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7501 from code-yeongyu/release/v5.0.0-beta.27-source-state
  - Merge pull request #7504 from code-yeongyu/release/v5.0.0-beta.28-source-state

## [5.0.0-beta.29] - 2026-08-30

### OMO v5.0.0-beta.29

Re-release of the beta.28 line with the engine bumped to **senpi 2026.8.30-2** — the shared-host / connection surfaces are now **disabled by default**.

**Headline**
- **Shared session host + connection surfaces are OFF by default.** omo interactive sessions run standalone unless you opt in via the `experimental.sharedHost` setting or `OMO_ENABLE_SHARED_HOST=1`. Nothing changes in the TUI when you don't opt in — this closes the default-on RPC connection surface.

**Engine (senpi 2026.8.30 → 2026.8.30-2, 65 commits)**
- Security: RPC trust requires the agent directory.
- Compaction pipeline overhaul: large-window tiers, scaled reserve, speculative summary warming, oversized tool-result spill with read-back pointers, grace band + admission + deterministic breaker fallback, pre-compaction reminder.
- RPC fixes: compiled-binary shared-host launch, wrapper-injected internal host route, durable session identity across rebinds, binding-time tool changes no longer cancel client work.
- Anthropic fallback-marker replay 400 fix.

**omo-side changes since beta.28**
- fix(librarian): update legacy context7 tool name and remove orphaned table syntax (#7505, @KasimKaizer)
- chore(release): bump senpi engine pin to 2026.8.30-2 (`922a0c56e`)
- fix: DAG journal staleness (#7511)
- fix(test): make test-fast assertions Windows-safe — unblocks Windows CI shards (#7512)
- feat: Codex usage reporting was merged (#7508) and reverted (#7509) in the same window — net no change in this release.

Install: `npm i -g omo-ai@beta`

_omo delta: 20 commits since v5.0.0-beta.28 · engine delta: 65 commits (senpi v2026.8.30 → v2026.8.30-2)_

---

#### Commits

- 443103494 Merge pull request #7515 from code-yeongyu/release/v5.0.0-beta.29-source-state
- 30e4b5fd4 Merge pull request #7511 from code-yeongyu/fix/7412-dag-journal-staleness
- 212c2ceae Merge pull request #7512 from code-yeongyu/fix/test-fast-windows-assertions
- fda71c56c fix(test): make test-fast assertions Windows-safe
- bd73775af Merge pull request #7505 from KasimKaizer/fix/librarian-context7-and-table-syntax
- d813385d3 Merge pull request #7509 from code-yeongyu/revert-7508-feature/codex-usage-reporting
- 64039129e Revert "feat: report OpenAI Codex plan and quota usage"
- e7c3f546f Merge pull request #7508 from code-yeongyu/feature/codex-usage-reporting
- 587a5cf1a feat(cli): register Codex usage command
- a65c89f0f feat(cli): add Codex usage output
- 67d2a38bf feat(codex): format quota summaries
- 2b9bfe92c feat(codex): read quotas through app server
- 3cab9f937 feat(codex): normalize account usage reports
- f9840d4ba fix(librarian): update legacy context7 tool name and remove orphaned table syntax

**Thank you to 3 community contributors:**
- @KasimKaizer:
  - fix(librarian): update legacy context7 tool name and remove orphaned table syntax
- @KNN-07:
  - feat(codex): normalize account usage reports
  - feat(codex): read quotas through app server
  - feat(codex): format quota summaries
  - feat(cli): add Codex usage output
  - feat(cli): register Codex usage command
  - Merge pull request #7508 from code-yeongyu/feature/codex-usage-reporting
  - Revert "feat: report OpenAI Codex plan and quota usage"
  - Merge pull request #7509 from code-yeongyu/revert-7508-feature/codex-usage-reporting
  - Merge pull request #7505 from KasimKaizer/fix/librarian-context7-and-table-syntax
- @sisyphus-dev-ai:
  - Merge pull request #7515 from code-yeongyu/release/v5.0.0-beta.29-source-state

## [5.0.0-beta.30] - 2026-08-30

# omo-ai v5.0.0-beta.30 (npm 5.0.0-0.beta.30)

This is a hotfix release. Steering a message into a running turn while the shared interactive host socket dropped used to lose the message and throw a raw "Error: Client not started". The underlying fix ships in the engine (senpi PR #1220): a typed RpcTransportGoneError, an onDisconnect notification, and reconnect-or-fallback orchestration. The TUI now degrades gracefully when the host connection goes away, and your steering message isn't lost.

### Engine (senpi v2026.8.30-3)
- rpc: session events survive a deferred rebind and are delivered once the client reattaches.
- pty and terminal: screen writes are serialized with a bounded backlog, queued writes and resizes are absorbed or merged cleanly, and replays no longer split or drop under trim and flush.
- compaction: a broad correctness pass covering deterministic fail-safe tool admission, preserved structured tool results and lane ownership, retry-safe reminders, and a shared admission cap for multipart results.
- models: context downswitches are admission-checked against the target usable budget, equal-budget provider switches work, and invalid selections roll back.

### omo-ai changes
No omo-side commits land in this release. It picks up the engine hotfix above, so upgrading is still recommended: the "Client not started" crash path affected the omo TUI directly.

---

#### Commits

- 3abc23c23 Merge pull request #7517 from code-yeongyu/release/v5.0.0-beta.30-source-state

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7517 from code-yeongyu/release/v5.0.0-beta.30-source-state

## [5.0.0-beta.31] - 2026-08-31

- 62ed79525 Merge pull request #7555 from code-yeongyu/release/v5.0.0-beta.31-source-state
- e5b910f76 Merge pull request #7551 from code-yeongyu/deslop-w1
- 6ec04f9e9 Merge pull request #7553 from code-yeongyu/fix/recall-mode-assertions-win32
- 6e3b1ed72 test(memory-core): gate recall file-mode pins to POSIX platforms
- 24cc17ad5 revert: drop out-of-scope W1 changes flagged by strict merge review
- a7e33a667 build(omo-codex): regenerate install-dist bundle for W1 source changes
- 3307fb251 docs: refresh re-export shim inventory for W1 deletions (316 -> 315)
- 6974bbdb1 fix(omo-opencode): restore model-fallback chain accessor refuted by hook tests
- b0fe2f334 fix(omo-opencode): restore concurrency manager + stream-activity exports refuted by build
- 3a4874ac1 fix(omo-opencode): restore barrel-imported cache/polling exports refuted by typecheck
- 7074d2c87 fix(model-core): remove unused compatibility ladder
- 0290c3613 chore(utils): remove dead prompt slop
- 847eb39c5 chore(memory-core): remove stale layout comment
- c1e4c1399 chore(ast-grep-mcp): remove redundant comments
- a055e6c3d chore(lsp-tools-mcp): remove unused re-export modules
- fe6c85dc0 chore(omo-opencode): remove dead code and redundant comments
- 8e8d06c90 test(omo-native): give the packed consumer install room on slow runners
- ea2918f12 Merge pull request #7543 from code-yeongyu/fix/7537-ulw-gate-reviewer-surface
- 2ef02d905 fix(qa): ignore volatile settings stamps
- e49207369 style(codex-ulw-loop): apply biome formatting to the surface tests
- 51716a4b9 feat(codex-ulw-loop): resolve reviewer identities per toolkit surface
- c53faf72f Merge pull request #7539 from code-yeongyu/fix/dag-queued-node-running-transition
- f9069472e Merge pull request #7538 from code-yeongyu/feat/memorian-recall
- 940ccf01b fix(memory): narrow the custom-message transcript exclusion to memory channels
- 594715c65 fix(memory-core): exclude only the reserved root system tree from recall
- 31bc71ccd fix(memory-core): render each recall candidate as its own sourced block
- 613929594 fix(hooks): close legacy snapshot race
- 1f5c143b6 fix(memory-core): keep extension-injected messages out of transcript search
- 7a15a85d3 feat(omo-config-core): add memory.recall settings block
- cc199ea8c feat(memory-core): barrel-export the recall surface
- 51a665c84 feat(memory-core): add recall runtime paths to identity layout
- e0874d361 feat(memory-core): append recall receipts as JSONL
- 49d9abdee feat(memory-core): persist session recall ledger
- 7ca2fde15 feat(memory-core): render recall message block
- a451625ad feat(memory-core): select recall candidates by lexical match
- a42165733 feat(memory-core): plan short recall queries from recent texts
- f859ece5d feat(memory-core): load committed recall corpus from HEAD tree
- 09f8e43f5 Merge pull request #7500 from minpeter/fix/local-fomo-oauth
- 7017a76cc docs(evidence): record lsp pool RED/GREEN remote runs
- 0173eb2be test(lsp-core): fail initialization on the first generation only
- 50673b9c1 fix(lsp-core): tombstone in-flight client stops and bound dead-client respawns
- fe9c407a2 fix(lsp-core): collapse workspace roots to the git repository root
- 3ea5b056e test(lsp-core): pin monorepo root collapse and stop/respawn pool invariants
- d50518d45 Merge pull request #7526 from code-yeongyu/fix/mem-delegation-lifecycle
- 7603a66eb Merge pull request #7525 from code-yeongyu/fix/mem-mcp-idle-teardown
- 51ddd6eca Merge pull request #7530 from code-yeongyu/ci/bot-merge-summary
- ffbee1a97 Merge remote-tracking branch 'origin/dev' into fix/local-fomo-oauth-delivery
- d682f34aa test(omo-native): record round-two isolated QA
- 5cda20141 test(hooks): bound synchronized subprocess contracts
- a16929084 ci(bot-merge): write the mandatory job summary and register the workflow expectation
- 7c3cb8366 docs(evidence): record the unavailable-stub idle regression fix and dist regen
- 60cd9e1d3 fix(omo-codex): keep the unavailable codegraph stub alive on the codex host
- 8da24e3c1 fix(omo-opencode): restore continuation cleanup on every exit
- 11f1274cd Merge pull request #7527 from code-yeongyu/fix/mem-hook-cache-evictions
- 23afd7661 Merge pull request #7523 from code-yeongyu/fix/mem-signal-test-orphans
- ab3aa3c39 Merge pull request #7522 from code-yeongyu/fix/mem-tui-mirror-heartbeat
- 8a9ad069e Merge pull request #7529 from code-yeongyu/ci/bot-merge-workflow
- 69a59ac2b Merge pull request #7528 from code-yeongyu/fix/sisyphus-agent-gh-login
- 66fbcfe6e fix(omo-opencode): preserve continuation revival cleanup
- b83de56f7 ci(sisyphus-agent): clear token env vars for the gh auth login call
- dc57ba59e fix(omo-opencode): preserve continuation anchors and revival cleanup
- 9903d6db0 fix(omo-opencode): preserve delegation queue and wake history semantics
- 6b0d5075a fix(omo-opencode): keep sync poller completion detection live under fetch gating
- 924abd75b fix(hooks): bridge legacy state writers safely
- a7d244b38 fix(omo-opencode): harden delegated lifecycle test compatibility
- 481872523 wip(omo-opencode): harden delegated lifecycle test compatibility
- 5ca094ee7 fix(omo-opencode): keep sync poller completion detection live under fetch gating
- 88c6547d3 fix(omo-opencode): narrow optional session.delete before deferred invocation
- b15842ee1 fix(omo-opencode): narrow optional session.delete before deferred invocation
- bc6729c22 docs(omo-opencode): record delegation memory evidence
- 2325af33a docs: record hook cache eviction TDD evidence
- 43edd7803 test(hooks): isolate fsync skip start-time cleanup
- 3fec0c26f fix(hooks): prune unmatched fsync-skip start times
- a9ef102ee fix(hooks): sweep hashline pending file captures
- 4b642597d fix(hooks): drain unbounded session-id hook sets
- 88c72a4d0 fix(hooks): clear anthropic recovery maps on dispose
- 284d6f9ba fix(hooks): prune idle transcript cache snapshots
- 5409c6f87 test(omo-native): record isolated OAuth QA
- 0bf2bbe29 test(hooks): fail until idle hook caches evict
- 78cda27bc docs(evidence): record RED/GREEN and per-site respawn verdicts for MCP idle teardown
- b9374cd46 docs(mcp): record why idle timeouts stay disabled on no-respawn hosts
- 5d7bad4b1 test(omo-native): document signal fixture cleanup evidence
- 6f2a1673e test(omo-native): track re-exec fixture pid
- 17ba153b7 fix(omo-opencode): wire tui mirror into plugin disposal
- 6de61a709 test(omo-opencode): cover tui mirror disposal assembly wiring
- 4e08c44c5 test(omo-native): await fixture process reaping
- b45acd6c5 test(omo-native): make fixture reaping verification reliable
- 0774fb780 fix(omo-opencode): release delegated subagent lifecycle resources
- 4905b4b5d test(omo-native): reap signal fixture children in teardown
- dafd8ca0a fix(omo-opencode): unref tui mirror heartbeat and stop it on dispose
- b607d24b5 test(omo-native): record signal fixture child pids
- 42740d0dd fix(mcp-stdio-core): drop unused handler param and share child-spawn setup
- 278d92faa fix(mcp-stdio-core): destroy stdin on idle timeout so abandoned servers exit
- 9597bb72d test(omo-opencode): cover tui mirror heartbeat disposal lifecycle
- 4f71cd7d9 test(hooks): isolate publication failure injection
- 0e5293b51 Merge commit '3abc23c23bae150f0276f8596dbda50edb310844' into fix/local-fomo-oauth-delivery
- f98128cfe fix(omo-native): bundle OAuth and harden hook state

**Thank you to 3 community contributors:**
- @minpeter:
  - fix(omo-native): bundle OAuth and harden hook state
  - Merge commit '3abc23c23bae150f0276f8596dbda50edb310844' into fix/local-fomo-oauth-delivery
  - test(hooks): isolate publication failure injection
  - test(omo-native): record isolated OAuth QA
  - fix(hooks): bridge legacy state writers safely
  - test(hooks): bound synchronized subprocess contracts
  - test(omo-native): record round-two isolated QA
  - Merge remote-tracking branch 'origin/dev' into fix/local-fomo-oauth-delivery
  - Merge pull request #7500 from minpeter/fix/local-fomo-oauth
- @lifrary:
  - fix(mcp-stdio-core): destroy stdin on idle timeout so abandoned servers exit
  - fix(mcp-stdio-core): drop unused handler param and share child-spawn setup
- @sisyphus-dev-ai:
  - Merge pull request #7522 from code-yeongyu/fix/mem-tui-mirror-heartbeat
  - Merge pull request #7523 from code-yeongyu/fix/mem-signal-test-orphans
  - Merge pull request #7527 from code-yeongyu/fix/mem-hook-cache-evictions
  - Merge pull request #7525 from code-yeongyu/fix/mem-mcp-idle-teardown
  - Merge pull request #7526 from code-yeongyu/fix/mem-delegation-lifecycle
  - Merge pull request #7555 from code-yeongyu/release/v5.0.0-beta.31-source-state

## [5.0.0-beta.32] - 2026-09-02

- d85fa7ba7 Merge pull request #7629 from code-yeongyu/release/v5.0.0-beta.32-source-state
- 716adb407 Merge pull request #7628 from code-yeongyu/fix/publish-platform-prebuilt-inputs
- daa6a0e5f fix(release): build missing prebuilt inputs in omo-native staging
- 9af5b8b52 Merge pull request #7627 from code-yeongyu/fix/windows-io-test-budgets
- 8887260e9 test(windows): widen legacy daemon fixture readiness budget
- 60c8577fc Merge pull request #7624 from MoerAI/fix/7541-grok-output-reserve
- b5a757323 fix(model-core): cap grok output reserve when output limit equals context window (fixes #7541)
- b4ad3c392 Merge pull request #6274 from fivetaku/docs/insane-search-v0.10.0
- e71937305 Merge pull request #6739 from LYY/fix/6732-parent-wake-variant
- efd9ad6a5 Merge pull request #6728 from SoShymKing/fix_windows_build
- 69cb6f2cf Merge pull request #6633 from EZotoff/fix/truncation-rework
- 2a4c30cfe Merge pull request #5933 from dihak/fix/session-list-sdk-directory-filter
- 3b69d879a Merge pull request #4233 from codeg-dev/fix/boulder-null-active-plan
- ea827d23a Merge pull request #5676 from Hungdoan565/codex/refactor-skills-async-allowed-tools-parser-20260628
- 50b66aac1 Merge pull request #5678 from Hungdoan565/codex/fix-skill-merge-allowed-tools-normalization-20260628
- 397fe4baa Merge pull request #5677 from Hungdoan565/codex/fix-config-skill-allowed-tools-normalization-20260628
- 2760b04cd Merge pull request #5683 from Hungdoan565/codex/fix-mcp-redact-slack-tokens-20260628
- 3937bfa69 Merge pull request #5698 from Hungdoan565/codex/fix-model-format-empty-segments-20260628
- 8a266bb8a Merge pull request #5704 from Hungdoan565/codex/fix-utils-contains-path-realpath-fallback-20260628
- a08c2f537 Merge pull request #5694 from Hungdoan565/codex/fix-utils-frontmatter-bom-20260628
- bfc685b58 Merge pull request #5693 from Hungdoan565/codex/fix-utils-tool-name-whitespace-20260628
- d6e87f538 Merge pull request #5692 from Hungdoan565/codex/fix-utils-onedrive-segment-20260628
- a13fe9e5a Merge pull request #5633 from Hungdoan565/codex/fix-utils-tar-listing-preserve-whitespace-20260627
- 72344026f Merge pull request #5675 from Hungdoan565/codex/test-rules-engine-markerless-workspace-20260628
- a6a05c24a Merge pull request #5648 from Hungdoan565/codex/test-lsp-parameter-helpers-20260627
- dc011a598 Merge pull request #5646 from Hungdoan565/codex/test-tmux-layout-width-clamp-20260627
- 0bfb7261f Merge pull request #5644 from Hungdoan565/codex/test-tmux-pane-dimensions-null-20260627
- aa38e8d89 Merge pull request #5642 from Hungdoan565/codex/test-openclaw-command-timeout-bounds-20260627
- 2759fa0b2 Merge pull request #5640 from Hungdoan565/codex/test-telemetry-env-normalization-20260627
- c4035b08b Merge pull request #5235 from JSap0914/docs/4314-notification-attention
- f00405a0a Merge pull request #5229 from JSap0914/docs/3355-delegation-tool-boundary
- 34c670152 Merge pull request #5223 from JSap0914/docs/3729-agent-temperature-docs
- 50bab07e4 Merge pull request #7402 from MoerAI/fix/codex-ulw-review-no-progress
- ca6ce0143 fix(ulw-loop): fix concurrent race and test env capture order
- 4c724235d fix: sort node: imports alphabetically in spawn-guard.ts for Biome
- 8e5689bad fix(ulw-loop): gate-artifact check before reviewer quota, V1/V2 non-reviewer early exit, atomic counter writes
- cf83cf6f7 fix(ulw-loop): check fan-out eligibility before charging reviewer quota
- 95a3d0fe2 Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- a4c364b94 Merge pull request #7618 from code-yeongyu/fix/flake-dag-subscriber-overflow
- 4acea4598 Merge pull request #7617 from code-yeongyu/fix/flake-hook-timeout
- 3b313be1f test(windows): make hook command fixtures shell-portable
- 4becf568e Merge pull request #7615 from code-yeongyu/fix/flake-git-memory-repo
- f1fc77013 Merge pull request #7613 from code-yeongyu/fix/flake-plugin-entry
- db804d3eb Merge pull request #7612 from code-yeongyu/fix/flake-rpc-child-windows
- d08047483 Merge pull request #7614 from code-yeongyu/fix/flake-dag-attach-residual
- 005a668be fix(memory): skip default git template files
- 846eda2bc refactor(test): drop subprocess-shaped wrapper from plugin-entry tests
- 2008f3756 test(omo-opencode): avoid subprocess plugin entry checks
- b027a45ff Merge pull request #7610 from code-yeongyu/fix/flake-mcp-child-proc
- 7ad8121f5 Merge pull request #7609 from code-yeongyu/fix/flake-skills-discover
- 560790f87 Merge pull request #7611 from code-yeongyu/fix/flake-lsp-freshness-sibling
- d18877fbf test(lsp-core): make diagnostics freshness deterministic
- 425573633 test(skills-loader): isolate blocking discovery fixtures
- b2edc8b6e Merge pull request #7608 from code-yeongyu/fix/flake-memfs-backup
- 945524445 Merge pull request #7607 from code-yeongyu/fix/flake-dag-runtime-trio
- bd3dedfd3 Merge branch 'dev' into fix/6732-parent-wake-variant
- 6b05f8f21 Merge branch 'dev' into fix_windows_build
- dff4a156a Merge pull request #7606 from code-yeongyu/fix/flake-credential-inheritance
- 10a1d0ef0 Merge branch 'dev' into fix/truncation-rework
- df6217ce5 Merge branch 'dev' into docs/insane-search-v0.10.0
- 99a7bd04e Merge branch 'dev' into fix/session-list-sdk-directory-filter
- dd29f6a20 Merge branch 'dev' into codex/fix-model-format-empty-segments-20260628
- 05a35165c Merge branch 'dev' into codex/fix-utils-contains-path-realpath-fallback-20260628
- 77a9f3a83 Merge branch 'dev' into codex/fix-utils-frontmatter-bom-20260628
- cc14bca4c Merge branch 'dev' into codex/fix-utils-tool-name-whitespace-20260628
- 45315e686 Merge branch 'dev' into codex/fix-utils-onedrive-segment-20260628
- b4190081f Merge branch 'dev' into codex/fix-mcp-redact-slack-tokens-20260628
- 5e421a7f7 Merge branch 'dev' into codex/refactor-skills-async-allowed-tools-parser-20260628
- 1bcb99d43 Merge branch 'dev' into codex/fix-skill-merge-allowed-tools-normalization-20260628
- 92af7172f Merge branch 'dev' into codex/fix-config-skill-allowed-tools-normalization-20260628
- 733c6344b Merge branch 'dev' into codex/test-rules-engine-markerless-workspace-20260628
- 9cfc54326 Merge branch 'dev' into codex/test-lsp-parameter-helpers-20260627
- 4a57a9d3e Merge branch 'dev' into codex/test-tmux-layout-width-clamp-20260627
- 21d4d7374 Merge branch 'dev' into codex/test-telemetry-env-normalization-20260627
- 89339a166 Merge branch 'dev' into codex/test-tmux-pane-dimensions-null-20260627
- 8a646ea94 Merge branch 'dev' into codex/test-openclaw-command-timeout-bounds-20260627
- e35ab5810 Merge branch 'dev' into codex/fix-utils-tar-listing-preserve-whitespace-20260627
- 8922fb541 Merge branch 'dev' into docs/4314-notification-attention
- 9a3b925ae Merge branch 'dev' into docs/3355-delegation-tool-boundary
- 26d76dec7 Merge branch 'dev' into docs/3729-agent-temperature-docs
- 555beab21 Merge branch 'dev' into fix/boulder-null-active-plan
- 75107fba3 Merge pull request #7603 from code-yeongyu/fix/staging-windows-red
- 4ef2e5983 test(omo-native): isolate credential import roots
- 4bf82a3ef Merge pull request #7604 from code-yeongyu/fix/flake-setup-sibling
- a4fc3e07b fix(omo-native): isolate concurrent staging builds
- 185a90b30 Merge pull request #7602 from code-yeongyu/fix/facts-store-windows-red
- 4b8a9304b fix(memory-core): remove unsafe lock fallback
- b0658ba82 Merge pull request #7599 from code-yeongyu/fix/flake-team-send
- 1061501da fix(omo-native): avoid needless sqlite setup fixtures
- 0758fe2b6 Merge pull request #7601 from code-yeongyu/fix/flake-dag-abort
- 0c6f70c0d fix(memory-core): bound shared candidate leaks
- 987a44fe3 fix(memory-core): reclaim shared lock candidates
- dda5f783f Merge pull request #7596 from code-yeongyu/fix/flake-manifest-parity
- 6f5b2ee5c test(team-mode): cover ambient live delivery settle default
- 580c33a18 Merge pull request #7595 from code-yeongyu/fix/flake-worktree-sweep
- 06288fdb8 test(memory-core): assert portable facts ledger permissions
- 97692c27b fix(memory-core): tolerate Windows lock candidate sharing
- 4ad0bfc50 fix(team-mode): settle live delivery tests deterministically
- c469f0302 Merge pull request #7598 from code-yeongyu/fix/flake-mcp-loader
- 9b6c0a8e5 test(release): use fixture for manifest parity
- 47acf2100 test(worktree-sweep): make age fixture deterministic
- 0e89523f1 Merge pull request #7597 from code-yeongyu/fix/flake-bg-queue
- 6b73ce3b1 fix: hermetically test MCP loader defaults
- da6fa68f5 fix(team-mode): make ambiguous delivery test deterministic
- 3546a1f4b test(background-agent): make queue integration deterministic
- 55c642e66 build(omo-codex): refresh the committed codegraph dist and local installer
- 124d24ddc Merge pull request #7589 from code-yeongyu/fix/lsp-freshness-test-determinism
- a1d6e1c29 Merge pull request #7590 from code-yeongyu/fix/supervisor-outcome-flake
- b680e29bc test(lsp-core): drive diagnostics freshness through a controlled clock
- 033deb5e9 Merge pull request #7592 from code-yeongyu/fix/memory-dir-one-process
- c9a3d605f Merge pull request #7591 from code-yeongyu/fix/facts-quick-pin
- b14e3c4cb docs(evidence): record QA for the facts quick-pin fallback fix
- fab28ed5e Merge pull request #7588 from code-yeongyu/perf/dream-o1-volume-gate
- 24c909c4e Merge pull request #7586 from code-yeongyu/fix/env-cleaner-hermetic-windows
- 55e204b3f fix(memory-core): backfill legacy reflection offsets
- 5ec11ff57 test(memory-core): assert reflected journal byte offset
- 40b45d34f perf(memory-core): include contextual rows in cursor offset
- f9f957ecc Merge pull request #7571 from code-yeongyu/feat/memorian-gate
- 595edb060 test(script): stage the memorian persona in the packed-layout fixture
- f7ea793ff fix(memory-core): verify payload ownership before retracting a pending file
- 6970d8039 feat(memory-core): stamp pending nudges with the compaction epoch
- f32f8e677 test(memory-core): pin the pending epoch and the delete collision guard
- d8a6d7569 feat(memory-core): let PendingNudges retract one session's payload
- de6e0651a refactor(memory-core): sweep dead recall surface
- e4aed73b3 feat(memory-core): add memorian persona asset
- f08930fa9 feat(memory-core): add memorian gate contract and pending store
- f6d455627 refactor(omo-config-core): shrink memory.recall to enabled and max_items
- d2f090992 refactor(memory-core): drop recall receipts
- ace706ec5 fix(mcp-client-core): make env filtering hermetic on Windows
- ffdc8baa9 Merge pull request #7582 from code-yeongyu/feat/dream-session-reconcile
- 43ca37ca6 Merge pull request #7580 from code-yeongyu/fix/shutdown-drain-severity
- c67f8165b Merge pull request #7581 from code-yeongyu/feat/opengateway-kimi-k3-ultrafast-256k
- 649378d6b Merge pull request #7578 from code-yeongyu/perf/dream-single-scan
- 60d36ef53 fix(omo-opencode): register kimi-k3-ultrafast with a 256k default context
- 51137a647 Merge pull request #7577 from code-yeongyu/feat/ulw-loop-gate-review-only
- ffafb1d98 style(ulw-loop): satisfy component biome check in quality-gate-artifacts
- 410d19379 refactor(ulw-loop): single-pass defect aggregation and artifact-primitive extraction
- c7c682c59 fix(ulw-loop): checkpoint --print-template works without --goal-id
- c216a5745 docs(ulw-loop): exact checkpoint sequence + template guidance in both harness refs
- 71af40c13 fix(ulw-loop): satisfy strict tsc and biome across branch test files
- edbbaa3f4 docs(ulw-loop): record why component commands stay npm under the bun-only toolchain
- 6aecff37b feat(ulw-loop): guided recovery messages for snapshot, plan, and session-id errors
- 3655e4439 feat(ulw-loop): aggregate quality-gate validation errors into one report
- 391daed8f feat(ulw-loop): checkpoint --print-template emits surface-aware gate skeletons
- ac99f53c0 feat(ulw-loop): checkpoint validates quality gate per reviewer surface
- b35ae37c2 Merge pull request #7585 from code-yeongyu/ci/review-claims-gate-summary-name
- 5a7cefdb7 ci(review-claims): name summary steps per the job-summary contract
- a1be34a01 Merge pull request #7584 from code-yeongyu/ci/review-claims-gate-refresh
- a463794bd ci(review-claims): refresh the gate check after automated claim release
- f9e0b3317 Merge pull request #7576 from code-yeongyu/ci/review-claims-sweep-backstop
- 355ba4208 ci(review-claims): add hourly sweep release backstop for restricted-token contexts
- 7af00123d Merge pull request #7572 from code-yeongyu/ci/review-claim-labels
- 6a8e7a825 Merge pull request #7575 from code-yeongyu/feat/opencode-verifier-fallback
- 8965e85d2 feat(omo-opencode): category-chain fallback verifier for ultrawork verification
- b63ea2609 test(ci): follow the bumped action versions in workflow shape tests
- 2636aa1f7 fix(ci): register review-claims in the job-summary contract
- 4335479d2 feat(memory-core): extend the resilient fs surface for adapter adoption
- e2996f4af fix(memory): stale candidate sweep + recoverable bind-time reconcile contention (#7567)
- 1956728f8 chore(ci): bump GitHub Actions to latest majors
- e03c56aca feat(ci): add review-claim label system
- 68f5dd61a fix(memory-core): sweep stale lock candidates and tolerate publish races
- 134120193 feat(memory-core): EINTR-resilient fs boundary (#7566)
- 889514916 fix(memory-core): honor abort signals and handle flushes in resilient writes
- 3f61b95c9 test(memory-core): harden the direct node:fs import detector
- 7e69389f4 fix(memory-core): retry EINTR at the write(2) boundary and guard exclusive creates
- 3e9344525 refactor(memory-core): route fs imports through the resilient boundary
- d34c774b0 feat(memory-core): add EINTR-resilient fs boundary
- ffefeb2aa Merge pull request #7565 from code-yeongyu/fix/reflection-bind-lock-contention
- 800b46605 fix(memory): defer bind reflection lock contention
- 88b50279c test(run): record idle boulder CLI evidence
- 51193f186 fix(run): ignore idle boulder state without active plan
- 423bdca0a Merge pull request #7564 from code-yeongyu/fix/astgrep-mcp-bun-be-bun
- 975dd9695 docs(qa): record final PR 7402 verification
- c331deb2d Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- e260717b8 fix(ulw-loop): canonicalize reviewer aliases by surface
- b5cbae3fb Merge pull request #7560 from code-yeongyu/fix/7544-resident-task-reconciliation
- c4ad1e772 revert: drop unrelated lsp-daemon Bun migration
- 57c7b1fbb Merge pull request #7559 from code-yeongyu/deslop-w2-ultrawork
- 6e9769887 fix(ultrawork): emit a biome-stable directive artifact and organize smoke-test imports
- 1876d9e3c Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- 12697e3ae Merge pull request #7558 from code-yeongyu/deslop-w2-skills
- 80e8fb732 test(skills-loader-core): mirror the template's four-group team-tool taxonomy
- b772c06f2 refactor(omo-codex): single-source ultrawork directive via prompts-core with bundled runtime export
- 558bbeb79 test(skills-loader-core): restore full team-tool gating coverage in team-mode test
- 948335934 fix(ulw-loop): scope generic gate quota by surface
- 520c1379c docs(qa): record article-role current-dev gates
- fbd119da6 Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- 7d72f4d89 fix(ulw-loop): parse article-bearing reviewer roles
- 00fc6bdb8 Merge pull request #7019 from LilMGenius/fix/lsp-document-uri-normalize
- 9ab0a28d6 refactor(omo-opencode): complete extraction of builtin-skills to core package
- a13d5c16e refactor(omo-opencode): repoint builtin-skills consumers at skills-loader-core
- b2f11bb89 fix(skills-loader-core): port the omo.jsonc config path into security-research
- 6fca00f2d Merge pull request #7557 from code-yeongyu/deslop-w2-pag
- 370091c78 fix(lsp): normalize document uris at the openByUri boundary
- d606f8926 refactor(omo-opencode): complete extraction of pag to core package
- af9fe3ace refactor(omo-opencode): point pag subpath imports at the utils core package
- ee7ae5d66 Merge pull request #7556 from code-yeongyu/deslop-w2-ccpl
- 763a351ea refactor(omo-opencode): complete extraction of ccpl to core package
- 573f107c4 refactor(omo-opencode): point ccpl consumers at the compat-core package
- 43ea7d265 fix(ulw-loop): honor explicit V2 reviewer assignments
- 0d5a8ef9b Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- 0c44cc692 test(ulw-loop): record current-dev merge gates
- e061a5673 Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- 5c480dbb4 test(ulw-loop): record post-merge gates
- 6c7d5957b Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
- 52982d5f7 test(ulw-loop): prove live PreToolUse spawn hook
- 575b96824 fix(ulw-loop): prioritize mixed-role gate prompts
- 0080d9a22 fix(ulw-loop): detect V2 reviewer role messages
- a71715d43 fix(ulw-loop): bound repeated review spawns (fixes #7392)
- 76f9bfe84 fix(model-core): classify terminal_quota_exhausted as non-retryable abort
- e291754ed fix(background-agent): preserve parent wake variant
- 9b3a44c0a fix windows build
- 39e588118 feat(context-recovery): non-destructive truncation with cleanup and tests
- 435f1af11 docs(ultimate-browsing): sync insane-search reference to engine v0.10.0
- 117dc2cea fix(background-task): add recovery hint and non-destructive truncation
- 0c913499c fix(session-manager): preserve platform path roots
- 6252720eb fix(session-manager): keep POSIX separators in directory normalize on Windows
- 9be9d235b fix(session-manager): normalize directory before session_list filter
- 53699aa6b fix(utils): fallback when contains path realpath fails
- c124c1ac3 fix(model-core): reject empty provider model segments
- e9dcaf8a9 fix(utils): parse frontmatter after UTF-8 BOM
- 7abb161be fix(utils): normalize whitespace-delimited tool names
- dad215d8d fix(utils): match OneDrive path segments
- bc36f501b fix(mcp-client-core): redact Slack MCP tokens
- 3ac34a4f9 fix(skills-loader-core): normalize merged allowed tools
- e1d460da9 fix(skills-loader-core): normalize config allowed tools
- c4d37e3ae refactor(skills-loader-core): share async allowed-tools parser
- f5035a3ed test(rules-engine): harden markerless workspace fixture
- 058089966 test(lsp-core): cover tool parameter helpers
- fbf2612fa test(tmux-core): cover main pane width clamping
- ffd3d4847 test(tmux-core): cover pane dimension null paths
- 0a208f632 test(openclaw-core): cover command timeout bounds
- a2bec517d test(telemetry-core): cover opt-out env normalization
- 43c84e90f fix(utils): preserve tar-listed filename whitespace
- 29dd8ba55 docs(config): clarify notification attention overlap
- f1e60f660 docs(features): clarify delegation tool boundary
- f0e4eb85e docs(agents): clarify temperature defaults

**Thank you to 2 community contributors:**
- @MoerAI:
  - Merge remote-tracking branch 'upstream/dev' into fix/codex-ulw-review-no-progress
  - fix(ulw-loop): check fan-out eligibility before charging reviewer quota
  - fix(ulw-loop): gate-artifact check before reviewer quota, V1/V2 non-reviewer early exit, atomic counter writes
  - fix: sort node: imports alphabetically in spawn-guard.ts for Biome
  - fix(ulw-loop): fix concurrent race and test env capture order
  - Merge pull request #7402 from MoerAI/fix/codex-ulw-review-no-progress
  - Merge pull request #5223 from JSap0914/docs/3729-agent-temperature-docs
  - Merge pull request #5229 from JSap0914/docs/3355-delegation-tool-boundary
  - Merge pull request #5235 from JSap0914/docs/4314-notification-attention
  - Merge pull request #5640 from Hungdoan565/codex/test-telemetry-env-normalization-20260627
  - Merge pull request #5642 from Hungdoan565/codex/test-openclaw-command-timeout-bounds-20260627
  - Merge pull request #5644 from Hungdoan565/codex/test-tmux-pane-dimensions-null-20260627
  - Merge pull request #5646 from Hungdoan565/codex/test-tmux-layout-width-clamp-20260627
  - Merge pull request #5648 from Hungdoan565/codex/test-lsp-parameter-helpers-20260627
  - Merge pull request #5675 from Hungdoan565/codex/test-rules-engine-markerless-workspace-20260628
  - Merge pull request #5633 from Hungdoan565/codex/fix-utils-tar-listing-preserve-whitespace-20260627
  - Merge pull request #5692 from Hungdoan565/codex/fix-utils-onedrive-segment-20260628
  - Merge pull request #5693 from Hungdoan565/codex/fix-utils-tool-name-whitespace-20260628
  - Merge pull request #5694 from Hungdoan565/codex/fix-utils-frontmatter-bom-20260628
  - Merge pull request #5704 from Hungdoan565/codex/fix-utils-contains-path-realpath-fallback-20260628
  - Merge pull request #5698 from Hungdoan565/codex/fix-model-format-empty-segments-20260628
  - Merge pull request #5683 from Hungdoan565/codex/fix-mcp-redact-slack-tokens-20260628
  - Merge pull request #5677 from Hungdoan565/codex/fix-config-skill-allowed-tools-normalization-20260628
  - Merge pull request #5678 from Hungdoan565/codex/fix-skill-merge-allowed-tools-normalization-20260628
  - Merge pull request #5676 from Hungdoan565/codex/refactor-skills-async-allowed-tools-parser-20260628
  - Merge pull request #4233 from codeg-dev/fix/boulder-null-active-plan
  - Merge pull request #5933 from dihak/fix/session-list-sdk-directory-filter
  - Merge pull request #6633 from EZotoff/fix/truncation-rework
  - Merge pull request #6728 from SoShymKing/fix_windows_build
  - Merge pull request #6739 from LYY/fix/6732-parent-wake-variant
  - Merge pull request #6274 from fivetaku/docs/insane-search-v0.10.0
  - fix(model-core): cap grok output reserve when output limit equals context window (fixes #7541)
  - Merge pull request #7624 from MoerAI/fix/7541-grok-output-reserve
- @sisyphus-dev-ai:
  - Merge pull request #7629 from code-yeongyu/release/v5.0.0-beta.32-source-state

## [5.0.0-beta.33] - 2026-09-02

- a0dd6cc91 Merge pull request #7631 from code-yeongyu/release/v5.0.0-beta.33-source-state
- 16bec1b17 Merge pull request #7630 from code-yeongyu/fix/beta32-prompts-core-payload
- 3d4a99af4 fix(publish): ship prompts-core Codex prompt

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7631 from code-yeongyu/release/v5.0.0-beta.33-source-state

## [5.0.0-beta.34] - 2026-09-02

# OMO v5.0.0-beta.34 + senpi v2026.9.2

This release rolls up everything since **beta.30**. beta.31, beta.32 and beta.33 were published to npm but never announced, and beta.32/33 shipped a broken LazyCodex install (every `lazycodex-ai install` died in `sync:skills` with an ENOENT on the ultrawork prompt). beta.34 is the one to upgrade to. If you're on beta.30, this is a big jump; if you're on 31/32/33, the Codex installer is fixed and the engine moved to senpi 2026.9.2.

#### Why the last three betas were silent

Each one was killed by a different release-pipeline defect, not by the product. beta.31 shipped with a recall file-mode pin that broke on win32. beta.32 fixed that but the Windows legacy-daemon fixture blew its readiness budget and the omo-native staging build skipped prebuilt inputs under `--ignore-scripts`. beta.33 fixed those but the published tarball was missing the prompts-core Codex prompt. beta.34 fixes the last link: the Codex installer flattens the plugin into `<CODEX_HOME>/plugins/cache/sisyphuslabs/omo/<version>`, and the ultrawork prompt was resolved repo-relative, so it was never there. Every fix landed with a failing-first regression, and the final smoke was replayed against the real published beta.33 tarball (exit 0, ultrawork `SKILL.md` carries the canonical body).

### 🔧 Codex / LazyCodex: the installer works again

- `npx -y lazycodex-ai@5.0.0-beta.34 install` completes. The installer now materializes the prompts-core ultrawork directive inside the cached plugin root, and `sync:skills` resolves it checkout-first, plugin-internal second.
- The ultrawork directive is single-sourced from prompts-core with a bundled runtime export, so Codex and omo-senpi ship the same text.
- The unavailable codegraph stub stays alive on the Codex host instead of idling out and dropping the tool.

### 🧠 Memory: the memorian gate and recall

- Recall is now a two-step loop. At settle, omo collects recall candidates from your committed memory and launches a fire-and-forget "memorian" judge child. On your next turn, whatever the judge picked arrives as one hidden recall message with one sourced `<recalled-memory source="[[path]]">` block per nudge, so the agent can open the file for detail. Your current turn pays nothing for it.
- Nudges are stamped with the compaction epoch. If the transcript gets compacted mid-flight, stale nudges are dropped instead of injected over a transcript that no longer exists.
- `memory.recall` config shrinks to `enabled` and `max_items`, and `memory.agents.<id>.recall` lets you silence or tune recall for a single agent.
- Recall delivery fails open: an unwritable ledger degrades to a missing record, never a swallowed hint. Only whole candidates that fit the token budget are delivered, and extension-injected messages stay out of transcript search.
- Dreams reconcile at session start (an overdue identity gets a best-effort dream check), and dream scanning reads each conversation once, gated by journal byte offsets.
- Default git template files are skipped, and the memory-core fs layer is EINTR-resilient with proper abort-signal handling and Windows-tolerant lock candidates.

### 🔁 ulw-loop: guided gates, bounded reviewers

- `checkpoint --print-template` emits a surface-aware quality-gate skeleton and works without `--goal-id`. Gate validation errors are aggregated into one report, and snapshot, plan, and session-id errors come with guided recovery messages.
- Repeated review spawns are bounded: each quality-review agent gets three spawns per goal attempt, reset on explicit restart, and only allowed spawns count toward fan-out (fixes #7392). Fan-out eligibility is checked before reviewer quota is charged, and counter writes are atomic.
- The ulw reviewer agents (`omo-senpi-code-reviewer`, `omo-senpi-qa-executor`, `omo-senpi-gate-reviewer`) no longer carry hardcoded model chains: they resolve their model through the category router (code review -> `unspecified-high`, QA -> `deep` then `unspecified-low`, gate review -> `deep` then `unspecified-high`), so whatever you configure for those categories is what the reviewers run on.
- omo-senpi ships its own ulw reviewer builtin agents, reviewer identities resolve per toolkit surface, article-bearing reviewer roles ("the V2 reviewer") parse, and explicit V2 assignments are honored.
- The senpi surface gate is gate-review-only with a category chain: `codeReview` is dropped and `manualQa` is pinned to the main session. omo-opencode gets a category-chain fallback verifier for ultrawork verification.

### 🧩 Models, LSP, and MCP

- Grok: the output reserve is capped when the output limit equals the context window, so requests no longer fail admission (fixes #7541).
- `terminal_quota_exhausted` is a non-retryable abort instead of a retry loop. `kimi-k3-ultrafast` registers with a 256k default context instead of the base model's 1M. Empty provider model segments are rejected, and the ulw reviewer fallback chains are gone (the fallback table now lists 11 agents).
- LSP: workspace roots collapse to the git repository root, so a monorepo no longer spawns one language server per package (in-vivo: 4 TLS + 8 tsserver, ~2.4GB, now one). In-flight client stops are tombstoned and dead-client respawns are bounded. Document URIs are normalized at the `openByUri` boundary.
- MCP: the ast-grep stdio server arms a 10-minute idle timeout (`OMO_AST_GREP_IDLE_TIMEOUT_MS` to override) and idle servers get stdin destroyed so abandoned children exit. Under a bun-compiled omo host, the ast-grep child runs as plain bun instead of re-executing the omo binary (which used to boot a ghost agent session per connection attempt). Slack MCP tokens are redacted in logs.

### 🪟 Windows and path hygiene

- Session manager preserves platform path roots, keeps POSIX separators in directory normalization, and normalizes the directory before `session_list` filtering.
- Frontmatter parses after a UTF-8 BOM, OneDrive path segments match, whitespace-delimited tool names normalize, tar-listed filename whitespace is preserved, and `contains path` falls back when realpath fails.
- Skills loader normalizes allowed tools from both config and merged sources, and the security-research skill reads the `omo.jsonc` config path.

### 🧹 Lifecycle and leak fixes

- Delegated subagent lifecycle resources are released, the TUI mirror is wired into plugin disposal with its heartbeat unref'd and stopped, and continuation cleanup runs on every exit (anchors and revival cleanup preserved).
- Hooks: idle transcript cache snapshots are pruned on a TTL sweep, unmatched fsync-skip start times are dropped, hashline pending captures are swept, unbounded session-id hook sets drain, and Anthropic recovery maps clear on dispose. A legacy snapshot race is closed.
- Background tasks get a recovery hint and non-destructive truncation (backups are cleaned up after recovery), and the parent wake variant is preserved.
- `omo run` ignores idle boulder state when there's no active plan. omo-ai ships and hardens the Senpi runtime patch, including hoisted installs, and bundles OAuth with hardened hook state.
- Reliability: a large sweep made the test suite deterministic on Windows and slow runners (event-driven waits, controlled clocks, isolated fixture roots, no subprocess-shaped wrappers).

### ⚙️ Engine: senpi 2026.9.2 (and 2026.8.31)

- **Claude Fable 5.1 preset.** `claude-fable-5-1` is the dieted Fable 5 core plus the 5.1 prompting-guide deltas: scope-is-the-deliverable, per-response tool-call batching, surgical-edit preference, test-scope discipline, formatting and narration recalibration. The dotted release resolves before the generic `fable-5` matcher, `promptPreset: "claude-fable-5-1"` forces it, and the default lanes (recommended model, fallback chain, startup tip) now point at 5.1. Sessions on the `claude-fable-5` chain keep it.
- **Shared RPC host on Windows.** Socket endpoints resolve to `\\.\pipe\` named pipes derived from a per-endpoint secret with a constant-time authenticated handshake, pidfile ownership no longer depends on MSYS `ps`, and detached supervisor startup failures don't leak children. POSIX keeps unix sockets + `0600`.
- `/quit` and `/exit` during startup (managed-tool downloads) now quit instead of being parked in the editor, which also used to disable Ctrl+D.
- `ctx.shutdown()` from an extension while the session is idle shuts down immediately instead of waiting for an `agent_settled` that never comes. Interactive quit keeps stderr capture installed while shutdown handlers drain, so diagnostics land in the debug log.
- RPC: launch capabilities from `SENPI_RPC_CLIENT_CAPABILITIES` apply to bindings even when the client never sends `set_client_info` (this was breaking task/DAG/monitor liveness in omo-desktop-app). `abort` acks are sent as soon as the signal is dispatched. Clients can opt into native auto-titles with `auto_title_sessions`.
- Compaction no longer wedges when the summarizer answers with a bare tool call (seen on `gpt-5.6-sol` at high reasoning): one retry with tool calling forbidden, then the deterministic no-LLM fallback on required routes.
- Hooks trust-state reads keep a lock-free fast path for complete snapshots and take the bounded writer lock only on malformed reads, so mixed-version writers can't surface `ELOCKED`.
- The shared multi-session RPC host reclaims itself: 30-minute idle eviction, 8 concurrent sessions, 15-minute empty-host exit, all overridable via `SENPI_RPC_SESSION_IDLE_EVICTION_MS`, `SENPI_RPC_MAX_SESSIONS`, `SENPI_RPC_HOST_EMPTY_EXIT_MS`.
- Windows session resume no longer aborts on non-canonical `fs.watch()` paths. TTSR stream buffers keep only a tail window, and the in-memory session mirror is bounded at 64 MiB.
- Refusal-caused model fallbacks release their pin after a successful senpi-owned compaction and re-attempt the original model once; billing-caused pins never release.

### Install

```
npm i -g omo-ai@beta          # omo native CLI (5.0.0-0.beta.34, engine senpi 2026.9.2)
bun i -g oh-my-openagent@5.0.0-beta.34
npx -y lazycodex-ai@5.0.0-beta.34 install   # Codex plugin (fixed installer)
```

---

- d20c167da Merge pull request #7645 from code-yeongyu/release/v5.0.0-beta.34-source-state
- b840c2930 Merge pull request #7643 from code-yeongyu/test/team-message-windows-budget
- de78d4244 Merge pull request #7635 from code-yeongyu/feat/reviewer-agents-category-model-routing
- d6a868fab test(team-mode): budget Windows fallback wake case
- 3216a23fa Merge pull request #7640 from code-yeongyu/fix/codex-cache-prompt-layout
- 96f891e82 fix(codex-installer): materialize prompts-core directive into the plugin cache
- 38a46e601 Merge pull request #7633 from code-yeongyu/refactor/model-core-drop-reviewer-agent-chains
- 2546845e1 docs(model-core): agent fallback table now lists 11 agents
- 0a9a3758b refactor(model-core): drop the ulw reviewer agent fallback chains

**Thank you to 2 community contributors:**
- @MoerAI:
  - test(team-mode): budget Windows fallback wake case
  - Merge pull request #7643 from code-yeongyu/test/team-message-windows-budget
- @sisyphus-dev-ai:
  - Merge pull request #7645 from code-yeongyu/release/v5.0.0-beta.34-source-state

## [5.0.0-beta.35] - 2026-09-03

- 7ccd78137 Merge pull request #7663 from code-yeongyu/release/v5.0.0-beta.35-source-state
- b12d08f4b Merge pull request #7661 from code-yeongyu/fix/7550-7579-task-residency
- d79ea1ff8 Merge pull request #7656 from code-yeongyu/fix/ulw-checkpoint-gate-dx
- c3eb2eaa4 refactor(ulw-loop): isolate checkpoint Codex validation
- 7eff02187 fix(ulw-loop): aggregate checkpoint gate defects
- b1c32dd18 Merge pull request #7648 from code-yeongyu/feat/memorian-nudged-trace
- 51bf35efa docs(evidence): capture the live Memorian nudged TUI notice
- 1291b02c1 Merge pull request #7647 from code-yeongyu/fix/windows-dag-runtime-overflow-sync
- 83c1fab9d docs(evidence): record memorian nudged visibility QA
- 25e3cf613 docs(evidence): clarify DAG timeout proof
- bd702cb8c Merge pull request #7646 from code-yeongyu/fix/omo-native-linux-deleted-execpath
- 280c57395 Merge pull request #7644 from code-yeongyu/refactor/remove-codegraph
- a9766e30d fix(omo-native): forward signals during native re-exec
- 547ef2420 fix(omo-native): handle deleted Linux executable paths
- b941e9f34 build(omo-codex): regenerate the plugin lockfile without the codegraph workspace
- c95e713f7 docs(evidence): record CodeGraph removal QA
- 8512ef8f6 docs: drop CodeGraph from prompts, skills, and docs
- e5ab78a2d refactor: remove the CodeGraph integration
- a66022557 feat(omo-config-core): ignore unrecognized config keys instead of dropping the layer

**Thank you to 2 community contributors:**
- @MoerAI:
  - docs(evidence): clarify DAG timeout proof
  - Merge pull request #7647 from code-yeongyu/fix/windows-dag-runtime-overflow-sync
- @sisyphus-dev-ai:
  - Merge pull request #7663 from code-yeongyu/release/v5.0.0-beta.35-source-state

## [5.0.0-beta.36] - 2026-09-03

# OMO v5.0.0-beta.36 + senpi v2026.9.3-2

This is the first omo release that carries senpi's fix for the Windows shared RPC host dying about a minute after every start (code-yeongyu/senpi#1307, fixed in senpi 2026.9.3 and shipped in omo for the first time here). It also carries the RPC interactive-login fix (code-yeongyu/senpi#1316), so Anthropic Claude Pro/Max logins through the desktop app finish instead of landing on a dead callback port. The engine moves to senpi 2026.9.3-2, which makes eval-only tool routing the default and fixes several Claude SDK OAuth failure loops. If you use OmO desktop or omo on Windows, upgrade now. Everyone else gets the engine changes and a set of ultrawork doctrine updates.

### 🪟 Windows: the shared RPC host stays alive

**The host no longer dies on its own liveness probe.** The shared RPC supervisor identifies the host process it is watching by reading a process baseline through PowerShell (`Get-CimInstance Win32_Process`). On Windows that read can take more than a second, and the supervisor's 1 s probe treated the overrun as fatal, so the host crashed within about a minute of every start. The OmO desktop app kept reconnecting to a host that had just killed itself.

- The baseline identity read is now guarded. When the probe runs past its budget, the baseline degrades to `UNKNOWN` instead of throwing.
- The watchdog starts without a baseline and keeps running. A slow `Get-CimInstance` no longer decides whether the host lives.
- The fix landed in senpi 2026.9.3 (code-yeongyu/senpi#1307). beta.36 is the first omo build that pins a senpi with it, along with the rest of the 2026.9.3 shared RPC supervisor lifecycle fixes.

### 🔐 OAuth logins that need a pasted code now work over RPC

**Anthropic Claude Pro/Max login through the desktop app completes.** Over RPC, `startLogin` wired the provider's `onPrompt`/`onSelect` callbacks to a function that threw `Interactive login input is not supported over RPC`. For Anthropic that failure was misleading: `loginAnthropic` races a local browser-callback listener against a `manual_code` prompt right after it emits `auth_login_url`, so the instant rejection set `manualError`, cancelled the wait, and closed the listener about 150 ms after the URL went out. Your browser opened, you approved the login, and the redirect landed on `connection refused`.

- Interactive callbacks now ride the existing `extension_ui_request` dialog channel: `input` for pasted codes, text, and secrets, `select` for account choices. Any RPC client that already renders extension dialogs can answer them.
- An unanswered dialog never blocks the browser callback path. When the login settles through the browser, the pending dialog is released instead of holding the flow open.
- Cancelling the dialog maps to `Login cancelled`, the same result a terminal user gets from Escape.
- Fixes code-yeongyu/senpi#1316 via PR code-yeongyu/senpi#1319. Other prompt-driven OAuth providers get the same path.

### ⚙️ Engine: senpi 2026.9.3-2

**Eval-only tool routing is the default** (code-yeongyu/senpi#1314).

- `bash`, `powershell`, `workflow`, and now `monitor` leave the model's direct tool list whenever the session has an `eval` tool. They're called as `tool.bash(...)`, `tool.workflow(...)`, and `tool.monitor(...)` inside a cell; hooks and permission checks still apply.
- A direct call returns a hint naming the eval form. A session without `eval` (codemode disabled, or a child agent whose allowlist omits it) keeps all four directly callable.
- `monitor` joined the set because 141 of ~225 solo `monitor` calls over 14 days of local sessions came one turn after an `eval` call, a two-turn split that collapses into one cell.
- The wait-as-subscription guidance moved from the presets into the `eval` tool description, where it can name `tool.monitor(...)`. The preset rule was gated on `monitor` being directly selectable and would've stopped rendering otherwise.
- `experimental.bashEvalOnly` and `experimental.workflowEvalOnly` are removed. Existing entries in a settings file are ignored.

**Claude SDK OAuth stops looping on `No conversation found with session ID`** (code-yeongyu/senpi#1318, fixes oh-my-openagent#7562).

- After a failed cold seed, `claude-sdk-oauth` kept a continuity binding whose session id had only been minted locally. The next turn chose `reattach`, Claude Code answered that the session didn't exist, and every later turn repeated the cycle with zero usage.
- A session id is now resumable only once Claude Code acknowledged it, through a `system`/`init` message or the replay echo that claims the turn. Entries created from a resume start confirmed; locally minted ids start unconfirmed.
- An id Claude Code reports missing is dropped rather than retried.

**Codemode keeps Bun child-process output inside the eval cell** (code-yeongyu/senpi#1317).

- `Bun.$` streams command output to fd 1/2 unless `.quiet()` is applied or a `.text()`-style reader is used, and `Bun.spawn` inherits stderr by default. Inside the JS eval kernel worker those fds are the interactive TUI's terminal.
- A cell like `` $`vibe-notion page get <id> --pretty` `` dumped a Notion page's pretty-printed block JSON straight into the editor, where it got pasted into the next prompt. The existing `routeWrite` only intercepts JS-level `process.stdout.write`, so native child writes bypassed it.
- A new `worker-shell-capture` layer installs beside the console/stdout routing while a cell is active and is restored with the rest of the worker state, so child output lands in the cell result like everything else.

**Prompt presets: Kimi K3, Claude Opus, GLM** (code-yeongyu/senpi#1315).

- The K3 core was written through the K2.6 lens (an overthinker that needs act-bias). Moonshot's own K3 notes describe the opposite failure, "excessive proactiveness," and the old core stated act-bias in four places against one reflect-then-ask clause, so the trained prior won. The session corpus showed K3 writing more test files than any other model.
- The K3 core is rebuilt on the Fable 5.1 skeleton with each failure mode given one home: a Scope section makes the request the deliverable (pre-existing problems become follow-ups, tests only where the task or repo calls for them), the ambiguity gate does the answer-independent work first and then asks one question, a failure cap stops improvisation after three failed approaches, and delegation propagates a stop condition to subagents. The result is 11 fewer Kimi K3 tokens than before.
- Opus 5 is rebuilt on the same skeleton with the guide's outcome-first final-summary shape. Opus 4.7/4.8 keep only their documented deltas and gain same-turn subagent fan-out; Opus 4.6 drops tuning text the core now carries.
- GLM 5.2/5.3 share one builder, gain the eval/monitor execution-tooling stance, and lose the lineage preamble, undefined-mode reference, and unconditional todo procedure. The shared core gains a conditional delegation rule and explains the auto-compaction mechanism behind the context-limits rule.

**Claude SDK OAuth errors are real errors** (code-yeongyu/senpi#1312).

- Failures now surface the SDK's actual assistant/result text, including API and version-floor errors, instead of `unknown`. Version-floor and model-not-found failures come with actionable guidance.
- Results marked `is_error: true` count as failures even when their subtype is `success`, which lets model fallback and multi-account failover kick in for session limits and API errors.
- Token-refresh transport outages are classified as transient server errors rather than permanent auth blocks. The handling applies to ambient streams, managed failover, resident session pumps, and turn-success bookkeeping alike.

**Also from the 2026.9.3 line, first pinned by omo in this beta:** the universal fallback system prompt rewrite, muted-monitor footer labels, bounded multi-session `close_session` teardown (`SENPI_RPC_CLOSE_GRACE_MS`), and the `/reload` `fs.watch` stall fix.

### 🧩 omo

**omo-native runs on bun wherever a bun >= 1.4 exists** (#7680).

- The launcher used to re-exec under bun only for `bun add -g` installs. npm, project-local, and `bunx` installs stayed on node even with bun on the machine, so the JS eval kernel ran under node and the bundled `bun-1-4` skill never surfaced.
- `resolveBunReexec` now applies a first-match policy. Stay on the current runtime if already on bun, if `OMO_RUNTIME=node`, or if no bun binary is found in `$BUN_INSTALL/bin`, `~/.bun/bin`, or PATH.
- Re-exec with no version floor when `OMO_RUNTIME=bun`. Re-exec without a probe when the script sits in bun's global tree (trust the bun that installed it).
- For any other install, re-exec when `bun --version` reports 1.4.0 or newer. An older bun or a failed probe stays on node.

**setup-import closes its SQLite handles deterministically** (#7681).

- Windows teardown timed out on `win32 EBUSY` because handles opened by the pinned `.omp`, `.gjc`, and unknown-schema fixtures weren't proven closed before the temp root was removed. Per-file process exit had hidden this until Windows shard 2 stopped running with `--parallel`.
- Every handle is now recorded, closed through the existing `withDatabase` helper, and asserted closed before the case ends. No timeout, retry budget, platform skip, or `--parallel` change was added.

**ultrawork, ulw-execute, ulw-loop, and mass-ulw doctrine** (#7673, #7674, #7675).

- Per-phase worktrees: every plan phase runs in its own task-owned worktree that lands on the integration base before the next phase branches. ulw-execute used to require a worktree only for PR/branch work; `--worktree` is now optional reuse of a first-phase worktree, and `--make-pr` drops its worktree-implication clause.
- One workflow run per phase: dependency-ordered lanes are dispatched as one `workflow` run per phase, recovered inside that run with `retry`/`amend`/`send`. The next phase is a new run or an `amend`, never one graph for the whole plan. mass-ulw's header now states this unit of use instead of "in one call," and ulw-loop owns goals, criteria, evidence, and checkpoints while `workflow` is the per-phase dispatch surface.
- Ideal end state and pre-existing defects: the ultrawork directive's discovery wave now produces the current problem, evidence-backed decision points, and the ideal end state the goal objective names. "Smallest correct change. No drive-by refactors." is replaced by an owner doctrine: defects met mid-run, pre-existing ones included, become registered work in this run (subgoal, plan checkbox, or workflow node) and are fixed to the ideal state, while delegated-unit scope stays hard.
- Discovered defects route through the orchestrator: `add_subgoal` widens so they become stories rather than follow-up notes, and the poll/`wait()`-default framing is replaced with completion wakes.
- Housekeeping: the bootstrap carve-out widens to the ulw-execute contract so `ulw execute` no longer double-bootstraps, duplicated child-handling sections are merged so the directive shrinks, stale `dag` tool references are gone, and the TUI visual-QA runner switches to `bun`.

**Windows CI** (#7672, #7665, #7668).

- A `workflow_dispatch`-only soak workflow repeats one of 11 allowlisted focused test targets up to 50 times with per-iteration telemetry, stops at the first failure, always uploads artifacts, and writes a job summary. Each target maps to hardcoded test arguments, so the dispatch input never reaches the shell. Normal CI is untouched.
- All four Windows Bun invocations, including the previously uncovered `senpi-compatibility` job, now run through `.github/scripts/windows-ci-telemetry.ps1`, which captures process, timing, filesystem, and exit data. Artifacts upload with `continue-on-error`, and the Bun exit code stays authoritative.
- The heaviest worktree-sweep test (seven worktrees) was the only one left on Bun's 5000 ms default and timed out mid `git worktree add` on the slower Windows runner. It now runs under the same 30 s budget as its siblings, and git setup failures name the stalled phase and elapsed time, e.g. `creating external worktree failed after 37ms`.

### Install

```
npm i -g omo-ai@beta          # omo native CLI (5.0.0-0.beta.36, engine senpi 2026.9.3-2)
bun i -g oh-my-openagent@5.0.0-beta.36
npx -y lazycodex-ai@5.0.0-beta.36 install   # Codex plugin
```

---

### Commits

- 776405ec0 Merge pull request #7684 from code-yeongyu/release/v5.0.0-beta.36-source-state
- 12637f1b3 Merge pull request #7682 from code-yeongyu/fix/hooks-state-writer-cleanup
- 090bd9fcd docs(evidence): record hooks-state writer cleanup QA
- e54c7c18c Merge pull request #7681 from code-yeongyu/fix/setup-import-sqlite-handle-leak
- 4103bea93 Merge pull request #7680 from code-yeongyu/feat/omo-native-bun-reexec-any-bun
- e64b424a8 fix(omo-native): close setup-import database handles deterministically
- 16f213443 test(script): follow the bun-runtime test split in the command-string allowlist
- 7c240ca65 docs(omo-native): document the any-bun runtime policy
- 32bca4739 feat(omo-native): run on bun wherever a bun >= 1.4 exists
- d2e807dfa Merge pull request #7674 from code-yeongyu/feat/ultrawork-ideal-state-owner-doctrine
- e46e3a29f Merge pull request #7675 from code-yeongyu/docs/ulw-execute-phase-worktree
- 2c6aee570 Merge pull request #7673 from code-yeongyu/docs/ulw-loop-mass-ulw-composition
- d2632e623 docs(shared-skills): each ulw-execute phase carries its own concrete goal
- 124e43294 docs(shared-skills): give each ulw-execute wave its own goal and route discovered defects through the orchestrator
- 529121594 docs(shared-skills): tighten the discovered-work checkbox rule in ulw-execute
- bcae3b346 docs(shared-skills): run web-terminal visual QA with bun in ulw-execute
- a41c75cbb docs(shared-skills): ulw-execute registers pre-existing defects as plan checkboxes
- 4c8385a93 docs(shared-skills): ulw-execute dispatches each wave as one workflow run
- 92ccdeefd docs(shared-skills): ulw-execute runs every phase in its own worktree
- 130a5c516 Merge pull request #7672 from code-yeongyu/ci/windows-flake-soak
- 48c7dc21c Merge pull request #7665 from code-yeongyu/fix/windows-ci-telemetry
- aec983957 Merge pull request #7668 from code-yeongyu/fix/worktree-sweep-windows-budget
- ba323d227 test(omo-opencode): diagnose worktree sweep setup timeouts

**Thank you to 2 community contributors:**
- @MoerAI:
  - test(omo-opencode): diagnose worktree sweep setup timeouts
  - Merge pull request #7668 from code-yeongyu/fix/worktree-sweep-windows-budget
  - Merge pull request #7665 from code-yeongyu/fix/windows-ci-telemetry
  - Merge pull request #7672 from code-yeongyu/ci/windows-flake-soak
  - fix(omo-native): close setup-import database handles deterministically
  - Merge pull request #7681 from code-yeongyu/fix/setup-import-sqlite-handle-leak
  - docs(evidence): record hooks-state writer cleanup QA
  - Merge pull request #7682 from code-yeongyu/fix/hooks-state-writer-cleanup
  - Merge pull request #7685 from code-yeongyu/test/reconciliation-lock-determinism
- @sisyphus-dev-ai:
  - Merge pull request #7684 from code-yeongyu/release/v5.0.0-beta.36-source-state

## [5.0.0-beta.37] - 2026-09-03

- ed5eca467 Merge pull request #7697 from code-yeongyu/release/v5.0.0-beta.37-source-state
- 745eb43b4 Merge pull request #7696 from code-yeongyu/fix/git-toplevel-native-path
- 7e8ce5e14 Merge pull request #7689 from code-yeongyu/fix/ulw-loop-status-git-noise
- 65c55dc6b Merge pull request #7687 from code-yeongyu/fix/windows-soak-fidelity
- ad674f2d3 docs: record Windows soak fidelity evidence
- 4aa300730 Merge pull request #7685 from code-yeongyu/test/reconciliation-lock-determinism

**Thank you to 2 community contributors:**
- @MoerAI:
  - Merge pull request #7685 from code-yeongyu/test/reconciliation-lock-determinism
  - docs: record Windows soak fidelity evidence
  - Merge pull request #7687 from code-yeongyu/fix/windows-soak-fidelity
- @sisyphus-dev-ai:
  - Merge pull request #7697 from code-yeongyu/release/v5.0.0-beta.37-source-state

## [5.0.0-beta.38] - 2026-09-03

- 05a1fbcc7 Merge pull request #7712 from code-yeongyu/release/v5.0.0-beta.38-source-state
- 2755238f6 Merge pull request #7710 from code-yeongyu/fix/task-batch-run-in-background
- 93542d125 Merge pull request #7698 from code-yeongyu/fix/7686-background-wake-variant-fallback
- 7347c9665 fix(omo-opencode): capture the model variant into the compaction checkpoint
- 1d91a6e45 fix(omo-opencode): carry the model variant through the compaction checkpoint
- 99a8f7f9e fix(omo-opencode): keep the flat model variant on background wake
- fd4ed40f2 Merge pull request #7700 from code-yeongyu/fix/lcx161-codex-network-access-key
- ca7e76b60 Merge pull request #7699 from code-yeongyu/fix/7671-sync-poll-deadline
- 52f411903 docs(guide): drop the last network_access = "enabled" mention from the install table
- 636b8f9d4 Merge pull request #7705 from code-yeongyu/fix/ulw-loop-quality-gate-enum-messages
- 2179edcd2 test(omo-opencode): pin the sync poller's active-status contract
- 11cbb5705 refactor(ulw-loop): derive gate enum messages from one supported-value table
- cbdffca4a build(omo-codex): drop the legacy network_access key from the bundle, parity tests, and docs
- 049f09fef docs(ulw-loop): document quality gate enums
- 653154717 fix(ulw-loop): explain quality gate enum defects
- 31efd7e56 fix(omo-opencode): stop treating an active status as sync task progress
- 742fefafd fix(omo-codex): stop writing the removed top-level network_access key

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7712 from code-yeongyu/release/v5.0.0-beta.38-source-state

## [5.0.0-beta.39] - 2026-09-03

- c21fceb6f Merge pull request #7716 from code-yeongyu/release/v5.0.0-beta.39-source-state
- 1b3f610eb Merge pull request #7715 from code-yeongyu/fix/win-launcher-bun-cmd-einval
- cc966e556 fix(omo-native): stop the launcher dying with spawn EINVAL on Windows npm bun shims
- 80ac895ff Merge pull request #7713 from code-yeongyu/fix/task-batch-progress-polish
- 7d46cc2cb Merge pull request #7714 from code-yeongyu/fix/windows-flake-quarantine
- e336e4372 test(git-bash-mcp): retry temp-dir removal on Windows EBUSY

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7716 from code-yeongyu/release/v5.0.0-beta.39-source-state

## [5.0.0-beta.40] - 2026-09-04

- f8aba1b94 Merge pull request #7735 from code-yeongyu/release/v5.0.0-beta.40-source-state
- 20ac67e6d Merge pull request #7734 from code-yeongyu/fix/anthropic-tool-search-compat-20260904
- 3106eb5bd test(omo-native): guard the engine-owned Anthropic tool-search contract
- c6e7dd7fb Merge pull request #7729 from code-yeongyu/feat/ultrawork-js-eval-maxxing
- 27ddc4d0d test(ci): register npm-dist-tag-rollback.yml in the job-summary coverage gate
- eabe9d111 Merge pull request #7724 from code-yeongyu/ci/npm-dist-tag-rollback-20260904

## [5.0.0-beta.42] - 2026-09-04

# omo 5.0.0-beta.42

> beta.41 was never published: its first release attempt failed the CI gate and the retry re-selected the stale stamp commit, so the number was skipped rather than shipping a tree that lacked the engine bump. This release carries everything intended for beta.41.

Engine: **@code-yeongyu/senpi 2026.9.4-3** (beta.40 shipped 2026.9.3-2 — this beta moves the engine across 2026.9.4, 2026.9.4-2 and 2026.9.4-3).

### Highlights

#### Anthropic native tool search no longer 400s
The headline engine fix. Native tool search sent `tool_reference` blocks under a `name` field instead of the API's `tool_name`, and the BM25 server tool was injected on **every** `anthropic-messages` endpoint — including gateways, proxies and Kimi-coding hosts that reject it. Either one returned
`400 tools.N.tool_search_tool_bm25_20251119.name: Input should be 'tool_search_tool_bm25'` (or an opaque invalid-request error), after which the adapter disabled native search for the rest of the session. Injection is now gated to models that actually support tool search (Opus/Sonnet 4.5+ and the Fable line), and the reference field matches the wire contract. (senpi #1354)

#### Korean and non-ASCII memory finally round-trips
Memory slugs, git paths and recall query planning keep Korean/non-Latin letters instead of mangling them, with compatibility for directories written by older builds. (#7739, #7741)

#### Release plumbing corrected
Every GitHub release is created as a full release, and the Latest badge is decided from the highest **published** semver rather than tag order. (#7743, #7761)

#### Windows: a leaked SQLite handle no longer stalls the harness
`node:sqlite`'s `DatabaseSync.close()` does not finalize outstanding statements on Bun 1.4, so one
`prepare()` left the store's file handle open until GC. POSIX hides this (unlink ignores open handles) but
Windows keeps the file locked, and the next open of the same store blocks — sibling-harness detection could
stall for tens of seconds. Every `prepare()` in the credential readers and their tests is gone, replaced by
`exec()` with a row-sink function, and a contract test now asserts that no file handle survives `close()`.
(#7775)

### Fixed

- `omo-senpi`: the conditional x-search skill ships and no longer logs at startup (#7745); Bun skill guidance in the ultrawork directive is gated instead of unconditional (#7754); the senpi hooks-state lock is granted to every memory sandbox (#7756); unsupported isolation traversal fails closed instead of looking complete (#7769)
- `lsp-core`: a diagnostic pull that times out now awaits its cancellation write, so `$/cancelRequest` is not lost on Windows (#7773)
- `senpi-task`: PATH senpi executables that do not match the running engine are rejected (#7758); lead tasklist tools are deferred to tool_search (#7737)
- `omo-native`/`omob`: hoisted bin dir resolution for scoped engine packages (#7755), architect blockers closed in the omob pipeline (#7747), skill-source filter + cache locking + provenance mirrors root-fixed (#7763), dev binary built from the latest commits with build provenance (#7740)
- `shared-skills`: page work routes to a real browser before the CLI (#7751), browser QA and research browsing go through the eval kernel (#7750), CloakBrowser's venv interpreter is used in the launch step too (#7757)
- Dependencies: `@code-yeongyu/senpi` pin moved to 2026.9.4-2 then 2026.9.4-3 (#7749, #7772)
- Isolation QA snapshots assert the real per-platform contract instead of POSIX-only outcomes, so Windows reports capability failures explicitly (#7770, #7775)

### Engine changes (senpi 2026.9.4 → 2026.9.4-3)

- Terminal monitors and background Bash sessions are recorded per session, with a single startup notification for carried-over/lost/expired state, and monitors expose a stable `mon_` id while `bash_output`/`bash_input`/`bash_resize`/`kill_bash` accept either id
- A spawned RPC host that never answers `get_protocol_info` reports why instead of surfacing a raw `powershell.exe` failure, and no longer leaks its pidfile and socket
- File-backed credential, auth and settings locks wait through bounded contention retries and report an actionable transient error instead of burning the provider fallback chain
- Image generation treats a seeded placeholder key as absent, so it falls through to a configured gateway instead of failing with an OpenAI 401
- Hook trust-state reads fail open when the lock directory cannot be created (sandboxed/read-only children); writers still fail closed
- `bun install --frozen-lockfile` works on a clean checkout again

### Internal / tests

- Windows `memory-core` unmerged-entry timing (#7767), omob default dirs asserted with the host path separator (#7759), isolation state-race suite determinism (#7770)
- Task and memory tool descriptions dieted (-369 tokens) (#7738), shipped skill descriptions rewritten as routing text (#7744), review-work replaced with orchestrator QA plus one gate reviewer (#7742), ulw-research browsing worker made binding and render-first (#7760)

## [5.0.0-beta.43] - 2026-09-05

- 3460be2bc Merge pull request #7811 from code-yeongyu/release/v5.0.0-beta.43-source-state
- a2130f695 Merge pull request #7807 from code-yeongyu/fix/omo-dev-green-20260905
- 93a5e8830 Merge pull request #7808 from code-yeongyu/fix/memorian-judge-completion-policy
- 2bf127ddb Merge pull request #7806 from code-yeongyu/fix/ci-model-core-requirements
- 8181c28f3 fix(model-core,telemetry): register claude-fable-5-1 everywhere the Fable 5.1 routing needs it
- a722ee320 Merge pull request #7804 from code-yeongyu/fix/memory-notice-wiring-test-drift
- fd1d0dbbc Merge pull request #7800 from code-yeongyu/fix/ulw-monitor-routing
- 23074f20d Merge pull request #7803 from code-yeongyu/feat/facts-in-process
- 983755a64 feat(memory-core): export the single facts record validator
- 021aaf8cf Merge pull request #7799 from code-yeongyu/fix/visual-design-deep-category-guidance
- f0d9ae7fc move deep routing mandate to category descriptions
- c01d126bc refine visual and deep category guidance
- fd6f996c8 Merge pull request #7798 from code-yeongyu/feat/fable-5-1-visual-writing-routing
- 6c75efe35 test(omo-opencode): route visual-engineering config to Fable 5.1
- 8606cedaa test(prometheus): preserve Fable 5.1 effort variant
- a7d3c58dc test(omo-opencode): align Fable 5.1 default assertions
- b85662db0 fix(categories): refresh Fable 5.1 routing assertions
- 516254643 fix(categories): update Fable 5.1 compatibility fixtures
- 79d666ad0 docs(categories): document Fable 5.1 routing chains
- 2988839da test(categories): align mirrors with Fable 5.1 routing
- 2d03a69b3 feat(categories): route visual and writing through Fable 5.1
- e416cf2a6 test(model-core): pin Fable 5.1 category routing
- 9d39e8605 Merge pull request #7797 from code-yeongyu/fix/async-first-remaining-task-examples
- b1f08ffd8 test(evidence): record the async-first sweep renders
- 1badc489e fix(omo-opencode,delegate-core,prompts-core): sweep the remaining task examples and the delegate schema to background-by-default
- 3bd08b366 Merge pull request #7795 from code-yeongyu/feat/gpt-6-astra-async-first
- 004aed716 test(evidence): add the fan-out regression sample to the async-first backtest
- b1c7bd39c test(evidence): record the gpt-6-astra async-first live backtest
- 8d0586ca6 fix(omo-opencode): make background the standard spawn in the GPT-5.5 prompt family and the task tool description
- 143868ad0 Merge pull request #7796 from code-yeongyu/feat/gpt-6-astra-momus
- e857acb19 test(evidence): record the momus Astra resolution proof and cleanup receipt
- 04d7f2b1c Merge pull request #7762 from code-yeongyu/fix/skill-frontmatter-body-preserving
- 1594610fd test(evidence): record the momus GPT-6 Astra RED and GREEN runs
- 25fa01c3a Merge pull request #7794 from code-yeongyu/refactor/memory-tool-surface-consolidation
- 6fd53f2cf refactor: consolidate memory tool surface
- 0c5b1afa9 docs: pin momus to the GPT-6 Astra chain
- 2d2ad3ce5 fix(memory): add a body-preserving frontmatter field writer
- 7c839408e Merge pull request #7793 from code-yeongyu/fix/astra-deep-root-cause
- 273880b26 fix(categories): restore the root-cause clause in the deep Astra prompt append
- 058b15b75 Merge pull request #7792 from code-yeongyu/feat/gpt-6-astra-category-prompts
- a9dc2ad56 docs(evidence): record the GPT-6 Astra category prompt verification run
- cfee1670d refine: tighten the Astra ultrabrain/deep appends, update docs and changelog, follow Astra defaults in remaining omo-opencode tests
- 21a28c8c2 feat(omo-opencode): GPT-6 Astra prompt appends, Astra defaults, and an either-flagship gate for the category twins
- 0e048206e Merge pull request #7791 from code-yeongyu/fix/js-first-eval-docs
- 8b8b1743c docs: present eval examples with JavaScript first
- f31055b2b Merge pull request #7789 from code-yeongyu/docs/gpt-6-astra
- 41717a68a Merge pull request #7790 from code-yeongyu/feat/gpt-6-astra-routing
- c9de902e4 fix(model-core): cap GitHub Copilot GPT-6 reasoning tiers at high like GPT-5
- 544d7288c test(evidence): document Astra max Copilot resolution
- b893cfee1 test(evidence): fix resolution proof imports
- 41ec745e3 test(model-core): clarify Astra max category assertions
- 9e6dfcf28 test(evidence): record GPT-6 Astra routing RED and GREEN
- 5aa6a3e2c test(model-core): align Copilot Astra tier expectations
- d356a5497 docs: pin the ultrabrain default to GPT-6 Astra max
- 8d2f9d67d fix(model-core): use max Astra tier for ultrabrain
- 33286fda7 test(model-core): cover Astra fast alias diagnostics
- 0fe0ac98f feat(model-core): route categories through GPT-6 Astra high
- 047014595 docs: mirror the built-in agent chains without vercel or quotio rungs
- 32aedf541 docs: describe GPT-6 Astra as the recommended GPT flagship and category default
- d4c627165 test(model-core): add failing GPT-6 Astra routing assertions
- 18e514f0f Merge pull request #7766 from code-yeongyu/feat/memorian-in-process
- ad075253a ci(diagnostic): on a stale sidecar check, print the runner's rebuild divergence (temporary)
- 3ec09ec1e ci(diagnostic): print the runner-built omo-task.js divergence on the bundle check
- 07e30350b Merge pull request #7776 from code-yeongyu/fix/dag-runtime-within-budget
- 0a5dab201 Merge pull request #7780 from code-yeongyu/fix/ci-test-timeout-per-file
- 5905fa6aa Merge origin/dev into feat/memorian-in-process
- f1e09b4c5 wip: package.json multi-file scripts carry the budget
- 1dbbcb3ec wip: move pinned invocations + quarantine single source
- 89957ad93 Merge pull request #7782 from code-yeongyu/fix/dag-lock-wait
- 40e49d530 Merge pull request #7784 from code-yeongyu/fix/publish-readiness-test-windows
- 13e09782d test(publish): stub npm and sleep as bash functions, not PATH executables
- 928aa8571 Merge pull request #7781 from code-yeongyu/fix/publish-readiness-budget
- 546bb50cc Merge origin/dev into feat/memorian-in-process
- 4c3b6a586 Merge pull request #7779 from code-yeongyu/fix/publish-stale-stamp-reuse
- 2d3eca4c2 fix(publish): wait for npm propagation as long as npm says it can take
- 481f32a44 test(publish): pin the head-equality reuse guard as a resumability contract
- e06646bd3 fix(publish): refuse to reuse a release commit that is not the base head
- 638c0c474 Merge remote-tracking branch 'origin/dev' into feat/memorian-in-process
- 62bb5e581 test(memory-core): isolate pending payload validation
- c8e94749c fix(memory): validate pending recall payloads
- b634ca135 fix(memory-core): escape recalled memory paths
- 86b261b6b fix(memory-core): harden sync secret redaction
- c1387c55e fix(memory-core): mask every secret occurrence in sync redaction
- a5e61e578 fix(memory): reject secret-bearing and delimiter-breaking nudge hints
- 88dd16bec docs(memory): update memorian gate rows for the in-process judge

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - Merge pull request #7811 from code-yeongyu/release/v5.0.0-beta.43-source-state

## [5.0.0-beta.44] - 2026-09-06

### OMO 5.0.0-beta.44 — hotfix: Codex install works again

beta.43 could not install its Codex plugin from npm. This release fixes both published packages and adds the guards that would have caught it before publish. Engine: senpi **2026.9.5-3** (beta.43 shipped 2026.9.5; #7819).

#### The install failure, fixed
- **`oh-my-openagent@5.0.0-beta.43` died at `npm run sync:skills`** because the published tarball did not carry `packages/prompts-core/prompts/ultrawork/codex.md`, the canonical ultrawork directive the Codex cache install reads. The root `files` allowlist now ships it (#7835, thanks @LilMGenius) and the pre-publish payload verifier refuses a payload without it (#7836).
- **`lazycodex-ai@5.0.0-beta.43` died at the same step** because the curated lazycodex `files` list lacked `packages/shared-skills/skill-source-filter.mjs`. The list is fixed and the verifier now requires every shared-skills runtime export target (#7813).
- **Both packages would have failed again on dev** — the shared-skills imports in `sync-skills.mjs` had been changed (#7814) to checkout-relative paths that do not exist once the installer flattens `plugin/` into `<CODEX_HOME>/plugins/cache/<marketplace>/omo/<version>`. Restored to the package specifier the installer's `file:` link resolves, with a regression test that runs sync-skills inside a reproduction of that cache layout (#7848).
- **The `skipped OMO SOT seed/migration` warning is gone**: the installer no longer spawns a migration script that was removed from the payload (#7837).
- **A failed Codex half now tells you how to retry it** (`bunx oh-my-openagent install --platform=codex`) instead of ending on a success banner (#7845).

#### Release-pipeline hardening
- The published-package smoke job actually installs both payloads through `installMarketplaceLocally` instead of dry-running (#7839).
- The payload verifier reads both npm 11 and npm 12 `npm pack --json` shapes (#7840) and spawns npm through a shell on Windows so the gate can run locally there (#7844).

#### Also since beta.43
- Memory: the reflection payload is bounded and routed around context-window overflow (#7842); memorian nudges are triggered and delivered at tool-call boundaries (#7843, #7846).
- ulw-loop footer refresh, x-search abort, and batch progress state (#7822); Luna / Luna Fast aligned with their 1M context (#7826); compaction-timeout admission overlap prevented in omo-opencode (#7824); repeated senpi runtime access errors suppressed (#7834); LSP push-diagnostics fallback tests synchronized (#7812); category docs aligned with the shipped chains (#7821).

```
npm i -g omo-ai@beta
bunx oh-my-openagent@5.0.0-beta.44 install
bunx lazycodex-ai@5.0.0-beta.44 install
```

Both published packages were installed into a fresh `CODEX_HOME` on a clean Linux box (bun 1.4.0 / node 24) right after publish, through `bunx <pkg>@5.0.0-beta.44 install --platform=codex --no-tui --codex-autonomous` and through `installMarketplaceLocally` directly: exit 0, `sync:skills` clean, 26 skills synced, no `skipped OMO SOT seed/migration` line. An independent macOS/arm64 isolated-HOME install of both packages passed as well. Details on #7835.

## [5.0.0-beta.45] - 2026-09-06

### OMO 5.0.0-beta.45 — engine update: senpi 2026.9.6

A small follow-up to the beta.44 install hotfix: the engine moves from senpi 2026.9.5-3 to **2026.9.6**, which carries the compaction and fallback fixes below. No omo-side code changes besides the pin (#7852).

#### Fixed (via senpi 2026.9.6)
- **Long sessions no longer get stuck above the compaction threshold when a retained tool result holds an image.** The deterministic compaction fallback rejected any prepared suffix whose tool results carried an image block (`unsafe-retained-content`), so after a summarization timeout the session could not compact at all — the "deterministic compaction fallback cannot retain the prepared suffix" loop reported in #6871. Well-formed image blocks are now retained; malformed blocks stay rejected; each candidate's rejection reason is recorded in the diagnostics (code-yeongyu/senpi#1412, reported and reproduced by @ayden94).
- **Fallback decision logs are back.** After the atomic fallback-admission change, `no_chain` / `candidates_exhausted` stopped being written to `fallback.log`; they are logged again (code-yeongyu/senpi#1415).
- **Fallback activation is atomic and fails closed**: model-select hooks and context admission complete before anything is persisted or announced, and a fallback model that cannot admit the live context no longer hops through unrelated providers (code-yeongyu/senpi#1413, #1411).
- Claude SDK OAuth: early terminal results and replay failure attribution are preserved (code-yeongyu/senpi#1400, #1401); senpi compaction is re-enabled on those lanes when `compaction.model` is configured (#1405).
- **Eval cells survive a stop.** The JS kernel handles interrupts cooperatively with a bounded stop, so a stopped or timed-out cell no longer resets the kernel and wipes top-level state, and `Bun.## OMO 5.0.0-beta.45 — engine update: senpi 2026.9.6

A small follow-up to the beta.44 install hotfix: the engine moves from senpi 2026.9.5-3 to **2026.9.6**, which carries the compaction and fallback fixes below. No omo-side code changes besides the pin (#7852).

#### Fixed (via senpi 2026.9.6)
- **Long sessions no longer get stuck above the compaction threshold when a retained tool result holds an image.** The deterministic compaction fallback rejected any prepared suffix whose tool results carried an image block (`unsafe-retained-content`), so after a summarization timeout the session could not compact at all — the "deterministic compaction fallback cannot retain the prepared suffix" loop reported in #6871. Well-formed image blocks are now retained; malformed blocks stay rejected; each candidate's rejection reason is recorded in the diagnostics (code-yeongyu/senpi#1412, reported and reproduced by @ayden94).
- **Fallback decision logs are back.** After the atomic fallback-admission change, `no_chain` / `candidates_exhausted` stopped being written to `fallback.log`; they are logged again (code-yeongyu/senpi#1415).
- **Fallback activation is atomic and fails closed**: model-select hooks and context admission complete before anything is persisted or announced, and a fallback model that cannot admit the live context no longer hops through unrelated providers (code-yeongyu/senpi#1413, #1411).
- Claude SDK OAuth: early terminal results and replay failure attribution are preserved (code-yeongyu/senpi#1400, #1401); senpi compaction is re-enabled on those lanes when `compaction.model` is configured (#1405).
 inside a cell no longer reads the TUI's stdin (#1406, docs #1408); inline skill references preserved (#1404); the shared-host RPC session admission cap is removed (#1409).

```
npm i -g omo-ai@beta
bunx oh-my-openagent@5.0.0-beta.45 install
bunx lazycodex-ai@5.0.0-beta.45 install
```

Both published packages were installed into a fresh `CODEX_HOME` on a clean Linux box (bun 1.4.0 / node 24.18.1) right after publish — through `bunx <pkg>@5.0.0-beta.45 install --platform=codex --no-tui --codex-autonomous` and through `installMarketplaceLocally` directly: exit 0, `sync:skills` clean, 26 skills synced, no OMO SOT warning. `npm i -g omo-ai@5.0.0-0.beta.45` then `omo --version` on that box prints `omo 5.0.0-0.beta.45 (engine: senpi 2026.9.6)`. An independent macOS/arm64 isolated-HOME install of both packages passed as well.

## [5.0.0-beta.46] - 2026-09-07

### OMO 5.0.0-beta.46 — engine update: senpi 2026.9.7

The engine moves from senpi 2026.9.6 to **2026.9.7** (#7886). This one carries the three fixes for the defects that were silently killing long sessions.

#### Fixed (via senpi 2026.9.7)
- **Context overflow is recoverable again, even with auto-compaction off.** `compaction.enabled=false` now switches off only proactive threshold compaction; a turn the provider rejects as a context overflow still gets its one-shot compact-and-retry recovery instead of leaving the session with no way forward. A goal no longer re-prompts a context the provider just rejected; the next user message resumes it (code-yeongyu/senpi#1425, #1422).
- **The RPC `set_auto_compaction` is session-scoped**: it no longer rewrites the persisted global `compaction.enabled`, so one OmO Desktop thread toggling auto-compaction cannot disable it for every other session on the machine. The desktop toggle keeps working (it reads the following `get_state`); the interactive `/settings` toggle still persists (#1425).
- **Context windows in the catalog now show the real prompt budget.** OpenAI rejects a request with `context_too_large` once the prompt alone exceeds window minus max output, so the old 1,050,000 / 400,000 totals let sessions run past the point where compaction could still help — that is why sessions were dying around 916k. 128 catalog rows across OpenAI, OpenAI Codex, Azure, Bedrock, Copilot, OpenRouter, Vercel, OpenGateway, Cloudflare and OpenCode now carry the provider input caps (922,000 / 272,000); your UI footer shows a smaller denominator by design, and user `modelOverrides` still win (#1427, #1422).
- **No more whole-session freeze on a path token.** The permission system's external-directory check resolved paths with `realpathSync`, which under Bun opens every directory it walks and blocks forever on an autofs trigger such as macOS `/home`; it now resolves per component with `lstat`/`readlink` (#1419).
- Codemode: a missing sidecar now surfaces a clear error instead of a hang (#1426); skill packages are de-duplicated (#1424); fallback decision logs and the teardown test harness were hardened (#1416, #1417).

#### Also since beta.45 (omo)
- test(background-agent): stop the unreachable-server stale sweep from expiring on the wall clock (#7891, @LilMGenius)
- fix(omo-senpi): make DAG owner-scope snapshot keys posix on Windows (#7893)
- #7869 fix(senpi-task): scope DAG recovery to the session and immediate fork source
- #7882 fix(postinstall): bound the opencode version probe
- #7881 fix(omo-senpi): keep one omo-senpi package entry and isolate the local launcher
- #7877 ci: fail the build job when committed schema artifacts are stale
- #7873 fix(schema): regenerate omo.schema.json after memory.tool_exposure was removed
- #7854 test(background-agent): pin the stale sweep against an unreachable server end to end
- #7851 fix(background-agent): finalize a stale task whose session is gone and cannot be aborted
- #7850 fix(background-agent): stop reading an unreachable server as a live session

```
npm i -g omo-ai@beta
bunx oh-my-openagent@5.0.0-beta.46 install
bunx lazycodex-ai@5.0.0-beta.46 install
```

Verified on a clean Linux box right after publish: both Codex install paths exit 0 with 26 skills, and published omo-ai reports `omo 5.0.0-0.beta.46 (engine: senpi 2026.9.7)`.

## [5.0.0-beta.47] - 2026-09-07

### OMO 5.0.0-beta.47

**✦ Aha moment! this is the memory release. nothing your agent learned gets dropped on shutdown anymore, Memorian keeps recalling straight through a 503, and every recollection now lands on screen as an aha moment. enjoy them.**

engine unchanged: senpi **2026.9.7**, same as beta.46. this one is all omo side, and most of it is the memory subsystem. i went looking for why memory felt thinner than the number of sessions said it should, and found it.

#### 🧠 memory

**the journal you wrote this session actually gets flushed now.** (#7899, closes #7889)
the shutdown drain has a fixed 1.5 s budget, and the only durable step in it, `journal-flush`, ran *last*. before it, the drain awaited the Memorian judge, the gate and the facts children, and whenever one of those was sitting inside a provider retry chain the budget was gone before the flush was even attempted. i measured it on one host: **199 starvation events across 78 sessions, journal-flush skipped in 191 of them**, and 183 came from ordinary `omo.jsonc` hot-reloads. one shared-config edit was silently dropping the journal of every open session at once. that is not a shutdown edge case, that is memory loss during normal use. the flush now runs **first**, before any pre-drain await, same deadline, no budget increase. and if it still gets skipped or aborted, you get `memory shutdown drain skipped the journal flush` at **error** level instead of a warning that nobody greps for.

**Memorian reads your `eval` cells and your long shell commands now.** (#7895)
the lexical planner never read `eval` code, and it threw away any shell command over 120 characters whole. if you live in eval, the judge basically never fired for you. it now harvests terms from `eval` code and summary arguments and from commands of any length, and reserves two newest-first, path-preferring query slots for tool terms, so one filename in a cell can surface a memory even when your prompt already owns both default slots.

- **late-judge salvage:** nudges the judge already accepted before its deadline are delivered instead of dropped. tool-call-launched judges get a 90 s deadline (was 45 s, judge p90 was 44 s, you can see why).
- **a deadline is not a failure anymore.** a judge that runs out of time with zero accepted nudges is `dropped` (cause `deadline`), so the red *"Memorian gate failed - deadline"* notice is gone for that case. 44 zero-token deadline aborts in 36 h on one host were rendering as failures. real provider breakage still shows as `child_failed`.
- **run retention:** every judge run writes `outcome.json`. run dirs are pruned after 7 days, 30 when nudged, failed or dropped, throttled hourly.

**the judge and the facts child ride your quick-category fallback chain.** (#7907 fixes #7904, #7911)
both children were launched with only the primary model of `quick` and `modelFallback: false`. one `503 server_is_overloaded` on that rung and the run was over, with the rungs you configured sitting unused in an array. they now receive the category's own chain (`selectedModel` + `fallbackModels`) and senpi rotates rungs mid-turn the same way it does for task subagents and the main session. a run fails only when the whole chain is exhausted. when fallbacks exist the same-model retry budget is capped at one, otherwise a two-rung chain could never be exercised inside the 90 s deadline. the beyond-category ladder stays refused: the judge is still pinned to `quick`, it just gets to use all of `quick`.

**and the record tells the truth about which model answered.** (#7911)
the gate entry, the nudged/empty result, the failure record and `outcome.json` now name the rung that actually produced the verdict, not the launch primary.

**recollections look like recollections.** (#7906)
a Memorian nudge used to read like third-party bookkeeping: `Memorian nudged · <hint>`, muted, with a `via steer` line. it now renders as `✦ Aha moment!` / `just remembered: <hint>` (`also remembered:` for a second one) in the agent's own voice. the delivery route stays in the record for forensics but is gone from the screen, and the "hint, not current state" caveat moved to the expanded view. this is the one you will notice first.

**known memory issue, not fixed in this release:** #7912. the reflection scheduler never reclaims an `active.lock` whose launcher is dead when a retired run dir with the same id shadows it, so `pending.json` grows without bound and reflection/dream runs stop launching. if your `runtime/reflection/active.lock` names a dead pid, delete it once. the proper fix is tracked there.

#### 🔁 DAG runs survive a desktop host restart (#7905)

a DAG run paused for its host's shutdown stayed `paused` forever if the successor host resumed the session while the predecessor was still exiting. that is the normal shape of an OmO Desktop RPC restart, so every desktop-hosted run that lived through a restart was stuck, and the desktop's "will be claimed and resumed automatically" prompt was lying. `attach` now arms a lease watch on the previous holder pid and re-runs recovery (claim, reconcile, reschedule) the moment it exits, in the same session, no second `session_start`. `detach`, `pauseForShutdown` and `dispose` cancel the watches.

#### 🔒 `ulw-loop` toolkit: no lost updates, no silent shared scope (#7908, #7913)

- **cross-process state lock.** every mutating CLI command (`create-goals`, `record-evidence`, `checkpoint`, ...) takes an `O_EXCL` lock file carrying pid + a per-acquisition token. stale locks are reclaimed only when the owner pid is dead, `release` unlinks only its own token, and a waiter that cannot acquire fails closed with `ULW_LOOP_LOCK_TIMEOUT` instead of proceeding unlocked. before this, three parallel `record-evidence` calls landed 1 of 3 criteria in 4 of 4 rounds while every process exited 0 with `ok: true`.
- **fail-closed session scope.** without `--session-id` and without a session env key the CLI fell back to the cwd-global `.omo/ulw-loop/` root. from an eval kernel, which does not carry `PI_SESSION_ID`, the same session could read a stranger's plan. it refuses now, and the `ulw-loop` pointer omo-senpi injects carries `--session-id` so eval calls land in the right scope.
- **locked legacy-plan migration.** the aggregate-objective migration no longer runs from inside a read. an unlocked read of a legacy plan fails with `ULW_LOOP_MIGRATION_REQUIRED` and names the recovery (run any mutating command once).

#### 🎯 workflow pointers stop putting words in your mouth (#7910, for #7890)

`skill-pointers` matched workflow names anywhere in any input and injected *"The user asked for <skill>..."*. in a multi-session setup, a relayed status line or a quoted advisory that named a workflow re-armed the pointer in the recipient, and the `ultrawork` trigger had no word boundary. inline and fenced code plus already-injected pointer blocks are masked before the keyword test, the pointer text is conditional ("if the user of this session is asking to run X ... otherwise ignore"), and `ultrawork` / `ulw` match on word boundaries only. `ulw-loop` still arms, `ulwfoo` does not.

#### 🪟 windows

- OpenClaw's reply-listener daemon is identified through `Win32_Process` (PowerShell addressed via `SystemRoot`, not PATH), so it can be detected and stopped instead of being orphaned on the first status check. (#7885, thank you @LilMGenius)

#### known issues

- **#7914**: `lsp-daemon`'s `spawnDaemonProcess` launches the daemon through the compiled `omo` binary without `BUN_BE_BUN=1`, so an `ensureDaemonRunning` retry can boot a **phantom agent session** instead of a daemon. present on `dev` and in this release, fix in progress. if you see short sessions you did not start, `omo doctor` lists orphaned engines.
- **#7912**: reflection reservation not reclaimed after a dead launcher (see memory above).
- **#7902**: DAG reconcile fails never-started nodes as `task_lost` instead of re-admitting them.

```
npm i -g omo-ai@beta
bunx oh-my-openagent@5.0.0-beta.47 install
bunx lazycodex-ai@5.0.0-beta.47 install
```

try it and tell me what breaks. i will be here.

---

- b885f13f8 Merge pull request #7915 from code-yeongyu/release/v5.0.0-beta.47-source-state
- f52d0cb85 Merge pull request #7911 from code-yeongyu/fix/memory-child-chain-provenance
- df30a8e51 Merge pull request #7913 from code-yeongyu/fix/ulw-loop-lock-ownership
- af000e465 fix(ulw-loop): track held locks per async continuation and record tokens in lock fixtures
- 306aa832c fix(ulw-loop): refuse the legacy aggregate-objective migration on read paths
- 39c168e47 fix(ulw-loop): never reclaim a live owner's lock and release only an owned lock
- c55d97dc2 Merge remote-tracking branch 'origin/dev' into fix/memory-child-chain-provenance
- 04282b3f8 Merge pull request #7910 from code-yeongyu/fix/skill-pointer-intent-honesty
- f0dbd3110 Merge branch 'lane/facts-chain' into fix/memory-child-chain-provenance
- a67cb3815 Merge branch 'lane/provenance' into fix/memory-child-chain-provenance
- eb4f0b75c Merge pull request #7908 from code-yeongyu/fix/ulw-loop-state-integrity
- 4714a3ab3 Merge pull request #7907 from code-yeongyu/fix/memorian-judge-quick-chain-fallback
- d4345c5d5 docs(ulw-loop): document the session-scope requirement and the cross-process state lock
- 30b7168d3 fix(ulw-loop): refuse unscoped state instead of falling back to the shared root
- 2449a155d fix(ulw-loop): serialize state mutations with a cross-process lock
- b21052132 Merge pull request #7906 from code-yeongyu/feat/memorian-aha-moment
- 5e49066b9 Merge pull request #7905 from code-yeongyu/fix/dag-recovery-desktop-resume-20260907
- b78afb5c2 feat(memory-core): reserve recall query slots for tool-argument terms
- 767069606 Merge pull request #7899 from code-yeongyu/fix/shutdown-drain-journal-starvation
- 6d404434b Merge pull request #7885 from LilMGenius/fix/windows-reply-listener-daemon-identity
- ef2dfcc66 test(openclaw-core): identify the reply-listener daemon against real child processes
- 2fbe86904 fix(openclaw): identify the reply-listener daemon on Windows

**Thank you to 2 community contributors:**
- @LilMGenius:
  - fix(openclaw): identify the reply-listener daemon on Windows
- @sisyphus-dev-ai:
  - test(openclaw-core): identify the reply-listener daemon against real child processes
  - feat(memory-core): reserve recall query slots for tool-argument terms
  - Merge pull request #7915 from code-yeongyu/release/v5.0.0-beta.47-source-state

## [5.0.0-beta.48] - 2026-09-07

- a470d3d9d Merge pull request #7927 from code-yeongyu/release/v5.0.0-beta.48-source-state
- bcbdb3980 Merge pull request #7922 from code-yeongyu/fix/facts-child-completion-7921-20260907
- 41f4da121 Merge pull request #7917 from code-yeongyu/fix/windows-flake-determinism
- 3726c9ecb Merge pull request #7916 from code-yeongyu/fix/lsp-daemon-packaged-spawn-bun-env
- bdc1f2177 Merge pull request #7918 from code-yeongyu/docs/memorian-aha-moment
- 21643b549 docs(memory): document the Memorian recall gate behind the Aha moment notice
- b9fb35461 test(hooks): cross the legacy truncate/write boundary in-process
- c6fda841c test(team-mode): observe fallback wakes through injected dispatch timing
- 51385f235 test(lsp-daemon): keep the fixture path free of legacy command strings
- 78b925c5e style(lsp-daemon): sort the injected child_process import names
- 3386d8f38 fix(lsp-daemon): force BUN_BE_BUN when spawning the packaged daemon
- 27e70dcff test(lsp-daemon): observe the packaged daemon spawn options

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - docs(memory): document the Memorian recall gate behind the Aha moment notice
  - Merge pull request #7927 from code-yeongyu/release/v5.0.0-beta.48-source-state

## [5.0.0-beta.49] - 2026-09-08

### Highlights

**Engine: senpi 2026.9.8** - fixes the Anthropic OAuth login loop reported on Discord: `/login anthropic` and `/claude-account add` no longer dead-end on a browser page reading "Authentication failed - State mismatch." when another OmO/senpi process on the same machine still holds the OAuth callback port 53692. The login now binds an ephemeral loopback port in that case and carries it through the auth URL and the token exchange, a callback that belongs to another session explains itself and tells you how to continue, and an abandoned login times out after 10 minutes and releases its port ([senpi#1502](https://github.com/code-yeongyu/senpi/pull/1502), [senpi#1503](https://github.com/code-yeongyu/senpi/issues/1503)). Pin bump: #7984. Full senpi notes: [v2026.9.8](https://github.com/code-yeongyu/senpi/releases/tag/v2026.9.8).

**Memorian nudges got sharper.** Recollections now fire on the live prompt and steer an accepted nudge mid-run (#7945), each notice opens with a per-record recollection opener under a single "Aha!" title (#7943, #7959), memories already visible in the transcript are excluded from recall (#7948), factual-negation and decision-commentary hints are rejected before they reach you (#7953, #7949), and accepted nudges are capped per session (#7950). The filler-hint gate was reverted in favour of guidance in the nudge tool description (#7956, #7957, #7960).

### Fixed

- **Tasks / DAG**: spawned task records persist `child_session_id` (#7978); never-started DAG nodes are re-admitted as a new attempt on reconcile (#7939); a vanished DAG state directory no longer exits the session (#7962); RPC process trees are awaited on termination (#7965); `omo.task.updated` snapshot pushes are coalesced so RPC queues stop overflowing in bursts (#7941); delegated children inherit the parent's fast mode through the `-fast` catalog sibling (#7938).
- **Memory**: a bind superseded by session replacement is treated as a skip instead of an error (#7955); reflection completion swallows a stale extension ctx (#7951); the dream idle tick retires on a stale extension ctx (#7942, thanks @stevenahhh); ghost active memory reservations self-heal on reconcile (#7947); dead-launcher reflection reservations shadowed by retired runs are reclaimed (#7944).
- **Packaging**: the bundled agent toolkit runs under Bun mode from the packaged binary (#7936); the tracked generated extension bundles are un-ignored (#7964).

### Changed

- **Ultrawork**: eval work is routed by dependency and every cell is compared with the state it was meant to produce (#7981, senpi#1500).
- **Teams**: task records expose team membership (#7969); the thread tool family is registered (#7456).
- **LazyCodex**: the final gate is softened and subagent plan takeover is stopped (#7976).
- **Website**: the landing hero carries the desktop workflow graph (#7966), the DAG stylesheet ships and the desktop workflow view is legible (#7968), agents are described by role (#7970), and the social image is dynamic with live stars and larger typography (#7954, #7967).
- **CI**: Windows test timeouts raised for git/fs-heavy tests (#7937); the thread live-surface test builds its path expectations with `node:path`, so the Windows senpi-compatibility leg is green again (#7982).

### Pull requests

#7981 #7978 #7976 #7969 #7970 #7968 #7967 #7942 #7966 #7965 #7951 #7955 #7964 #7937 #7962 #7960 #7959 #7957 #7956 #7947 #7954 #7939 #7944 #7950 #7953 #7948 #7949 #7945 #7943 #7941 #7938 #7456 #7936 #7982 #7984

### Commits

- 4b84102c3 Merge pull request #7985 from code-yeongyu/release/v5.0.0-beta.49-source-state
- 73248ccb0 Merge pull request #7982 from code-yeongyu/fix/live-surface-test-windows-paths
- 665abcc0b Merge pull request #7981 from code-yeongyu/feat/ulw-observe-then-act
- 771b83c29 Merge pull request #7978 from code-yeongyu/fix/persist-child-session-id
- a3691b5a9 Merge pull request #7976 from code-yeongyu/lcx/gate-softening
- 681950567 fix(ulw-loop): satisfy strict index-signature access in quality-gate test; repair evidence link
- 9f4d59676 style(omo-codex): format ulw-execute-continuation cli test for biome
- 097be4c09 docs(omo-codex): PR B ship evidence (codex-qa install/app-server proofs)
- 8dde4e843 docs(omo-codex): close out PR B QA evidence (breaker RED/GREEN, remote cleanup receipts, installer probe)
- 3451c0a8b test(omo-codex): update Codex overlay inverse for the shared-skill drift check
- 95f7e934f fix(ulw-loop): bundle the component CLI so dist/cli.js stays self-contained
- eeeb3287e test(ulw-loop): expect lazycodex to accept codeReview-free final gates
- 8bd0c35b3 Merge pull request #7969 from code-yeongyu/feat/team-member-task-linkage
- adb92840f chore(omo-codex): regenerate tracked plugin skill after codex overlay change
- 20c73b8a4 fix(ulw-loop): wrap spawn-admission hook manifest, evaluate breaker first, align legacy artifacts
- ca92f1741 test(ulw-loop): cover accepted quality-gate input forms in error text
- 3f6d44739 fix(ulw-loop): validate codeReview acceptors via surface table on lazycodex
- 40a5364ca Merge remote-tracking branch 'origin/dev' into feat/team-member-task-linkage
- 602f72192 Merge pull request #7970 from code-yeongyu/feat/web-redesign-phosphor-20260908
- 64623f77e fix(web): give the DAG camera toolbar 44px hit targets
- 249a6308d refactor(web): describe agents by role instead of internal names on the public site
- 7f8071678 feat(ulw-loop): add subagent admission circuit breaker and align lazycodex gate artifacts
- 61acee06e fix(omo-codex): make Codex final verification self-review by default and warn on empty spawn fields
- b08bcbe51 fix(omo-codex): relax ulw-execute final gate and stop injecting root plans into subagents
- 0889c2467 feat(prompts-core): trigger ultrawork verification gate only on explicit review demands
- 1999be1f6 fix(ulw-loop): explain accepted quality-gate input forms in errors and help
- a94df2085 feat(ulw-loop): soften lazycodex quality gate to optional codeReview and self-review acceptors
- dfe5289d1 Merge pull request #7968 from code-yeongyu/feat/web-redesign-phosphor-20260908
- ebccbc373 fix(web): ship the DAG stylesheet and make the desktop workflow view legible
- 988f02d38 Merge pull request #7967 from code-yeongyu/feat/web-redesign-phosphor-20260908
- e22e8d63a style(web): format social image component
- 6ee1c7469 fix(web): enlarge star count on social image
- 4a45e9755 fix(web): improve OmO social image typography
- efec42a81 Merge pull request #7942 from stevenahhh/fix/dream-idle-stale-ctx
- 8878a3009 Merge pull request #7966 from code-yeongyu/feat/web-redesign-phosphor-20260908
- e07fe0c23 Merge remote-tracking branch 'origin/dev' into fix/dream-idle-stale-ctx
- 5769d9f1f Merge pull request #7965 from code-yeongyu/fix/rpc-terminate-tree
- ae50dba22 feat(web): port desktop workflow graph into landing hero
- bacec4c88 Merge remote-tracking branch 'origin/dev' into fix/rpc-terminate-tree
- 4e90bf07e Merge pull request #7951 from code-yeongyu/fix/7946-reflection-stale-ctx
- d9a9bd18b Merge remote-tracking branch 'origin/dev' into fix/7946-reflection-stale-ctx
- 50786ac15 Merge pull request #7955 from code-yeongyu/fix/memory-bind-stale-ctx
- 936d255d3 Merge remote-tracking branch 'origin/dev' into fix/memory-bind-stale-ctx
- 493b6faaa Merge pull request #7937 from code-yeongyu/fix/windows-ci-timeout-7709
- b717f0b21 Merge pull request #7962 from code-yeongyu/fix/dag-runs-dir-enoent
- 7a67160da Merge pull request #7960 from code-yeongyu/fix/aha-filler-test-removal
- f7b4b43bd Merge pull request #7959 from code-yeongyu/feat/aha-unify
- bbc2fcc18 feat(web): re-skin docs shell and manifesto and close the mobile overflow debt
- 14e5b2061 feat(web): rebuild the landing page to the Phosphor Ledger contract
- be0b3a90d Merge pull request #7957 from code-yeongyu/revert/memorian-filler-hint
- 2f07008f6 Revert "Merge pull request #7956 from code-yeongyu/fix/memorian-filler-hint"
- 7c1c66c61 Merge pull request #7956 from code-yeongyu/fix/memorian-filler-hint
- 4cc218d7a docs(web): clarify animatable properties and the decorative-only faint text token
- 1b2d857c4 fix(web): serve a minimal social image when the branded render fails
- 064f9dd8b feat(web): add the 3D agent-graph hero scene with poster fallback and chunk budget
- c9b324948 feat(web): add the Phosphor Ledger token layer, primitives, nav and footer
- 9c91bf480 fix(memory): reject filler nudge hints before they reach the recollection notice
- 6595aa6b6 Merge pull request #7947 from code-yeongyu/fix/memory-ghost-active-self-heal
- 11d5155a8 Merge pull request #7954 from code-yeongyu/feat/web-redesign-og-20260908
- cdec4d8bc docs(web): rewrite DESIGN.md as the Phosphor Ledger redesign contract
- 383d17954 feat(web): render the Open Graph image dynamically with live stars and the GitHub description
- 9b52eac1c fix(web): correct landing copy, model labels, and edition list
- 102717bec docs: fix stale claims in READMEs and guides against current code
- a27dc31f5 Merge pull request #7939 from code-yeongyu/fix/7902-dag-readmit-never-started
- fa9a3226d Merge pull request #7944 from code-yeongyu/fix/7912-reflection-reclaim
- fac35d8e7 fix(memory): anchor stranded temporary matching to the full suffix
- b5f664772 fix(memory): read abandoned generation timestamps by artifact schema
- 405a45dc9 test(memory): preserve durable completions with temporary-like run ids
- 963c193cb test(memory): cover retired abandoned reservation generations
- 22cdd1334 fix(memory): bound pending reflection snapshots with oldest-first eviction
- 63102ce6b test(memory): cover persisted pending limits and legacy promotion
- 0759323cb fix(memory): clean reservation temporaries while holding the scheduler lock
- 5f77ec83e docs(memory): document generation-aware reclaim and temporary retention
- 4fe4ba90b test(memory): exercise pending byte and conversation limits behaviorally
- d96b164f0 test(memory): pin reservation temporary cleanup under the scheduler lock
- f8ef47b5a fix(memory): clean failed artifact writes and sweep stranded run temporaries
- d69e67401 fix(memory): reclaim dead launchers shadowed by retired reflection runs
- 662cea3ab test(memory): exercise temporary cleanup through startup and publication
- e98aba39a test(memory): correct retired-generation fixture timestamps and imports
- 50025981e test(memory): pin the aggregate cap on pending reservation snapshot merges
- 2f89d28a2 test(memory): pin run artifact temporary cleanup and the stranded-temp sweep
- 11b558fd6 test(memory): pin dead-launcher reclaim when a retired run dir shadows the reservation
- 90bab7c99 Merge pull request #7950 from code-yeongyu/feat/memorian-nudge-cooldown
- c6f9ef58b Merge pull request #7953 from code-yeongyu/fix/memorian-factual-negation
- cc3800cdd docs(readme): hype up the mass-ulw caption under the DAG image
- 32d20eb1f docs(readme): frame sponsors as sustaining a personal side project
- 60a71b368 fix(memory): narrow factual negation filtering
- 8b764c6d4 Merge pull request #7948 from code-yeongyu/feat/memorian-transcript-filter
- eb102205b docs(readme): state OpenGateway policy as no-logging of inference raw content
- b290ed0b2 docs(readme): unify caption style and add OpenGateway privacy note
- 7e2c90c3d docs(readme): restore omo-herdr-dag image inside OmO Beta block
- 97f85045a ci(cla): allowlist YeongYU account
- 3b562c57f docs(readme): nest mass-ulw caption inside OmO Beta block
- 4660153f3 docs(readme): add omo-herdr-dag showcase under OmO Beta block
- dc847767e docs(readme): fix sponsor section rendering
- 791430499 docs(readme): add sponsor thank-you note under Sponsors title in all languages
- 6e6476136 docs(readme): add OpenGateway sponsor table with logo across all languages
- b55ded074 Merge pull request #7949 from code-yeongyu/feat/memorian-hint-meta-validation
- ce7bcb82e fix(memory-core): reject decision-commentary memorian hints
- 2f2f03e33 Merge pull request #7945 from code-yeongyu/feat/memorian-same-turn-steer-ko
- ffc8292fd feat(memory-core): render the recall hint header in Korean for Korean hints
- fccfb7a5a test(memory-core): cover Korean recall hint header
- 7c78c1464 Merge pull request #7943 from code-yeongyu/feat/memorian-recall-openers
- 85d0cb795 fix(memory): retire dream idle tick on stale extension ctx
- 81f1e7daf Merge pull request #7941 from code-yeongyu/fix/task-updated-coalesce
- f906270e1 Merge pull request #7938 from code-yeongyu/fix/task-fast-mode-inherit-6795
- 7855da5f0 Merge pull request #7456 from code-yeongyu/feat/thread-tools-registration
- 22a79fa19 fix(task): delegated children inherit the parent's fast mode via the -fast catalog sibling
- e5c39d30d ci(windows): raise test timeouts for git/fs-heavy tests
- 31721f19c Merge pull request #7936 from code-yeongyu/fix/ulw-loop-toolkit-bun-be-bun

**Thank you to 3 community contributors:**
- @sisyphus-dev-ai:
  - fix(task): delegated children inherit the parent's fast mode via the -fast catalog sibling
  - test(memory-core): cover Korean recall hint header
  - feat(memory-core): render the recall hint header in Korean for Korean hints
  - fix(memory-core): reject decision-commentary memorian hints
  - test(memory): pin dead-launcher reclaim when a retired run dir shadows the reservation
  - test(memory): pin run artifact temporary cleanup and the stranded-temp sweep
  - test(memory): pin the aggregate cap on pending reservation snapshot merges
  - test(memory): correct retired-generation fixture timestamps and imports
  - test(memory): exercise temporary cleanup through startup and publication
  - fix(memory): reclaim dead launchers shadowed by retired reflection runs
  - fix(memory): clean failed artifact writes and sweep stranded run temporaries
  - test(memory): pin reservation temporary cleanup under the scheduler lock
  - test(memory): exercise pending byte and conversation limits behaviorally
  - docs(memory): document generation-aware reclaim and temporary retention
  - fix(memory): clean reservation temporaries while holding the scheduler lock
  - test(memory): cover persisted pending limits and legacy promotion
  - fix(memory): bound pending reflection snapshots with oldest-first eviction
  - test(memory): cover retired abandoned reservation generations
  - test(memory): preserve durable completions with temporary-like run ids
  - fix(memory): read abandoned generation timestamps by artifact schema
  - fix(memory): anchor stranded temporary matching to the full suffix
  - docs: fix stale claims in READMEs and guides against current code
  - fix(web): correct landing copy, model labels, and edition list
  - feat(web): render the Open Graph image dynamically with live stars and the GitHub description
  - docs(web): rewrite DESIGN.md as the Phosphor Ledger redesign contract
  - fix(memory): reject filler nudge hints before they reach the recollection notice
  - feat(web): add the Phosphor Ledger token layer, primitives, nav and footer
  - feat(web): add the 3D agent-graph hero scene with poster fallback and chunk budget
  - fix(web): serve a minimal social image when the branded render fails
  - docs(web): clarify animatable properties and the decorative-only faint text token
  - Revert "Merge pull request #7956 from code-yeongyu/fix/memorian-filler-hint"
  - feat(web): rebuild the landing page to the Phosphor Ledger contract
  - feat(web): re-skin docs shell and manifesto and close the mobile overflow debt
  - Merge remote-tracking branch 'origin/dev' into fix/memory-bind-stale-ctx
  - Merge remote-tracking branch 'origin/dev' into fix/7946-reflection-stale-ctx
  - Merge remote-tracking branch 'origin/dev' into fix/rpc-terminate-tree
  - feat(web): port desktop workflow graph into landing hero
  - Merge remote-tracking branch 'origin/dev' into fix/dream-idle-stale-ctx
  - fix(web): improve OmO social image typography
  - fix(web): enlarge star count on social image
  - style(web): format social image component
  - fix(web): ship the DAG stylesheet and make the desktop workflow view legible
  - feat(ulw-loop): soften lazycodex quality gate to optional codeReview and self-review acceptors
  - fix(ulw-loop): explain accepted quality-gate input forms in errors and help
  - feat(prompts-core): trigger ultrawork verification gate only on explicit review demands
  - fix(omo-codex): relax ulw-execute final gate and stop injecting root plans into subagents
  - fix(omo-codex): make Codex final verification self-review by default and warn on empty spawn fields
  - feat(ulw-loop): add subagent admission circuit breaker and align lazycodex gate artifacts
  - refactor(web): describe agents by role instead of internal names on the public site
  - fix(web): give the DAG camera toolbar 44px hit targets
  - Merge remote-tracking branch 'origin/dev' into feat/team-member-task-linkage
  - fix(ulw-loop): validate codeReview acceptors via surface table on lazycodex
  - test(ulw-loop): cover accepted quality-gate input forms in error text
  - fix(ulw-loop): wrap spawn-admission hook manifest, evaluate breaker first, align legacy artifacts
  - chore(omo-codex): regenerate tracked plugin skill after codex overlay change
  - test(ulw-loop): expect lazycodex to accept codeReview-free final gates
  - fix(ulw-loop): bundle the component CLI so dist/cli.js stays self-contained
  - test(omo-codex): update Codex overlay inverse for the shared-skill drift check
  - docs(omo-codex): close out PR B QA evidence (breaker RED/GREEN, remote cleanup receipts, installer probe)
  - docs(omo-codex): PR B ship evidence (codex-qa install/app-server proofs)
  - style(omo-codex): format ulw-execute-continuation cli test for biome
  - fix(ulw-loop): satisfy strict index-signature access in quality-gate test; repair evidence link
  - Merge pull request #7985 from code-yeongyu/release/v5.0.0-beta.49-source-state
- @stevenahhh:
  - fix(memory): retire dream idle tick on stale extension ctx
- @YeongYU:
  - fix(memory): narrow factual negation filtering

## [5.0.0-beta.50] - 2026-09-09

- dc9bf86e4 Merge pull request #7998 from code-yeongyu/release/v5.0.0-beta.50-source-state
- 73882d6d2 Merge current dev into release state
- 84c2320b7 Merge pull request #7999 from code-yeongyu/refactor/kibitzer-20260909
- 053a64e4f Merge remote-tracking branch 'origin/dev' into refactor/kibitzer-final
- fd35b9a24 Merge pull request #7995 from code-yeongyu/feat/memory-read-recall-line
- d36aca20c Merge pull request #8007 from code-yeongyu/fix/bun142-postmerge-gates
- e3bf17e0c Merge remote-tracking branch 'origin/dev' into refactor/kibitzer-final
- 1d9e71868 fix: reconcile Bun artifacts after upstream merge
- fbb0bb4be feat(memory): add recall headlines to memory reads
- 14d9e90cf Merge pull request #8001 from code-yeongyu/fix/omob-windows
- 8c99e582a Merge remote-tracking branch 'origin/dev' into refactor/kibitzer-final
- fdca52b85 fix: refresh Bun 1.4.2 artifacts after merge
- 704b3a20f Merge pull request #8003 from code-yeongyu/fix/dev-7971-merge-regressions
- a306072cd test(omob): gate POSIX-only launcher/refresh tests off Windows
- dce8bc029 test(omob): remove duplicated runtime prune coverage
- 6d7889172 Merge pull request #7971 from code-yeongyu/bun-1.4.2
- 131fa3e96 Merge origin/dev into bun-1.4.2
- 7ca4abdb9 Merge pull request #7992 from code-yeongyu/fix/memory-tool-render-shell
- 34627922f fix(omob): preserve Windows executable suffixes
- 2e530b2ce Merge pull request #8000 from code-yeongyu/lcx/evidence-doctor-hardening
- e3e256980 Merge pull request #7996 from code-yeongyu/fix/omob-windows-tests
- 944e3d77c docs(omo-codex): PR C ship evidence (executor-verify raw-pipe proofs, doctor QA-by-read)
- 6fa91b2e7 chore(omo-codex): regenerate installer bundle for 5.0.0-beta.49
- 2ab0db1b9 test(omob): use native executable and path fixtures on Windows
- bc1fb4a36 test(openclaw): publish restart readiness at spawn handoff
- 97e7d1571 test(script): record remote omob POSIX regression evidence
- b92d0f09f test(script): make omob coverage portable across host platforms
- 73f0ddd14 Merge pull request #7994 from code-yeongyu/fix/omob-prune-skip-in-use
- 5f12a02c2 fix(omob): never prune a dev runtime a live process still executes
- 3df6edc5c Merge bun 1.4.2 updates
- 097ba78c9 docs(omo-codex): key lcx-doctor Astra readiness to the catalog default
- 9b4bf222c fix(omo-codex): reject placeholder and stale executor evidence receipts
- 8cc044737 docs(omo-codex): add Astra readiness check to lcx-doctor
- 1cdd5895a Merge pull request #7991 from code-yeongyu/fix/omob-mainline-st-01a083d8
- 6cd4f6c54 Merge pull request #7990 from code-yeongyu/lcx/astra-default-models
- 4730ee8e0 Merge origin/dev and refresh Bun 1.4.2 artifacts
- 7e429a8e6 docs(omob): describe managed startup and isolated feature builds
- 159cbe919 test(omob): cover real git refresh and repeated installation
- c5cacd97e fix(omob): refresh managed mainline launcher before startup
- 7f93ad5f7 docs(omo-codex): PR A ship evidence (codex-qa install/app-server proofs)
- 88089721c docs(omo-codex): installer test A/B timing and test:codex rerun evidence
- 1ee26636f Merge pull request #7987 from code-yeongyu/fix/windows-compiled-worker-st01a08276
- adecbcf31 Merge pull request #7983 from code-yeongyu/fix/compiled-session-worker-st_01a08205
- 1698c8aa0 fix(build): name embedded workers by their physical package layout
- cd235e6f3 fix(build): support Bun 1.4.0 compiled workers within the binary budget
- b8485e334 docs(omo-codex): record CI-parity gate results and installer timeout
- e87691a6a docs(omo-codex): PostCompact budget raw-pipe evidence with injected guide lengths
- 3bc7a3737 test(omo-codex): drop non-null assertion in Hephaestus variant test
- a57c31953 style(omo-codex): biome format
- fd6654639 docs(omo-codex): capture PostCompact budget raw-pipe evidence
- 57531c3c3 docs(omo-codex): state the exact thread-cap preservation rule
- 2dc7551d6 fix(omo-codex): remove quoted agents.max_threads under multi_agent_v2
- 38718c52a docs(omo-codex): executed failing-first evidence for Astra catalog, budget, caps, agents
- b97e0acdf test(omo-codex): expect gpt-6-astra defaults in auto-update migration checks
- d4f41f081 fix(omo-codex): upgrade legacy bundled agent efforts to gpt-6-astra defaults
- 10e7b1112 test(omo-codex): record genuine catalog RED/GREEN evidence
- 82b86e4a0 Merge origin/dev into bun-1.4.2 and regenerate bundles
- 793bc293a fix(omo-codex): reconcile Hephaestus gpt-6 variant with the Astra preset
- e1a70cb52 fix(omo-codex): stop forcing subagent thread caps and detect gpt-6 as multi-agent v2
- 0086eb445 docs(omo-codex): document gpt-6-astra default catalog and cap removal
- a1ae4ded1 feat(omo-codex): move bundled agents to gpt-6-astra with reasoning upgrade steps
- bba5ca308 fix(omo-codex): add gpt-6-astra post-compact context budget
- ca18cac09 feat(omo-codex): default model catalog to gpt-6-astra with sol legacy profile
- 9968ed57d feat(rules-engine): select Hephaestus gpt-6 variant for GPT-6 models

**Thank you to 1 community contributor:**
- @sisyphus-dev-ai:
  - feat(rules-engine): select Hephaestus gpt-6 variant for GPT-6 models
  - feat(omo-codex): default model catalog to gpt-6-astra with sol legacy profile
  - fix(omo-codex): add gpt-6-astra post-compact context budget
  - feat(omo-codex): move bundled agents to gpt-6-astra with reasoning upgrade steps
  - docs(omo-codex): document gpt-6-astra default catalog and cap removal
  - fix(omo-codex): stop forcing subagent thread caps and detect gpt-6 as multi-agent v2
  - fix(omo-codex): reconcile Hephaestus gpt-6 variant with the Astra preset
  - Merge origin/dev into bun-1.4.2 and regenerate bundles
  - test(omo-codex): record genuine catalog RED/GREEN evidence
  - fix(omo-codex): upgrade legacy bundled agent efforts to gpt-6-astra defaults
  - test(omo-codex): expect gpt-6-astra defaults in auto-update migration checks
  - docs(omo-codex): executed failing-first evidence for Astra catalog, budget, caps, agents
  - fix(omo-codex): remove quoted agents.max_threads under multi_agent_v2
  - docs(omo-codex): state the exact thread-cap preservation rule
  - docs(omo-codex): capture PostCompact budget raw-pipe evidence
  - style(omo-codex): biome format
  - test(omo-codex): drop non-null assertion in Hephaestus variant test
  - docs(omo-codex): PostCompact budget raw-pipe evidence with injected guide lengths
  - docs(omo-codex): record CI-parity gate results and installer timeout
  - fix(build): support Bun 1.4.0 compiled workers within the binary budget
  - fix(build): name embedded workers by their physical package layout
  - docs(omo-codex): installer test A/B timing and test:codex rerun evidence
  - docs(omo-codex): PR A ship evidence (codex-qa install/app-server proofs)
  - fix(omob): refresh managed mainline launcher before startup
  - test(omob): cover real git refresh and repeated installation
  - docs(omob): describe managed startup and isolated feature builds
  - Merge origin/dev and refresh Bun 1.4.2 artifacts
  - docs(omo-codex): add Astra readiness check to lcx-doctor
  - fix(omo-codex): reject placeholder and stale executor evidence receipts
  - docs(omo-codex): key lcx-doctor Astra readiness to the catalog default
  - Merge pull request #7998 from code-yeongyu/release/v5.0.0-beta.50-source-state

## [5.0.0-beta.51] - 2026-09-09

### OMO 5.0.0-beta.51

Recall stops dying after an upgrade, thread tools stop appearing on hosts that cannot run them, and the engine gains GPT Image 2.5 with reference-image editing.

#### Memory

**Recall survives an upgrade that lands under a running session.** The recall gate read its judge persona from beside the plugin bundle on every single fire, so the file had to still exist, under its current name, in an install tree that changes while sessions run. After the Kibitzer rename shipped in beta.50, every session whose process had loaded the previous bundle kept opening the retired filename and each recall gate died with `session_create_failed`; one machine logged 155 of them. Persona filenames now have a single definition, each asset is read at most once per process, and all four personas are primed when the memory component registers — so a process keeps serving the payload it started from and a later upgrade, prune, or rename cannot turn its next judge launch into a missing-file error. A persona that genuinely cannot be read is reported once, by name, with its cause, and is never silently substituted (#8016).

**Packaging now guarantees the assets the runtime reads.** The published `omo-ai` payload validator had drifted from the local install validator and no longer required the gate persona, so a staging regression could have shipped a package whose every recall gate failed while the completeness check stayed green. Both validators derive from one list, and the payload test proves the check names a missing persona instead of passing (#8016).

**`omo doctor` names sessions that are running a retired payload.** An in-place upgrade cannot rewrite a process that is already running; doctor compares each engine against the payload on its own `--extension` path and tells you exactly which sessions to restart. It never signals those processes, and they stay outside `--reap` (#8016).

#### Sessions and tasks

**Thread tools only appear where they can actually work.** They now follow the engine's shared-host capability, read from the host instead of guessed from ambient environment variables: off means no thread tools, on means all six, still search-only (#8010, #8011).

#### Platform

**Windows DAG runs no longer trip over lock cleanup.** A concurrent start could leave the losing worker unable to remove its own quarantined lock while another process still held a handle, which Windows reports as a sharing violation rather than the POSIX unlink semantics the code assumed. Cleanup retries briefly on Windows, and worker failures report message, syscall, and path (#8005).

**LazyCodex installs agree with the migration guard.** The installer treated only the model heuristic as MultiAgent V2 while the guard also honored an explicit `[features.multi_agent_v2] enabled = true`; both follow the same rule now, and spawn-guard storage errors surface on stderr instead of being swallowed (#8008).

#### Engine: senpi 2026.9.9-2

**GPT Image 2.5 with reference-image editing.** `generate_image` gains model selection (`gpt-image-2.5-sunburst` by default, plus `gpt-image-2.5-flare` and `gpt-image-2`), `xhigh` and `max` quality, free-form validated sizes, and `reference_image_paths` — up to five local PNG/JPEG/WEBP files that are edited or referenced through the images edit endpoint instead of being rejected.

**Compact read classifications.** Extensions can register a read classifier, so a read is presented by what it is rather than by its path; OmO's memory component uses it for memory-read headlines.

**Oversized sessions resume instead of refusing.** A restored transcript in the compaction band opens in a required-compaction state and compacts before the first prompt, rather than failing model-budget admission at construction time.

**Cold starts with injected context are classified correctly.** A fresh `claude-sdk-oauth` session whose first turn carries several user messages reports continuity as a bootstrap instead of a false registry miss.

**Extensions can see the shared-host policy at registration**, which is what the thread-tool gating above consumes.

---

```bash
npm i -g omo-ai@beta
```

After updating, restart your sessions: a running process cannot adopt a new payload in place, and `omo doctor` will name the ones still on the old one.

## [5.0.0-beta.52] - 2026-09-10

### OMO 5.0.0-beta.52

This is the beta that makes assistant-response editing a real OmO capability, keeps child sessions from inheriting interactive question tools, and closes several compiled-runtime, memory, task, and doctor rough edges. The engine underneath is **senpi 2026.9.10**.

#### Native and shared sessions

**Edit assistant responses instead of restarting the conversation.** senpi now exposes `edit_assistant_message` over RPC and `ctx.editAssistantMessage()` through the extension API. The operation accepts an entry id, replacement text, optional `expectedLeafId`, summarization, and custom instructions. The leaf token is checked before mutation and before the unchanged fast path, so a stale client cannot rewrite a conversation that another client has already advanced. Results distinguish edited, unchanged, and cancelled outcomes, while failures carry typed codes for streaming, missing entries, wrong entry kind, empty text, and stale leaves. `/tree` editing branches at the selected assistant entry, preserves the original session file, and continues from the corrected response. Shared-host `/tree` edits now route to the host rather than a local shadow session.

**Questions are now a complete built-in interaction surface.** `request_user_input` is selected for OpenAI GPT models and `ask_user_question` for other models, with wait-or-continue behavior, partial answers, idle and hard timeouts, resume/reload recovery, and one-time orphaned-after-restart delivery. `askUser.enabled` and `askUser.timeoutMinutes` configure it, while `--no-ask-user` disables it for one run. RPC extension UI now carries question requests, progress, deadline refreshes, resolution broadcasts, and pending state; clients without the capability receive a sequential fallback. Goal continuation treats a question as a legal ending and asks through the tool when only a user decision can unblock the run.

**Child sessions stay headless.** OmO hides both question tools from in-process children, passes `--no-ask-user` to RPC children, and cancels question UI requests in headless auto-answer mode instead of allowing a detached child to hang.

#### Memory and task reliability

**Memory failures explain the cause, not a code frame.** Reflection child stderr is distilled to a bounded cause line before it reaches health notices, fingerprints, completion payoffs, summaries, or `/facts`; the full diagnostic remains in the durable child log and completion record. This keeps repeated failures grouped by their actual cause without exposing source excerpts in every notice.

**Transient memory identities are reclaimed safely.** One-shot children use a transient run root removed at shutdown, abandoned roots and repo-less historical identities are swept by age, and cross-identity guards use structural boundaries instead of enumerating the entire agents directory. `omo doctor` reports durable, transient, and transient-run identity counts.

**Task and team errors render as errors.** Lead team tools now use typed tool errors, preserve structured details, and render compact team rows with member status and bounded failure reasons. Windows task-record writes retry sharing violations and terminal persistence failures settle waiters with an explicit error record, releasing residency so dependent DAG nodes do not hang forever.

#### Runtime and diagnostics

**Compiled children use the compiled engine itself.** A single-file omo binary no longer scans PATH and accidentally launches a different senpi installation for memory or RPC children. `--no-extensions` is honored by the compiled launcher, so bare reflection children stay bare and RPC children do not load the plugin twice.

**Doctor is actionable across editions.** Native, OpenCode, and Codex doctor output now names the edition, installed version, latest channel version, and the exact update command. Windows fixture paths use the same native canonicalization as the child process.

**Native parity and packaging fixes.** The native edition includes the senpi Venice provider, and compiled webfetch binaries inline css-tree data needed by Bun's embedded filesystem. Task tools retain model variants across continuation seams, task-store contention waits within a bounded retry budget, and native installs include Context7 and grep_app MCP parity where configured.

#### Engine: senpi 2026.9.10

**Assistant-response editing is available to every host.** RPC and extension clients can edit an assistant entry with optimistic concurrency and typed errors, and shared-host `/tree` edits reach the canonical host session.

**Venice AI is built in.** `VENICE_API_KEY` is documented in help, the provider appears as Venice AI, and `venice` defaults to `z-ai-glm-5-3` through the OpenAI-compatible privacy-first provider path.

**Question handling is durable.** RPC, extension UI, and app-server clients receive question lifecycle events, timeout outcomes, replay on resume, cancellation on turn end, and exactly-once delivery for unanswered questions. Settings and `--no-ask-user` control the feature.

**More engine fixes ship underneath.** Anthropic tool-search results are readable, native search 400s retry on the same model before fallback, gateway reference names are normalized safely, resumed oversized sessions reduce context deterministically before opening, Claude SDK executable discovery requires a verified spawnable file, Codex multi-account refresh avoids holding the auth lock across exchange, and Bun-compiled webfetch assets are self-contained. The full engine changelog is included in this release.

---

```bash
npm i -g omo-ai@beta
```

After updating, restart running sessions: a process cannot adopt a new payload in place, and `omo doctor` identifies sessions still using an older payload.

## [5.0.0-beta.53] - 2026-09-10

### OMO 5.0.0-beta.53

Pick a model profile instead of hand-wiring a chain, the curated agents are named for what they do instead of who they were in mythology, native workflows survive a session switch, and a process leak that could eventually stop a Mac from spawning anything at all is gone. The engine underneath is **senpi 2026.9.10-2**.

#### Model profiles pick your session model

**Say what kind of work it is; OMO picks the model.** `omo.json` gains `model_profiles` (a record of fallback chains) and `model_profile` (the active one), with three builtin profiles that choose the MAIN session model at session start:

- **capable** — `claude-fable-5-1` -> `claude-opus-5` -> `kimi-k3` -> `glm-5.3`
- **simple work** — `gpt-5.6-luna-fast` -> `deepseek-v4-flash` -> `claude-haiku-4-5`
- **deep work** — `gpt-6-astra` -> `gpt-5.6-sol`

The first rung the live registry can actually serve wins, and the applied notice names the model it picked along with the rungs it skipped. `model_profile` also accepts a literal `provider/model` pin, and you can define your own profiles or override a builtin one.

**It stays out of the way.** No profile is active by default. A profile applies only at session start for a new or startup session, through the session-scoped model setter — it never writes your harness settings, and an explicit `--model`, a scoped model, a pinned value, or a resumed session is left alone. Profiles are documented in the config reference and the agent-model-matching guide, and omo.dev now tells the model story the same way.

#### The curated agents are roles now

**`metis` is `plan-consultant`, `momus` is `plan-reviewer`.** The omo-senpi runtime, its skills, config keys, telemetry, and the shipped ultrawork directive all speak in roles: the main agent (your session model), `plan-consultant`, `plan-reviewer`, `explore`, `librarian`, the Ultrawork Planner persona, and the category roster. Docs, the READMEs in five locales, and omo.dev were re-keyed in the same release.

**The old ids keep working for exactly one release.** `subagent_type: "metis" | "momus"`, DAG routes, team member specs, and `omo.json` `agents.metis|momus` / `allowed_subagents` entries all canonicalize through a single alias module, and every entry point that accepts a legacy id now prints a deprecation notice — task start, DAG lint, team member validation, and a config-startup warning. Only the canonical id is ever persisted, so DAG fingerprints and telemetry never carry the old name forward. Plan frontmatter moves from `review.momus` to `review.plan_reviewer`. **The alias is removed in the next tagged release**, so update your config now rather than later.

**If you query telemetry, this is a breaking change.** `delegation_started.name` and `delegation_completed.agent_type` report the new ids, so dashboards filtering on `metis` or `momus` stop matching new events. A repo gate now fails CI if a retired name reappears in a governed surface. The OpenCode and Codex editions keep their own agent ids; nothing named `boulder` changed.

#### Memory and long-running hosts

**A shared host no longer fills the machine's process table.** The memory lock protocol fingerprints a process start time to detect PID reuse, and on macOS it resolved that by spawning `/bin/ps` on every check — every lock record, every reflection and facts reservation, every stale-lock recovery. A long-lived shared RPC host never reaps those children, so they accumulated as defunct entries until `posix_spawn` failed machine-wide with `EAGAIN`: one workstation reached 10,981 process-table entries with 9,750 zombies, 9,386 of them `ps`, after which shells and ordinary tooling could no longer start. The value now comes from libproc in-process, so there is no child to leak regardless of how the embedding host handles `SIGCHLD`. Dead PIDs are rejected by a fork-free liveness probe first, so stale-lock recovery no longer forks either, and the identity is recorded as an epoch rather than formatted local time, which also removes a timezone-dependent mismatch. Older lock records stay compatible, so an upgrade never steals a live owner's lock.

**Memory children stop inheriting a stranger's package root.** Reflection and dream children were dying about six tenths of a second after launch with an `ENOENT` on a theme asset, and the health alert repeated every session with a hint that could not work. The child is frequently a different senpi install than the engine that exported `OMO_PACKAGE_DIR` / `SENPI_PACKAGE_DIR` / `PI_PACKAGE_DIR`, and it read that inherited root as its own. Those variables are now dropped unless the resolved launcher actually lives inside the root they name, with both sides canonicalized so symlinked installs still compare correctly, and the filter covers the reflection spawn payload, the model preflight probe, and the people-ask runner. A deliberate relocation still works. The remediation hint is honest again: `SENPI_BIN` is offered only for pre-spawn resolution failures, while a child that started and then crashed points at its own log instead of a variable the launcher deletes.

**Reflection health alerts describe this session, not history.** Binding a session to a shared memory identity could replay that identity's old failure streak even when the new session consumed nothing. Alerting is now edge-triggered — a bind that consumes no unsuccessful completion is silent — and completion records carry launcher provenance, so a notice names the runtime that actually failed, the current runtime when it differs, and how many runtimes the streak spans. Legacy records without that metadata still render.

**Kibitzer stops calling non-failures failures.** A judge that answers only through its nudge tool and then stops silently was being settled as an error by empty-response recovery; the nudge result now ends the turn once it reaches its item cap, and a settled empty-response error counts as completed when nudges were accepted and as empty when none were. Run-directory artifacts are auditable output rather than inputs, so a failed write warns and continues instead of failing the fire as a session-creation error. A missing persona asset is reported as `persona_unavailable` and names the file. The task runtime is primed at registration alongside the personas, and a failed import is not cached so a repaired tree recovers.

#### Workflows, tasks, and continuation

**Native workflows survive a session switch.** Switching sessions used to cancel active DAGs from a vetoable pre-switch hook before shutdown could pause them, and recovery then rejected even an explicitly released lease held by the same process. Retirement moves to committed shutdown, which awaits scheduler quiescence before persisting the pause and suspending child sessions; a single-shot suspension drains in-flight admission and journal delivery without cancelling child records; and a released own lease can be reclaimed while active self-claims and live foreign owners stay protected. Returning to the session in the same host process resumes the run, reuses completed output, keeps the running child's identity, and admits a pending dependent exactly once. Opening `/session` or opening and cancelling `/resume` never caused teardown and still does not. Explicit workflow cancellation stays destructive.

**Builtin Claude work tries your subscription first.** All fourteen builtin Claude rungs — nine category rungs and five builtin-agent rungs — now list senpi's Claude Pro/Max lane ahead of the metered providers. A machine logged into that lane while also holding a marketplace key had been paying per token for every delegated Claude turn, because rung provider order is the ranking and the subscription lane was not in the list. Relatedly, when two providers expose the same model id, the tie is broken by the rung's own provider order and then the shorter model id; provider name length no longer decides. With the subscription lane absent, resolution is byte-identical to before.

**A child that dies before its first prompt now says why.** Task records carried only `status=error` for a child that never started, because the classifier's detail was collapsed into one sentence before it reached the record. That collapse is deliberate — the message is untrusted child stderr and durable-log redaction matches key names, not values — so instead of persisting the text, the record now carries closed enums and numbers: the failure kind, and the exit kind, code, and signal when the child reached a real exit. That distinguishes a crash from a spawn error from a kill. The runtime-fallback launch path records the same facts, which it previously omitted entirely.

**Windows: a compiled engine launches itself.** When the running process embeds the engine, resolution returns that executable — but on Windows any candidate not ending in `.exe` was read as an npm shim, and a compiled single-file binary may be named anything. The shim reader found no adjacent entry script, discarded the one candidate guaranteed to match the running version and its embedded assets, and fell through to guessing an entry script. The running compiled executable is now returned directly and never re-interpreted; the shim reader still handles PATH and sibling candidates.

**Queued completions survive a session reload.** The idle-injection coordinator's deferred flush could fire after a reload invalidated the extension runtime and take the process down with a stale-generation throw. Retiring a coordinator now cancels its timer and fails queued entries explicitly, the task layer rolls back the failed notification epoch and re-enters its retry path, and producers handle the refusal instead of dropping the work.

**Plan continuation only continues successes.** The `ulw-loop` and `ulw-execute` hooks ignored the outcome of the turn they were continuing, so they could resubmit a turn that errored, was aborted, was already owned by a host retry, or was refused. Both producers now record at turn end and decide at the settle edge that guarantees no retry, compaction, or queued continuation will follow, skipping failures without consuming a continuation slot and logging the reason. Successful continuation, caps, and deduplication are unchanged, and ordinary assistant prose that merely discusses an error still continues.

#### Engine: senpi 2026.9.10-2

**Kimi For Coding sessions identify themselves as a Kimi client.** The Kimi Code endpoint recognizes its clients by a product `User-Agent` plus a six-header `X-Msh-*` device set — platform, version, device name, device model, OS version, and a per-install device id — which the official Kimi client sends on device authorization, token polling, token refresh, and every request. senpi sent none of them, so a subscription session presented itself as an anonymous Anthropic-protocol client that happened to hold a Kimi bearer token. The OAuth subscription path now sends the full set on all four request paths, with printable-ASCII sanitized values and a device id persisted under the agent dir that degrades to a per-process id rather than throwing when that directory cannot be written. The api-key path is deliberately untouched: it authenticates with a platform key rather than a client session.

**The manual-continue shortcut stops appearing as your message.** A bare `.` submitted on a session that already has messages is the hidden continuation it was always meant to be, and nothing is painted for it in the TUI.

**Reasoning warnings fire at the level that warrants them.** GPT-6 Astra's high-reasoning warning now appears only at `max`, and the GPT-5.6 Sol levels are documented alongside it.

**Claude subscription resumes are steadier.** A completed resumed query no longer has its abort listener left attached, so reattaching does not close a healthy query, and a resumed query is pinned across completed-request cleanup.

**A refused model switch is visible and inert.** When a session declines a model switch, the refusal is recorded rather than silently applied or silently dropped.

#### Install

```
npm i -g omo-ai@beta
```

<details>
<summary>Commits (118)</summary>

- 7918f2449 Merge pull request #8101 from code-yeongyu/release/v5.0.0-beta.53-source-state
- bb698fde0 release: v5.0.0-beta.53
- 4212d35ad Merge pull request #8088 from code-yeongyu/docs/omo-model-profiles
- ca8db374d Merge remote-tracking branch 'origin/dev' into docs/omo-model-profiles
- cc1007af2 Merge pull request #8084 from code-yeongyu/feat/omo-model-profiles
- 9efd54a73 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 90df26987 Merge remote-tracking branch 'origin/dev' into feat/omo-model-profiles
- e1ef0a019 test(omo-senpi): budget the model-profile component's first-party bundle growth
- af6ab2336 Merge pull request #8076 from code-yeongyu/docs/omo-senpi-role-names
- 2aa3c4bec Merge pull request #8028 from rlaope/fix/session-dag-suspend-resume
- c5c1f0acc Merge pull request #8099 from code-yeongyu/chore/senpi-pin-2026.9.10-2
- bda423127 build(omo-senpi): regenerate extension bundles on Linux after rebase
- 2518df235 fix(omo-senpi): actually await scheduler quiescence on committed shutdown
- 0c04724be fix(omo-senpi): suspend native workflows across session switches
- 234127bdf chore(deps): adopt senpi 2026.9.10-2
- b850afc96 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- b8d5f0b05 Merge remote-tracking branch 'origin/dev' into docs/omo-senpi-role-names
- 1bbfdc5e3 Merge remote-tracking branch 'origin/dev' into feat/omo-model-profiles
- b03c5796b Merge pull request #8085 from code-yeongyu/refactor/omo-senpi-role-names
- 3f3c97c99 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 9649fa05e Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- 6c15fa87a Merge pull request #8027 from rlaope/fix/policy-continuation-hooks
- 780108592 fix(omo-senpi): match the canceller-returning FlushScheduler in the terminal-outcome fixture
- d9c511315 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- aead84d75 build(omo-senpi): regenerate extension bundles on Linux after rebase
- 6ba04976c fix(omo-senpi): decide plan continuation on agent_settled
- dedf45b1e fix(omo-senpi): gate plan continuation on successful turns
- 7f66132a0 Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- 594e76984 docs(changes): drop a stray merge-marker line from the changelogs
- 715212e23 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- f63126c59 Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- 73dd51c53 Merge pull request #8062 from code-yeongyu/fix/8052-kibitzer-fire-hardening
- 0ab14a696 build(omo-senpi): regenerate extension bundles on Linux after rebase
- 6c4fc1376 docs(omo-senpi): QA evidence for the Kibitzer fire hardening
- 53ff13aa1 docs(omo-senpi): record the Kibitzer fire hardening
- 61ab84b61 fix(omo-senpi): prime the Kibitzer task runtime at memory registration
- eaa062da1 fix(omo-senpi): report a missing Kibitzer persona as persona_unavailable
- 0894ac00c fix(omo-senpi): keep Kibitzer run-dir artifacts best-effort
- 12603e82c fix(omo-senpi): complete a silent Kibitzer judge instead of failing it
- 87f52078f Merge pull request #7933 from code-yeongyu/fix/idle-injection-dispose-7932
- 32f9d4fbd chore(omo-senpi): rebuild senpi plugin bundles on linux
- 124b193c7 fix(omo-senpi): hand back dropped idle injections instead of losing completions
- 75c45a800 Merge pull request #8097 from code-yeongyu/fix/8096-spawn-free-process-identity
- feb54dad3 chore(omo-senpi): rebuild the plugin bundle with the CI-pinned bun 1.4.2
- 19238cb5e chore(omo-senpi): refresh the committed Senpi plugin bundle
- 80dbb6c4b test(memory-core): pin pid-reuse recovery to a same-scheme start identity
- 35dc9c394 fix(memory-core): make the start identity timezone-independent
- 5c6c260d4 fix(memory-core): read darwin process start time in-process instead of forking /bin/ps
- 446b0e3a6 Merge pull request #8059 from code-yeongyu/fix/8051-claude-sdk-oauth-lane-first
- 985e50dad build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 3699fa7aa Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- a2328edbc build(omo-senpi): regenerate extension bundles on Linux after rebase
- ab2ceb224 build(omo-senpi): regenerate extension bundles on Linux after rebase
- 83a9c7965 fix(model-core): never let provider name length decide a fuzzy model tie
- 6ba87ec9c fix(senpi-task): head builtin Claude rungs with the claude-sdk-oauth lane
- 8a3751a73 fix(omo-senpi): export claude-sdk-oauth as a known telemetry provider
- 77d800379 Merge pull request #8094
- 68b67ec1e build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 84f580ac2 Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- d60249eb5 build(omo-senpi): refresh health attribution bundles on current dev
- 2d5926c11 test(memory): cover launcher attribution rendering
- 12809bec2 fix(memory): attribute reflection health to its launcher
- c9d90b563 fix(memory): scope health alerts and record launcher provenance
- 1e5ddba2e test(memory): specify reflection launcher provenance
- 6a35ad579 Merge pull request #8093 from code-yeongyu/fix/6976-rpc-e2e-child-diagnostics
- 1da8b4308 build(omo-senpi): regenerate extension bundles on Linux for the start-failure facts
- 7b87476a1 fix(senpi-task): record why a child failed to start, without leaking its stderr
- 23b99a4a3 build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 9e3af023f Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- b343e2cec Merge pull request #8091 from code-yeongyu/fix/windows-senpi-launcher-flake
- 6855e9cf4 build(omo-senpi): regenerate extension bundle on Linux after rebase
- 10f7a90d2 build(omo-senpi): regenerate extension bundles on Linux for the launcher fix
- ac70d98ec fix(senpi-task): keep the compiled engine when its binary has no .exe suffix
- cb3d88e9c Merge pull request #8070 from code-yeongyu/fix/memory-child-foreign-package-dir-env
- 0bed01a4a build(omo-senpi): refresh memory env bundle on current dev
- 3f1c86f84 fix(memory): use resilient fs for package-root canonicalization
- 5782f32ac fix(memory): stop memory children from inheriting a foreign package root
- 6147d0e2c test(omo-senpi): compare synced-skill exemption paths with forward slashes on every platform
- daa9fcdad build(omo-senpi): regenerate the plugin bundle on the dev-merged tree
- 689071c09 Merge remote-tracking branch 'origin/dev' into refactor/omo-senpi-role-names
- d5e321fb1 build(omo-senpi): regenerate the plugin bundle for the renamed curated agents
- 3135114ba docs(reference): regenerate the telemetry schema block for the renamed curated agents
- 46b786073 test(web): landing e2e covers the Profiles section
- c9605595a test(omo-senpi): QA drivers exercise plan-consultant/plan-reviewer and the legacy aliases
- 12bf5e21b feat(web): tell the model story through profiles in four locales
- b9c522325 docs: document model profiles and how they pick the session model
- d3d2f8714 test(script): keep overlay-rerouted OpenCode literals legal in shared-skill sources
- 24a4b89b0 docs(guide): keep the Codex agent-role install path in the installation guide
- 638f6e8de test(script): gate retired myth agent names out of user-facing surfaces
- ab27ab5d0 refactor: drop the retired curated ids from code comments and mark the Codex role list
- 2d86c998b refactor(omo-senpi): ultrawork directive names the plan-consultant and plan-reviewer
- 5dfb50a4a docs(changelog): record the role-based agent rename and the one-release alias window
- b49efe2c3 build(omo-senpi): regenerate the plugin bundle for model profiles
- 910576d2a fix(omo-senpi): keep an explicit --model when senpi omits the session provenance
- de028bc36 feat(omo-senpi): model-profile QA driver and changelog entries
- e378ad251 test(senpi-task): retire myth agent names from fixtures and package docs
- 7d4c9cb44 feat(omo-senpi): honor legacy agents.momus/metis config keys with a deprecation notice
- 05afdec7b refactor(senpi-task): describe category routing and the plan reviewer by role
- 964915278 feat(omo-senpi): apply the active model profile to the main session
- 3a11406db refactor(omo-senpi): retire persona names from shared-skill prose and the senpi sync scripts
- 00afeac47 refactor(senpi-task): key the plan gate and reviewer policy on plan-consultant/plan-reviewer
- 17a179a0b feat(senpi-task): surface a deprecation notice for legacy curated agent ids
- 8b301e45b style(web): format the cognitive-load manifesto section
- d8ab818ee refactor(omo-senpi): ulw-plan speaks as the Ultrawork Planner with plan-consultant/plan-reviewer
- 9dc58a06c feat(omo-senpi): builtin model profiles and chain resolution
- 6de3d526a refactor(senpi-task): rename curated agents to plan-consultant and plan-reviewer
- c93cb11a6 test(web): showcase and landing e2e follow the role-based roster
- aabc23393 refactor(senpi-task): add legacy agent-name aliases for the curated tier
- bbcb58181 feat(omo-config-core): add model_profiles and the active model_profile key
- 706124b87 feat(web): role-based roster, orchestration and core-loop copy in four locales
- 0dc3bbeb9 docs(reference): configuration and features describe the omo-senpi agent surface
- ded517fc4 docs(guide): installation, team mode and senpi-task pages use role-based agent names
- f6db19edf docs(guide): reframe model matching and overview around the main agent and curated roles
- 00775dcd2 docs(reference): known issues, CLI, telemetry, manifesto, templates and examples use role names
- a40fde3db docs(guide): rewrite orchestration around the omo-senpi delegation model
- 525882365 refactor(web): re-key the agent roster and graph to role-based nodes
- 8a711ddd9 refactor(omo-senpi): describe ulw-execute continuation without the planner persona name
- 470dd6087 docs(readme): describe the main agent, planner and executor by role in all locales

</details>

## [4.14.0] - 2026-06-29

#### Added

- Unified telemetry architecture across OpenCode and Codex editions. (PR #5668)
- Coding Agent Sessions shared skill for finding and reconstructing agent sessions across harnesses. (PR #5600)
- Atlas final-review verdict classification (approve/reject/missing). (PR #5605)
- Web terminal visual evidence helper for QA. (PR #5534)

#### Changed

- Named plugin server export for easier integration. (PR #5717)
- Release prepublish size gates with documented exceptions. (PR #5718, #5722)
- QA evidence redaction for auth headers and terminal secrets.

#### Fixed

- Atlas background output gate requires explicit gate for retrieval. (PR #5653)
- TeamMode leader patience: waits calmly instead of rushing members. (PR #5613)
- CodeGraph child process environment isolation. (PR #5667)
- Windows Codex desktop install discovery-first flow. (PR #5618)
- Context7 placeholder auth removed from Codex config. (PR #5593)
- ULW loop context pressure scan limited to tail.
- Visual QA CJK semantic line break detection. (PR #5522)

## [4.13.0] - 2026-06-23

#### Added

- TeamMode v2 script-driven model (complete rewrite with cross-platform controller script and worktree automation). (PR #5416, #5421)
- Ultimate Browsing shared skill with tiered routing (insane-search, agent-reach, Chrome stealth). (PR #5469)
- CodeGraph auto-init config to skip automatic `.codegraph` creation. (PR #5456)
- Per-member thread titles in TeamMode named by role. (PR #5453)
- ULW loop research work-shape branch with ledger-backed dedup and hypotheses. (PR #5467)
- ULW loop quality gate schema rewrite with essential checkpoint criteria. (PR #5309)
- Lazycodex update release notes included in auto-update. (PR #5477)
- TeamMode members push constant updates by default. (PR #5487)
- Cross-platform teammode controller script and merge-commit integration.

#### Changed

- Venice provider neutralized in Hephaestus and deep model chains. (PR #5523)
- Frontend design references materialized from submodules for DMCA compliance. (PR #5472)
- LazyCodex steering mode defaults to on at install. (PR #5531)
- CodeGraph cross-platform bundle and MCP handshake improvements. (PR #5475, #5496)
- Provider exhaustion fallback policy for background tasks. (PR #5508)

#### Fixed

- Ultimate Browsing cookie handling, template warnings, and forged module detection. (PR #5498, #5503)
- TeamMode worktree-add idempotency on Windows 8.3 paths. (PR #5502)
- TeamMode duplicate member name rejection. (PR #5501)
- Runtime fallback timeout rearming after blocked escalation. (PR #5491)
- Delegate-task silent parent wake retry bounding. (PR #5488)
- Opencode run marker refresh after wake requeues. (PR #5500)
- Skill MCP servers resolved from runtime config without deadlock. (PR #5482)

#### Removed

- AST-grep MCP server and `ast-grep-mcp/core` packages replaced with `sg` binary provisioning via shared resolver. (PR #5313)

## [4.12.1] - 2026-06-20

#### Added

- Per-member thread titles named by role in TeamMode.

#### Changed

- UltraResearch prefers cooperating team broadcasts.

#### Fixed

- Codex thread title nudge shortened.
- CodeGraph bootstrap on Node 26.
- Thread title hook failures surfaced.
- Packaged skills synced during Codex cache install.

## [4.12.0] - 2026-06-20

#### Added

- Skill rename: `frontend-ui-ux` to `frontend` (ported with full references and designpowers contract). (PR #5308)
- Skill rename: `ultraresearch` to `ulw-research`. (PR #5518)
- ULW plan becomes LLM-agnostic (collapsed per-LLM Prometheus prompts into one skill). (PR #5310)
- Monitor tool relocated into `omo-opencode` with background command monitoring and ReDoS hardening. (PR #5315)
- TUI sidebar panel with roster resolver, ULW loop reader, and runtime mirror manager. (PR #5325)
- CodeGraph MCP serve wrapper and session bootstrap for both OpenCode and Codex. (PR #5322)
- Shared agent setup/cleanup/qa-sandbox scripts for cross-harness dev env. (PR #5354)
- `qa-docker.sh` for containerized OpenCode and Codex QA.

#### Changed

- CI upgraded to Node.js 24 runtimes across all workflows. (PR #5352)
- Master-targeting PRs auto-closed with friendly notice. (PR #5351)
- PR and issue auto-labeling reworked to per-package model.
- Build runs in parallel with checks.
- Package layering refactor continued: `telemetry-core`, `team-core`, `delegate-core`, `skills-loader-core`, `claude-code-compat-core`, `tmux-core`, `mcp-client-core`, `openclaw-core`, `mcp-stdio-core`, `lsp-core` extracted.

#### Fixed

- TUI sidebar quality: redacted active goals, safe background task titles, canonicalized paths. (PR #5349)
- Prompt async gate virtualized waits in tests (watchdog, background wake, runtime fallback, todo continuation).
- Delegate-task sync completion gated on direct children only.
- Opencode plugin component load failures retried.
- TeamMode composition invariants enforced.
- ULW plan honors explicit ask and fork filter.
- Sisyphus prompt rebuild for runtime model family.

#### Removed

- Native `ast_grep` MCP server and `ast-grep-mcp/core` packages; replaced with shared `sg` resolver and skill. (PR #5313)

## [4.11.1] - 2026-06-18

#### Added

- GLM prompt variants and ultrawork GLM prompt routing.
- Claude Fable-5 and Mythos-5 context limit recognition.

#### Changed

- Programming skill: restored hard LOC gate, replaced absolute rule with code-smell review triggers.
- Model-core normalizes non-Claude model version separators.

#### Fixed

- Codex marketplace auto-update boundary preserved.
- CodeGraph MCP path stamped during bootstrap.
- CodeGraph startup hook output made valid.
- Start-work passes bare session id to SDK session.messages.
- Background-agent schedules re-flush for reply-required wake after activity window.
- Lazycodex codegraph missing binary provisioned during MCP serve.

## [4.11.0] - 2026-06-17

#### Added

- CodeGraph initialization: bootstrap on session start, register MCP, shared resolver and provisioning. (PR #5322)
- TUI sidebar panel: state model, snapshot schema, roster resolver, ULW loop reader, mirror manager. (PR #5325)
- Monitor tool: background command monitoring with ReDoS hardening. (PR #5315)
- ULW plan LLM-agnostic skill. (PR #5310)
- Lazycodex agent series and executor verify hook component. (PR #5305)
- Frontend skill designpowers operating layer and web-ui-design skill. (PR #5541)
- Visual QA clone fidelity reviewer and dual-harness dispatch. (PR #5307)
- Shared agent setup/cleanup/qa-sandbox scripts for cross-harness dev env. (PR #5354)
- Devcontainer and cross-harness dev env wiring. (PR #5354)
- `default_mode` config auto-activates ultrawork and ralph loop without typing commands. (PR #4190)
- Toast i18n with English and Chinese locales, backed by plugin config. (PR #3884)
- `disabled_providers` config schema and helper. (PR #4031)
- `plan-format-validator` hook warns on malformed task labels in `.omo/plans/*.md`. (PR #4221)
- Prometheus gains spec-driven development framework awareness (OpenSpec, .specify). (PR #2307)
- Per-agent skill filtering with `restrictedAgents`. (PR #2827)
- `look_at` async refactor for non-blocking image analysis. (PR #4098)
- `keyword-detector.enabled_expansions` allowlist. (PR #4084)
- `taskCleanupDelayMs` configurable for background tasks. (PR #3241)
- Per-agent `displayName` for i18n. (PR #4081)
- Grok family models with `reasoningEffort` support. (PR #4186)
- CLI `setup` alias for `install`. (PR #4174)
- Codex CLI Light edition (`omo-codex`) with one-command install via `bunx oh-my-openagent install --platform=codex` or `lazycodex` bin entry. (PR #5354)
- New `--platform <opencode|codex|both>` install flag.
- New bin entries: `omo` (short alias) and `lazycodex` (auto-defaults `--platform=codex`).
- PostHog telemetry stream `omo_codex_daily_active` for Codex edition.
- Triple-publish to npm: `oh-my-opencode`, `oh-my-openagent`, and `lazycodex`.

#### Changed

- Massive package layering refactor. Eight workspace packages extracted: `utils`, `hashline-core`, `model-core`, `rules-engine` (renamed from `rules-core`), `agents-md-core`, `ast-grep-core`, `comment-checker-core`, and `boulder-state`.
- `model-core` uses dependency injection, eliminating all `src/` back-imports from core packages.
- `prompt-async-gate` split from monolith into six focused sub-modules.
- Additive OpenCode config directory discovery. (PR #3875)
- `delegate_task` supplies sensible defaults for `run_in_background` and `load_skills`. (PR #4121)
- CI reworked with Node 24, parallel build, per-package labeling.
- Master-targeting PRs auto-closed.

#### Fixed

- Background-agent session activity tracking and stale timeout. (PR #4226, #4228, #4235)
- Team-mode hard-rejects coordinator agents, surfaces member errors, port-0 fallback, Windows base directory init, atomic config writes, preserves membership across fallback, validates agents. (PR #4027, #3923, #3963, #4023, #3838, #3898, #3987)
- Runtime-fallback synthetic continuation, quota error recognition, OpenAI `server_error` retryable. (PR #3645, #3937, #3799)
- Windows Git Bash / MSYS2 shell detection, powershell syntax fallback, WSL binary detection. (PR #3370, #3499, #3607, #2991)
- Tmux-subagent terminal probe drain, session readiness wait, layout skip for isolated panes. (PR #2887, #0465, #4100)
- Skill-mcp-manager survives reloads and disconnections, trusts explicit env vars. (PR #4099, #3995)
- Slash-command duplicate injection removed. (PR #3724)
- Hyperplan no longer fires on `.hpp` C++ header paths. (PR #4215)
- Todo-continuation-enforcer stops looping after completion. (PR #4013)
- `tool.definition` handler wired for `todo-description-override`. (PR #3705)
- Model parsers guard against non-string input. (PR #4145)
- `mcp_` prefix stripped from tool names before dispatch.
- Shell `glob` and `grep` tolerate broken symlinks.
- `delegate-task` defaults and per-agent skill restrictions. (PR #4119, #4121)
- Process-cleanup graceful shutdown after `SIGTERM`. (PR #4026)

#### Documentation

- Added `ROADMAP.md` describing the package layering refactor and multi-harness direction.
- PR merge policy documented: merge commits required, squash/rebase forbidden.
- `prompt-async-gate-rfc.md` updated with `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` 250 to 2000 rationale.

## [4.2.3] - 2026-05-20

#### Added

- `packages/rules-engine`: new workspace package extracting rule discovery, matching, caching, and nested AGENTS.md context utilities. Part of the ROADMAP multi-harness package layering refactor.
- `packages/ast-grep-mcp`: native `packages/omo-opencode/src/tools/ast-grep` removed and replaced with a package-backed MCP server. User-facing tool names `ast_grep_search` / `ast_grep_replace` are preserved via MCP namespacing (server `ast_grep` + tools `search`/`replace`). `disabled_tools` continues to honor the legacy names.
- Rules-injector transcript hydration: dedup cache is now seeded from the session transcript on context-recovery, preventing duplicate rule injections after compaction.
- Comment-checker now parses `apply_patch` tool payloads, detecting AI slop comments in patch-style edits (not just plain file writes).
- `setSisyphusRuleDeprecationLogger` export from `@oh-my-opencode/rules-engine` lets the host inject its logger so the core package stays free of harness-source imports.
- `ROADMAP.md` documents the multi-harness package layering refactor and contribution flow (`ROADMAP` label).

#### Changed

- `prompt-async-gate`: `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` default raised from 250 ms to 2_000 ms (8x) to absorb slower-provider `session.error` arrivals before reservation release. The constant remains a public export; callers can still override via `postDispatchHoldMs` per dispatch. [`docs/reference/prompt-async-gate-rfc.md`](docs/reference/prompt-async-gate-rfc.md) updated accordingly.
- `team-mode`: `team_send_message` ambiguous-failure path now releases the reservation, commits on success-path mark failures, preserves live delivery holds, and decouples resume history from session routing (BUG-A / BUG-B).
- `runtime-fallback`: recognises every OpenCode progress event shape (`message.part.updated`, `message.part.delta`, `message.updated`) and boolean/completed finish markers, preserves accepted pending retries, and detects finish-only tool waits (BUG-C / BUG-D).
- `background-agent`: parent-wake on same-source reservation now re-enqueues instead of dropping the wake (BUG-E).
- `rules-core`: `findRuleFiles` falls back to `workspaceDirectory` when no project root marker is found (BUG-F).
- `cli doctor`: lists all built-in MCP servers (`websearch`, `context7`, `grep_app`, `lsp`, `ast_grep`) and bootstraps the LSP MCP fallback script when no CLI binary is present.

#### Fixed

- `rules-core` **security**: project rule files and directories can no longer escape the workspace via symlinks. `findRuleFilesRecursive` and the project-single-file path now require every realpath to remain within the scan boundary, blocking attacks where a hostile repo points `.github/copilot-instructions.md` (or any `.omo/rules` entry) at host secrets such as `~/.ssh/id_rsa`. Tests track the boundary contract in [`packages/rules-engine/src/index.test.ts`](packages/rules-engine/src/index.test.ts).
- `test-isolation`: rules-injector storage and fixture home isolated per-test; cross-suite leak diagnostic regression test added.
- `ast-grep-mcp`: absolute paths whose `realpath` stays inside the workspace are now accepted (covered by red test); `path` entries are normalized via `resolve` + `realpath` and rejected for null bytes, leading `-`, and out-of-workspace traversal.
- `runtime-fallback`: completion progress events (`message.part.updated`, deltas, finished markers) now correctly recognized, preventing false-negative retry triggers on sessions that are actually making progress.
- `context-recovery`: idle sessions are now handled during context recovery, avoiding stale state when compaction fires on an already-idle session.
- `rules-injector`: storage writes now retry after cleanup races, preventing transient ENOENT failures during concurrent compaction + rule injection.
- `plugin`: synthetic `status: idle` events now correctly trigger idle hooks, ensuring continuation and recovery hooks fire even when OpenCode emits synthetic idle after tool completion.
- `rules-core` **security** (additional): package fully isolated from harness imports; symlink escape blocking extended to cover rule directory scanning (not just individual files).

#### Reverted Breaking Changes

- Restored `.sisyphus/rules` and `~/.sisyphus/rules` rule-source discovery that was silently removed in v4.2.2..HEAD. They now load with LOWEST priority among project rule sources and emit a deprecation warning. **Planned removal in v4.3.0**: migrate to `.omo/rules` and `~/.omo/rules`.

#### Internal

- `packages/rules-engine` no longer imports `../../../src/shared/logger`. ROADMAP's "core has no harness dependencies" invariant is now upheld; the host injects its logger from `packages/omo-opencode/src/hooks/rules-injector/rule-file-finder.ts` as a module-level side effect.
- `README.ru.md` gains the OmO logo to match `README.md` / `README.ja.md` / `README.ko.md` / `README.zh-cn.md`.
- CLA signatures added for PR #4176, #4180, #4181, #4186.

#### Known Limitations (deferred to v4.3.0)

- `packages/omo-opencode/src/shared/prompt-async-gate.ts` is 885 LOC, well past the 250-LOC architectural ceiling. Splitting it into `prompt-reservations`, `prompt-queue`, `prompt-message-state`, `prompt-dispatch-runner`, and a thin facade is queued with the broader multi-harness refactor.
- Root `package.json` still declares `@ast-grep/napi` and the doctor still checks the NAPI dependency even though the native tool is gone. Cleanup ships with the next ast-grep harness pass.

#### Web

- Landing page decomposed from 832 LOC into 10 section components; manifesto page from 358 LOC into 9 section components.
- Design system tokens extracted into `DESIGN.md` with consistent spacing, color, and typography variables.
- Dynamic OG + Twitter card images via `next/og`, later switched to static PNG file convention for reliability.
- Hero "Get Started" CTA now links to `/docs#installation` (closes #3848).
- Nested `<main>` on manifesto page removed for WCAG 1.3.1 compliance.
- UX/accessibility polish pass + middleware metadata route fix.
- Responsive test matrix added: 6 viewports x 4 locales x 2 pages.
- CI/build pipeline optimized; dead dependencies removed.

#### Documentation

- Added [`ROADMAP.md`](ROADMAP.md) describing the package layering refactor and multi-harness direction.
- Added OmO logo to [`README.ru.md`](README.ru.md) for parity with the other localized READMEs.
- PR merge policy documented: merge commits required, squash/rebase forbidden.
- `prompt-async-gate-rfc.md` updated with `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` 250 -> 2000 rationale.

## [4.2.0] - 2026-05-15

#### Added

- `createPluginModule` test seam moved out of public API surface to `packages/omo-opencode/src/testing/create-plugin-module.ts`. New public exports for the prompt-async-gate primitives: `dispatchInternalPrompt`, `releasePromptAsyncReservation`, `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS`, `DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS`.
- `ParentWakeNotifier` module (`packages/omo-opencode/src/features/background-agent/parent-wake-notifier.ts`) extracted from `BackgroundManager`. Background-agent parent-wake state now lives in its own narrow class with dependency-injected client, directory, and notification enqueue callback.

#### Changed

- `prompt-async-gate` now uses a shared internal runner for both sync (`prompt`) and async (`promptAsync`) dispatch wrappers, deduplicating the reserve/settle/check/dispatch/hold/release flow.
- `releasePromptAsyncReservation` accepts `reservedByPrefix` only when the prefix ends in `:` (e.g., `model-fallback:`), preventing accidental release of sibling reservations whose source merely starts with the same identifier characters.
- Version bump from 4.1.2 to 4.2.0. Reason: added public exports for the gate primitives qualify as MINOR per semver. No removals or breaking signature changes.

#### Fixed

- `prompt-async-gate`: dispatch timeout via `Promise.race` with a default 30s window. Previously a hung `promptAsync` deadlocked the gate for that sessionID until process restart. (BLOCKER-1)
- `prompt-async-gate`: post-dispatch failure now keeps the reservation hold regardless of whether `promptAsync` resolved or threw. AGENTS.md's documented race window ("returns before durably accepted, later failures arrive as `session.error`") is now covered. (BLOCKER-2)
- `prompt-async-gate.test.ts`: replaced `setTimeout`-based synchronization with event-driven patterns to comply with the new `.omo/rules/test-discipline.md` rule. (BLOCKER-3)
- `model-suggestion-retry`: releases the reservation before the suggested-model retry so the second attempt can dispatch immediately. Without this, BLOCKER-2's post-dispatch hold trapped the retry path.

#### Internal

- `prompt-async-route-audit.test.ts` migrated to TypeScript compiler API for AST-based detection. Catches destructuring, bracket access, optional chaining, and type-cast aliasing bypass patterns. Two existing production callers are documented in `RAW_PROMPT_ALLOWLIST` with justifications: `packages/omo-opencode/src/plugin/event.ts` (team-idle-wake-hint client facade) and `packages/omo-opencode/src/hooks/session-recovery/recover-unavailable-tool.ts` (capability check before gate-routed dispatch). (HIGH-5)
- New `mock-module-lifecycle-audit.test.ts` enforces cleanup pairing for `mock.module(...)` calls in test files; existing offenders allowlisted with TODO references. (HIGH-10)
- `.omo/rules/test-discipline.md` added in this release window forbidding `setTimeout(resolve, N)` and `await sleep(N)` in test bodies unless time is the SUT. Several CI sharding commits earlier in the window were superseded by removing the sharded runner in favor of the rule.

#### Known Issues

- **Delegated child-session early-failure fallback (BLOCKER-4)**: PR #3825's `fac90d69f` was reverted by PR #4044 because its own regression test failed on clean root `bun test`. The delegate-task fallback bug for empty session history remains unaddressed in v4.2.0. Reland targets v4.2.1 once the regression test is stabilized against post-#4032 schema and the new gate semantics. See `docs/reference/known-issues.md` for details and workaround.
- **First-prompt watchdog supersession history (L16)**: PR #3952 was superseded by PR #4051 (rebased over #4007/factory refactor with `internallyAbortedSessions` threading). The supersession represents conflict resolution, not a feature pivot. The final watchdog logic shipped via #4051 + `a130fa70d` covers subagent first-prompt silence past 90 seconds with cleanup via session.deleted.

[Unreleased]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.14.0...HEAD
[4.14.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.13.0...v4.14.0
[4.13.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.12.1...v4.13.0
[4.12.1]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.12.0...v4.12.1
[4.12.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.11.1...v4.12.0
[4.11.1]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.11.0...v4.11.1
[4.11.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.3...v4.11.0
[4.2.3]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.2...v4.2.3
[4.2.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.1.2...v4.2.0

## Development ledger (pre-backfill, unversioned)

Accumulated before the release sections below were backfilled from the published releases.
Kept verbatim; it was never attributed to a single release and is not release notes.

### Added

- New npm package `omo-ai` (beta channel only): the senpi-native edition. `npm i -g omo-ai@beta` installs the `omo` command, which launches the pinned senpi release with the full OMO extension loaded, and `omo setup` imports API credentials from sibling harnesses with consent. Channel contract: every version is a prerelease published with `--tag beta`, so a bare `npm i -g omo-ai` fails with ETARGET by design and `latest` never advances past the deprecated placeholder. Upgrade order: machines with oh-my-openagent/oh-my-opencode 4.19.4 or earlier must upgrade or uninstall that package first (it owns the old global `omo` bin), then install `omo-ai@beta`. See docs/reference/omo-ai-publishing.md.

- Unified `omo.jsonc` configuration surface across all three harnesses: `~/.omo/omo.jsonc` plus walked project `.omo/omo.jsonc` layers, VSCode-style `[opencode]` / `[senpi]` / `[codex]` harness blocks, opt-in `profiles` activated by `OMO_PROFILE` > `OCX_PROFILE` > `OPENCODE_CONFIG_DIR` tail, and a shared `models` catalog whose entries fill unset tuning while site tuning wins.
- Runtime legacy-config migration: a lock+journal engine imports `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` and `~/.omo/config.jsonc` into the unified file with no-clobber conflict diagnostics, `_migrations` markers, and resumable backups under `~/.omo/migration-backup-<UTC timestamp>-opencode-config/`; runs at plugin startup (OpenCode + Senpi), Codex startup (config.jsonc group only), install, and `oh-my-openagent config migrate` (`--dry-run` / `--json`).
- Reasoning unification: `reasoning` is now the canonical config field, `models` is the shared ordered chain, `provider_options` is the escape hatch for wire-specific knobs, model strings accept a `:level` suffix, and deprecated keys remain readable during the back-compat window while the migration rewrites persisted config to the unified schema.
- Doctor surfacing for deprecated reasoning keys now reports exact file and key paths so users can clean up stale config before the removal window closes.
- CodeGraph upgraded to 1.5.0; managed 1.0.1 and 1.4.1 runtimes re-provision automatically, while existing project stores remain compatible without a manual re-index.
- Opt-in CodeGraph shared daemon across all three adapters: `codegraph.daemon` config key (default false) on OpenCode and Codex, `OMO_CODEGRAPH_DAEMON=1` on Senpi, plus `codegraph.excluded_roots` parity. (PR #6251)
- Process hygiene: parent-liveness watchdogs exit MCP server processes when their parent dies, new lsp daemons reap older-version daemons at startup, and a startup family sweep removes orphaned codegraph and lsp processes on every adapter. (PR #6262)
- Model profiles: `model_profiles` / `model_profile` in omo.json with builtin `capable`, `simple-work`, `deep-work`; the active profile picks the main session model for the session only (never persisted), a literal `provider/model` value pins, and mid-session fallback continues to follow senpi's retry chains when no model is pinned.
- `omo doctor` reports stale orphaned engines: interactive senpi engine processes whose launcher died underneath them (reparented to pid 1) are listed with pid, age and tty. Terminating them is an explicit, per-pid opt-in - `omo doctor --reap <pid> [pid...]` - which refuses any pid that is not an orphaned interactive engine at the moment of the request (a live session, an `--mode` rpc/app-server engine, or anything that is not an engine at all). Nothing is ever matched and killed by pattern.

### Changed

- The ultrawork directive's `# Parallel execution` section routes eval work by dependency instead of call count: independent reads, searches, symbol lookups, and spawns batch into one js cell, while edits, side-effecting commands, deploys, approvals, and result-dependent calls run one action at a time and are observed; every cell is named by the state it should produce and compared with it, failures stay verbatim in aggregates, truncated output is re-read, and visual results (pages, components, images, 3D scenes) get a change-render-look loop with several angles for 3D and desktop/mobile widths for pages. The "JS EVAL MAXXING" / "MONITOR MAXXING" wording and its profanity are gone; the Manual-QA browser and computer-use channels name per-change observation. The `visual-engineering` category append (both editions) adds an `<OBSERVE_EACH_CHANGE>` block with the same loop.
- **OmO Native runs on bun wherever bun exists, no config needed.** The `omo` launcher used to hand itself to bun only for `bun add -g` installs; every other install stayed on node even on a machine with bun, so the JS eval kernel ran under node and the bundled `bun-1-4` skill never surfaced. Now any install (npm, project-local, `bunx`) probes the bun it finds (`$BUN_INSTALL/bin`, `~/.bun/bin`, PATH) once per node boot and re-execs under it when it is >= 1.4.0; bun-global installs keep trusting the bun that installed them without a probe. `OMO_RUNTIME=node` is still the way to stay on node, and `OMO_RUNTIME=bun` still forces bun without the version floor. See docs/reference/omo-ai-publishing.md, "Runtime selection".
- OmO Native beta.23 adopts Senpi 2026.8.27 and documents the JavaScript-first eval workflow: persistent state, `Promise.all` fan-out, bounded `parallel()`/`pipeline()` composition, idle-kernel continuation for detached work, literal-safe top-level persistence transforms, explicit detached-cell diagnostics, bounded eval telemetry, worker-crash recovery, and Node 24/Bun 1.4 compatibility. It intentionally describes telemetry and mechanisms without inventing an uncommitted percentage speedup.
- **Detailed eval runtime notes:** The first eval examples now use JavaScript to establish reusable state, then use `await Promise.all(...)` for independent tool calls, and finally demonstrate continuing in Python when JavaScript is busy with detached work. This is the documented fast path because eval kernels are persistent per session and per language; a value created in one JavaScript cell remains available to the next cell, while resetting Python does not reset JavaScript.
- **Safer persistence transforms:** JavaScript state capture now rewrites only top-level declarations, including destructuring and uninitialized bindings. Declaration-shaped text inside strings, comments, and nested function bodies is left unchanged. The result is safer reuse for templates, examples, regular expressions, and embedded snippets without weakening the state-carrying behavior.
- **Bounded parallel composition:** `parallel(thunks)` runs asynchronous thunks through a bounded pool with result-order preservation, and `pipeline(items, ...stages)` applies stage barriers while reusing the same bounded fan-out. The default pool width is four. The release describes the mechanism and its telemetry rather than promising a percentage improvement that has not been benchmarked and committed.
- **Busy-kernel recovery guidance:** A detached cell keeps its language kernel busy until terminal settlement. A competing request receives the occupied cell context and the list of idle enabled kernels, so the agent can continue in another language instead of abandoning the workflow or unnecessarily falling back to an external shell. When every enabled kernel is busy, the diagnostic does not fabricate an alternative.
- **Detached execution observability:** Detached cells retain explicit create/start/detach/complete/fail/stop/peek lifecycle states. Completion notifications are internal model-visible messages rather than synthetic user-input queue entries. Oversized output notices use plain absolute spill paths for the agent-facing read surface, while `local://` remains an in-cell artifact helper.
- **Bounded lifetime and bridge behavior:** The hard wall-clock limit remains active across detachment and host-tool bridge calls, with a default of 1800 seconds. A bridge call may use the configured pause grace, but a stuck or detached cell still reaches a bounded terminal outcome and releases the loop instead of remaining unbounded.
- **Tool orchestration and telemetry:** Eval cells dispatch nested tools through the session's real execution surface; reserved `agent`, `output`, and `tool_schema` helpers use their dedicated bridge path and recursive eval remains rejected. Each settled cell emits one bounded `senpi.eval.execution` record containing wall/kernel timing, terminal and detach status, nested call counts, and bounded per-tool aggregates. External projections omit prompts, arguments, call identifiers, errors, and result previews.
- **Failure recovery:** A JavaScript worker crash settles the active cell, retires the failed worker, and prepares a fresh worker for the next cell. Session-generation fencing prevents retired callbacks from emitting into a newer session. Subprocess-backed interpreters wait for readiness before their cell timeout begins, so startup under load is not mistaken for user-code failure.
- **Runtime compatibility:** JavaScript is available on supported Node runtimes without an optional interpreter. Python, Ruby, and Julia remain separately detected capability surfaces. The supported boundary remains Node `>=24`; the build and release toolchain is Bun 1.4, while the codemode package keeps a Node-compatible boundary and avoids depending on Bun-only APIs. Explicit `OMO_RUNTIME=node` and `OMO_RUNTIME=bun` selection remains supported by the launcher, with re-execution loop guards.
- **Migration and measurement:** This update replaces package files and does not reset settings, credentials, sessions, permissions, or extension enablement. The eval telemetry separates eval-only and non-eval waves, correlates cells to their owning sessions, rejects malformed or duplicate ownership, and reports modeled savings and round trips. No cross-version latency percentage is claimed because the repository contains no committed before/after benchmark.
- **Breaking**: the `/start-work` command and skill are renamed to `/ulw-execute` (hard cutover, no alias). Update scripts, prompts, and CI that reference the old name. The `start_work` config key is deprecated in favor of `ulw_execute`: the old key still loads for one release and emits a deprecation warning, and it will be removed next release; if both keys are set, `ulw_execute` wins. The `omo-senpi-start-work-continuation-disabled` flag is renamed to `omo-senpi-ulw-execute-continuation-disabled` following the component rename to `ulw-execute-continuation`. The telemetry `skill_loaded` known-skill value `start-work` is renamed to `ulw-execute`; update dashboards and queries that filter on the old value.
- **Breaking**: the `omo` command is renamed to `omo-agent-toolkit` on every edition, and the old name is removed in the same release. The `omo` npm bin entry and the Codex `~/.local/bin/omo` runtime wrapper are both gone; `omo-agent-toolkit` replaces them with identical behaviour. This is a major release because a published bin entry is removed. Migration: replace `omo ` with `omo-agent-toolkit ` in scripts, prompts, and CI. Migration is automatic for existing installs — an npm upgrade prunes the old `omo` bin link, and Codex installs delete the generated wrapper at the next session start or installer run (a user-owned `omo` file that the installer did not generate is left untouched). One-time caveat: an agent running at the moment of the Codex relink can see a single failed `omo ulw-loop` call and must re-issue it as `omo-agent-toolkit ulw-loop`. The `omo` name is reserved for the future native edition (npm `omo-ai`), which is not shipped in this release.
- **Breaking**: the OpenCode plugin, Senpi adapter, and Codex codegraph loader no longer read `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` or `~/.omo/config.jsonc` at runtime; the first startup migrates them into `~/.omo/omo.jsonc` (existing values win, skipped values become diagnostics) and moves the sources into the migration backup directory. Older strict config cores reject a newer `omo.jsonc` containing `models` / `profiles` / harness blocks; restore the legacy files from `~/.omo/migration-backup-*` when downgrading.
- **Breaking**: `shared/<name>` skill invocations and `disabled_skills: ["shared/<name>"]` entries no longer resolve. Skills from the shared catalog now register under their bare name (e.g. `ulw-plan`, `frontend`). Update configs and prompts to use bare names. (PR #6180)
- omo-senpi curated agents renamed: `metis` -> `plan-consultant`, `momus` -> `plan-reviewer`; the ulw-plan persona is the Ultrawork Planner; docs and omo.dev describe agents by role. The draft/plan frontmatter key `review.momus` is now `review.plan_reviewer`.
- **Breaking**: telemetry `delegation_started.name` and `delegation_completed.agent_type` now report `plan-consultant`/`plan-reviewer` instead of `metis`/`momus`; dashboards filtering the old values must be updated.

### Deprecated

- `subagent_type: "metis"|"momus"`, `omo.json` `agents.metis|momus` and `allowed_subagents` entries naming them keep working in the first tagged publish containing this change (currently 5.0.0-beta.51 per package.json) with a deprecation notice and are removed in the next tagged publish. Replace them with `plan-consultant` / `plan-reviewer`.

### Post-beta.23 merge follow-ups

The following pull requests merged after the beta.23 release note was authored
and are recorded here so the changelog remains connected to the final `dev`
history:

- LSP formatting now flows through `lsp-core` and the daemon, with typed
  no-op/unavailable results and a default cap of six resident idle clients.
  (PR #7428, merge `f356d17816aad57eb248b42a2f30ec0f1b14fde8`)
- Senpi config-watch re-registration is deferred and coalesced, and duplicate
  extension instances stand down instead of recursively rebuilding watchers.
  (PR #7420, merge `8776e80252cbf91127b1b8c1865a11da10e8bb38`)
- Codex GPT-5.6 context-window contracts are aligned at 650k tokens across
  catalogs, migration fallbacks, post-compact budgeting, and installers.
  (PR #7429, merge `a5bb28c604c9fe57c5c59ac00968fe8514881cf4`)
- Windows DAP drive-letter paths and durable mailbox/receipt persistence are
  portable across the release path, including the merged beta.23 source-state
  release update. (PR #7432, merge `c6b1d190e6c52bc1689ba08b138f64e2e54712fb`;
  PR #7427, merge `b9631886e4ad8922324d3a0977274735b5729be9`)
- Senpi mutation handling now shares path extraction and single-flight state,
  uses daemon-first formatting with bounded fallback, and runs diagnostics
  before comment-checker feedback. (PR #7430, merge
  `5c2f56b997c13d056ad56c196be32b9e8e37a298`)

### Fixed

- omo-senpi ulw-loop: the bundled agent toolkit is spawned with `BUN_BE_BUN=1` when the runtime is the packaged omo binary (omo-desktop, omob). Without it `process.execPath` ran the omo entrypoint instead of the toolkit, `ulw-loop status` exited 1, and every session with a plan read as inactive (no continuation).
- Senpi engine pin `2026.8.28`: repairs the beta.23 shared interactive host regressions — Shift+Tab no longer prints `Thinking level: [object Promise]` and `/settings` thinking options render, user messages no longer render twice, resuming a session held by a live shared host attaches instead of failing with `session_path_in_use`, and the compiled JavaScript/Python eval kernels resolve their runtime assets again.

- Windows DAP script paths with drive letters are no longer misclassified as `host:port` endpoints, and thread mailbox/receipt persistence now tolerates the Windows `fsync` behavior while retaining atomic writes.
- The `omo` launcher no longer orphans the engine when it is signaled. Both spawn layers (`node bin/omo.js` -> engine, and the bun re-exec in between) waited in `spawnSync`, where no JS handler can run, so a `SIGTERM`ed launcher died instantly and left the engine reparented to pid 1 - where it kept running, held the terminal, and eventually accumulated as a zombie session. The launcher now waits asynchronously, forwards `SIGTERM`/`SIGHUP` to the child, gives it a bounded grace window (10s, `OMO_SIGNAL_GRACE_MS`) to run its own graceful shutdown, and re-raises the signal on itself if the child ignores it. `SIGINT` is deliberately not forwarded - the terminal already delivers it to the whole foreground process group - but the launcher still waits instead of dying under the engine. Exit fidelity is unchanged: the child's exit code passes through, and a child killed by a signal still makes the launcher die by that same signal.

<!-- omo-live-backfill-2026-09-11T11:28:45.268Z -->
