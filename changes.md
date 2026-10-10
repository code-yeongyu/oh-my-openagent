## 2026-10-10 - macOS native menu backend for computer use (#9651)

The macOS backend now implements the `Backend` menu hooks over AXUIElement, so `menus.items` and `menus.select` run against a real app's menu bar instead of refusing `AxUnsupported`. `menus.items` resolves the exact AX window root by CGWindowID (refusing `BackgroundUnavailable` when the window id cannot be proven), walks the path from `AXMenuBar` through the shared matcher, and lists each titled `AXMenuItem`/`AXMenuBarItem` child with its native path, enabled, checked (`AXMenuItemMarkChar`), hasSubmenu, and a shortcut rendered from `AXMenuItemCmdChar` plus `AXMenuItemCmdModifiers` (`Ctrl+Alt+Shift+Cmd+K`). `menus.select` walks to the parent menu, matches the leaf, requires `AXPress`, and re-describes the leaf right before pressing because the app can re-validate the command after the key-window change; it makes the window key without raising it via `skylight::activate_without_raise`, verifies the key window is exactly the target (refusing `BackgroundUnavailable` otherwise), checks stop once more, then presses. Every level calls the stop check, every element must belong to the same pid, child lists are capped at 4096, and a second `AXMenu` child or a missing submenu is refused. Ported from oh-my-pi's `ax/menus.rs`; the session's key-focus guard (not this backend) owns restoring the user's keyboard context, so upstream's `with_focus_without_raise`/`with_background_guard` are deliberately not copied. Pure unit tests cover the shortcut rendering and the single-`AXMenu`-child choice headless; an `#[ignore]`d live test drives a small Swift `NSMenu` fixture end to end.

## 2026-10-10 - Cross-platform menu methods for computer use, proven on the fake backend (#9651)

The engine answers `menus.items` and `menus.select`, the cross-platform menu contract, against any backend that implements the two new `Backend` hooks (default: `AxUnsupported`; no native platform code in this PR). `menus.items` (read) lists the immediate children of a window's menu at `path` (empty path = the menu bar): each item carries title, native path, enabled, checked, hasSubmenu and shortcut. `menus.select` (exec) invokes the leaf command `path` names through the shared matcher: a case-insensitive exact title wins over one with a trailing `...` or `…` ignored, each tier must be unique, and an ambiguous label, a disabled item anywhere in the path, a submenu as the leaf, or an untitled separator is refused before anything is dispatched. Selection runs as one background-delivered, gated, audited mutation (new `MutatingAction::MenuSelect`) with the key-focus restore, and every request, an invalid path included, emits exactly one audit event. Backends call a stop/cancel check at every menu level and right before the press, so a stop chord landing mid-walk dispatches nothing. The model facade gains `win.menu.items(path?)` and `win.menu.select(path)` in the JS/Python preludes, declarations, the `WINDOW_METHODS` tier table (items read, select exec, so read-only runs refuse select), and the fake backend serves a scripted per-window menu tree so every rule is exercised headless. Ported from oh-my-pi's `desktop.menus` flow.

## 2026-10-10 - Shared menu-path matching for computer use (#9651)

`senpi-desktop-core` gains `menus`, the platform-independent half of selecting an app command by its menu path. `validate_path` refuses an empty, over-long (more than 32 labels), blank or NUL path before any native access. `match_index` picks the item a label names: a case-insensitive exact title wins over a match with a trailing `...` or `…` ignored, each tier must match exactly one item, and neither menu order nor enabled state breaks a tie. `require_enabled` refuses a disabled item, and backends call it on every submenu they open while walking a path. `require_command` adds the leaf check (no submenu, no untitled separator), and backends call it again right before the native press. A label of just `...` never matches an untitled separator. Nothing calls it yet: the macOS, Windows and Linux menu backends follow in separate PRs. Ported from oh-my-pi `3f000c524c` (`desktop/menus.rs`) with its tests.

## 2026-10-10 - macOS computer use writes ISO-8601 dates to date controls (#9651)

`el.setValue(text)` on a macOS date or time control (an `NSDatePicker`, whose `AXValue` is a `CFDate`) used to write `text` as a `CFString`, which those controls do not take. When the control's current `AXValue` is a `CFDate`, the backend now parses `text` as ISO-8601 and writes a `CFDate` in the system time zone, then reads it back and refuses a mismatch. Accepted forms: `YYYY-MM-DD` (keeps the control's time of day), `YYYY-MM-DDTHH:MM[:SS[.fraction]]` (local wall clock), and a date-time with `Z`, `±HH:MM` or `±HHMM` (that exact instant). The form the accessibility tree prints round-trips. A local time that daylight saving skips or repeats is refused rather than moved or guessed, and the repeated-hour refusal names both offsets. Malformed input is refused with the accepted forms and the control's current value, and nothing is written. Every other element keeps the existing string write. Ported from oh-my-pi `9c7db7e596` and `de1b923bd9`; the parser takes the zone offset as a function, so its tests use a fixed Europe/Berlin rule, and an ignored live test drives a real `NSDatePicker` under `TZ=Europe/Berlin`.

## 2026-10-10 - macOS computer use chooses popup-button options through setValue (#9651)

`el.setValue(text)` on an `AXPopUpButton` used to write `text` as the popup's `AXValue`. AppKit accepts that write and ignores it, so the call reported success while the popup kept its old value. The macOS backend now opens the popup's menu, presses the option whose title equals `text` exactly, and confirms the choice by reading `AXValue` back. When a press shows no options it falls back to `AXShowMenu`. A missing, ambiguous or disabled option is refused with an error that lists the options. A menu the call opened is closed again whenever no choice is made, and the error says so if it will not close. After a confirmed choice the call also waits for AppKit to tear that menu down, cancelling it if it lingers, so the next call or screenshot never sees a dying menu. A menu the user left open is used but never closed. Pull-down popups (`pullsDown`), whose value is a fixed title, are not supported yet: a press on one is reported as not taken. Ported from oh-my-pi `55b3c08f7d` and `850072ad91`; the sequence sits behind a `PopupControl` seam so it is tested without a live accessibility server, and an ignored live test drives a real `NSPopUpButton`.

## 2026-10-10 - unspecified-low runs GPT-6.1 Sol on the OpenAI lanes (#9844)

`unspecified-low` had no GPT-6.1 Sol rung, so an OpenAI-only machine (ChatGPT subscription or OpenAI API) ran `gpt-5.6-terra (high)`. `packages/model-core/src/category-model-requirements.ts` and the Senpi mirror in `packages/senpi-task/src/category/fallback-chains.ts` add `gpt-6.1-sol (medium)` on `openai|chatgpt-subscription` directly before the second GPT rung, the effort every other 6.1 Sol default uses. GPT-5.6 Terra leaves the chain entirely (owner direction, 2026-10-10): the second GPT rung is now `gpt-5.6-sol (medium)` on `openai|chatgpt-subscription|github-copilot|opencode`, the same model the deep-low and ultrabrain lanes already use for Copilot and OpenCode Zen, so those setups keep a valid GPT rung and a registry without 6.1 Sol still resolves the lane. The the model 5.5 head (#9144) is unchanged.ged. No other category had a stale GPT-5.6 lead: `quick` leads with GPT-6 Luna Fast, `deep-low` with GPT-6.1 Sol, `deep-high`/`ultrabrain` with GPT-6 Astra. The four chain-pin tests and the docs rows follow; the Senpi extension bundles are regenerated (`build-extension.mjs --check` current).

## 2026-10-10 - Hide console windows on the Bun spawn path (#9840)

`@oh-my-opencode/utils/runtime` `spawn()` / `spawnSync()` prefer `Bun.spawn` / `Bun.spawnSync` under Bun and passed no `windowsHide` there, while the Node fallback already set it on win32. Both Bun calls now go through `createBunSpawnOptions`, which adds `windowsHide: true` (Bun applies it only on Windows). The utils `windows-console-hide` gate now also audits `Bun.spawn*` and runtime-handle `bun.spawn*` calls. An allowlisted call must pass through the options helper its entry names, and the gate asserts that each helper sets the flag.

## 2026-10-10 - Run hook commands without a console window on Windows (#7144)

`executeHookCommand` now spawns every Claude-compatible hook command with `windowsHide: true`, matching the `taskkill` spawn beside it. A console-less host (an IDE- or GUI-launched `opencode serve`) used to get a fresh console per hook: a conhost flash echoing the hook JSON, or, with Windows Terminal as the default terminal, a full terminal window that took focus on every prompt and tool event. The `sg --version` probe in `ast-grep/sg-resolver.ts` and the `where bash` lookup in `runtime/git-bash.ts` had the same gap and now pass the flag too.

`packages/utils/src/windows-console-hide.test.ts` walks the whole utils source tree like the #8501 gates do and fails on any `node:child_process` spawn, exec, execFile or fork call without `windowsHide: true`, unless an allowlist entry names its reason (the `runtime/spawn.ts` Node fallback, whose options helpers set the flag on win32; the gate asserts that too). The flag is inert on posix.

## 2026-10-10 - lazycodex plugin scripts no longer open console windows on Windows (#9838)

Every `node:child_process` call in `packages/omo-codex/plugin/scripts/` now passes `windowsHide: true`. The worst offender was the background auto-update in `auto-update.mjs`, which ran `cmd.exe /c npm.cmd` detached from a Codex hook and so got its own console window on every update. The `auto-update-plan.mjs` version probe and manual-update runner, and the plugin build scripts, had the same gap. `plugin/test/windows-console-hide.test.mjs` walks every plugin script and fails on any spawn, exec, execFile or fork call without the flag (allowlist with a reason per entry, empty today), and refuses namespace, default or `require` imports of `child_process` that it could not audit.

## 2026-10-09 - Warn on logout unless the server revoked the device (#9833)

A refresh refusal during logout suppresses the unconfirmed-revocation warning only when the service guarantees the device is already revoked: `account_deleted`, and `reauth_required`, which the service returns on refresh only after revoking the device for token reuse. `unauthorized` and `invalid_grant` leave the device's slot held, so logout clears locally, makes no revoke attempt, and points to the account's Devices page.

## 2026-10-09 - Finish logout after refresh refusal or interruption (#9833)

Logout uses the normal journal-before-send refresh path. An explicit terminal refresh refusal means the session is already ended: local credentials are cleared without a revoke request, and the unconfirmed-revocation warning is shown unless the refusal is `account_deleted` or `reauth_required` (see the entry above). Other refresh failures and a previously uncertain record clear the complete local item, exit successfully, and warn that server revocation was not confirmed. An uncertain record is cleared without another network attempt.

A real-child crash regression kills the owned logout process while its journaled refresh response is held, then proves fresh logout clears without replay and fresh whoami reports signed out.

## 2026-10-09 - Recover sign-in safely after TLS and browser-launch failures (#9831 follow-up)

Certificate verification failures and explicitly identified connection/handshake failures now preserve a retryable sign-in, since no HTTP credentials were sent. Generic resets and timeouts remain fenced when the send outcome is unknown. Logout refreshes an expired access token only for a non-uncertain record, persists the rotation before revoking the device, and still clears locally on every exit.

A valid loopback callback is no longer discarded when the browser opener subsequently fails. Chooser labels use a directly tested sanitizer mapping. Regression coverage includes real local self-signed TLS, both terminal-refusal message arms, refresh 429 recovery, C1 terminal controls, and deterministic first/last-byte and length-mismatch callback rejection.

If the OS credential store cannot restore a record after a proven not-sent failure, the durable safety marker remains: the client cannot safely tell another process to replay the token without persisting that knowledge. No disk fallback or process-local bypass was added.

## 2026-10-09 - Preserve offline sign-in and prevent uncertain refresh replay (#9831)

Refresh now journals an in-flight rotation in the OS credential record before sending it. Proven connection failures preserve a retryable sign-in. A timeout, lost response, 5xx, invalid reply, or failed rotated-token save retains credentials and device keys but requires a new sign-in instead of resending the possibly consumed refresh token. Reuse has no grace period and can revoke the device, so a later process also honors the journal. Only explicit terminal refusals clear the stored sign-in.

Loopback state comparisons are constant-time. Device polling follows RFC 8628 without the off-contract 401 continuation, strips terminal controls from displayed server strings, and handles 429 with bounded Retry-After backoff until expiry. Logout attempts access-authenticated device revocation and always clears locally, warning when server revocation could not be confirmed. Error objects no longer serialize management credentials or arbitrary server error codes.

Regression coverage includes actual listener binding, ephemeral ports, callback reuse, HTTPS guards, per-failure refresh outcomes, native CLI error output, terminal injection, and offline logout. The native authentication bundle is regenerated from the same source.

## 2026-10-09 - CLI sign-in with OS credential storage (#9829, #9811)

`omo login` supports browser loopback PKCE and headless device authorization (`--device` or `--no-browser`), production origins by default, and explicit API/accounts overrides. Device sign-in shows the verification URI, user code, and matching code, observes the server's expiry and polling interval, and backs off on `slow_down`. At the device limit, interactive users can choose and confirm one device to revoke before retrying; declining changes nothing.

Tokens and Ed25519/X25519 private keys live only in Bun's OS credential store: Keychain on macOS, Secret Service on Linux, and Credential Manager on Windows. Missing or locked stores fail without a plaintext fallback. Refresh reads, rotation, atomic credential replacement, and logout share a cross-process lock; terminal refresh refusals clear credentials. `omo logout` clears the stored sign-in; `omo whoami` reports the device after refreshing if necessary. Default device names strip format/control/separator characters and Hangul fillers before applying the 64-character limit.

The toolkit CLI, native launcher, and compiled native entry share the commands. Native's checked-in command bundle is regenerated by `bun script/build-service-auth.ts` and guarded by a freshness test.

## 2026-10-09 - Adopt senpi 2026.10.10-11

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-10 to 2026.10.10-11: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. `tool_schema("eval:environments")` documents `packages.install` and `environment_install_timeout` in JavaScript and Python cells, while the default eval description and parameters stay byte-identical. Julia, Ruby and Python cells do less fixed work per cell: no globals walk below the memory thresholds, no awaited cwd stat, and leaner Python queue and capture bookkeeping. The lockfile is refreshed with `bun install --no-cache`, the provider map is checked against the pinned engine's `builtinProviders()`, and the generated plugin bundle is regenerated for it.

## 2026-10-09 - Default lineups use Claude Haiku 5.5, right after Luna

Every default chain that used `claude-haiku-4-5` now uses `claude-haiku-5-5` at `medium`, moved up to sit right after `gpt-6-luna-fast`:
- `quick` (`packages/senpi-task/src/category/fallback-chains.ts`, mirror `packages/model-core/src/category-model-requirements.ts`): Luna (low) -> Haiku 5.5 (medium) -> DeepSeek Flash (off) -> ...; the trailing Haiku 4.5 (off) rung is gone.
- `explore` and `librarian` (`packages/senpi-task/src/agents/builtin/fallback-chains.ts`, mirror `packages/model-core/src/agent-model-requirements.ts`, parity #8259): Kimi HighSpeed (off) -> Luna (low) -> Haiku 5.5 (medium) -> DeepSeek Flash (max) -> ...; the trailing Haiku 4.5 rung is gone.
- The Claude Code `haiku` alias maps to `claude-haiku-5-5`; the OpenCode installer's Claude-only `explore` default is `anthropic/claude-haiku-5-5` (medium); the agent-category migration maps both ids to `quick`; telemetry adds the 5.5 id and keeps 4.5.

Providers are the 4.5 rung's, all of which serve the model in the pinned senpi catalog: `anthropic` and `anthropic-subscription` (`claude-haiku-5-5`), `anthropic-api` (an `anthropic` alias), `github-copilot` (`claude-haiku-5.5`, reached by `transformModelForProvider`). The variant is `medium` because Haiku 5.5 has no `off`, and in our evaluation `low` stopped early. The bundled capability snapshot gains the nine `claude-haiku-5-5` entries these rungs need, picked from a fresh models.dev fetch like the Opus 5.5 entries were; the full refresh is the scheduled workflow's job. `.github/workflows/sisyphus-agent.yml` keeps its `claude-haiku-4-5` entry: it is that workflow's own pinned provider definition for its CI agent, not a routing default.

## 2026-10-09 - Adopt senpi 2026.10.10-10

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-9 to 2026.10.10-10: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine keeps a session on one Anthropic Subscription account across transient errors (senpi#2891), stops re-writing the whole conversation to the prompt cache with resume off (senpi#2982), waits for the reader instead of failing a long streamed tool call (senpi#2822), and serves `gpt-6.1-sol-ultrafast` without a local extension (senpi#2975). The generated plugin bundle is regenerated for it on Linux.

## 2026-10-08 - Config migrations edit omo.jsonc only where a value changes (#9777)

The first engine start against an existing `~/.omo/omo.jsonc` runs the `2026-08-reasoning-unification` migration (replace-target, no `shouldRun`). It reformatted every top-level value: nested line and block comments, trailing commas, inline objects and custom indentation were lost. A `.bak` was written first, so nothing was unrecoverable. There were two causes:
- **Every key was edited:** `prepareTargetReplacement` (`packages/omo-config-core/src/migration/commit.ts`) emitted an edit for every top-level key, changed or not.
- **Edits reformatted their neighbours:** jsonc-parser's `modify` reformats the neighbouring member's line whenever it inserts or removes a member, and it replaces a whole value's text.

The fix:
- **Diffing:** replace-target migrations now diff the transformed document against the target (`migration/diff-edits.ts`) and edit only the deepest paths that changed, plus the `_migrations` marker. A migration that changes nothing adds only the marker.
- **Surgical writes:** the writer (`writer/surgical-edit.ts`) inserts and removes members by hand in the file's own indentation and trailing-comma style. Replacing a value still goes through `modify`, which rewrites only that value. A member that shares its line with another falls back to `modify`.

The same writer serves merge migrations' additions and `omo setup` edits.

Every registered migration was audited: reasoning-unification, category-deep-split, harness-native-rename and subscription-provider-rename (replace-target) and the opencode/config-jsonc merges. They all write through the one writer, so all of them are covered.

## 2026-10-08 - The configuration reference documents the Anthropic 1-hour prompt cache and the cache keep-alive (#9770)

`docs/reference/configuration.md` gains an "Anthropic Prompt Cache Lifetime" section. The engine already supported both settings, but the docs never mentioned them, so users with long gaps between turns paid a full cache rewrite on every turn and asked for a feature that already existed. The section covers:
- **Two switches:** `PI_CACHE_RETENTION=long` for every Anthropic model, and a per-model `providers.<provider>.modelOverrides.<id>.cacheRetention` in `~/.omo/agent/models.json`, which wins over the variable. A `cacheRetention` set directly on a built-in provider is rejected.
- **Where it applies:** the 1-hour lifetime is sent only to the Anthropic API base URL.
- **Cost trade-off:** 1-hour writes cost 2x base input against 1.25x for 5 minutes, and reads cost 0.1x.
- **`promptCache.keepAlive`** in `settings.json`, with its defaults.

The environment variable table lists `PI_CACHE_RETENTION`.

## 2026-10-08 - Install guide lists the community AUR package (#9584)

`docs/guide/install.md` gains an "Arch Linux: community AUR package" section for `omo-bin`, a package maintained by @sTiKyt outside the OmO team. The section says what it installs (our official release binary for its version, checked against that release's `SHA256SUMS`, as `/usr/bin/omo`), and to update it with the AUR helper, because `omo update` and the install command don't recognize a pacman install yet (#9585). It also says the package can trail the `latest` channel.

## 2026-10-08 - The process-model catalog probe reads the whole catalog under load (#9068)

`senpi --list-models` prints its catalog and calls `process.exit(0)` right away. When the host was too loaded to drain the probe's stdout pipe, every row past the pipe buffer was dropped while the child still exited 0, and because the catalog is sorted by provider the tail (`xai`) went first. Admission then rejected `xai/grok-4.7` as `model_not_in_child_profile`, and the confirming re-probe ran under the same load, so it confirmed the false absence. `probeModelCatalog` (`packages/senpi-task/src/runners/rpc/model-catalog-probe.ts`) now gives the child a temp file as stdout instead of a pipe, reads the last 2 MiB of it once the probe settles (the child closed, or the timeout path terminated it) and removes it; stderr stays piped. A read or cleanup failure is reported in the probe's stderr instead of thrown, so admission always gets a result. A file write never waits on the reader, so the catalog is whole however slowly the host is scheduled.

## 2026-10-08 - OpenCode never migrates `.sisyphus` into the home `~/.omo`; `~/.omo/desktop*` is reserved for the OmO desktop app (#9727)

The OmO desktop app is moving its data home (a live SQLite database and worktrees) to `~/.omo/desktop`, with a transient `~/.omo/desktop.init-*` while it prepares (code-yeongyu/omo-desktop-app#1829). The OpenCode plugin's legacy workspace migration (`packages/omo-opencode/src/shared/legacy-workspace-migration.ts`, run on every plugin load) copied missing entries of `<cwd>/.sisyphus` into `<cwd>/.omo`. When OpenCode started in the home folder, that target was the OmO home itself, so a stray `~/.sisyphus/desktop/` could drop files into the desktop app's database folder. The migration now:
- **Refuses the home target:** it does nothing when the directory is the user's home, in any of its spellings: `HOME`/`USERPROFILE` (the config loader's user layer), `os.homedir()`, and the account home. `.sisyphus` was always a per-project workspace, and the only home-level legacy entry, `~/.sisyphus/rules`, is still read in place by the rules engine.
- **Never overwrites:** it decides whether a target exists with `lstat` and copies with `COPYFILE_EXCL`, so an existing file is never overwritten and a dangling symlink at the target is never written through.

The root `AGENTS.md` now reserves `desktop/` and `desktop.init-*` in `~/.omo` for the desktop app. Other operations under `~/.omo` stay scoped as before:
- the isolation sweep removes only `t<hex10>` entries under `~/.omo/wt`;
- team cleanup removes only `~/.omo/runtime/<id>`;
- config migration touches only the omo config files.

The engine's copy-forward into a flat-layout brand dir skips the reserved names in senpi (code-yeongyu/senpi#2898).

## 2026-10-08 - An explicit task model pin is honoured or the spawn fails loudly (#9722)

A task spawn carrying `model: "provider/model:level"` silently ran on the global settings default whenever the default differed from the pin: the planner kept the suffix as part of the model id, the in-process session context dropped the unresolvable id without an error, and senpi substituted the default. The pin is now parsed once with senpi's own model resolver into a canonical `provider/model_id` plus thinking level, resolved against the live registry at plan time, and a pin that does not resolve fails with a typed `model_unavailable` naming the pin and the default route the child would have used. The in-process session context asserts the spec's model instead of filtering it, the RPC process and host runners admit a valid `:level` pin and send the base id plus the level, and after start the child's effective model is checked against the plan (a mismatch fails typed, the session is torn down) and read from the child itself into the record's new `effective_model` - so `task_output` and the `started` result name the model that actually ran.

## 2026-10-07 - Suspended children retry after their parent session resumes (#9498)

A resumed session now retries its own children when revival temporarily cannot
resolve a model or session, acquire a lock, roll back a claim, obtain capacity,
or recover ownership. Previously only unreachable or draining daemon sessions
were retried; other children waited indefinitely for another session start.
The existing bounded backoffs and ownership-fenced admission remain in use.
Repeated unowned model/session/rollback/lock failures end as `lost`, with the
deferral and retry count visible in `task_output` and the normal parent terminal
notification. Capacity and live-owner deferrals stay suspended until the other
side moves; daemon-hosted sessions are never marked lost by this fallback.

## 2026-10-07 - Memory masking covers a token glued by an invisible character that also holds one inside (#9717)

When a format character outside the Basic Multilingual Plane glued an ordinary word to a token, and the token itself held a zero-width or control character, memory masking hid only the token's first part (and an AWS access key id in that shape was not detected at all). The scanner now remembers where it dropped an invisible character and retries the token patterns around each such point (also for a token that ends in a hyphen or is glued to a word after it), so the whole token is detected and masked; the extra pass stays linear on adversarial input. Control characters inside a credential key or vendor prefix are now covered by tests, and a facts warning no longer copies a parse error message that can quote the file.

## 2026-10-07 - The per-session workflow cap counts only active runs (#9712)

`task.dag.max_runs_per_session` (default 16) is a cap on runs that are still active, as the `mass-ulw` guidance describes it. The store used to count every run record of the session, including completed, failed and cancelled runs, until the 7-day retention pruned them, so a long session hit `DAG session run limit reached: 16` with nothing running. The capacity check now skips runs whose status is terminal (`TERMINAL_DAG_RUN_STATUSES` in `senpi-task`'s `dag/types.ts`, shared with the wait surface, retention and retry). Because a finished run no longer holds a slot, reviving one (`retry`, or re-entry after an amend) now passes the same check under the session capacity lock before anything is journaled, so a session cannot exceed the cap through retries and a refused retry leaves every node as it was. The error states how many runs are active and the way out: wait for one to finish, cancel one, or raise `task.dag.max_runs_per_session`. Finished runs stay readable until retention, as before. An amend that the cap refuses at re-entry keeps the saved amendment: amend again with the same definition once a slot frees to run it.
## 2026-10-07 - The parity gate's ast-grep probe waits for the MCP tools to register (#9710)

Since senpi 2026.10.10-6 a first message no longer waits for MCP servers to connect (senpi#2843), so `native-binary-parity`'s tool-search probe counted whatever the bundled ast-grep MCP server had registered by then and failed on timing alone (3 vs 4 tools on macOS, which also stopped the 5.1.23 publish once). `script/qa/omo-native-parity-compare.mjs` now builds the probe as an eval cell that polls `tool_search` until all three ast-grep tools (`mcp__ast_grep_search`, `_rewrite`, `_scan`) are listed, bounded at 45 s, with `on_timeout: "error"` on the step so eval never detaches the cell (an RPC session otherwise detaches a cell after 30 s), and prints one settled line. The search is scoped to `source: "mcp"` so other catalog tools can't crowd the three out of the result cap. A side whose tools never register prints an explicit timeout line, and `compareRuns` reports it as a difference even when both sides agree, so a missing MCP runtime still fails the gate. senpi#2843's behavior is untouched.

## 2026-10-07 - A child that fails to start says why (#9703)

A task child whose first prompt was rejected reported only "Child prompt failed to start." in the task record, the event log and the tool result, so a host timeout, a host refusal, a lost connection and a child that crashed before taking its prompt all looked the same. The start failure now names the cause in one sanitized line: the request that got no answer in time (`request_timeout`), the host's refusal with its error code when the code is a plain identifier (`host_refused`), a lost connection (`transport_lost`), or the child's exit (kind plus code or signal). The event log also carries `cause_class`, `timed_out_command` and `cause_code`. Raw error text, which can carry a stderr tail, still never reaches a record, an event or the tool result, and an unrecognized cause keeps the previous message.

## 2026-10-07 - Memory secret scanning handles format characters outside the BMP; doctor and receipts say when they fall back (#9653, #9689 follow-ups)

The memory secret scanner strips Unicode format characters before matching, but it walked text one UTF-16 code unit at a time, so a format character outside the Basic Multilingual Plane survived the strip and could split a secret-like value past the commit gate and the injection-time masking. The scanner now walks by code point and maps matches back to the exact original span, and it also scans a copy where format characters become a separator, so a format character gluing a word character to a secret no longer hides the secret's word boundary (this also closes the older zero-width-space variant of that gap); a match from that second scan is kept unless the first scan already covers all of it, so a token joined to a following credential by such a character masks both (the split-key pass follows the same rule, so a glued credential whose value holds such a character is masked whole), and control characters gluing a word to a secret are handled the same way. `/doctor` reports when commit times cannot be read and the memory file list falls back to name order, facts receipts that cannot be written because a run's ledger is missing now log a warning instead of skipping silently, and `invalid_generation_timestamps` is removed from the quarantine reasons because nothing writes it. New tests cover the out-of-BMP split, a `/doctor --json` value with a quote next to a credential, the preserved reservation evidence of a quarantine, and a facts run whose ledger is gone.

## 2026-10-09 - Adopt senpi 2026.10.10-9

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-8 to 2026.10.10-9: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the cap on engine-originated turns (senpi#2967), the required ask-user question gate (senpi#2949), the merged `anthropic-beta` header (senpi#2957) and a refreshed model catalog. The generated plugin bundle is regenerated for it on Linux.

## 2026-10-08 - Adopt senpi 2026.10.10-8

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-6 to 2026.10.10-8 (-7 was cancelled before publishing): the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the MCP SDK 1.32.1 issuer binding for saved sign-ins (senpi#2940), the Anthropic subscription auth-block recovery (senpi#2926), required compaction on small windows (senpi#2925), the config-reload loop fix (senpi#2878), print-then-exit output on slow pipes (senpi#2937), `ask_user_question` answers outside the tool result (senpi#2920) and the official Kimi K3 cache-write price. The generated plugin bundle is regenerated for it on Linux.

## 2026-10-07 - Adopt senpi 2026.10.10-6

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-5 to 2026.10.10-6: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the child-spawn fix for "Provider scope is closed" on a busy shared host (senpi#2871), senpi-owned compaction on the subscription lane (senpi#2749), the Anthropic tool-change fix, the cache-first MCP admission and the restored-binding check. The generated plugin bundles are regenerated for it on Linux.

## 2026-10-07 - Memory maintenance runs write receipts, unrecoverable runs are quarantined, and recovery is kill-tested (#9689)

Reflection, dream and facts runs now leave an append-only record of what they did:
`receipts.jsonl` in the identity's runtime directory, one JSON line per event (`launched`,
`recovered`, `merged`, `no_changes`, `failed`, `abandoned`, `quarantined`, and for facts
`committed`, `no_facts`, `failed`, `parked`). A receipt is written after the run's own
terminal file, and the next startup rebuilds a lost one from that file, so each outcome is
recorded exactly once. Startup reconciliation no longer throws on invalid timestamps or keeps a
reservation forever behind an unreadable ledger. Under a launcher proven dead, such a run is
quarantined: its files stay, `quarantined.json` names the reason, and the reservation is
released so later runs proceed. A supervisor that dies after its child committed a valid result
no longer loses it: startup validates and merges the tip. A launch interrupted before its run
started is recorded as `abandoned` instead of being deleted. `/doctor` shows the newest
receipt per kind and lists quarantined runs. A crash test kills a real process at each of seven
points and checks that recovery settles every run once with its evidence intact.

## 2026-10-07 - Adopt senpi 2026.10.10-5

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-4 to 2026.10.10-5: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the attach permission-preset fix (senpi#2823), the streaming scroll fix (senpi#2836), the codemode stop/require/name-shadowing and live-row fixes, and the `show_html_page` tool. The generated plugin bundles are regenerated for it on Linux.

## 2026-10-07 - The memory file list in the prompt is bounded by recency, count and bytes (#9687)

`<external_projection>`, the list of memory files outside `system/` at the end of the compiled
memory block, had no limit. A long-lived corpus measured 157,834 bytes (about 39K tokens) on
every turn. Each directory now lists its most recently committed files first, up to
`memory.projection.max_entries_per_directory` (default 40). The whole list fits
`memory.projection.max_bytes` (default 24576), with the largest directory giving up names first.
Omitted names are counted with a pointer to read the directory. `0` disables a limit, and both
at `0` reproduce the previous list byte for byte. `/doctor` reports names shown and omitted, the
byte size, and the overflow when no listing fits the budget. Commit times per path are read incrementally and
stored in the memory repo's git dir. After the first full read (about 9 s on a 12k-commit
history), a new commit costs one short `git log` of the new range.

## 2026-10-06 - /doctor audits corpus structure and dream repairs it (#9652)

Memory doctor now reports dangling links, invalid frontmatter, duplicate bodies,
orphaned paths, unreadable files, and system pressure. `/doctor --json` provides
the checks, audit findings and counts, and skill repair totals, with secret-like
string values masked before serialization. Unknown flags, including `--fix`,
are refused. Dream receives a redacted audit of its own worktree and a structural
repair phase; reflection does not. The repair pipeline preserves user boundaries
and evidence, validates the child's committed edits, and merges them normally.

## 2026-10-06 - Adopt senpi 2026.10.10-4

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-3 to 2026.10.10-4: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. `test/provider-map-registry.test.ts` passes against the 10-4 engine, so the provider registry lists are unchanged. The engine carries the terminal session controls and delivery sender labels that omo #9662 and #9664 build on, the concurrent-rebind fix (senpi#2828), the stale extension shim repair and the TUI stdout guard. The generated plugin bundles are regenerated for it on Linux.

## 2026-10-06 - Memory refuses secret-like commits and masks injected memory text (#9653)

Memory used to commit whatever it was given and inject it back verbatim, so a token pasted into a conversation could end up in the memory repository and in every later session's prompt. One evasion-resistant scanner now guards both directions. It covers AWS keys, credential assignments, bearer headers, OpenAI-style keys, vendor tokens, PEM blocks and whitespace-split credential keys, and it matches after stripping zero-width characters. Every commit path refuses secret-like file names or content and leaves the repository unchanged: the memory tools, facts extraction, and reflection and dream runs, whose full branch history is checked before merging. A refused facts run parks after one failure, and a refused reflection or dream run counts as non-retryable. The pre-commit hook applies the same classes to hand commits. The compiled memory block, rendered paths, recall hints and memory command output mask any match as `***`, including content committed before this change. Errors name the file and the class, never the secret.

## 2026-10-06 - The release binary ships the browser skill's omowright runtime (#9661)

Since the browser guidance was routed through omowright (#8729, 5.1.11), the published release binary installed the browser skill without its bundled `runtime/omowright`, so `loadOmowright()` and `browser-doctor.mjs` always failed for binary installs while the npm `omo-ai` install worked. The native staging chain (`script/build-omo-native.ts`) runs `build:senpi-plugin:native` with `OMO_SKIP_MATERIALIZE=1`, which skips `stage-omowright-runtime.mjs`, and nothing else staged the gitignored runtime before the plugin payload was copied. The runtime is now a prebuilt native input staged via `build:materialize-frontend` when missing, and `skills/browser/runtime/omowright/index.js` is a required plugin artifact, so a payload without it fails the build instead of shipping. `script/build-omo-native.test.ts` covers both the staging trigger and the required-artifact gate.

## 2026-10-06 - Adopt senpi 2026.10.10-3

Every `@code-yeongyu/senpi` pin moves from 2026.10.10-2 to 2026.10.10-3: the root devDependency, `omo-native` and its provider map comment, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the retry-watchdog fix (senpi#2804) that the 5.1.21 hotfix ships, plus codemode's opt-in process-isolated JavaScript kernel. The generated plugin bundles are regenerated for it on Linux.

## 2026-10-06 - The frontend skill routes tone and situation to more component catalogs, with licence gates (#9644)

The frontend skill could only source motion from beui.dev and react-bits. A brief whose tone or surface fell outside them (AI-agent UI, charts, landing sections, brutalist or Tailwind-only builds) left the agent writing motion from memory, and nothing told it which other catalogs it may read or copy from. The new project-original `references/design/component-catalogs.md` maps tone and situation to the catalog to read first, lists a seven-step exploration procedure built on each catalog's published `llms.txt` and shadcn registry, records each catalog's licence, terms and robots.txt stance (measured 2026-10-06), and covers charts. Agents fetch only published agent surfaces, never paste source, take free items only, and never fetch styles.refero.design, skiper-ui.com or originkit.dev. It is routed from `SKILL.md` and from both anchors' "no matching pattern" step; component Motion lines in `DESIGN.md` now name a borrowed mechanism's source. `_INDEX.md` now credits Layer B to nexu-io/open-design, which is where the manifest materializes it from.

## 2026-10-05 - Detect stale stylesheet references across web deployments (#9617)

The web deployment-coherence probe retains the stylesheet references from build A's HTML, checks both unchanged-build controls, and requests the retained paths against build B. It covers English and Korean with synthetic mobile Safari and WKWebView user agents and rejects missing CSS, HTML masquerading as CSS, or a broken control. Same-origin absolute references are rebased to B so the check cannot silently fetch the old stylesheet from A and report success. Five HTTP/CLI behavior tests cover these paths.

The static-asset carry-forward engine preserves the current live resource graph on first migration and the entire generated static set on subsequent deployments. It checks downloaded bytes and CSS MIME, preserves inherited deadlines, and retires resources only after the prior HTML lifetime plus deployment overlap. The deployment CLI reads the compiled Next budget, refuses an under-budget document, and blocks on missing advertised, malformed or unreadable history. Next's ISR expiry is bounded to one hour, deployments use their commit identifier, hashed static resources are immutable, and the inventory is not cached.

The Worker deployment workflow now carries the inventory before uploading and uses one cross-branch concurrency group with cancellation disabled and a 30-minute deployment bound. The production CLI's current-only bootstrap passes the actual four-case retained-document A/B probe. Already-gone generations cannot be reconstructed; pre-existing older cached HTML may still lose those resources for its original lifetime, which the new expiry does not shorten retroactively. The deploy owner must adopt/coordinate the lock on older master workflows that do not yet contain it.

## 2026-10-05 - LazyCodex activates the version it just installed (#9631)

The installer left previous plugin versions beside a new cache entry. Codex gives `local` priority over versioned entries, so an old local plugin could keep displaying old hook names while the installer recorded trust for the new payload. Installing now removes obsolete version directories only after the replacement payload validates and is promoted. Other plugins, plugin data, symlinks, and hidden staging directories stay in place; a failed preparation leaves the previous cache intact. Actual Codex app-server checks cover restart and reinstall stability and confirm that genuinely changed hooks still require review.

## 2026-10-05 - Adopt senpi 2026.10.10

Every `@code-yeongyu/senpi` pin moves from 2026.10.9 to 2026.10.10: the root devDependency, `omo-native` and its provider map, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine adds code mode's `%bun add` / `%npm add` and opt-in isolated cells and the fixes listed in its release; omo's codemode prompt surface is unchanged (the default eval description renders from the same senpi source in both versions, and omo sets neither `prompt.advertiseHelpers` nor `sandbox.enabled`). The generated plugin bundles are regenerated for it on Linux.

## 2026-10-05 - The reply-listener success test no longer races a 500 ms budget on a slow runner (#9607)

`reply-listener-startup.test.ts` ran its success-path test under the production 500 ms startup budget. When a starved Windows runner delayed the fake child's ready write past that deadline, the test failed with `result.success` false. The success path returns as soon as the child reports ready, so the test now sets a 30 s budget. The never-ready test keeps the short budget.

## 2026-10-05 - The manifesto keeps the top three quarters of the screen fully lit (#9591)

On omo.dev's manifesto the reveal fully lit text only down to about two thirds of the viewport (median ~0.66, as low as ~0.61, measured at word tops at 390 / 1440 / 1920 in en and ko), against the 75-80% the reading design asked for (#9537). A word is fully lit once its bottom, plus its in-line stagger, is above `--lit-line - --lit-band`. That line was 78vh - 8vh = 70vh, so the tops of the last fully lit words sat near 66%. `--lit-line` moves to 91vh (`packages/web/app/styles/design-system.css`), putting the full line at 83vh. Measured the same way after the change, the depth is 0.805-0.819 at the median and 0.760-0.772 at worst in every one of those configurations, identical on the scroll-timeline and the fallback path. The reveal order, the reduced-motion path and the lit-at-the-bottom guarantee are unchanged.

The readable-screenful e2e test pinned the old 70% from the CSS, so it could not catch this. It now measures the depth from word geometry on every scroll step (the top of the first visible word that is not fully lit), requires at least 0.72 on every frame and at least 0.75 at the median, and moves into its own file, `packages/web/e2e/manifesto-lit-depth.spec.ts`, with the shared page helpers in `e2e/manifesto-page.ts`.

## 2026-10-04 - Adopt senpi 2026.10.9

Every `@code-yeongyu/senpi` pin moves from 2026.10.8 to 2026.10.9: the root devDependency, `omo-native` and its provider map, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine names the tool call a permission prompt approves (senpi#2710), stops requiring a status block on a reply that only answers and drops quote-line reply templates (senpi#2723, senpi#2714), and carries 2026.10.9's code mode work; the generated plugin bundles are regenerated for it on Linux.

## 2026-10-04 - Test runs keep the engine's agent dir in their temp home (#9578)

`test-setup.ts` pointed `HOME` at a per-process temp dir but DELETED the agent-dir variables (`OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR`, `PI_CODING_AGENT_DIR`). The engine resolves its agent dir from those variables first and from `os.homedir()` otherwise. `os.homedir()` keeps the real home it read at process start, so any test that booted the packaged extension wrote into the developer's (or CI host's) real agent dir. `bun test ./packages/omo-senpi/` left a real task host running there, with its shard meta and daemon dir.

The new `test-hermetic-home.ts` is the one place that sets the hermetic home. Every reader takes the first set name in `OMO_` > `SENPI_` > `PI_` order. It drops the inherited `OMO_` and `SENPI_` values and pins only `PI_CODING_AGENT_DIR`, the lowest-precedence name, to `<temp home>/.omo/agent`. So the engine resolves the temp dir by default, and a test that sets `OMO_` or `SENPI_CODING_AGENT_DIR` for itself or a child still wins as before. A first revision pinned all three, and `omo-native`'s doctor tests, which hand their child only `SENPI_CODING_AGENT_DIR`, then read the temp dir instead of their fixture. When the run ends it stops any process whose command line names this process's own temp home, and it fails the run if this test process registered a host shard under a real agent dir (identified by the shard meta's `created_by_pid`, so a live session's shards are never counted). The root preload and the package-local preloads use it.

## 2026-10-04 - Adopt senpi 2026.10.8

Every `@code-yeongyu/senpi` pin moves from 2026.10.7 to 2026.10.8: the root devDependency, `omo-native` and its provider map, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine makes an idle host exit once its sessions are done (senpi#2713) and stops failing a busy cold Python start as a hang (senpi#2718, the cause of omo#9495's Windows flake); the generated plugin bundles are regenerated for it on Linux.

## 2026-10-04 - Format examples in OmO prompts are no longer markdown quote lines (#9538)

Several prompts OmO ships showed a reply format as a markdown quote line: the Hephaestus routing line and handoff template in the Codex bundled rules (`packages/omo-codex/plugin/components/rules/bundled-rules/hephaestus/gpt-6.md`, `gpt-5.6.md`), the handoff template in the OpenCode Hephaestus GPT-5.6 and Sisyphus Grok 4 prompts, and the `"I detect [...] intent - [reason]. My approach: [...]"` line in the Sisyphus default, Claude Opus 4.7 / 4.8 / 5 and Fable 5 prompts and `sisyphus-dynamic-prompt-role.ts`. The model copies a format example as the shape of its reply, `>` included, so whole answers rendered as blockquotes that read like a paused aside. The same defect in the senpi engine is code-yeongyu/senpi#2714. Each line loses its leading `> `; labels and wording are unchanged. Emphasis blockquotes that are not reply formats stay.

`sisyphus-agent-factory.test.ts` (every routed Sisyphus family), `delegation-table-contract.test.ts` (Hephaestus GPT-5.6) and the Codex rules `hephaestus-model-variant.test.ts` (every shipped bundled rule) fail when a line with `[placeholder]` slots is a quote line; all three fail on `dev`.

## 2026-10-04 - Adopt senpi 2026.10.7

Every `@code-yeongyu/senpi` pin moves from 2026.10.6 to 2026.10.7: the root devDependency, `omo-native` and its provider map, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine lets `host handoff` replace an old host still serving the client's own socket with no session open (senpi#2701) and carries 2026.10.7's code mode work; the generated plugin bundles are regenerated for it on Linux.

## 2026-10-04 - visual-qa carries an Apple HIG checklist, a light/dark phone+desktop capture matrix and a per-item verdict (#9533)

The `visual-qa` shared skill judged a surface only against its reference image, the request text and CJK line breaking, so a screen with no reference - the normal case for our own product UI - passed with a card pinned to the top-left of an empty canvas, a reserved-scrollbar gutter at phone width, a see-through sticky header, a cramped tab bar with the wrong active tab, raw ISO timestamps and engine strings on screen, dark-only captures, a capture browser's chrome inside a screenshot, and a fix proven on one app while a sibling kept the defect.

`packages/shared-skills/skills/visual-qa/SKILL.md` now carries a 67-item checklist distilled from Apple's Human Interface Guidelines (Korean edition: layout, typography, color, dark mode, accessibility, motion, icons, branding, writing, and the component pages for buttons, tab bars, toolbars, sheets, alerts, menus, text fields, progress, onboarding, feedback, loading, privacy, accounts, modality, scroll views, sidebars, windows, lists, toggles, focus, search, settings) and from the `frontend` skill's visually checkable rules, organised by surface concern (A layout, B hierarchy, C text, D targets, E contrast and themes, F consistency and brand, G motion and feedback, H states, I keyboard and accessibility, J macOS desktop and iOS-width web). Every item is PASS, FAIL or N/A with the capture that proves it. The author runs it before dispatch; Pass A re-runs G-J and Pass B re-runs A-F, pasted verbatim into their prompts; Pass A's "code style", "responsive" and "slop animation" items and Pass B's generic "matches the request" item are folded into the checklist. The capture protocol becomes a matrix: every changed page plus every sibling route or app sharing the changed layout or component; 390 with true mobile emulation (`emulate(page, "iphone-14")`: DPR 3, mobile, touch, overlay scrollbars) and 1440, plus 1920 for page layouts; light and dark paired; a scrolled-to-end viewport shot; motion frames plus a reduced-motion pass and an interruption pass; a frame showing browser chrome or the capture tool's UI is rejected as a window grab. The Step 4 report gains a per-item table and any FAIL makes the verdict NEEDS WORK. `references/browser-setup.md` shows the matrix loop with the colour-scheme and reduced-motion emulation for the owned engine and the phone emulation for the attached engine.

The `frontend` skill now points at `visual-qa` for verification instead of keeping its own list: `SKILL.md`'s done axiom and `references/design/README.md`'s Phase Final drop the 375 / 768 / 1280 breakpoints and the two verification rules the checklist now owns (slop animation, accent-border state), keeping only the flatness judgment the verifier cannot make; `clone-from-url.md`, `layout-skill.md`, `design-system-architecture.md` and `aside.md` use the same capture widths. The two mirror copies follow their sources: the `skills-loader-core` builtin wrapper's `visual-qa` description and its checked-in `frontend/SKILL.md` artifact (the extraction test requires byte equality), and the omo.dev landing ticker's `visual-qa` blurb no longer names the retired widths. Prose and copy only; no test pins wording.

## 2026-10-04 - Adopt senpi 2026.10.6

Every `@code-yeongyu/senpi` pin moves from 2026.10.5 to 2026.10.6: the root devDependency, `omo-native` and its provider map, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine adds the `auto` permission preset (senpi#2614, senpi#2688) and carries 2026.10.6's fixes; the generated plugin bundles are regenerated for it on Linux.

## 2026-10-03 - Adopt senpi 2026.10.5

Every `@code-yeongyu/senpi` pin moves from 2026.10.3 to 2026.10.5: the root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests, the engine named in `senpi-task`'s coverage test and `omo-native`'s provider map. The engine makes a failed permission setup refuse tool calls instead of running them unchecked (senpi#2617, senpi#2618) and carries 2026.10.4's and 2026.10.5's fixes; the generated plugin bundles are regenerated for it on Linux.

## 2026-10-03 - LazyCodex no longer blocks an edit because a language server is not installed (#9509)

On LazyCodex, editing a file whose language server is missing (a `.json` with no biome, say) made the LSP `PostToolUse` hook answer `decision: "block"` with the install guidance, on every edit and even after the user declined the install. `postEditOutcomeFromDaemonResult` in `packages/omo-codex/plugin/components/lsp/src/codex-hook.ts` mapped only the daemon's `not_configured` availability, so a `not_installed` result fell through as plain text, was classified as a diagnostic, and skipped the install-decision handling. The Native edition already mapped it (`packages/omo-senpi/src/components/lsp/post-edit-outcome.ts`); the Codex hook now maps it the same way.

`collectPostEditDiagnostics` (`packages/lsp-core/src/post-edit/orchestration.ts`) marks each entry with `blocking`: real diagnostics are `true`, missing-server guidance is `false`. The Codex hook blocks only when at least one entry is blocking; guidance alone is sent as `hookSpecificOutput.additionalContext` with no `decision`, so the model still reads it but the edit is not blocked. The guidance wording and how often it appears are unchanged, and real diagnostics still block. The Native edition reads the same entries and its output is unchanged.

`codex-hook-not-installed.test.ts` drives the hook through the real daemon-result mapping with only the daemon RPC stubbed: an undecided server, a declined server and a repeated edit no longer block (all three fail on `dev`), and a real type error still blocks, alone or next to a missing server in the same patch. The committed `omo.js` bundle is rebuilt in the Linux container.

## 2026-10-03 - Memory writes survive a Windows rename that a passing file hold refuses (#9471)

On Windows, renaming a temporary file over a target that another handle holds open (a reader, the search indexer, an antivirus scan) fails with EPERM, EBUSY or EACCES, usually for a few milliseconds. The memory stack writes state atomically through that rename, so such a hold lost the write: `memory-core`'s transcript journal logged `memory bind-time reconcile failed` / `memory shutdown drain step failed` and left `state.json.tmp-<id>` behind. In the Windows task e2e, that diagnostic also landed in a killed child's stderr, so the kill classifier correctly read the exit as a crash and recorded `killed=false` (#9471, after #9228/#9387).

`packages/memory-core/src/fs/rename-contention.ts` retries those three codes on win32 only, with a bounded backoff of about 0.8 s in total, and `fs/resilient.ts` routes the memory boundary's `rename` through it. Every atomic memory write gets the retry. POSIX keeps failing at once, because EPERM/EACCES there are real permission errors. `journal/store.ts` now removes the temporary state file when the rename finally fails, and takes an optional `renameFile` so a test can simulate a refused rename. The kill classifier is unchanged.

`fs/rename-contention.test.ts` drives the retry with an injected rename and clock: two refusals then success; a refusal that never clears gives up after the budget; POSIX EPERM fails at once; ENOENT is not retried. `journal/store.test.ts` shows that a refused state rename rejects and leaves no temporary file; it fails on `dev`.

## 2026-10-03 - Task kills are recorded from the runner, not guessed from stderr (#9471)

A killed process-mode task child on Windows could be reported as a crash when its teardown wrote memory diagnostics to stderr. The runner now records the kills it issues itself and never infers a kill from stderr. A Windows child terminated from outside the runner is reported as an unexpected exit (`killed=false`, exit code and stderr kept), because Windows gives no signal that separates it from a crash. Details: `packages/senpi-task/changes.md`.

## 2026-10-03 - The browser skill obeys the session's browser engine and asks before irreversible actions (#9486)

The OmO desktop app lets the user choose which browser an agent drives and passes the choice to the session as `OMO_BROWSER_ENGINE` (senpi#2611). `packages/shared-skills/skills/browser/scripts/omowright.mjs` now returns omowright through `guardOmowright()` (`browser-engine-guard.mjs`) whenever that variable is set; unset (terminal use) returns the library untouched.

- `connected`: only `connectBrowserSkill()`; a missing browser, daemon or extension becomes `BrowserNotConnectedError` ("Connect your browser") and nothing else is launched. `builtin` refuses `connectBrowserSkill()` (use the app's in-app browser tools), `none` refuses browser work, an unknown value is refused rather than read as unset. The owned-engine entry points (`connectPipe`, `connectCloakProfile`) are not touched.
- State: the wrapper reports `omo.browser.state` (engine, status, tab id/url/title/favicon, action kind, failure reason) when a session starts, around each action, after each navigation or tab change, when it stops and when a connect fails, through the new eval-only `omo_browser_bridge` tool (`packages/omo-senpi/src/components/browser-bridge`) that republishes it as a session `extension_event`. A host or bridge that cannot take events never blocks an action.
- Policy: `BROWSER_CONFIRMATION_POLICY = "ask-before-irreversible"`. Before a click, Enter or script that sends/posts/publishes, pays/purchases/orders/subscribes, or deletes/removes/cancels a subscription/closes an account, the user is asked through the engine's question tool (`ask_user_question` or `request_user_input`); only an exact "Allow" proceeds, anything else raises `BrowserActionDeclinedError`, and a session with no question tool fails closed. The control is read from the page first (markup for a daemon ref, an element probe for a selector); a control that cannot be read is asked about. `evaluate` that clicks, submits or posts and the daemon's raw `session.tool("click"|"press"|"evaluate"|"fill"|"select")` are covered; `bskSnapshot` reads through the raw session.
- Closed ways around it (review round 1): the guard returns an allowlisted library, so the owned engine (`connect`, `connectPipe`, `connectCloakProfile`) is refused with `browser_engine_owned_blocked` naming the engine, and any export that can act on a browser and is not on the allowlist is refused with `browser_engine_export_blocked` (setup, doctor, error classes, pure helpers and data pass through). Enter (not Shift+Enter) in a `textarea`, `contenteditable` or `role=textbox` element outside a GET form asks, since it sends in most chat apps. `session.tool()` passes only the read tools (`observe`, `snapshot`, `get_html`, `screenshot`, `tab_list`, `console`, `network`). `sendBeacon` counts as a write, and the label list gains submit, confirm, checkout, transfer, approve, merge, sign-a-document and their Korean forms. This prevents mistakes by a cooperating agent; it is not a boundary against code that imports the raw entry. Side effect: while the variable is set, the visual-qa, debugging and frontend skills cannot launch their own owned browser through this loader.
- Stop: a daemon `user_aborted`, or the app's `omo.browser.stop` request, makes the next call throw `BrowserUserStoppedError` and blocks new sessions until the user's next message.
- `SKILL.md` gains Step 0 (engine selection), `references/install.md` notes that inside the app the app installs and starts the daemon, and `references/commands.md` lists the typed errors. `BSK_HOME` / `BSK_BIN` handling is unchanged.

`browser-skill-engine.test.ts` drives the guard against a fake BrowserSkill session and a fake kernel host (60 cases), and `browser-bridge/index.test.ts` covers the bridge tool. The committed `omo.js` bundle is rebuilt in the Linux container.

## 2026-10-03 - The task tool stops describing few-read investigations and small foreground children as delegation targets (#9499)

GPT-6 Astra followed the task tool's wording literally and handed few-call reading, credential lookups and the checks on its own change to subagents on executable lanes, then waited for them: in a 10-day survey of local sessions 86% of its spawns went to executable categories against 30-50% for the Claude and Kimi presets on the same text, nine were read-only investigations, and two were browser-use credential lookups. The sentences that named those as delegation targets are replaced at their source, in both editions where a twin exists. `packages/senpi-task/src/tools/task/description.ts` drops "pass false only for a short child whose result gates your very next call" from the run_in_background guideline (the flag stays documented in the tool description). The deep-low caller guidance in `packages/senpi-task/src/category/openai-categories.ts` and `packages/omo-opencode/src/tools/delegate-task/openai-categories.ts` no longer describes a one-subsystem-plus-callers investigation as the lane's home and its description names the lane as "preferred over deep-high for" the listed work instead of the bold "is routed here". The ultrawork skill's routing item 4 (`packages/omo-senpi/skills/ultrawork/SKILL.md`, embedded into `generated-directive.ts`) sends only work "across more files than one wave can read" to parallel explore agents. The Codex Hephaestus GPT-6 rule (`packages/omo-codex/plugin/components/rules/bundled-rules/hephaestus/gpt-6.md`) carries the same delegation paragraph as the senpi GPT-6 preset after senpi#2630: reading, lookups and own-change checks stay in the session however many calls they take; a subagent is for a track that runs beside the session's own and lands the task sooner. The rendered task tool description and the ultrawork directive both shrink; the omo-senpi plugin bundles are regenerated on Linux.

## 2026-10-03 - Adopt senpi 2026.10.3

Every `@code-yeongyu/senpi` pin moves from 2026.10.2 to 2026.10.3: the root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine fixes MCP tools failing with `MCP server <name> is disabled` once a child session ends (#9461, senpi#2524 and senpi#2608); the generated plugin bundles are regenerated for it on Linux.

## 2026-10-03 - LazyCodex spawns a project's own registered agent roles (lazycodex#171, lazycodex#164)

Reported by @aconley-vultr. On the LazyCodex surface, `spawnRoleDenial()` (`packages/omo-codex/plugin/components/ulw-loop/src/spawn-role-guard.ts`) accepted only the 12 bundled role names, and `applySpawnGuards()` ran it on every spawn before the plan and budget checks. A project's own roles in `.codex/agents/*.toml`, which Codex offers as valid `agent_type` choices, were denied even with no LazyCodex plan active.

The guard now also accepts an `agent_type` that Codex has a role file for, read the way Codex reads them (`ulw-loop/src/registered-agent-roles.ts`): a standalone `agents/*.toml` keyed by its `name` (else the file name), or an `[agents.<name>]` table in `config.toml`, under `CODEX_HOME` and under the `.codex/` of the working directory and its ancestors. A missing `agent_type`, or a name with no role file, is still denied, so a LazyCodex workflow never falls back to a generic agent (#134). The denial lists the registered roles as well as the bundled ones. Bundled roles are matched before any disk read, and the plan and budget guards are unchanged.

The bundled Hephaestus rule's `multi_agent_v2` `spawn_agent` example (`components/rules/bundled-rules/hephaestus/{gpt-5.5,gpt-5.6,gpt-6}.md`) now passes `"agent_type":"<role>"`, so a session copying it is no longer denied (lazycodex#164). The v1 examples already did. Codex exposes `agent_type` on the v2 `spawn_agent` whenever agent roles are configured, so `plugin/test/aggregate-plugin-fixture.mjs` stops treating the object-form v2 `agent_type` as unsupported (the direct keyword form still is); that rule predated the guard requiring the role.

`ulw-loop/test/spawn-role-registered.test.ts` covers project roles from a nested cwd, keying by declared name, a role file without a name field, `CODEX_HOME` roles in both forms, and the denials (no role file, no `agent_type`, a role registered only in another project). Five of its eight cases fail on `dev`. `spawn-role-matrix.test.ts` now isolates `CODEX_HOME`.

## 2026-10-03 - OpenCode executes tool-argument rewrites on the original object (#9448)

`replaceToolArgs` replaced `output.args` with a shallow clone, but OpenCode executes tools with the argument object it retained before calling `tool.execute.before`. The patch never reached that object, and later plugins edited a detached copy. The helper now merges patches into mutable arguments in place, so both OmO's rewrites and later hooks' edits reach tool execution. All 12 OpenCode call sites are unchanged.

Frozen arguments retain the existing clone behavior to avoid throwing on older hosts. Executing that replacement still requires the host to read `output.args` back; this change does not claim to fix frozen host-held arguments. The helper tests reproduce both mutable-reference failures on the development code and preserve the frozen-object cases.
## 2026-10-02 - The skill tool lists skills and commands in a stable order (#9432)

Reported by @kimchupa-l10n, with relay captures that pinned the cause. `sortByScopePriority` in `packages/skills-loader-core/src/tools/skill/scope-priority.ts` compared scope priority only, so items in the same scope kept their discovery order, and that order varies between processes. The OpenCode edition's skill tool description (`packages/omo-opencode/src/tools/skill/description-formatter.ts`) is built from that sort, so the tool definition changed from one session to the next and every new session and subagent missed the Anthropic prompt cache.

The sort is now total: scope priority first, then name, compared by UTF-16 code units so the order cannot depend on the machine's locale. Scope precedence is unchanged, and `matchCommandByName` still resolves by exact name with the higher-priority scope winning a shared name. OmO Native does not use this sort: `omo-senpi`, `senpi-task` and `omo-native` never import `skills-loader-core`, Native's tool descriptions are static, and the bundled skills Native contributes are already listed in sorted order (`packages/omo-senpi/src/components/bundled-skills/index.ts:40`).

`description-formatter.order.test.ts` renders the same skills and commands discovered in different orders and requires byte-identical descriptions; both cases fail on `dev` and pass with this change. `skill-matcher.test.ts` covers exact-name command resolution and scope precedence under both discovery orders.

## 2026-10-02 - Adopt senpi 2026.10.2

Every `@code-yeongyu/senpi` pin moves from 2026.10.1-3 to 2026.10.2: the root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. This is the first senpi release carrying the upstream pi v1.0.0 engine sync; the generated plugin bundles are regenerated for it on Linux. No omo source needed changes: the engine's builtin provider registry still matches `provider-map.json`, and the omo-senpi, senpi-task and omo-native suites pass against it.

## 2026-10-02 - omob builds the engine with its own source siblings (#9416)

Since senpi publishes `@code-yeongyu/senpi` with exact `npm:@code-yeongyu/senpi-*` aliases instead of bundled workspaces, `script/build-omob.ts` packed only `packages/coding-agent` and the install resolved `pi-tui`, `pi-ai` and the other lockstep siblings from npm at the same version string. A source commit that used a sibling export newer than the published build then failed `bun build --compile` (`No matching export ... for import "nextRenderRevision"`), and the commit-keyed artifact cache kept serving that install. `packSenpiSiblingTarballs` now packs every workspace in senpi's `scripts/registry-packages.mjs` list from the same checkout and fails when one is missing, and `installSenpiTarball` places each reachable sibling beside the engine through alias, range and peer edges, installs only the remaining external dependencies, and rejects siblings that declare different version specs for one external package. Artifact manifests carry `assembly: "source-siblings-1"`; an older same-commit artifact is rebuilt instead of reused.
## 2026-10-02 - In-process task children run session_shutdown before they are disposed (#9413)

Since #9343, an in-process task child loads the engine's builtin extensions, codemode included. `packages/senpi-task/src/runners/in-process/child-handle.ts` tore the child down with a bare `session.dispose()`, on both the handle's `dispose()` and `discardUnstartedChildSession()`. That never emits `session_shutdown` (only the engine's `AgentSessionRuntime` does), and codemode closes its per-session bridge HTTP server only on `session_shutdown`. So every in-process child left a listening loopback server and a keep-alive socket behind, and `omo -p` never exited after it delegated a task.

Both teardown paths now go through `shutDownChildSession`: it emits `session_shutdown` (`reason: "quit"`) through the session's own extension runner when the session has handlers for it, then disposes the session in a `finally`. The runner applies the host's per-handler shutdown budget (`sessionShutdownHandlerTimeoutMs`), so a handler that hangs cannot hold teardown. `ChildSession` gains an optional `extensionRunner` (fakes that load no extensions leave it out), the handle's `dispose()` returns a promise, and the manager's in-process adapter awaits it. When handle construction fails and shutting the discarded session down also fails, both errors are kept in an `AggregateError`.

`child-shutdown.integration.test.ts` runs real children with the builtin extensions against a local fake provider. It covers the three acceptance criteria in #9413, plus one budget case: disposing a child closes its codemode bridge; a print run that delegates to a child that succeeds, and one that fails, both exit 0 within the bound; a child discarded before its handle started is shut down the same way; and a hung `session_shutdown` handler is aborted at the budget while the session is still disposed. All five fail on `dev` and pass with this change.

## 2026-10-01 - Adopt senpi 2026.10.1-3

Every `@code-yeongyu/senpi` pin moves from 2026.10.1-2 to 2026.10.1-3: the root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins (with their `senpi-tui` and `senpi-ai` aliases), the pin tests and the engine named in `senpi-task`'s coverage test. The engine carries the three desktop permission fixes (senpi#2511, #2512, #2513), event-driven Python readiness for cold Windows starts, and the tool-search, thinking-format and Claude-subscription fixes listed in CHANGELOG.

## 2026-10-01 - A PR's Windows and macOS legs never report green without running their tests (#9245)

On a pull request the Windows and macOS legs of `test`, `codex-compatibility` and `senpi-compatibility` skipped every install and test step unless a changed path looked platform-sensitive or the PR carried `ci:full-matrix`, and the job still concluded success, because GitHub counts a step skipped by its `if` as passing. That let #7676, #9329 and #9243 merge with green Windows checks and turn `dev` red. Two changes close it. `script/ci-fast-path.mjs` now marks a change runtime-touching unless every changed path matches an explicit allowlist of web, prose (top-level Markdown, README/CHANGELOG/AGENTS-style docs outside `packages/*/src`) and repository metadata (other workflows, issue templates, `.github/assets`); anything else, including a new folder or an unknown extension, counts as runtime, and a runtime-touching PR runs every OS leg by itself, with no label and no write token, so fork PRs get it too. Each OS leg also ends with a guard step, `script/ci-leg-tests-guard.mjs`, that always runs and reads the real outcomes of that leg's test steps: if they were all skipped while the change needed them, the check fails with `tests not run: add ci:full-matrix`; if the skip was intended (a docs or metadata change), the leg passes with a `tests intentionally not run` notice and says so in its job summary. The `dev` push still runs the full matrix.

## 2026-10-01 - The copy-tree self-destination test uses the OS temp dir on Windows

`packages/isolation-core/src/backends/copy-tree.test.ts` built its scratch root from `process.env.TMPDIR ?? "/tmp"`, a POSIX-only fallback. Windows runners do not set `TMPDIR`, so the path became `\tmp\self-copy-XXXXXX` and `mkdtemp` failed with `ENOENT`, which turned the required `test (windows-latest, 2/2)` job red on `dev` after #9388 changed which files share that shard's workers. The test passed before only when an earlier test in the same worker had left `TMPDIR` set. It now uses `os.tmpdir()`, which resolves on every platform. Test-only; no product change. The worker env leak that made it pass is tracked separately.

## 2026-10-01 - A Bun crash in the Windows rpc-host tests is contained and retried once (#9219)

Bun 1.4.2 intermittently segfaults a Windows test worker while it runs `packages/senpi-task/src/runners/rpc-host`, and 1.4.3-canary.1 still does (oven-sh/bun#44390). Each crash turned the required `test (windows-latest, 2/2)` job red. That job now runs the rpc-host suite in its own `bun test --parallel` invocation, between the serial quarantine and the remainder, through `script/bun-panic-retry.ts`: when the output carries Bun's crash markers (`Bun has crashed`, `worker crashed: exit code 3`) and nothing else failed, the invocation runs once more and the crash lines are logged as a warning annotation. A second crash fails the job. A real test failure (a `(fail)` line, an unhandled error, or more failures than crashed workers) is never retried, even when the same run also crashed. The suite stays in the required job with no `continue-on-error`. The Windows remainder reads the new `bunfig.win2.parallel.windows.toml`, which adds the directory to `bunfig.win2.parallel.toml`'s ignores so no file runs twice, and the flake soak's `full-shard-2` target follows the same shape without the retry. `script/bun-panic-retry.test.ts` drives the runner against a scripted fake `bun test` and proves that one crash is retried once, a second crash fails, and an assertion failure is not retried.

## 2026-10-01 - Builtin category chains only name thinking levels their models accept (#9378)

Reported by @markshikada, whose byte-compare of 5.1.6 against 5.1.7 and reflection timeline pinned it down. Five Senpi builtin category rungs named a thinking level senpi's model catalog rejects for that model, so every child session start logged a `validation_warning` to `fallback.log` (hundreds of lines in a live session) and the engine then silently clamped the rung to `high`. The entries were never skipped: they ran, just not at the declared level. In `packages/senpi-task/src/category/fallback-chains.ts`, the `quick` lane's opencode-go `minimax-m3` and `minimax-m2.7` rungs now carry no variant, so they run at the `quick` lane's own `low` instead of a clamped `high`. `unspecified-low`'s `mimo-v2.6-pro`, `qwen3.8-max-preview` and `mimo-v2.5-pro` say `high`, the level they already ran at, so their runtime behavior is unchanged and the warning stops. A level the user sets in `omo.json` is untouched: it still warns once, naming the level and the model, and still runs at a level the model accepts. The OpenCode edition's table in `model-core` keeps `max`, because OpenCode derives its own variants. The regression drives a real senpi session over the real model catalog. On the pre-fix chains, the `quick` child started at `high` instead of `low`, and two loads per category on an opencode-go plus xiaomi machine logged four warnings; after the fix it logs none.

## 2026-10-01 - The fake clock no longer calls the deprecated `AtomicU64::fetch_update` (#9383)

Rust 1.99 deprecates `fetch_update` in favour of `try_update`, and `rust-toolchain.toml` follows `stable`, so the desktop engine workflow's `clippy -D warnings` failed on every pull request at `crates/senpi-desktop-backend-fake/src/clock.rs`. `FakeClock::advance` now uses an explicit `compare_exchange_weak` loop with the same saturating result, which compiles without deprecation on older and current stable alike. The existing saturation tests in `tests/scenario.rs` cover it.

`rust-toolchain.toml` now pins `channel = "1.99.0"` instead of `stable`, which every Rust workflow reads, so a new stable release can no longer change the lints that every pull request is checked against. Toolchain upgrades now come as their own pull request, with clippy run on the new version.

## 2026-10-01 - Preserve Windows killed-task classification across repeated Bun advisories (#9228)

Windows RPC exits now accept any positive number of Bun's known child-reaper startup advisory lines as advisory-only stderr. An empty stderr remains an external termination, while any other stderr line still proves a crash. This preserves `status: error` with `killed: true` for externally terminated code-1/no-signal children without weakening crash diagnostics.

## 2026-10-01 - Adopt senpi 2026.10.1-2

Every `@code-yeongyu/senpi` pin moves from 2026.9.30 to 2026.10.1-2: the root devDependency, `omo-native`, the `omo-senpi`
and `senpi-task` peer and dev pins (with their `@earendil-works/pi-tui` -> `@code-yeongyu/senpi-tui` aliases), the pin
tests, `provider-map.json` and the engine named in `senpi-task`'s category coverage test. The engine carries the upstream
v0.99.1 sync, so `provider-map.json` gains the new builtin providers `meta` (OAuth login) and `typesafe`, and the
`senpi-task` runners follow the upstream disposition and `TranscriptContext` API. It also brings the compiled-engine
`bun` phantom-turn fix (#9362, senpi#2494) and per-session permission presets (senpi#2461).


## 2026-10-01 - Repeat macOS permission denials name the earlier pane (omo-desktop-app#1437)

macOS permission guidance now says the privacy pane has been opened only when the current denial opened it. Repeat denials refer to the pane opened earlier, or tell the user to open it when the initial attempt failed, while retaining the turn-on and fully quit/relaunch instructions and the responsible-process TCC identity.


## 2026-10-01 - Keep child tool parity stable on Windows (#9274, #6709)

The builtin tool parity regression now compares the in-process child loader directly with the `DefaultResourceLoader` policy used by process children instead of paying for two full Windows CLI cold starts. Both loaders expose the same platform-specific builtin registrations, including `web_search`; the existing policy tests continue to cover the shared parent and session-default tools that complete the child surface.

## 2026-09-30 - In-process task children receive senpi builtin tools (#9274, #6709)

The default in-process task runner now loads and binds senpi's builtin extensions without loading any parent, user or project extension paths. Its child tool payload matches process mode for the same category policy, including `web_search`, while existing allow/deny rules and the parent-only workflow, team and ask-user surfaces remain intact. The regression drives both runners through a deterministic local provider; it recorded 11 tools in-process versus 27 in process mode before the fix and 27 in both modes after it.

## 2026-10-01 - The curl installer hands pipes from sh to Bash (#9325)

`install.sh` keeps its Bash implementation, but its first block now parses as POSIX sh. When a user pipes the script to `sh` or `dash`, that block writes the Bash body from a quoted here-document to a private temp file and runs it with Bash, preserving arguments and the exit status. Sourcing the script from Bash, as the other-install tests do, still only defines the installer functions. If Bash is unavailable, it exits before any Bash syntax is parsed and prints the single command that uses Bash explicitly. Direct `| bash` installs are unchanged. Tests run the preamble through `sh` and `dash`, prove the complete buffered body and arguments reach Bash, and retain a direct Bash syntax check.

## 2026-10-01 - deep-high and Geeky · Heavy on GPT-6 Astra high, Geeky · Normal on GPT-6.1 Sol Fast medium (#9372)

The owner set new GPT lane defaults. `packages/model-core/src/category-model-requirements.ts` and the OpenCode builtin in `packages/omo-opencode/src/tools/delegate-task/openai-categories.ts` run `deep-high` on `gpt-6-astra` at `high` instead of `xhigh`, matching the Senpi chain in `packages/senpi-task` (see its changes.md). deep-high stays a single Astra rung with no Sol fallback, the 2026-09-20 rule that the deep lanes never substitute each other. `deep-low` already led with plain `gpt-6.1-sol` medium (#9214) and is unchanged. The model-profile change is in `packages/omo-senpi/changes.md`. The docs (`docs/guide/*`, `docs/reference/*`, `docs/examples/*.jsonc`) and the model-core and OpenCode tests that pinned `xhigh` for deep-high now show `high`.

## 2026-10-01 - The macOS tcc-diagnostic QA scenario reads the responsible-process message (#9368)

#9351 changed the permission-denied message to `TCC identity: responsible=<path>[ bundle=<id>], pid=<n>` (or `unresolved (engine executable=...)`), but `script/qa/desktop/macos/tcc.ts` still looked for the old `executable=` text, so the scenario could never pass. Its judgment now lives in `tccIdentityPasses`, which passes only when the denial names the engine itself (compared by real path) as the responsible process, and fails for another responsible process, an unresolved one, or a message with no identity. Five behavior tests cover those cases; with the old parser the two passing cases fail.

## 2026-10-01 - Windows explicit engine paths must name a .exe, and the exec-bit check stays POSIX-only (#9359)

On Windows, `fs.access(..., X_OK)` only proves a file exists: the platform has no exec bit. The parity test's chmod-0644 "not executable" case was therefore accepted on Windows runners, and doctor went on to spawn it. Status and doctor share `explicitPathDiagnostic`, which now refuses a win32 explicit `engine_path` that does not end in `.exe` (the name the locator and the release asset use) with `not executable (expected a .exe file)`. POSIX keeps the X_OK check. The parity test runs the mode-bit case only on hosts that have mode bits and adds a Windows case that runs on every host, with an executable fixture so only the Windows rule can refuse it.

## 2026-09-30 - The recommended installer offers to remove a second omo install (#9324)

After installing the standalone launcher, `install.sh` now verifies other `omo` entries on PATH against their package manifest or the previous standalone receipt. A terminal run asks `Remove the other omo install at <path>? [y/N]`; `--remove-other-installs` gives non-interactive runs an explicit opt-in, while piped and CI runs otherwise delete nothing and print the exact command. Removal is scoped to the verified global package and shim or the one receipt-owned launcher, and a failure leaves the new launcher working with remediation text. `omo doctor` now formats the non-active install's command with its detected Bun root, npm prefix, or quoted standalone path. The installer-channel behavior change is covered in throwaway HOME/prefix fixtures for acceptance, decline, failed-removal and look-alike safety cases.

## 2026-10-01 - Validate computer-use status sources and passively report permissions (#9349)

Status and doctor share installed-engine source selection and explicit-path validation.
Missing, non-executable and quarantined overrides are no longer reported as found,
and status retains the location after startup or failure. Before activation, status
uses the existing bounded hello/capabilities probe on an installed engine: no
acquisition, session opening, stop listener, input or permission prompt. Absent
engines and failed probes report unknown permissions rather than claiming a grant.
The probe deadline resolves independently of inherited pipe EOF and terminates
the engine process tree, so a silent wrapper cannot leave status or doctor hanging.

## 2026-10-01 - Preserve unsupported computer-use host diagnostics after first use (#9348)

`/computer status` retains the installed-engine diagnostic after activation fails as
native-unavailable. Unsupported linux-arm64 and win32-arm64 hosts continue naming
the missing release build instead of losing the explanation after first use.
Component regressions exercise the real activation failure and confirm status
does not start another child or acquire an engine.

## 2026-10-01 - the stop-path failure and permission-denied data types describe what they carry (#9338)

Two type comments copied during the computer-use permission work described the wrong data. `StopPathFailure` (`crates/senpi-desktop-safety/src/supervisor.rs`) now says it records why the global stop-chord listener failed to start, which the gate uses to turn an Accessibility miss into a permission error instead of a missing stop path. `PermissionDeniedData` (`packages/senpi-desktop-protocol/src/json-rpc.ts`) now says it carries the missing macOS permission, the Settings pane that grants it, the app to enable and whether that app must be relaunched. These are comment-only changes; the generated extension bundles were refreshed because they embed the protocol package's doc comment.

## 2026-10-01 - Permission errors name the macOS TCC responsible process (#9345)

Screen Recording and Accessibility denial diagnostics resolve the responsible process with the
macOS responsibility API and report its executable path, optional application bundle identifier,
and pid. Shell-launched engines report themselves; application-launched engines report the
responsible application. Failed resolution is explicitly unresolved and labels the engine path
only as diagnostic context, never as a guessed TCC identity.

## 2026-10-01 - Store extensions survive a worker restart and share the hourly retention sweep (#9331)

Rebased onto the gateway's failed-open recovery and retention sweep. A store handle whose worker
exits now registers the extensions the previous worker held on the fresh worker before serving
the next call, instead of answering `extension_unknown_name`; only registrations that worker
actually held are restored, so a refused downgrade or reserved name stays unregistered. The
sweep's hourly schedule is kept per connection, so an extension call joining core operations no
longer sweeps on every call. The sweep never deletes extension rows or a core row an extension
can still act on; a foreign key from an extension table to a core table is refused on write,
so none can cascade. Docs state that an operation's time budget equals the writers' lock-wait
bound, and the CHANGELOG names `gateway_schema_too_new` for core and extension downgrades.

## 2026-10-01 - Refuse extension schema downgrades without changing registration (#9331)

An extension whose stored version exceeds the caller's migration count now returns
gateway_schema_too_new under the migration lock. Refusal preserves stored rows, metadata,
ownership and any existing compatible registration; core service remains usable. Other
migration failures keep the existing lazy-retry behavior. Fresh-handle and replacement
regressions cover the refusal, unchanged SQLite data version and subsequent valid writes.

## 2026-10-01 - Exercise direct extension guards and document transaction behavior (#9331)

Direct SQLite authorization tests assert the trigger/view create decisions without the
statement lexer or schema-diff guard masking them. Caught constraint errors must roll back
prior writes, and table-valued sources remain refused. The SDK smoke uses a real disk-session
record and exercises clone recovery, shared target resolution and schema-version refusal.
The reference documents the shipped SDK entry point, owned DDL, deadlines and commit effects.

## 2026-10-01 - Refuse unsupported newer gateway schemas (#9331)

Core schema reads reject versions newer than this binary supports before migration or
normal operations. Core callers receive a typed gateway_schema_too_new error; extension
registration and calls receive that code as a refusal. The stored version and rows remain
unchanged. The check is also performed on the version re-read under the migration lock.

## 2026-10-01 - Normalize SQLite ownership and make namespace overlap symmetric (#9331)

Ownership checks fold identifier and schema-label ASCII case like SQLite, while retaining
the registry boundary around core and foreign objects. New ownership rows use canonical
names and schema changes replace legacy mixed-case rows. Overlapping extension namespaces
can register in either order; only unowned prefixed lookalikes block first registration.

## 2026-10-01 - Tokenize SQL parameters without changing quoted text (#9331)

The statement-free SQLite binder and extension statement guard share a tokenizer for
strings, quoted identifiers and comments. Literal question marks remain unchanged and
do not consume parameters. Row queries keep trailing line comments separate from their
generated wrapper. Regression coverage exercises each quote/comment form through the
real store worker, including escaped quotes and identifiers containing a question mark.

## 2026-10-01 - Refuse uncloneable extension arguments before posting (#9331)

Extension calls snapshot their arguments before crossing the worker boundary and return
invalid_arguments when cloning fails. A failed post also removes and rejects its pending
request rather than leaving an unhandled rejection for disposal. Function and symbol
arguments now leave the worker alive, preserve its registration and allow core calls.

## 2026-10-01 - Preserve relay validation and committed extension results (#9331)

Extension enqueue resolves its binding target with the relay's shared live-and-disk
address book over a worker request port. Missing sessions return not_found; receivers
are still signaled only after commit. Post-commit effects run independently, reporting
failed markers through extension_error store events without misreporting committed data
as a refused operation. Pending resolution requests are released on operation completion.
Tests cover missing/present targets, blocked markers followed by healthy markers, and
unawaited resolution failures and timeouts without late writes or worker loss.

## 2026-10-01 - Bound extension operations and revoke expired transactions (#9331)

Extension operations and pending helpers share the store's lock-wait budget. On expiry,
their transaction is revoked and rolled back and the worker accepts the next request.
Retained transactions raise typed errors; late asynchronous helper calls reject promises
instead of throwing synchronously. The worker reports an unhandled expired-transaction
error as a store event without losing core service. Other uncaught errors remain fatal.

## 2026-10-01 - Own automatic indexes through their extension tables (#9331)

Extension migrations now accept SQLite's automatic indexes for TEXT and composite primary
keys and UNIQUE constraints. Authorization requires the owning table; schema validation
checks the automatic index's table and records its extension owner atomically. Core
automatic indexes remain core-owned and inaccessible to extension operations.

## 2026-09-30 - Session gateway extension contract and actor identity (Refs #9143)

Core schema v5 adds `extension_schema` and nullable `deliveries.actor_user_id`, populated from
`author.user_id` without adding a CLI flag. The exported store-extension types define registration,
worker operations, namespaced SQL, joined relay transactions and typed refusals. The v4 migration
preserves existing rows. Registration and calls apply pending steps under the bounded core write
lock. SQLite authorization and schema-effect checks protect other namespaces and core objects.
The transaction adapter reuses relay/engine validation and budgets, defers file effects until
commit, and rolls back both kinds of writes on failure. Object ownership is persisted in
`extension_objects`, with the core schema captured before any extension runs; matching a prefix
never grants access. Core-colliding names, triggers and views are refused, and DELETE without a
WHERE clause is checked against the same ownership registry. The public thread SDK forwards the API.
Tests cover cross-process ensure, namespace violations, all refusals and continued core service,
relay parity, rollback, actor attribution, and lock bounds. The v2 fixture now removes v5 additions
when constructing its historical database. PR #9331 stacks on #9222.

## 2026-10-01 - ultrawork reuses evidence per target, spawns a new reviewer per round, and scopes defects to the blast radius (#9294)

The directive's Constraints bullet ("own every defect met mid-run ... never deferred as a follow-up", from #7674)
contradicted the engine's base prompt (a pre-existing bug is a follow-up) and the project's delivery rule (only defects
inside the blast radius belong to this run), and the Codex variant still said "No drive-by refactors"; gate step 4 sent
fixes back to the SAME reviewer while `review-work` and `ulw-execute` require a fresh one; "re-run the scenarios that
increment could have affected" had no definition; and the rerun rule was stated three times. `SKILL.md`, `codex.md`,
`default.md` (gate step only), the `ulw-loop` `add_subgoal` row and the `ulw-execute` discovered-work sentence now
carry one scope rule (blast radius: request not delivered, regression this change introduces, invalid proof, failing test
or stale doc of touched code; anything else becomes a tracked issue named in the final message), one rerun rule (evidence
valid per target with commit and coverage recorded; rerun touched-file tests plus importers, their scenarios, and moved
dependencies; one full pass before the final message) and a NEW reviewer per re-review (delta diff, cited blockers, at
most twice). The memory line asks for every regression a check caught and each QA scenario with its invocation. No TDD
wording returns. Generated copies (`generated-directive.ts`, `directive-content.ts`, `ulw-loop/directive.md`,
`plugin/extensions/omo.js`) regenerated; `embed-directive.mjs --check` went RED on the edit and GREEN after regen, and
`ultrawork-arming.test.ts` (packaged extension injects the directive) is the seam that fails on a stale bundle.

## 2026-09-30 - Localized Windows tar month tokens parse during archive entry validation (#9289)

Windows `tar -tvf` output can localize the month column or emit replacement characters when decoded. The tar listing parser now accepts any non-whitespace month token instead of only ASCII word characters, while malformed lines still fail closed and entry path validation remains unchanged. Regression coverage includes ASCII, Cyrillic, replacement-character, and malformed month/listing cases. Thanks @willowite for the report, reproduction, fix, and cases.

## 2026-09-30 - Verify quarantined desktop-engine sidecars inside the launcher install (#9283)

The locator accepts a quarantined executable sidecar only when its canonical path stays inside the
launcher's native/prebuilds directory and its SHA-256 matches the as-shipped checksum file there.
Missing, invalid or duplicate checksum entries, digest mismatches and escaping symlinks retain the
quarantine refusal. Other candidate sources and explicit engine paths remain refused. Release
acquisition and installed-sidecar verification share the existing checksum grammar; cache paths are
unchanged.

## 2026-09-30 - Adopt senpi 2026.9.30

Every `@code-yeongyu/senpi` pin moves from 2026.9.29-5 to 2026.9.30: the root devDependency, `omo-native`, the `omo-senpi`
and `senpi-task` peer and dev pins (with their `@earendil-works/pi-tui` -> `@code-yeongyu/senpi-tui` aliases), the pin
tests, the version comment in `provider-map.json` and the engine named in `senpi-task`'s category coverage test. The
engine brings the ask-user resume crash fix (#9268), the `accept-edits` permission preset (senpi#2430), the chat prompt
surface (senpi#2398) and the terminal control-endpoint answer fix the session gateway needs (senpi#2407).

## 2026-09-30 - Keep signed macOS computer-use engines at one path across updates (#9282)

Signed release engines now launch from `~/.omo/engines/senpi-desktop-engine/<host>/senpi-desktop-engine`,
so the absolute-path part of a macOS Accessibility or Screen Recording grant does not change on update.
Every service spawn reacquires its requested release and holds a process-safe exclusive lock through
atomic replacement, SHA-256 verification and native spawn. Concurrent sessions cannot replace the image
between another session's verification and spawn. Doctor uses the same transaction and reports that path.
Explicit overrides, sidecars, development engines, unsigned builds and quarantine diagnostics retain their
existing behavior; unsigned files never replace the permission-bearing release engine. Other platforms
retain immutable release generations.

## 2026-09-30 - Computer-use status and doctor report installed sources and unsupported hosts (#9286)

`/computer status` describes the located engine or verified release cache without starting it, or names the release asset that first use would download. Headless print mode emits the same status on stderr instead of losing the UI notification. Doctor now probes verified cached engines without fetching and reports the same source location as status, with a separate launched-executable field when signed launch uses a stable path. Empty unsupported hosts report that no engine is built instead of suggesting a download. The cache scan retains its existing layout, digest, quarantine and executable checks, including attempted paths when a cache read fails. The computer tool and guide require current-session capabilities before an availability claim.

## 2026-09-30 - macOS permission denials identify the app and preserve their cause (#9284)

A failed Accessibility stop listener now stays a permission denial through the supervisor, session,
engine RPC and computer tool, including the default-policy path where only the host relay is live.
Input remains refused; suspension and heartbeat precedence and the relay-only opt-in are preserved.
Denied macOS actions open each permission's Settings pane once per engine process and return the
launching app, pane URL and relaunch requirement. Capture remains independent of Accessibility.

## 2026-09-30 - The standalone binary gate starts the binary from an empty download folder and runs a Windows leg (#7485)

`native-binary-parity` (#9259) ran the binary where `build-omo-binary.ts` wrote it, and only on macOS, so the Windows
release exe dying in its download folder (#7485, fixed by #9255) could not fail it. `script/qa/omo-native-parity-smoke.mjs`
now copies the binary alone into an empty `download/` folder inside its sandbox before every binary run, on every leg.
`--npm-omo` became optional: without it the script runs the binary session twice in the same sandbox (the first run
provisions `~/.omo/binary-runtime/<version>/`, the second reuses it) and fails unless the `eval-js` and `pty-bash` steps
succeed with no extension load failure (`binaryOnlyFailures` in `omo-native-parity-compare.mjs`). The job is now a
matrix: `macos-15` keeps the binary/npm comparison, `windows-latest` builds the `x86_64-pc-windows-msvc` desktop
engine and the windows-x64 binary and runs the binary-only pair. Windows has no `ps e`, so the sandbox reaper there
lists processes whose executable or command line sits under the sandbox through `Win32_Process`. This replaces the
standalone `windows-standalone-binary.yml` from #9260, so there is one binary gate, not two.

## 2026-09-30 - CI compares the standalone binary with the npm launcher (#9248 class)

Every packaging check the binary build runs is self-referential. `build-omo-binary.ts` compares Bun's embedded files
with the staged files (`collectStagedFiles`), and `resolveExpectedSidecarRelPaths` derives its expected set from the
same `engineSidecarSources()` list that stages them, so a runtime dependency the list never names (codemode's
`@babel/parser`, #9248) passes every check. The release smoke only runs `--version`. The new `native-binary-parity` CI
job (macos-15, heavy mode) builds the darwin-arm64 binary and the omo-ai launcher from the same commit and runs
`script/qa/omo-native-parity-smoke.mjs`: both drive one scripted session in isolated sandboxes (eval JS and Python,
grep, a pty command, tool search, webfetch against a local page, text and image reads, LSP diagnostics, apply_patch,
memory, task) against a scripted provider (`omo-native-parity-provider.mjs`), then `omo doctor` and
`omo setup --dry-run`. `omo-native-parity-compare.mjs` fails on any registered-tool, step-result, doctor-section or
setup-line difference and on any extension load failure; the lines that differ by distribution (engine resolution,
edition line, embedded vs downloaded desktop engine) are listed with the reason in `DOCTOR_EXPECTED_ONLY`. The driver
stops every process its sandboxes started (found by the sandbox path in their environment) before removing them.

## 2026-09-30 - The /docs/<slug> guide pages render on omo.dev instead of returning 404 (DESKTOP-62 follow-up)

After #9261 deployed, every `/docs/<slug>` guide page answered 404 on omo.dev (`x-nextjs-prerender: 1`, `x-nextjs-cache: MISS`) while `next start` served them. The route exported `dynamicParams = false`; the Cloudflare Worker's incremental cache holds no prerendered entries, so each request was a cache miss and a closed route refuses to render on a miss. `app/[locale]/docs/[slug]/page.tsx` drops the export, like every other prerendered route in the site (`/manifesto` renders the same way); an unknown slug still ends in `notFound()`.

## 2026-09-30 - omo.dev guide pages for the OmO Desktop help links: workflows, agents, keywords, telemetry, desktop updates (DESKTOP-62)

OmO Desktop's "Learn more" buttons and its telemetry and update links opened raw markdown in this repository or a private releases page, because omo.dev had no page to send them to. `docs/guide/` gains five user-facing pages written for someone who has never read the code: `workflows.md` (what `mass ulw` does and how to follow a run), `agents.md` (delegation and the Agents panel), `keywords.md` (the engine's keyword list, mirrored from `packages/omo-senpi/src/components/ultrawork/index.ts` and `skill-pointers/index.ts`, including the `mulw` / `ulw mass` / `meth` aliases and the rule that code spans and fences are ignored), `telemetry.md` (a plain summary of `docs/reference/senpi-telemetry.md` with the `telemetry.enabled` and environment opt-outs) and `desktop-updates.md` (update flow, release notes, the Stable and Nightly tracks). `packages/web/lib/docs-sections-data.mjs` lists them as `DOC_GUIDE_PAGES_DATA`, so the generator compiles them and rewrites links between them to their routes; the new `app/[locale]/docs/[slug]/page.tsx` serves each one at `/docs/<slug>` with its own title, description and section sidebar, using `splitDocSections` (the widget-free half of `splitDocPage`), and the sitemap lists them. `docs-page.test.ts` checks every guide page splits into a titled lead with unique sections and that cross-page links resolve to site routes; `e2e/docs.spec.ts` opens each route.

## 2026-09-30 - Memory recall reads the memory repo with one git cat-file batch and re-reads only changed blobs (#9251)

`packages/memory-core/src/recall/provider.ts` loaded the recall corpus with one `git show <rev>:<path>` process per memory file, and `RecallCorpusCache` threw every parsed document away whenever HEAD moved. A memory repo with 2,159 recall files and about 17 auto-commits an hour made every live session spawn about 2,160 git processes per commit; with ~40 sessions and RPC hosts on one machine a 25 s sample caught 2,118 distinct `git show` processes (~85/s) at load 220-290, and the exited children waiting to be reaped showed up as a steady population of `<defunct>` git under the RPC hosts. A load is now `ls-tree -r` (new `GitMemoryRepo.lsTreeBlobs`, which keeps each blob id) plus at most one `git cat-file --batch` (new `GitMemoryRepo.readBlobs`, parsed from the raw stdout bytes the exec now also returns, so multibyte UTF-8 splits on byte offsets). The cache keeps the parsed document per path and blob id, so a HEAD move reads only the blobs whose id changed, reuses the unchanged document objects (the haystack, bm25 and CJK memos stay warm), drops deleted files, and reads nothing when the move touched no recall file. The tree and batch parsers live in `git/repo-tree.ts`. Every git child is still awaited on `close` on every path.

RED on dev (the old provider under the new `provider-git-budget.test.ts`): a 40-file load ran `show` once per file, and the one-edit-one-delete HEAD move and the system-only HEAD move each re-read the whole tree (41 extra `show` runs). GREEN: 3/3 in that file. With 200 files and 10 HEAD moves each load ran exactly 3 git processes (`rev-parse`, `ls-tree`, `cat-file`) and the test process had 0 zombie children.

## 2026-09-30 - Config pruning keeps valid siblings across unsafe keys, model aliases and legacy maxTokens (refs #7676)

The per-leaf pruning added by #7676 had three follow-up gaps. First, `constructor`, `prototype` and `__proto__` inside an otherwise valid config could bypass layer validation: `constructor` was then read through an inherited Zod shape member and crashed `unknown-key-diagnostics.ts`, while the other unsafe keys could survive or silently disappear. `layer-validation.ts` now rebuilds every parsed layer from safe own entries, reports each unsafe path through the existing `unknown-keys` diagnostic, and preserves valid siblings; the OpenCode schema walker also reads only shape-owned members. Second, `omo-config-chain.ts` parsed all model-reference input at once, so one invalid OpenCode leaf made it skip every model alias. It now prunes invalid model-input paths before `resolveModelReferences`, while the normal plugin-view warning still names the dropped leaf. Third, legacy `maxTokens` normalization moved even a wrong-typed value to `max_tokens`; the pruner could not find that normalized path in the raw document and removed the whole category. Invalid `maxTokens` now stays at its original path until validation removes only that field, while valid numeric values still normalize to `max_tokens`.

RED on current dev: the focused pipeline run produced four failures: the unsafe-key fixture lost the valid agent, the direct schema walker threw at `schema._zod.def`, the valid alias remained `alias`, and the valid category disappeared. GREEN after the fixes: all 10 focused tests pass, including the three real `validatePluginConfig` scenarios and the direct inherited-shape guard.

## 2026-09-30 - Post-edit LSP install nudges skip files outside a project and repeat at most once per server (#9223)

`@oh-my-opencode/lsp-core/post-edit` passed the daemon's not-installed guidance through for every edited file and every edit: a write to the agent's own config or a scratch temp file got "To install in THIS repository" plus "ACTION REQUIRED — ASK THE USER", which would create a `package.json` in HOME or a temp dir, and a harness without an install-decision tool saw it again on every edit. The diagnostics runner can now return a structured `not_installed` outcome, and `collectPostEditDiagnostics` takes an optional `locateFile` (`post-edit/file-location.ts` `classifyPostEditFileLocation`). An undecided nudge is skipped when the file has no project root (no `WORKSPACE_MARKERS` ancestor, the marker set the out-of-cwd workspace resolver uses), sits in the agent config dir, or sits in the canonical OS temp dir or `/tmp` without its own marked project below the temp root. Without a decision tool a server is nudged once per session cache (`notInstalledServers`, cleared with the not-configured cache). Recorded `declined`/`allowed` decisions and project-root files keep today's text, and `missing-dependency-result.ts` now reports the recorded `decision` in the not-installed availability. Direct `lsp_diagnostics` calls are unchanged. The Codex LSP component builds its per-session post-edit cache with an empty `notInstalledServers` set (`omo-codex/plugin/components/lsp/src/lsp-session-state.ts`); Codex has a decision tool and reports only `not_configured` structurally, so its behavior is unchanged.

RED on dev: the omo-senpi adapter test got the full ASK THE USER nudge for an agent-config file and a no-project scratch file. GREEN: `packages/lsp-core/src/post-edit/not-installed.test.ts` (14 cases) and `missing-dependency-result.test.ts`.

## 2026-09-30 - Adopt senpi 2026.9.29-5: GPT-6.1 Sol in the engine catalog, the OpenAI provider default, the GPT-6 prompt, and four engine fixes (#9214)

Every senpi pin moves from 2026.9.29-4 to 2026.9.29-5 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins including the `@earendil-works/pi-tui` aliases, their pin tests, the version comment in `provider-map.json`, and the engine named in `senpi-task`'s category coverage test). `bun.lock` moves the seven `@code-yeongyu/senpi*` entries. `packages/omo-senpi/plugin/extensions/omo.js` changes only in its embedded provider-map copy (the version comment and the digest); `build-extension.mjs --check` reports the build current. The routing change in this branch (deep-low and Geeky · Normal on `gpt-6.1-sol`) needs this engine, which is the first to carry the `gpt-6.1-sol` and `gpt-6.1-sol-fast` catalog rows on the OpenAI and ChatGPT-subscription lanes (senpi #2390, #2393, #2396).

## 2026-09-30 - Kibitzer's recall sidecar starts on a connected model when the quick pin names only unconnected providers (#9216)

`resolveKibitzerSidecarModel` took the category resolution as is, and category resolution keeps the `task` tool's rule that a user pin wins: when none of `categories.quick.models` is connected, delegate-core returns the first pin anyway and the senpi-task resolver only checks that the catalog knows it. The sidecar child then failed its auth check in milliseconds (`No API key found for <provider>`) and never reached the connected rung it carried as a fallback, so recall stayed off on a machine that had one. The new `kibitzer/sidecar-connected-order.ts` reorders the sidecar's candidates, only when the registry's availability list is known and non-empty: connected candidates lead (pins in pin order, then the builtin chain), unconnected ones stay behind them, and when none is connected the resolution is `category_unavailable` with the unconnected pins' providers first, then the chain's missing providers, so the existing notice names what to connect. An empty availability list (the stale first-turn snapshot) keeps today's resolution, and the `task` tool's resolution is unchanged.

RED on dev: the four new `sidecar-model.test.ts` cases failed (an anthropic-only registry with an openai pin resolved `openai/gpt-5.6-luna-fast`; an unconnected pin led the fallbacks ahead of a connected chain rung; nothing connected still resolved the pin). GREEN on this branch: 11/11 in that file, 643/643 across `kibitzer/` and `worker/`.

## 2026-09-30 - deep-low leads with GPT-6.1 Sol at medium, keeping GPT-5.6 Sol behind it (#9214)

`packages/model-core/src/category-model-requirements.ts` `deep-low` is now `gpt-6.1-sol` (medium) on `openai|chatgpt-subscription`, then `gpt-6.1-sol-fast` (medium) on the same two lanes, then the unchanged `gpt-5.6-sol` (medium, all four GPT lanes) and `gpt-5.6-sol-fast` (medium) rungs, so Copilot, OpenCode Zen and a registry without 6.1 Sol still resolve the lane at the same effort. `packages/omo-opencode/src/tools/delegate-task/openai-categories.ts` moves the builtin default to `openai/gpt-6.1-sol` medium and `DEEP_LOW_GATE_MODELS` to `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `gpt-5.6-sol-fast`, `gpt-5.6-sol`; the installer config writes the three later rungs as `fallback_models`. Every other category is unchanged.

Model capabilities: `model-capabilities/supplemental-entries.ts` adds `gpt-6.1-sol` and `gpt-6.1-sol-fast` (family `gpt`, text and image input, 400K context, 128K output), `model-capability-aliases.ts` maps `gpt-6.1-sol-fast` to `gpt-6.1-sol` through the OpenAI fast service-tier alias, and `model-capability-heuristics.ts` gives 6.1 Sol its own family ahead of `gpt-6` with the `low`..`max` ladder, downgrading `none` and `minimal` to `low` the way Astra does (plain GPT-6 Sol still accepts `none`). The family pattern matches the normalized id `gpt-6-1-sol`, since `detectHeuristicModelFamily` rewrites dotted versions first.

Tests: the chain pins in `model-requirements-categories.test.ts`, `gpt-6-family-routing.test.ts` and `category-routing-policy.test.ts` carry the four-rung chain; the guardrail and fast-alias tests list both 6.1 ids; the new `gpt-6.1-sol.test.ts` covers the effort ladder, the 128K output cap, and deep-low resolving 6.1 Sol over 5.6 Sol, the 6.1 Fast tier before 5.6, and Copilot's 5.6 Sol without 6.1. On the OpenCode side `openai-categories.test.ts`, `tools.test.ts` (the gate opens on each of the four ids) and `generate-omo-config.test.ts` follow. Docs: the deep-low rows in `agent-model-matching.md`, `installation.md` (plus a GPT-6.1 Sol model row), `overview.md`, `configuration.md`, `features.md`, the three `docs/examples` configs and `packages/omo-opencode/src/tools/AGENTS.md`.

## 2026-09-30 - Remove `omo daemon attach` and the shared-host opt-in (#9143)

senpi 2026.9.29-4 (adopted in the entry below) removed the interactive shared-host join, so omo drops its consumers: `omo daemon attach` now exits 2 as an unknown subcommand with nothing on stdout, and nothing in omo sets or reads `OMO_ENABLE_SHARED_HOST` any more. Details in `packages/omo-native/changes.md`; the user-facing note is the `### Removed` entry in `CHANGELOG.md`.

## 2026-09-30 - The RPC serializer test recovers upstream code from the installed engine, not its source map

`packages/omo-native/test/rpc-stream-errors.test.mjs` read the unprepared RPC serializer from `dist/modes/rpc/rpc-mode.js.map`, and senpi 2026.9.29-4 publishes no sourcemaps (senpi #2362), so the file failed at import with `ENOENT ... rpc-mode.js.map`. `bin/lib/rpc-stream-errors.js` now exports `serialization` and `guardedSerialization`, and the test reads the installed `rpc-mode.js` and reverses the one replacement the preparation makes, failing loud if the installed file carries neither shape. Disabling the preparation's write turns 4 of the 13 tests red.

## 2026-09-30 - The binary build resolves senpi's sidecars from senpi's real path (senpi 2026.9.29-4 no longer bundles its dependencies)

`script/engine-sidecar-sources.ts` built its `createRequire` from `node_modules/@code-yeongyu/senpi/package.json`, the symlink bun's isolated linker puts at the repo root. Node walks `node_modules` from the path it is given, so once senpi stopped bundling its dependencies (senpi #2360) the walk from the symlink found neither `@code-yeongyu/senpi-codemode` nor the `senpi-pty` alias, which bun links beside senpi's real path in `node_modules/.bun/<key>/node_modules`. `engineSidecarSources()` threw `codemode sidecar @code-yeongyu/senpi-codemode is not installed` and native prebuild staging fell back to `npm pack` (6 failures in `script/build-omo-binary.test.ts` and `script/engine-sidecar-sources.test.ts`). The require now starts at `realpathSync(senpiPackageDir)`, the same walk `engine-dependency.js` (#9184) uses, and the css-tree trio test's independent oracle resolves from the real path too, because that is where Node resolves the engine from. Reverting the production line brings all 6 failures back.

## 2026-09-30 - Adopt senpi 2026.9.29-4: project trust covers legacy .pi resources, interactive sessions stop joining a shared host, and the Claude 403 fallback fix

Every senpi pin moves from 2026.9.29-3 to 2026.9.29-4 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins including the `@earendil-works/pi-tui` aliases, their pin tests, `bun.lock`, the version comment in `packages/omo-native/bin/lib/provider-map.json`, and the engine version named in `senpi-task`'s category coverage test). `packages/omo-senpi/plugin/extensions/omo.js` embeds the provider-map comment, so its version string and source digest line move; the rest of the bundle is unchanged. `bun.lock` changes more than a usual pin bump because senpi now declares its real dependencies instead of bundling them (senpi #2360, prepared for by #9184). 2026.9.29-4 brings:

- **Breaking**: legacy `.pi/` project resources follow project trust, and a `.pi`-only project asks for trust (senpi #2375). Interactive sessions no longer join a shared RPC host; `pi.sharedHostEnabled`, `experimental.sharedHost` and `rendered_components` are gone (senpi #2347).
- **Session gateway**: `pi.session.registerControlEndpoint` / `admitExternalMessage`, `release_session` takeover, `wake` on multi-session hosts and kind-aware `host status --all` rows (senpi #2365).
- **Fixes**: transient Claude 403 retries the same model and a billing-dead fallback never pins the session (senpi #2379), trusted projects load `.agents/skills` again (senpi #2374), atomic session rewrites and consistent failed writes with `transcript_write_failed` (senpi #2367, #2369, #2370), every `extension_ui_response` gets a reply (senpi #2373), Claude answers in the user's language (senpi #2368), smaller installs (senpi #2363, #2364).

## 2026-09-29 - A Z.ai-only or Xiaomi-only machine gets a quick model, so Kibitzer recall runs (#9202)

The `quick` chain had no Z.ai or Xiaomi rung. A machine logged in to only one of them therefore had no quick model: quick delegation was unavailable, and Kibitzer refused with `beyond_category` and stayed off, because its recall sidecar is pinned to `memory.recall.category` (default `quick`). Both chains (`packages/senpi-task/src/category/fallback-chains.ts` and the `packages/model-core/src/category-model-requirements.ts` mirror) now end with `glm-5.3-flash (low)` on `zai|zai-coding-cn` (model-core: `zai-coding-plan`) and `mimo-v2.6-flash (low)` on `xiaomi`. The rungs come after `claude-haiku-4-5`, so every provider set that resolved quick before resolves the same model. Neither flash model can turn thinking off: the engine catalog maps `off` to null for `glm-5.3-flash`, and `mimo-v2.6-flash` declares `supportsDisabledThinking: false`. Both run at `low`, like `qwen3.6-flash`. The telemetry vocabulary adds both model ids, and the doc tables list them. The bundled capability snapshot gains the four entries these rungs resolve through (`glm-5.3-flash`, `zai/glm-5.3-flash`, `mimo-v2.6-flash`, `xiaomi/mimo-v2.6-flash`), taken from a fresh models.dev fetch through the generator's own normalization, so every built-in requirement model stays snapshot-backed. The full refresh belongs to the scheduled refresh-model-capabilities workflow. `omo-native/test/category-coverage.test.ts`, which runs the real engine with only a Z.ai key, now expects `quick` to be usable.

The Desktop's prompt surface is not passed through the environment. A host process keeps the environment of the client that started it. The operator endpoint `rpc.sock` is shared by `omo daemon run`/`attach`, the thread tools of any session, the Desktop's control endpoint and every Desktop thread on Windows. A surface variable set by a Desktop spawn would therefore reach CLI sessions on that host. The surface is carried per session instead, on the RPC session-open commands (senpi#2380).

## 2026-09-29 - Comment-checker resolvers find the npm binary in every layout the package has shipped (#9180)

`@code-yeongyu/comment-checker` is moving from one tarball that bundles five platform binaries under `vendor/<platform>/` (255 MiB per install) to per-platform optional packages `@code-yeongyu/comment-checker-<platform>-<arch>` with the binary in `bin/` (51 MiB; code-yeongyu/go-claude-code-comment-checker#12). Only Native saw both layouts, because it calls the package's own `getBinaryPath()`. The OpenCode hook resolver (`comment-checker-core` `resolveCommentCheckerBinary`) looked only in `bin/`, so it missed every 0.7.1+ npm install, and the doctor (`findCommentCheckerPackageBinary`) knew `vendor/` but not the platform package. `comment-checker-core/src/package-binary.ts` now owns one lookup: the platform package resolved from the root package's own location, then `vendor/<platform>-<arch>/`, then `postinstall`'s `bin/`. The core resolver, the doctor and the LazyCodex component's fallback all use it. Resolution order around it (env override, shared cache, PATH, lazy download) is unchanged.

RED on dev: the resolver matrix against real npm installs of 0.8.0 and of the per-platform packages returned no path from the core resolver for either layout, and none from the doctor for the per-platform layout. The real `doctor --json` reported `Comment checker: no` for the per-platform install. On this branch every surface returns the installed binary for both layouts, and that binary's check exits 2 on a comment. The built LazyCodex `PostToolUse` hook blocks with the checker's message in both layouts.

## 2026-09-29 - One invalid value no longer wipes an omo.json file: only that key is dropped and `omo doctor` names it (#7670)

Before this change a single malformed value in `omo.jsonc` (for example `"task": { "host_engine_policy": "sometimes" }`) made the loader reject the whole file, so every valid key in it silently stopped applying. `packages/omo-config-core/src/loader/layer-validation.ts` now validates a file in three gates: the prototype-tamper guard still rejects the file fail-closed before anything else, unknown keys are still stripped with one `unknown-keys` diagnostic (now also inside array elements, so `teams.alpha.members.0.bogus` is reported as an unknown key by its dotted path, and a diagnostic with an empty key list is never emitted), and every remaining invalid value is pruned by `prune-invalid-leaves.ts`. The pruner walks each zod issue path, drops the smallest failing subtree (the wrong value, or the object that lacks a required key, including inside arrays such as `teams.alpha.members.0.color`), removes containers left empty, and re-validates in bounded passes; an exhausted bound, an issue on the document root, or a file with nothing valid left still rejects the file with its existing `validation` diagnostic. This covers every section of the layer schema: the shared top level, `task`, `agents`, `categories`, `teams`, the `[native]` / `[senpi]` / `[codex]` blocks and `profiles`. Each dropped key is its own `invalid-value` diagnostic whose `path` is the file and whose `issuePaths` names the dotted key. The merged-config fallback follows the same rule: a merged value that fails the full schema is dropped with an `invalid-value` diagnostic at `(merged omo config)` instead of resetting the whole config to defaults. The prune builds on the agents/categories leaf pruning from #7676 (contributed by @mooire733), generalized from `agents.<name>` / `categories.<name>` leaves to every path.

`omo doctor` (native, both the launcher and the compiled binary, through `packages/omo-native/config-doctor-runtime.ts`) prints one `WARN config: ~/.omo/omo.jsonc: task.host_engine_policy ignored (invalid value)` line per dropped key, one `... ignored (unknown key)` line per stripped key, and one `... not loaded (<reason>)` line per file that contributed nothing, all shared from `omoConfigDiagnosticLines`. In the OpenCode edition, `validatePluginConfig` reports the loader's dropped keys as `warnings` (the file stays valid) and applies the same pruning to the `[opencode]` block against the plugin schema, so one bad field no longer drops the whole `agents` section of that block; its doctor lists each warning as its own issue.

## 2026-09-29 - omo doctor runs the computer-use diagnostic again: omo-ai ships the prelude assets beside the doctor runtime (#9193)

On 5.1.1 every `omo doctor` printed `WARN computer use: diagnostics unavailable: ENOENT ... plugin/runtime/category-coverage/assets.generated.json`, on every OS. `plugin/runtime/category-coverage/index.js` inlines the computer-use doctor, and with it `senpi-desktop-prelude`'s `assets.ts`, which reads `assets.generated.json` from beside the bundle at import time. `build-extension-core.mjs` stages that file beside the extension bundles in `extensions/`, but `script/build-omo-native.ts` never staged it beside the category-coverage bundle, so the published tarball had it only in `plugin/extensions/`.

`buildCategoryCoverageRuntime` now copies the prelude assets next to the bundle it builds, the same beside-the-bundle contract the extensions and personas follow, and `runtime/category-coverage/assets.generated.json` joins the native payload's required artifacts. `script/verify-omo-ai-payload.mjs` pins it too, and it gains a rule that reads every packed `.js`/`.mjs` file: a bundle that reads `join(dirname(fileURLToPath(import.meta.url)), "<file>")` fails the gate unless `<file>` is packed beside it. The rule matches both the bundled and the terser-minified shape of that read, so a future sibling asset a bundle reads but the package does not ship fails packing instead of reaching users.

## 2026-09-29 - Adopt senpi 2026.9.29-3: running sessions survive an update, unknown slash commands stay out of the model, and the web search, MCP and Bedrock fixes

Every senpi pin moves from 2026.9.29 to 2026.9.29-3 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, the version comment in `packages/omo-native/bin/lib/provider-map.json`, and the engine version named in `senpi-task`'s category coverage test). 2026.9.29-2 and -3 bring:

- **Running sessions survive `omo update` / `bun install -g`**: each launch runs from its own copy of the engine bundle under `<agentDir>/runtime/`, so a session started before the swap no longer fails every request with `Cannot find module './<chunk>-<hash>.js'` (senpi #2361, fixes senpi #2358).
- **Unknown slash commands never reach the model by accident**: the TUI returns the text to the editor with a `Did you mean` hint and a second Enter sends it as a message; RPC and app-server answer with a structured `unknown_command` (senpi #2350, fixes senpi #2348; builds on #2258). Picker rows whose command declares an `argument-hint` complete and wait for arguments (senpi #2258, used by #9169).
- **`~/.pi/agent` edits after the copy are reported** once per change at startup, and `config import-pi` copies them over (senpi #2349, refs #9173).
- **Web search**: hosted search on the provider's cheaper search model with a session-model retry (senpi #2342), a keyless engine chain with per-engine cooldown and SearXNG (senpi #2344), and only returned pages counted as OpenAI/xAI sources (senpi #2338).
- **MCP**: skill-declared servers expand `${VAR}` by the declaring skill's trust and remote skill servers stop sending `bearerTokenEnv` (senpi #2346); a non-shared `list_changed` registers the new tool list (senpi #2355).
- **Providers**: Cursor runs each tool call once (senpi #2336), Bedrock accepts root `anyOf`/`oneOf`/`allOf` tool schemas (senpi #2058), hook-removed tools stay out of `allowed_tools` (senpi #2312), nested Responses WebSocket errors show status and message (senpi #2244), Chat Completions folds adjacent user messages for non-OpenAI hosts (senpi #2148), Claude subscription custom tool schemas keep field descriptions (senpi #2146).
- **Sessions and extensions**: turns requested during `session_start` begin after every handler (senpi #2326, fixes senpi #1972), initial model provenance is forwarded (senpi #1863), CommonJS mode rules are preserved (senpi #1856).

## 2026-09-29 - The OpenCode plugin installs only what it runs: runtime dependencies are zod, detect-libc and @opentui/solid (#9181)

The root `package.json` listed thirteen build inputs under `dependencies`. `bun build` inlines all of them into `dist`, so every plugin install downloaded their full closure (`@opencode-ai/plugin` alone pulls `effect` 4 beta at 46 MiB) and never imported it. A bare-import census of every `.js/.mjs/.cjs` file in the published 5.1.1 tarball finds only `zod` (`dist/index.js`, the index build's one `--external`), `detect-libc` (`bin/oh-my-opencode.js`, `postinstall.mjs`) and `@opentui/solid` (`dist/tui.js`). Those three stay runtime dependencies. `@clack/prompts`, `@modelcontextprotocol/sdk`, `@opencode-ai/plugin`, `@opencode-ai/sdk`, `@opentui/core`, `@opentui/keymap`, `commander`, `diff`, `js-yaml`, `jsonc-parser`, `picocolors`, `picomatch` and `posthog-node` move to `devDependencies`, and the build is unchanged.

`@opentui/solid` stays a hard dependency rather than an optional peer. OpenCode installs plugins with npm Arborist, which never installs optional peers, and `tui.ts` returns before registering anything when `import("@opentui/solid")` fails. A packed variant with the optional peer, installed the same way, has no `@opentui/solid`, and its TUI loses the `/native` command, the sidebar and btw. The four `@earendil-works/pi-*` 0.84.2 root overrides are deleted: they matched no dependency edge. `omo-opencode` drops a `picomatch` declaration nothing in it imports. `senpi-task` moves `typebox` from 1.3.18 to the repo-wide 1.3.34. `omo-senpi` and `senpi-task` compile and test against `@earendil-works/pi-tui` as `npm:@code-yeongyu/senpi-tui@2026.9.29`, the fork the engine loads at runtime, instead of upstream 0.84.2. `runtime-dependency-resolution.test.ts` learns that an `npm:` alias installs the aliased package's manifest, and `dependency-security.test.ts` checks the ReDoS-safe picomatch pin under `devDependencies`, where the bundled copy now comes from.

## 2026-09-29 - omo resolves senpi's dependencies where senpi resolves them, not inside senpi's package directory (#9184)

Several sources reached into `node_modules/@code-yeongyu/senpi/node_modules/...`, which exists only while senpi publishes with `bundleDependencies`. Once senpi ships its dependencies as ordinary ones (code-yeongyu/senpi#2360), npm hoists them beside senpi and bun's isolated store links them beside senpi's real path, and every one of those paths breaks: the installed-engine preparation (postinstall and every launch) failed with `installed Senpi target is missing`, `omo setup`'s model import with `the engine model catalog is missing`, and the binary build could not resolve its OAuth import.

`packages/omo-native/bin/lib/engine-dependency.js` answers where the engine at a senpi root resolves a dependency: Node's `node_modules` walk from senpi's real path, which covers the bundled, hoisted and bun-store layouts with one rule. `claude-code-floor.js` (the Claude Code UA floor) and `engine-models.js` use it, as do `provider-map-registry.test.ts`, `compile-entry.test.ts` and the `policy-continuation-e2e.mjs` driver. `chain-provider-ids.test.ts` resolves the registry through pi-ai's exports from senpi's real path. The hooks-state legacy-reader fixture resolves and mocks `proper-lockfile` from senpi's entry with `createRequire`. `script/qa/tsconfig.json` takes `typebox` from omo-senpi's own dependency (the same 1.3.34 senpi pins) and `sanitizeTerminalLabel` from senpi's public re-export.

The compiled entry now calls `registerBunRuntimeModules()` from senpi's `./bun-runtime` export instead of importing `pi-ai/dist/bun-oauth.js` by path. The export is bound to the pi-ai senpi itself loads, and besides the OAuth flows it registers the statically bundled Bedrock, Cursor and Devin provider modules, as senpi's own Bun binary does. Before this, the binary answered a Bedrock or Devin model with `Cannot find module './bedrock-converse-stream.js' imported from /$bunfs/...` (#8235); now a Devin model reaches its endpoint and a Bedrock model reaches the AWS SDK. `engine-runtime-modules.ts` imports that export right before the CLI instead of at module scope: registering at module scope cost every launch about 90 ms of CPU, including `--version`. Deferred, the answers omo gives itself stay within about 20 ms of before, and an engine launch pays about 50 ms for the providers. A darwin-arm64 build with the repository's script bundles 4192 modules before and 4193 after (the new module), and the binary grows from 118,318,194 to 119,226,354 bytes. On a synthetic install where senpi has no nested `node_modules` and its dependencies are siblings in a bun store, `dev`'s fixture, compile entry, engine preparation and model catalog all fail to resolve, and this change's versions run, with the bundle taking every pi-ai module from the sibling (0 nested inputs). `senpi-patch.test.ts` covers the hoisted and bun-store layouts and the unresolvable case.

## 2026-09-29 - omo-ai no longer declares @babel/parser (#9182)

#6965 added `@babel/parser@8.0.4` to `omo-ai` because `@code-yeongyu/senpi@2026.8.16` bundled `senpi-codemode` without the parser its `kernels/js/rewrite-imports.ts` imports. `@code-yeongyu/senpi-codemode@2026.9.29` declares `@babel/parser 8.0.4` itself, and in clean global installs of the published `omo-ai@5.1.1` (bun and npm, isolated HOME and cache) the bundled codemode already resolves its own nested copy, `senpi/node_modules/@code-yeongyu/senpi-codemode/node_modules/@babel/parser`, so the omo-ai declaration was never read. `packages/omo-native/package.json` drops it and `test/package-shape.test.ts` pins the single `@code-yeongyu/senpi` dependency. A packed `omo-ai` without the declaration, installed the same two ways, answers `omo --version` and boots an RPC session whose `get_loaded_surfaces` lists the same 55 extensions as the published package, `senpi-codemode` included, with no `Cannot find module '@babel/parser'` warning. The installed tree is unchanged under bun (the parser stays as codemode's own dependency); npm no longer places an unused top-level copy.

## 2026-09-29 - omo.dev recommends the one-line installer for the visitor's OS, with an install page (#9177)

The landing hero and the closing CTA showed `bun install -g omo-ai`, and a browser opening get.omo.dev was sent to `omo.dev/docs/guide/installation`, which returned 404. Both now show `InstallTabs` (`packages/web/components/landing/install-tabs.tsx`): one CommandBar per shell under a `macOS, Linux, WSL` / `Windows PowerShell` / `Windows CMD` tab row. `lib/install-targets.ts` holds the three commands and `detectInstall()`, which reads `navigator.userAgentData.platform` first and the UA string second. Windows gets PowerShell, macOS, Linux and ChromeOS get the shell script, and phones, tablets and unknown agents get the shell script with a "run this on your computer" caption. A script in the root layout's `<head>` marks `<html>` with the detected target before the body is parsed, and CSS picks the panel from it until the visitor chooses a tab, so a Windows visitor never sees the macOS command flash and nothing shifts. Without JavaScript all three commands show. The tabs use a roving tabindex with arrow, Home and End keys.

`/docs/install` is new, built from `docs/guide/install.md`: the three commands (the site swaps the marked block for the tabs), checking the install with `omo --version` in a new terminal, fixing `PATH` per shell, channels and versions, updating, uninstalling, proxies and offline machines, and npm/Bun as the alternative. `scripts/generate-docs-content.mjs` compiles standalone pages listed in `DOC_PAGES_DATA` next to the single-page sections, and `DocsShell` takes each page's own section ids. The hero "Get started", the CTA "Install now" and the nav "Install" link there. get.omo.dev's browser redirect points to it, and `proxy.ts` sends the old `/docs/guide/installation` path there with a 308. The READMEs lead with the one-liner and link the page. `get-worker-ci.yml` runs the exact CMD line against the live get.omo.dev on `windows-latest`.

## 2026-09-29 - Memory reflection reaches models that only an extension-registered provider serves (#9175)

Reflection children start with `--no-extensions`, and the model preflight listed models the same way, so a provider that only an extension registers (a custom gateway declared under `packages` in `settings.json`) never existed in the child: every run failed `model_not_visible`, whichever model was pinned. `worker/model-preflight.ts` still probes the discovery-disabled catalog first. A candidate that catalog omits is looked up in a second catalog listed with extensions loaded (cached separately), and a candidate found only there keeps its place in the chain with `loadExtensions: true`. `spawn-payload.ts` starts that child without `--no-extensions` and with `OMO_SENPI_DISABLED=1`, so the omo plugin loads but registers nothing (its task and thread components would otherwise write `.omo/` into the memory worktree and dirty it; `extension/disable-env.ts`, honored in `compose.ts` like the `--omo-senpi-disabled` flag, which is an unknown option to a child without the plugin). The `SENPI_MEMORY_REFLECTION` sentinel stays set, and fork children keep omo loaded because their cache prefix must match the parent. Core-provider models keep the `--no-extensions` child unchanged.

When no catalog lists any candidate, the reactive attempt now runs in the extension-loading child, so a `model_not_visible` there proves no memory child can see the model. `memory-model-attempts.ts` then leads the detail with `model_unreachable_with_extensions`. `failure-policy.ts` marks that failure definitive, `memory-core` parks automatic reflection on the first definitive failure instead of the third, and the park alert is its one notice (the health alert skips it). The notice points at a core-provider model for `categories.<category>.model` or `memory.reflection.enabled: false`; `docs/reference/omo-json.md` documents it. RED on dev 3f9a6bb6e: the new runner integration test failed with `model_not_visible:extension-only/primary`. Live QA on the real engine with a discovered gateway extension and a localhost stub: reflection merged through the gateway, and after the stub died one failure parked with one notice and two later turns started no run.

## 2026-09-29 - One-line native installer at get.omo.dev: R2 mirror behind the CDN, GitHub fallback, counted downloads (#9166)

`curl -fsSL https://get.omo.dev/install.sh | bash` and `irm https://get.omo.dev/install.ps1 | iex` install the compiled `omo` binary. Both scripts live in `packages/get-worker/scripts/` and pick the asset for the OS, CPU, libc, AVX2 support and Rosetta. They verify it against the release `SHA256SUMS`, install `~/.local/bin/omo` atomically, add a marked PATH block (Windows: user PATH as REG_EXPAND_SZ) and write the receipt `~/.omo/install.json`. They also report an npm `omo-ai` install without removing it, and refuse to run as root. When get.omo.dev is unreachable, the channel resolves from the npm `omo-ai` dist-tags and the bytes come straight from GitHub Releases.

`packages/get-worker` is the Worker `omo-get` on get.omo.dev. It serves the scripts, the channel pointers `/channels/{latest,beta}` (60 s) and `/v/<version>/<asset>` from the private R2 bucket `omo-releases` through the Cache API (immutable, one year), and only allowlisted asset names are served. It answers with a 302 to the GitHub asset (`X-Omo-Source: github`) when the version has no `.complete` marker, the object is missing, or R2 errors. Every download writes one Analytics Engine datapoint, and installs tagged `omo-install-qa` (this repo's CI) are marked so the count leaves them out. An hourly cron rolls whole UTC days into D1 (`downloads_daily`, plus signed `download_adjustments`), and `/stats/downloads` reports `uncountedByGitHub`.

`script/installer/mirror-release-to-r2.ts` (reusable workflow `installer-mirror.yml`, called by `publish.yml` as the last release step) verifies each asset against `SHA256SUMS` and the GitHub digest. It uploads through a SigV4 PUT that signs the payload hash, so R2 refuses altered bytes, then reads every object back and re-hashes it. Only after that does it write `.complete` and move the channel. The channel never moves backwards unless forced, stable versions are kept forever and only the newest 20 betas are kept. `--dry-run` works under a scratch prefix and deletes it afterwards.

`packages/web` adds the mirror's `uncountedByGitHub` to the site total, the `/api/downloads` badge and the OG image; a failing stats reply withholds the figure like a failing npm range. Installs redirected to GitHub are already in the release `download_count`, so they are not added twice. `get-worker-ci.yml` runs the Worker tests, shellcheck, PSScriptAnalyzer and real installs on Linux (glibc, arm64, Alpine musl), macOS and Windows (pwsh and Windows PowerShell 5.1). `get-worker-deploy.yml` applies D1 migrations and deploys. The root `bunfig*.toml` files ignore `packages/get-worker/**` like `packages/web/**`.

## 2026-09-29 - Native's first start reports the OpenCode edition's agent and category models it does not use (#9147, #6794)

A user who moved from the OpenCode edition to OmO Native without running `omo setup` had their per-agent and per-category model choices ignored with no message: the legacy migration deliberately imports only model/provider controls (#7270), and Native reads only the shared base plus `[native]`. Native's startup migration batch now ends with a notice-only in-place plan, `2026-09-opencode-routing-notice` (`omo-senpi/src/components/config-startup/opencode-routing-notice.ts`). It reads the OpenCode edition's `agents` and `categories` from the legacy `oh-my-*` files or the migration backups they were moved into, overlaid by the `[opencode]` block, the same sources `omo setup` reads. Each choice the native view (shared base, `[senpi]`, `[native]`) does not already set is named under its native key through setup's own conversion (`openCodeRoutingGap` in `omo-native/bin/lib/setup-opencode-models.js`): `metis` -> `plan-consultant`, `momus` -> `plan-reviewer` (#9167), Native names win, provider ids through `provider-map.json` (`zai-coding-plan` -> `zai`, `kimi-for-coding` -> `kimi-coding`), `variant` -> `reasoning`. An agent Native has no counterpart for gets the category form; an unknown provider gets a `<provider>/<model>` placeholder. All of it goes into ONE warning at the first `session_start` with "run omo setup to carry them over" and the exact `"[native]": { ... }` member for each. The plan writes nothing but its `_migrations` marker, so later starts are quiet; a config with nothing to report gets no write and no marker. `omo doctor` prints the same line (`INFO`) for as long as the gap exists (`doctor-migration.js` `openCodeRoutingReport`).

Without the engine's model list the startup check validates providers only (against the engine's builtin ids); `omo setup` still validates each model before it writes. `setup-opencode-models.js` reads `provider-map.json` with a JSON import so the omo-senpi bundle carries it, and ships a `.d.ts` for that cross-package import. RED on dev 7737042b7: 5 of the new behavior tests failed (4 startup, 1 doctor) while the no-history and Native-set controls passed.

## 2026-09-29 - X11 foreground clicks and scrolls wait for the window manager to replay each press (#9136)

On X11 a foreground `scroll` sometimes delivered only part of its wheel clicks and still reported success; the Desktop Linux QA scenario `x11-scroll-direction-foreground` failed intermittently with one of three clicks missing. xfwm4 keeps a synchronous passive grab on every client window, so each XTEST press freezes the pointer until the manager replays it. The engine sent the next press, and then the focus restore to the previous window, while earlier presses were still held. A press sent in that window never reached the target, and a late replay could re-focus the target after the restore, which surfaced as `InputFailed: window ... did not become active and focused`.

`crates/senpi-desktop-backend-x11/src/input/settle.rs` now waits on the X server instead of on time. Before the first button it confirms the target is on the chain of windows under the pointer (`QueryPointer` descent from the root), so a covered point gets no button. After each click, and before focus goes back, it waits until no client holds the pointer, probed with a grab that selects no events and is released at once (`AlreadyGrabbed`/`Frozen` means a press is still held or a button is still down). Both waits are bounded by one second. When one runs out, the request fails with `InputFailed` that names the cause (covered point, or delivery unconfirmed) instead of reporting success. Desktop-target input and background (`XSendEvent`) delivery are unchanged, and the scroll contract (`dx`/`dy` pixels, 40 px per click, positive `dy` down) is untouched.

Evidence, on Xvfb + xfwm4 with a Tk window that counts the ButtonPress events it receives: 200 iterations of activate-another-window then a foreground `scroll` of `dy: 120` (3 clicks) lost clicks in 14 iterations with an `ok` reply, plus 17 `InputFailed` replies, on the base engine. The fixed engine had 0 short iterations and 200 `ok` replies. `x11-scroll-direction-foreground` repeated 30 times in one stage passed 30/30, each moving exactly 8 lines and returning to its start. `settle_tests.rs` covers held presses, a pointer that is never released, a permanently covered point and a late restack against the recording fake. Removing either wait fails them.

## 2026-09-29 - Docs: the session gateway, the `omo thread` CLI and `omo daemon adopt`; attach and shared-host prose removed (#9143)

`docs/reference/omo-thread.md` now carries the gateway contract a script or connector depends on: the delivery table (what `auto`, `steer` and `follow_up` do for an idle, mid-turn, question-waiting, compacting or offline session; `auto` never steers through the gateway), the fixed budgets (1 MiB per send and 32 KiB per report or answer, a 128-message / 1 MiB backlog per target, a burst of 8 then one per 5 s per sender and target, 16 sessions per turn, 4 hops / 64 deliveries / 7 days per causal chain, 24 h for an undelivered message), the binding invariants, the outbox cursor and ack rules, and the completion arm lifecycle (opt-in, durable, picked up at start and on wake, 250 ms settle wait, lock waits bounded at about 25 s and retried). The `list` row documents the endpoint fields a live row carries, the connector loop reads the reply token out of the outbox, and `report` documents the originating-binding rule. `docs/reference/omo-daemon.md` drops the `attach` subcommand and every shared-host sentence (the measured tables now name the previous release's one host), and the operator-endpoint row names only `OMO_RPC_SOCKET`. `CHANGELOG.md` [Unreleased] gains the gateway, `omo thread`, bindings/outbox, `omo daemon adopt` and the attach removal. No config key was added, so `assets/omo.schema.json` is unchanged. Every documented `omo thread` and `omo daemon adopt` example was run through the real CLI against a sandbox agent dir with a fake host and terminal endpoint, and each `--json` shape was compared with the real keys.

## 2026-09-29 - `omo thread` drives the session gateway from scripts; `omo daemon adopt` takes a host session into a terminal

`omo thread list|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack [--json]` runs every thread operation the agent tools offer without an agent session, as `cli:<uid>`, through the new plugin runtime `runtime/thread-sdk/sdk.js` (importable by connector scripts). `omo daemon adopt <session> [--interrupt] [--force]` asks the session's host to release it and resumes it in the current terminal with `--session <path>`; refusals exit 4 with the reason (`turn_active` -> pass `--interrupt`, `attached` -> pass `--force`, already a terminal session). `omo daemon status` lists terminal endpoints as `tui <name> pid <n> cwd <path>`, and handoff / `stop --all` never act on them. References: `docs/reference/omo-thread.md`, `docs/reference/omo-daemon.md`.

## 2026-09-29 - unspecified-low opens on Claude Sonnet 5.5 (medium), deep-low opens on plain GPT-5.6 Sol (medium) (#9144)

`unspecified-low` opened on `mimo-v2.6-pro (max)`. The chain now opens on `claude-sonnet-5-5 (medium)` behind the provider list of the existing `claude-sonnet-5` rung (`anthropic|anthropic-api|github-copilot|opencode`; the senpi mirror heads it with `anthropic-subscription`), and every earlier rung follows in its previous order, so the chain is 8 rungs. `deep-low` swaps its two rungs: plain `gpt-5.6-sol (medium)` on `openai|chatgpt-subscription|github-copilot|opencode` first, `gpt-5.6-sol-fast (medium)` on the OpenAI lanes second; its gate (either Sol tier) is unchanged. Owner decision; Claude Sonnet 5.5 was released 2026-09-28 and the engine catalog lists it from the next senpi release (code-yeongyu/senpi#2325), so until that adoption OmO Native keeps resolving `unspecified-low` on its MiMo V2.6 Pro rung.

Mirrors moved together: `model-core/category-model-requirements.ts` (source of truth), `senpi-task/category/fallback-chains.ts`, both `openai-categories.ts` builtin configs (`anthropic/claude-sonnet-5-5 medium`; deep-low `openai/gpt-5.6-sol` / `chatgpt-subscription/gpt-5.6-sol` medium), `supplemental-entries.ts` (+`claude-sonnet-5-5`, `anthropic/claude-sonnet-5-5` with the models.dev claude-sonnet shape: 1M context, 128k output, reasoning, no temperature; without them `keeps every built-in OmO requirement model snapshot-backed` read `heuristic-backed`), and the telemetry vocabulary (`model-vocabulary.ts`: +claude-sonnet-5-5 on every provider list that exports claude-sonnet-5) so no shipped rung masks to `custom`.

`unspecified-low-chain.test.ts` resolves the category against a registry serving every rung at once, so the winner proves order: sonnet-5-5 wins, then mimo-v2.6-pro once it is removed, then grok-4.7. RED before the test updates: 20 fails across the pinned chain/default expectations. GREEN on the identifier-scoped gate (model-core, senpi-task category/agents/tools-task, omo-opencode delegate-task + cli, omo-senpi telemetry): 2510 pass / 0 fail across 292 files. `bun run typecheck` exit 0. Extension bundles regenerated on Linux with bun 1.4.2 (the CI pin).

## 2026-09-29 - Adopt senpi 2026.9.29: Claude Sonnet 5.5, a self-updating Claude Code fingerprint, and the Claude continuity fixes

Every senpi pin moves from 2026.9.28-7 to 2026.9.29 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, and the version comment in `packages/omo-native/bin/lib/provider-map.json`). The new engine brings:

- **Claude Sonnet 5.5** (`claude-sonnet-5-5`) in the catalog for anthropic, Bedrock, OpenRouter, Vercel AI Gateway, Venice and OpenCode, shaped like Opus 5.5 (adaptive-only thinking, no forced tool choice), with its own prompt preset (senpi #2325, fixes senpi #2321). `senpi-task/src/category/coverage.test.ts` lists it in the pinned anthropic catalog.
- **The Anthropic OAuth `claude-cli/<version>` fingerprint follows the latest published Claude Code** (floor 2.1.284, six-hour background refresh cached beside models.json, `PI_CLAUDE_CODE_VERSION` pin, one retry at the version a `claude_code_version_too_old` rejection names). The bundled `claude-agent-sdk` is 0.3.284, the first Claude Code that knows Sonnet 5.5 (senpi #2325). omo's launcher floor rewrite (`bin/lib/claude-code-floor.js`, 2.1.280) is a no-op on this engine: the `claudeCodeVersion` declaration it rewrites is still there and already above the floor.
- **Claude subscription continuity**: a streaming turn survives a thinking-level change and failed turns stop being reported as re-sends (senpi #2322); a detached binding forks at one shared-prefix boundary (senpi #1986); recovery resumes at an earlier verified checkpoint instead of re-sending everything (senpi #2324); a cold seed that overflows the window compacts once and retries instead of killing the session (senpi #2330, fixes senpi #2329, refs #7975).
- **Ambient cloud credentials never make Bedrock the startup model** over configured providers (senpi #2332, fixes senpi #2327).
- Changelog completeness for the Together default (now Kimi K3; models.dev retired K2.6 there) and `session.log` keeping `sessionId` (senpi #2333, refs #8759).

## 2026-09-29 - LazyCodex agent sync keeps a user's model and applies `[codex].agents` overrides (#5245)

`packages/omo-codex/src/install/link-cached-plugin-agents.ts` still copies each bundled agent TOML over
`$CODEX_HOME/agents/<role>.toml`, but now restores a hand-edited `model` the way it already restored
`model_reasoning_effort` and `service_tier`, then applies `[codex].agents.<role>.model` / `reasoning` from omo.jsonc.
A per-agent receipt, `agents/.lazycodex-agent-models.json` (`agent-model-overrides.ts`), records the model LazyCodex
wrote (bundled or override) and any override reasoning: an installed value that differs is a hand edit, one that
matches follows the next bundled default, so a removed override does not stick. Installs from before the receipt fall
back to the list of models bundled agents have ever shipped (`managed-agent-model-defaults.ts`).
`codex-agent-config.ts` (was `codex-default-role-config.ts`) reads only the `[codex]` block and
`profiles.<P>.[codex]`, never shared base `agents`, whose OpenCode model ids share role names such as `librarian`.
The installer's agent linking moved to `install-codex-agents.ts`; both the installer and the bootstrap `setup` step warn
about override names LazyCodex does not manage. `install-dist/install-local.mjs` is regenerated.

## 2026-09-29 - Docs and schema: the task-host pre-warm uses the host's `warm` command, is admitted like a spawn, and warms Desktop threads on intent

`docs/reference/omo-daemon.md` (Pre-warm): the warm registers the session's task store in `rpc/task-stores.json`
before any host is ensured and does nothing when that fails; it then sends the host's `warm` command instead of opening
a throwaway session (an engine from before the command still gets the warm-up session); and a session inside a Desktop
thread host (`i-*`) warms on the first streamed `task`/`task_send` call instead of its first prompt.
`packages/omo-config-core/src/schema/task.ts`: the `host_shard_prewarm` comment says the same about Desktop threads.

## 2026-09-28 - Docs: engine hosts per session, the price of isolation, migration and rollback (#9003)

`docs/reference/omo-daemon.md` is now "omo daemon - engine hosts per session". It documents how a session's
task host is named (`<shardRoot>/p-<sha256("p:"+sessionId)[:16]>.sock`, `i-*` for Desktop threads,
`OMO_RPC_SHARD_ROOT` and the short `/tmp/omo-rpc-*` alternate root), how children inherit their tree's host through
`tree_key`/`shard_key`, why `OMO_RPC_SOCKET*` never route task children (a process launched through
`omo daemon attach` still puts its children on its own host), the `.meta.json` sidecar, the per-endpoint `stderr.log`
and `crashes.jsonl`, the 15-minute idle exit and eviction defaults, and the status/gc/handoff/stop surface including the
`unknown_identity` row. It adds Migration, a six-step Rollback runbook (quiesce, `stop --drain --all --wait` with exit 0,
zero reachable endpoints, `rollback-prepare` on this release, then R0), Pre-warm, and the Desktop contract.

The known price of isolation is stated there and in the release notes: with 4 parents x 4 children, per-session hosts
use 2.7 GB RSS and 0.8 GB physical footprint against 0.78 GB and 0.24 GB for one shared host. Idle memory is judged on
physical footprint, because RSS counts the supervisor's and the host's shared file-backed pages twice; an idle host
costs 126 MB of footprint. The measured memory and latency tables come from the shard-cost QA driver
(`task-host-e2e-shard-cost.mjs`, 20 samples per latency scenario).

User-visible changes of this release now in `CHANGELOG.md` under Unreleased: `thread_read` labels tool results as role
`tool` on the live path, matching the transcript fallback; the host crash notice names `supervisor pid N`, says
`1 child` in the singular, and its done line gains `, C cancelled` when children were cancelled; `omo daemon status`
and `omo doctor` list every host; `omo daemon gc`; `stop --all` and `handoff` cover every endpoint;
`rollback-prepare`; `omo daemon run --foreground` exits 2 because the engine host always detaches (`--persistent`
stays accepted). `AGENTS.md` files of `senpi-task`, `omo-senpi`, its `task` and `thread` components, `docs/AGENTS.md`,
`docs/guide/senpi-task.md` and `docs/reference/omo-json.md` no longer describe one machine-wide host.

## 2026-09-28 - omo adopts senpi 2026.9.28-3: a transient task daemon idle-exits again, and native tool search accepts the deferred computer tool (#9041)

Every `@code-yeongyu/senpi` pin moves from 2026.9.27-4 to 2026.9.28-3: the root devDependency, the `omo-native` dependency, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, and `bun.lock`. The release carries code-yeongyu/senpi#2242, under which `ensureHost()` holds the host for the caller until `release()` (omo releases it after the task daemon's capability probe, #9041), #2243 and #2237 (host teardown and ensure fixes), #2245 (`senpi host status --all`, `senpi host gc`, `memory_pressure`), #1519 (`/sessions` as a `/resume` alias and the thinking-level hints), #2253 (Anthropic native tool search resolves a deferred tool whose parameters are a root union, such as the desktop `computer` tool, instead of failing every request with HTTP 400), #2251 (a bare `/skill` no longer reaches the model), #2250 (`new Bun.WebView()` works in eval cells run by an RPC worker host) and #2257 (GPT-6 prompts stay on the stated goal). `packages/omo-native/bin/lib/provider-map.json` still matches the new engine's `builtinProviders()`, which `provider-map-registry.test.ts` checks against the installed package, so only its version comment changes.

## 2026-09-28 - The parent hears once when its task host crashes, and once when its children are back (#9003)

When a session's task host dies under running background children, every child already reattached on its own (re-ensure the recorded socket, reopen the session, re-prompt an interrupted turn), but the parent was told nothing. The host runner now reports each child's recovery to the session: when its transport was lost (socket, lost host generation, whether a turn was in flight) and how it ended (`attached`, `resumed`, `continued`, `lost`, `host_incompatible`, or `cancelled` when the child itself left during recovery). With the first loss it also names every live child still bound to that socket and generation, because each child's socket-close reaction runs in its own tick, and the supervisor pid it ensured for that generation. The task component coalesces these per socket and lost host generation, never by a time window. The first child that had a turn in flight produces one `host_shard_crash:<key>` line naming the shard, the supervisor pid when it is known, the signal or exit code from the endpoint's newest `crashes.jsonl` record (read once per crash, in the daemon directory the engine's own `createHostDaemonPaths` names), and how many children are reattaching. When the last of those children reports back, one `host_shard_crash_done:<key> <N> reattached: <M> continued mid-turn, <K> lost` line follows, with `, <C> cancelled` appended when a child was cancelled during recovery. Both lines go to the session's notice list, so `task_output` prints them, and to `ui.notify` (warning, then info). A TUI shows them as notice blocks, and a host-attached session forwards them as `notify` UI requests, which the Desktop renders as thread rows. A host that dies with no turn in flight is still re-ensured silently by the next spawn. The continuation prompt, the reattach backoff and the give-up semantics are unchanged, and an observer that throws cannot change recovery.

## 2026-09-28 - Crash reports name the kind of RPC host that crashed (#9003)

With one RPC host per parent session (and, in the Desktop, per thread), a crash no longer lands in one machine-wide endpoint. `process_crashed` already reads every endpoint directory's `crashes.jsonl` under `<agentDir>/rpc-host-daemon/`, and the claim fingerprint includes the endpoint directory. Two hosts' byte-identical records are therefore two reports, and each is still sent once. Each report now carries `shard_kind`: `p` for a per-session task host, `i` for a Desktop per-thread host, `none` for the legacy machine-wide endpoint or a crash outside any host, and `unknown` for an endpoint directory that names no socket. The kind comes from the endpoint's durable `endpoint.json`, or from the boot `settings.json` of a directory that predates it. A name counts only when its socket hashes to that directory. The shard key, socket path and owner session never leave the machine. The field is a flat string because the telemetry client drops object and `null` values.

## 2026-09-29 - Darwin desktop engines build on standard macOS runners, and the x64 engine launches

The two macOS rows of the `publish-platform.yml` desktop-engine matrix ran on the paid `macos-15-xlarge` larger runner; with the Actions spending limit reached, GitHub never started them and the 5.1.0 publish failed before anything reached npm. Both rows now run on the standard `macos-15` (arm64) runner; the x64 engine stays a cross-build, as it already was on the arm64 xlarge runner.

The x64 cross-build was also broken: rustc defaults `x86_64-apple-darwin` to macOS 10.12, so the engine linked the Swift back-deploy libraries through `@rpath` (`libswiftCoreMedia.dylib`) with no `LC_RPATH`, and it aborted in dyld at launch on every Intel Mac (reproduced from tag `v5.1.0` under Rosetta: exit 134). The release never ran its selftest, so nothing caught it. The engine build now sets `MACOSX_DEPLOYMENT_TARGET=11.0` (the arm64 default), which links no Swift dylib, and the x64 leg runs `--selftest` under Rosetta, installing Rosetta on the runner if it is missing.

## 2026-09-29 - `omo app-server` sessions get the OmO plugin (#9117)

`omo app-server` launched the engine without the OmO plugin, so app-server threads had only the engine's builtin tools: no `task`/`task_send`/`task_cancel`/`task_output`, no `workpool`, `memory` or `lsp_*`, and clients never received `omo.task.updated`. The launcher (and the compiled binary) now passes the plugin to `app-server` and to every `app-server daemon` verb, after the subcommand where the engine reads it (senpi #2313); the daemon records it, so `restart` keeps it. Install, auth, config and the other early commands are unchanged.

## 2026-09-28 - The auto-format notice reaches the model when post-edit diagnostics are clean (#9123)

When format-on-mutation rewrote a file after a `write`, `edit` or `apply_patch` and the post-edit LSP diagnostics came back clean, the `(OmO) auto-formatted ... re-read before exact-text edits` notice was dropped: the diagnostics step reported "nothing to add" and the LSP `tool_result` hook returned no replacement, discarding the notice the formatter step had already added. That is the default configuration and the most common outcome, so the model usually kept editing against the pre-format text. The notice now reaches the tool result whenever the formatter changed the file, whether diagnostics report errors, come back clean, or are disabled. A mutation the formatter leaves unchanged still adds nothing.

## 2026-09-29 - Adopt senpi 2026.9.28-7: app-server extensions, the host warm command, and the experimental /computer tip

Every senpi pin moves from 2026.9.28-6 to 2026.9.28-7 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, and the version comment in `packages/omo-native/bin/lib/provider-map.json`). The new engine carries:

- **`senpi app-server` loads extensions passed with `--extension <path>`** into every thread, including through `app-server daemon start|restart` (#9117, senpi #2313).
- **An RPC host can warm its prompt path without opening a session** (senpi #2314, #2318).
- **The `/computer` introduction tip says computer use is experimental** (senpi #2315, #2316).

## 2026-09-28 - Computer use says it is experimental on every user-facing surface (#9124)

OmO 5.1.0 ships computer use as experimental support, and every surface a user or model reads now says so. Only the wording changes: registration, gating, defaults, permissions and the #9049 root-object parameter schemas are unchanged (`published-parameters.fixture.json` is untouched).

- Settings: `packages/omo-config-core/src/schema/computer.ts` gives the `computer` block and `computer.enabled` a `describe()` text that starts with "Experimental", carried into `assets/omo.schema.json` by `bun run build:omo-schema`. The `enabled` description in `packages/senpi-desktop-tool/src/settings.ts` reads "Register the computer tool (experimental; default: host supported)".
- Tool: the `computer` description, `searchText` and `promptSnippet` (`packages/senpi-desktop-tool/src/tool-definition.ts`) and the `computer_actions` description and `searchText` (`cua-definition.ts`) say "(experimental)". `/computer` is described as "Computer use (experimental): on, off, status, stop, or resume (stop and resume are user-only)".
- Skill: the `computer-use` skill description opens with "Experimental computer use.", and its intro says behavior, platform coverage and settings may change between releases. The prelude facade line in `packages/senpi-desktop-prelude/docs/computer.md` reads "host desktop facade, experimental", regenerated into `src/assets.generated.json`; `test/assets.sha256.json` consciously moves only `COMPUTER_DOCUMENTATION` to the new bytes (the other four prelude assets are byte-identical).
- Docs: the computer-use guide has an experimental notice at the top and in setup, and Known limitations is grouped per OS, each marked experimental, with every earlier fact kept. The computer reference, the features section, the CLI doctor note, the Unreleased CHANGELOG headline and the README links in English, Korean, Japanese, Simplified Chinese and Russian say it too.
- The committed plugin bundles are regenerated on linux/amd64 with bun 1.4.2.

## 2026-09-28 - Adopt senpi 2026.9.28-6: GitHub Copilot Business and Enterprise requests reach the account's own host (#8662)

Every senpi pin moves from 2026.9.28-5 to 2026.9.28-6 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, and the version comment in `packages/omo-native/bin/lib/provider-map.json`). The new engine carries:

- **GitHub Copilot Business and Enterprise accounts no longer get `421 Misdirected Request` (#8662, senpi #2309, #2310).** The API host now comes from the account's own token exchange (`endpoints.api`, then the token's `proxy-ep`, then the GitHub Enterprise domain), with the individual host only as a last resort, for login, refresh, inference, `/btw`, and native web search. A 421 now says what happened and includes the GitHub request id.
- **Each RPC host supervisor uses about 12 MB less memory (senpi #2311).** The supervisor no longer loads the CLI parser or the provider model catalog.
- **The Devin model seed and SWE-2 prompt preset list only the lanes Devin serves (senpi #2306, #2308).**

## 2026-09-28 - Computer use loads its implementation on first use, not at every session start (#9113)

Every omo session paid about 20-30 ms of startup CPU for computer use even when it never touched the desktop, because the whole implementation (desktop service, engine client, handle, tool `execute`) was bundled into `extensions/omo.js`, and senpi's extension loader re-transpiles that file on every start. `omo.js` now carries only the registration shell: settings, `/computer`, the `computer` / `computer_actions` definitions (the #9049 root-object parameter schemas, unchanged), the permission parsers, the skill and the telemetry hooks. The implementation is a separate plugin entry, `extensions/omo-computer-use.js` (`#omo-computer-use-runtime`, mapped like `#omo-task-runtime`), imported on the first `/computer`, the first `tool_activated` naming a computer tool, or the first tool call. The ~29 KB of prelude and doc texts (`senpi-desktop-prelude`) moved out of the bundles entirely: they are generated into `assets.generated.json`, read once per process through memoized getters, and staged beside the bundles as `extensions/assets.generated.json` (the persona-asset contract). The published bytes are unchanged and pinned: `senpi-desktop-prelude/test/assets.sha256.json` and the plugin-side assertions in `computer-use-lazy-runtime.test.ts` keep the `computer` global, its Python twin, the declarations, the docs, the safety text, `kernelPrelude`, `promptGuidelines`, and the tool_search surface byte-identical to dev. Measured on the split alone (before the prelude JSON), the senpi importer's cost for computer use fell from +23.4 ms [+8.4, +32.9] (dev vs no-component, paired, CI excludes 0) to +9.8 ms [-0.9, +14.9]; the prelude JSON removes a further 28.6 KB of pre-terser input bytes from `omo.js`.

Every omo session paid about 20-30 ms of startup CPU for computer use even when it never touched the desktop, because the whole implementation (desktop service, engine client, handle, tool `execute`) was bundled into `extensions/omo.js`, and senpi's extension loader re-transpiles that file on every start. `omo.js` now carries only the registration shell: settings, `/computer`, the `computer` / `computer_actions` definitions (the #9049 root-object parameter schemas, unchanged), the permission parsers, the skill and the telemetry hooks. The implementation is a separate plugin entry, `extensions/omo-computer-use.js` (`#omo-computer-use-runtime`, mapped like `#omo-task-runtime`), imported on the first `/computer`, the first `tool_activated` naming a computer tool, or the first tool call. Registration still happens at extension load, so native tool search indexes both tools at `session_start`; activation by a by-name call, `setActiveTools` or `/computer on`, the disabled path, and all user-visible text are unchanged. `@oh-my-opencode/senpi-desktop-tool` gains a `./registration` entry that reaches neither the desktop service nor the engine. The eval-kernel prelude assets stay in `omo.js`: `kernelPrelude` is read synchronously by `getAllTools()` at `session_start` and the skill is written at `resources_discover`. The second `omo.json` read in computer-use registration stays too: config startup keeps no shared cache (it loads from `process.cwd()`, computer use from `pi.cwd`), and it costs about 0.3 ms.

## 2026-09-28 - Adopt senpi 2026.9.28-5: GitHub Copilot recovers from a revoked token instead of failing every model (senpi #2297)

Every senpi pin moves from 2026.9.28-4 to 2026.9.28-5 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, and the version comment in `packages/omo-native/bin/lib/provider-map.json`). The new engine carries:

- **GitHub Copilot no longer fails on every model with HTTP 403 after GitHub revokes the cached Copilot token (senpi #2297, #2302).** The token is re-exchanged once and the request re-sent before the reply starts streaming. A session recovers without `/login`, and with two Copilot logins a login that stays refused is blocked and the request moves to the other one. A Copilot 402/403 or 429 `quota_exceeded` now says whether it is a quota or a refusal and carries the GitHub request id.
- **Copilot models compact before Copilot's own prompt limit (senpi #2299).** The account's `GET /models` prompt and output limits replace the larger native limits, and `model_max_prompt_tokens_exceeded` triggers compact-and-retry.
- **Copilot turns no longer fail with a bare HTTP 400 when more than 128 tools are exposed (senpi #2298).**
- **A goal stops on the first persistent provider 401/403 instead of looping to the continuation cap (senpi #2293).**
- **The built-in OpenCode Go default model is `kimi-k3` (senpi #2295).**

## 2026-09-28 - Wayland captures without display geometry map through the libei layout or refuse coordinate input (#8957)

When the ScreenCast portal is unavailable, Wayland capture falls back to the Screenshot portal, which returns physical pixels and no display scale or layout. The frame was treated as scale 1, so on a scaled output (a 200% display returned 1280x720 pixels for a 640x360 logical desktop) a click at a screenshot pixel landed at the wrong place. A ScreenCast stream that reported no logical size was likewise treated as scale 1.

Both captures now take their geometry from the connected libei input session, whose device regions give the logical layout and per-region scale that input coordinates use. The image is accepted only when it is exactly that layout, either at logical size or at one uniform scale, within one pixel of rounding; a ScreenCast stream without a size takes the size of the region at its position under the same rule. Otherwise the capture is still returned, but coordinate input and hit tests against it are refused with a reason pointing to accessibility actions. Capture never opens an input session to learn the layout: before the first desktop input, such a frame refuses coordinate input. Pointer input through a frame derived this way is refused when the libei layout has changed since the capture.

## 2026-09-28 - Windows foreground scroll reaches the raised window (#9095)

A Windows foreground `scroll` at a point another window covered was lost. The focus guard raised the target, the cursor moved onto the point and the wheel was injected; the request reported success, yet no window received the wheel. Measured on the hosted runner: the raise changes the window order in win32k at once, but DWM's hit-testing of mouse input catches up only with the next frame it presents. A wheel inside that gap reached no window (5 ms after the raise: lost in 6 of 6 runs; 16 ms: 3 of 6), while clicks and drags were delivered. Foreground pointer input now waits for the next DWM present (`DwmFlush`, 6 to 35 ms on the runner) after the raise, which delivered the wheel in 18 of 18 runs. Before any button, drag step or wheel, the engine also reads the cursor back once the raw input thread has routed the move, falls back to `SetCursorPos` when the cursor is not within 1 px of the point, and otherwise fails with `InputFailed` without sending the button or wheel. The Windows QA driver gained foreground click, drag and scroll scenarios into a covered target from a stale cursor, #9062's same-rect scroll, and a check that the engine's desktop move lands.

## 2026-09-28 - Computer use scrolls the same distance on every OS: `dx`/`dy` are pixels (#9101)

The direction of a scroll was the same everywhere (#9055), but its unit was not: `scroll(x, y, { dy: 300 })` moved 300 pixels on macOS, 3 wheel notches on Windows (one notch per 100 units) and 300 wheel clicks on X11 (one click per unit), about a 100x difference between Windows and X11. `dx`/`dy` of every scroll, and `scroll_x`/`scroll_y` of `computer_actions` (the OpenAI computer-use rule), are now pixels on every OS, and one wheel notch stands for 40 px. Windows sends one notch per 40 px and X11 one click per 40 px (rounded half up, at least one for any motion; X11 still caps an axis at 1000 clicks); Wayland sends 3 libei 120ths of a click per pixel (120 per 40 px) instead of 120 per unit. macOS already posted pixel scroll events and is unchanged.

This changes what users see on Windows, X11 and Wayland: `dy: 120` is now 3 notches on Windows (1 before), 3 clicks on X11 (120 before) and 360 libei units on Wayland (14,400 before). A caller that passed small notch-style counts such as `dy: 3` now gets one notch or click instead of three. The declarations, the eval docs, the `computer_actions` schema and the computer-use guide and reference state the unit. The Windows and X11 desktop QA scroll scenarios now scroll by 120 px and assert that the view moved between 60 and 240 px, measured from each fixture's own line height.

## 2026-09-28 - Computer use scrolls the same direction on every OS (#9055)

A positive `dy` scrolled up on macOS but down on X11 and Windows, so the same `scroll(x, y, { dy })` call, and every `computer_actions` scroll from an OpenAI computer-use model (`scroll_y`), went the wrong way on macOS; at the top of a document it did nothing. The macOS backend now negates Quartz's wheel deltas, so on every OS a positive `dy` scrolls down and a positive `dx` scrolls right. The model-facing docs, the declarations and the `computer_actions` schema state the convention. The Windows and Linux (X11) desktop QA jobs now scroll a long document in a task-owned window both ways and read its top line (and on X11 its left column) from the window itself rather than from the engine: X11 with foreground and background delivery, Windows with background delivery. Windows foreground delivery is not in the job yet, because the engine's foreground pointer input never reaches the target on the hosted runner (#9095).

## 2026-09-28 - Adopt senpi 2026.9.28-4: Claude subscription stays signed in across sessions (#8762)

Every senpi pin moves from 2026.9.28-3 to 2026.9.28-4 (root devDependency, `omo-native`, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, `bun.lock`, and the version comment in `packages/omo-native/bin/lib/provider-map.json`). The committed plugin bundles pass `build-extension.mjs --check` against the new engine unchanged. The new engine carries:

- **Claude subscription no longer ends up "blocked until re-login" when several sessions run (#8762, senpi #2225, #2282, #2223).** A token refresh by any session revoked the token that other sessions' live Claude Code processes were still using; their next turn got `401 OAuth access token has been revoked`, and the account was stamped `auth_error` on its fresh, valid token, which stopped every session until `/login`. Live sessions now resume on the refreshed token, a 401 on a token another session already replaced retries once on the stored token instead of blocking, and each request reports the token it actually sent even when sessions share one process. A session that finds `auth.json` busy while another refreshes keeps its still-valid token or picks up the new one, and a throttled, failing or timed-out token refresh no longer blocks the account; only a rejected login does. `/login` into an existing account name now replaces the revoked token instead of silently keeping it.
- **First message no longer fails on providers that only accept `tool_choice: "auto"` (#9096, senpi #2218, #2224).** The first-turn `todo` forcing is retried once without the forced choice when the provider refuses it, on both chat completions and responses APIs, and is not forced again for that model; `compat.supportsForcedToolChoice: false` skips it from the start.
- **One session can no longer stop an RPC host handoff drain (senpi #2288).** Once this ships in an omo release, the production RPC host stopgap guard can be removed.
- **Runtime error output stays off the interactive TUI screen (senpi #2289).**
- **Child processes of retired eval workers are collected, and orphans are reaped in every mode (senpi #2278).**
- **Durable scheduled prompts that also work from `--print` (senpi #2216).**

## 2026-09-28 - macOS foreground actions restore the app the user had in front (#9084)

With another app's floating panel on screen, a macOS foreground action restored the wrong app and still reported `focusRestored: true`. The focus guard captured the "previous front" app from WindowServer's front process (added in #9057), which can be an accessory app that only shows a floating panel, while System Events and the menu bar still name the user's app. It then restored that panel owner, the call returned `Ok`, and the user's app never came back. The engine's in-process `NSWorkspace.frontmostApplication` is also stale (it has no AppKit run loop), and `with_foreground` restored through it.

The user's front app is now read live as the first regular ("Foreground") app in LaunchServices' front-to-back order, the list `lsappinfo visibleProcessList` shows. Without that SPI it falls back to WindowServer's front process when it is a regular app, then to the owner of the front-most on-screen normal window of a regular app. The focus guard's capture, the background hand-back, `with_foreground` and its activation gate all use it. A restore activates the app through accessibility (`AXFrontmost`) and AppKit and counts only once that app has stayed front for 250 ms within 1.5 s, asking again if a later activation takes the front back; otherwise the action reports `FocusRestoreFailed` and `focusRestored: false`.
## 2026-09-28 - A macOS background scroll moves the requested amount once (#9097)

A background scroll on macOS moved its target twice as far as a foreground scroll of the same delta: `scroll()` posted the wheel event through SkyLight and through the public per-pid queue, and AppKit and WebKit applied both. It now takes the SkyLight route alone, as keyboard events already do. Measured on this change: TextEdit moves 6 lines for both deliveries (13 in background before), and a WKWebView moves 90 px (180 before). The macOS live QA driver gains `background-scroll-once`, which fails when a background scroll moves a different amount from a foreground one.

## 2026-09-28 - omo adopts senpi 2026.9.28-3: a transient task daemon idle-exits again, and native tool search accepts the deferred computer tool (#9041)

Every `@code-yeongyu/senpi` pin moves from 2026.9.27-4 to 2026.9.28-3: the root devDependency, the `omo-native` dependency, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, and `bun.lock`. The release carries code-yeongyu/senpi#2242, under which `ensureHost()` holds the host for the caller until `release()` (omo releases it after the task daemon's capability probe, #9041), #2243 and #2237 (host teardown and ensure fixes), #2245 (`senpi host status --all`, `senpi host gc`, `memory_pressure`), #1519 (`/sessions` as a `/resume` alias and the thinking-level hints), #2253 (Anthropic native tool search resolves a deferred tool whose parameters are a root union, such as the desktop `computer` tool, instead of failing every request with HTTP 400), #2251 (a bare `/skill` no longer reaches the model), #2250 (`new Bun.WebView()` works in eval cells run by an RPC worker host) and #2257 (GPT-6 prompts stay on the stated goal). `packages/omo-native/bin/lib/provider-map.json` still matches the new engine's `builtinProviders()`, which `provider-map-registry.test.ts` checks against the installed package, so only its version comment changes.

## 2026-09-28 - macOS foreground pointer input refuses a covered point (#9079)

A macOS foreground click, move, drag or scroll raised the target window and waited until it was key, but never checked which window was frontmost at the point. A window of another application that stays above normal windows (a floating panel or an always-on-top utility) received the input, and the engine reported success. Before posting, each point the event hits (a drag's first and last point) is now hit-tested through accessibility. If another window covers a point, the target is raised once more; if it stays covered, or the owner at the point cannot be identified, the action is refused and nothing is posted.

## 2026-09-28 - Windows desktop QA teardown no longer kills or reports recycled pids (#9087)

The Windows interactive-desktop QA teardown tracked processes by pid alone. Windows reuses pids quickly, so after a tracked engine exited, an unrelated runner process could take its pid; teardown then reported it as a leftover (`procs 1 alive`, a red job) and ran `taskkill /T /F` on it. Teardown now records each tracked process's image name when it is tracked, and kills or counts a pid only while it still runs that image.

## 2026-09-28 - Computer use names the musl engine host and skips the glibc download (#9076)

On a musl Linux distribution such as Alpine, `getDesktopEngineHost()` returned `linux-x64`, so computer use downloaded and cached the glibc engine, which cannot execute there, and then failed to start without saying why. The host now names the libc on Linux: a musl process resolves to `linux-x64-musl` / `linux-arm64-musl`, the locator searches `native/prebuilds/linux-<arch>-musl/`, and because no musl engine is published the acquisition makes no request and returns the `native-unavailable` diagnostic "No desktop engine release asset exists for linux-<arch>-musl". The libc is read from the running process, not from what is installed: glibc builds of Bun report `process.report.getReport().header.glibcVersionRuntime` and musl builds omit it, and musl additionally requires the musl loader to be mapped in `/proc/self/maps`, so a glibc host with musl-tools installed stays `linux-<arch>`. `getDesktopEngineHost(platform, arch, libc)` takes the libc as an optional third argument and detects it only for the Linux platform the process runs on; an explicit host string passed to `acquireDesktopEngine` keeps its libc. glibc Linux, macOS and Windows hosts are unchanged.

## 2026-09-28 - `omo doctor` no longer fails or downloads for users who never started computer use (#9059)

Computer use is on by default, so `omo doctor` probed its engine for every user. When no engine was installed it downloaded one from GitHub releases, even in offline mode, and when that failed it printed `FAIL computer use engine` and exited 1, although the same doctor exited 0 before computer use existed. Doctor no longer installs anything: with no engine located and no `computer.engine_path`, it reports that the engine is downloaded the first time computer use starts, lists the paths it checked, and leaves the exit code alone. A configured `engine_path` that is missing or not executable, a quarantined binary, and a located engine that fails its handshake still fail doctor.

## 2026-09-28 - `omob` builds the desktop engine it embeds (#9063)

Since compiled binaries embed the Rust desktop engine, `omob` failed at its last step with `missing required desktop engine for <target>`: `build-omo-binary.ts` stages `target/<triple>/release/senpi-desktop-engine`, but only the release workflows ran cargo. `build-omob.ts` now builds it in the omo cache clone with the release flags (`cargo build --release -p senpi-desktop-engine --locked --target <triple>`, output pinned to the clone's `target/` whatever `CARGO_TARGET_DIR` says) when the binary is missing or `crates/`, `Cargo.toml`, `Cargo.lock` or `rust-toolchain.toml` changed since the last engine build. A stamp beside the binary records that tree fingerprint and the binary's size and mtime, so a rebuild with no engine change skips cargo. Without cargo the build stops with one line naming the missing Rust toolchain. Targets that ship no engine, and omo refs that predate it, skip the step. Feature builds (`--name`) take the same path.

## 2026-09-28 - AX coordinate clicks go to the element's own window (#8959)

`ax.click` clicked an element's centre in the first listed window whose rectangle held that point, so a window overlapping the element's own window, or listed before it, could receive the click. The accessibility backends now report an element's owning window (`AxBackend::owner`): macOS reads `AXWindow` and its CGWindowID, Windows walks UI Automation up to the top-level window handle, AT-SPI on Wayland returns the element's frame (Wayland lists frames as windows), and the fake backend returns the window whose tree holds the node. AT-SPI on X11, whose window ids AT-SPI cannot name, joins the element's frame to an X window by its application's pid (`_NET_WM_PID`), then tells that pid's windows apart by exact title and frame geometry (within 160 px of edge difference, and 24 px clearer than the runner-up, as cua does); title and geometry must agree. `owner` receives the live window list for this. The click targets the owner after checking it is still listed and still contains the centre. When the owner cannot be named, `ax.click` refuses with `AxFailed` and points to `ax.perform` or a screenshot-coordinate click; it no longer falls back to geometry. On X11 that happens when the frame's application reports no pid or no listed window carries it, when same-pid windows share a title and sit within the margin (or report no usable extents), and when title and geometry point at different windows. No pointer event is sent on any refusal. Semantic AX actions are unchanged.

## 2026-09-28 - macOS computer use keeps the user's newer front app (#9056)

After a background `type` or `press`, the macOS engine handed key focus back to the application that was front before the action, even when the user had switched to another application in the meantime. It read the front application from `NSWorkspace.frontmostApplication`, which in the engine (no AppKit run loop) can keep reporting an application the user already left. The front application now comes from WindowServer (`_SLPSGetFrontProcess`), with AppKit only as a fallback, and the hand-back leaves the front alone when a third application is front: the user's newer choice wins, as on X11 and Windows. Without a user switch the previous application is still restored.

## 2026-09-28 - Computer use reads and writes the clipboard (#9009)

The `clipboard.read` and `clipboard.write` engine methods were advertised by the SDK and the schema but answered "not implemented". They now reach the session: reading is a read-only request, writing goes through the same gate and single input transaction as other input (suspension, a live stop path, input permission, cancellation) and emits one audit record carrying only the text's length and digest, never the text. The macOS, X11, Wayland and Windows backends share one UTF-8 text clipboard in `senpi-desktop-core` (feature `system-clipboard`); on Linux one clipboard handle lives for the process so the text stays served after the write returns. A clipboard holding no text reads as the empty string. The desktop contract CI runs a live round-trip on the hosted macOS, Windows and Linux (Xvfb) runners.

## 2026-09-28 - `computer_actions` activates with `computer` (#9048)

With `computer.cua_adapter: true`, activating computer use (`/computer on`, a by-name call or a `tool_search` promotion) added only `computer` to the active tool set, and `/computer off` removed only `computer`. A provider without native deferred-tool search declares only active tools in its request, so an OpenAI computer-use model could find `computer_actions` through `tool_search` but never call it. Both tools now join and leave the active set together; without the adapter only `computer` moves, as before. The computer-use QA driver gained a scenario that records the tools each request declares and checks that the request after activation carries `computer_actions`.

## 2026-09-28 - X11 computer use keeps offscreen frames and newer user state (#8974)

Partially offscreen X11 windows now keep a full-size capture frame with transparent pixels for the off-root area, so an unchanged window remains targetable from its screenshot instead of being misclassified as resized. Keyboard text, chords and XTEST modifiers read the current server keymap once per operation, so runtime layout changes no longer require reconnecting.

Foreground delivery now confirms core X focus as well as EWMH active-window state. On a non-EWMH server it uses a core-focus fallback, delivers to the requested window, and restores the previous focus. Both the input-local guard and the shared session restore hooks preserve a newer user focus or pointer choice instead of replaying an older snapshot over it.

Filtering toolkits still receive a truthful background-unavailable refusal. The supported Linux QA stack exposes XInput and XTEST but has no writable `/dev/uinput`, and a bounded Xvfb hierarchy probe did not establish an isolated real-input route; MPX support therefore remains a separate real-Xorg/uinput feature rather than an inferred fallback.

## 2026-09-28 - Computer tools publish a root object schema (#9047)

The `computer` and `computer_actions` tools used to publish a root-union JSON schema. Anthropic native tool search sends a deferred tool's schema as-is, so every request with the `computer` tool deferred failed with `400 tools.N.custom.input_schema.type: Field required` (senpi #2252). OpenAI strict function schemas and Gemini also reject a root union. Both tools now publish one root object with an `action` enum and every action's fields as optional, and each field's description names the actions that take it. `execute` still checks the exact per-action shape, including every batch item, and refuses a missing, extra or mistyped field with `COMPUTER_INVALID_ARGUMENTS`, naming the action and the field, before any engine starts. Valid calls behave as before.

## 2026-09-28 - Boulder plan progress counts every task format and stops on 0/0 (#9019, #6233)

The plan parser in `packages/boulder-state/src/plan-checklist.ts` now counts `T1.2`, `T6.3a`, `F1` and `H1` task IDs written with a `.`, space, `-` or em-dash separator. When the canonical `## TODOs` / `## Final Verification Wave` sections hold no task rows but checkboxes sit under another heading, it falls back to every top-level checkbox. A `- [~]` row, which the continuation directive uses for a task blocked on the user, counts toward the total as in-progress: it is neither completed nor remaining. Progress no longer reads `1/1` when one of two tasks is blocked, and a plan whose open work is all blocked still ends continuation.

OpenCode's idle continuation, its pending retry and the `oh-my-opencode run` continuation check now treat a plan with no countable tasks as nothing to continue, as Senpi and Codex already did. Before, a prose or heading-only plan produced the `0/0` continuation directive on every idle. The plan-format validator judges rows with the counter's own grammar (`isStructuredTaskRow`), so it no longer warns that `T1.1` rows will be skipped, and the Codex Stop hook's parser copy matches the shared grammar. Across 159 real plan files, the only totals that change are two plans that read `0/0` before.

## 2026-09-28 - Session search finds prompts in the middle of a session (#9012)

`find`/`search` in the `coding-agent-sessions` skill used to match only session metadata and the first and last user prompts, so a query that appeared only in a middle prompt returned nothing even though `read` showed it. Scanners that already read the whole transcript (OmO/Senpi, oh-my-pi, gajae-code, Claude, Codex rollouts, OpenClaw, Qwen, Droid, Kimi, Aside) now keep every user prompt they parse, and search reports such a hit with the match reason field `user_message`. A Codex thread listed from the state database searches the prompts of its scanned rollout. The search adds no file reads, so a miss-heavy query costs the same as before. Claude subagent transcripts and Codex threads beyond the 2000 newest rollouts keep metadata and first/last-prompt search.

The entrypoint now exits with status 2 and a message naming the required Python 3.11+ and the interpreter it found, instead of failing with `ImportError` on an older `python3`.

## 2026-09-28 - macOS foreground input lands in the target window (#9008)

`delivery: "foreground"` clicks and keys on macOS used to report success while the target app ignored them. The engine fronted the process through SkyLight (`_SLPSSetFrontProcessWithOptions`), which makes it front to WindowServer and AX but leaves the app inactive in AppKit, so every click was consumed as an activation click. Foreground delivery now activates the app through accessibility (`AXFrontmost`) and AppKit, waits for `NSRunningApplication.isActive`, and waits until the target window is the app's focused main window. Only then does it post input. If the app never becomes active, nothing is posted and the call fails with `InputFailed`. The previous front app is still restored through SkyLight and AppKit.

## 2026-09-28 - macOS QA checks both canary policies (#8893)

The live macOS harness (`script/qa/desktop/macos.ts`) gains a `canary-off` scenario next to `canary`. Both drive the packaged OmO component through a real Senpi session and make two background inputs to TextEdit. `canary` runs `computer.macos_canary: "session"` and expects exactly one canary dialog; `canary-off` runs `"off"` and expects none. Both inputs must succeed in each case. The dialog count comes from the harness's independent System Events observer, not from the engine, so the pair would fail if the observer missed a dialog or if the policy were ignored.

## 2026-09-27 - Computer use honors the macOS canary policy (#8945)

`computer.macos_canary` now reaches the native session and macOS backend instead of being discarded by the TypeScript request builder. The wire accepts `session` and `off`, defaults to `session`, and rejects unknown values. Backend reconstruction receives the current policy, including when a session is reconfigured. The engine schema and shipped OmO extension are regenerated.

## 2026-09-27 - Stop in-flight desktop typing before the remaining characters (#8937)

The macOS physical stop chord previously latched the supervisor while an active `typeText` kept posting the entire text, then reported `Suspended` only after the backend returned. Desktop text delivery now checks suspension and request cancellation between Unicode scalars inside each native backend's single input call. An interrupted request releases held input, keeps the existing single admission and focus-restoration transaction, and audits both the requested and fully delivered scalar counts without recording the text.

## 2026-09-27 - macOS computer focus guard preserves the visible window (#8925)

The macOS engine now captures the frontmost application's first on-screen layer-0 WindowServer window instead of assuming its AX-focused window is visually on top. Foreground delivery passes that captured window to SkyLight; when the foreground SPI is unavailable, it retains the existing public app-activation fallback. Synthetic window-order tests reject off-screen, non-normal-layer, and other-process windows. Window enumeration no longer cuts off after 48 windows, so a target behind many other windows remains addressable.

Background clicks keep the user's frontmost app, visible front window, focused window, cursor, and next-keystroke destination. The target can move directly beneath the front window; macOS QA records that rank without treating it as a focus failure, and foreground sabotage still fails the invariant. The guide, tool reference, and model-facing computer guidance describe the same accepted behavior.

## 2026-09-27 - OmO Native records privacy-safe computer-use outcomes (#8940)

OmO Native telemetry now measures whether computer use activates, what blocks it, and which desktop-engine failures occur without exporting desktop content. Three strict events use only closed vocabularies:

- `computer_use_activation`: active/inactive, source (`tool_call`, `/computer on`, `/computer off`), platform and backend.
- `computer_use_permission_denied`: OS capability (`capture`, `input`, `ax`) or OmO permission tier (`read`, `exec`), plus platform and backend.
- `computer_use_engine_error`: the frozen engine error code, startup diagnostics (`native-unavailable`, `quarantined`, `abi-mismatch`), or `other`.

The computer-use adapter publishes through the existing OmO Native telemetry client, so every existing environment, config and component opt-out disables these events too. Session ids remain salted hashes. Screenshots, window and application names, coordinates, typed text, tool code and arguments, permission feedback, paths, error messages and recovery hints never enter an event.

## 2026-09-27 - The computer-use skill says when to stop and ask (#8941)

The `computer-use` skill that `materializeComputerSkill()` writes (`packages/senpi-desktop-tool/src/skill.ts`) was the helper reference plus the safety block. It now opens with the two decisions the reference did not cover: read `computer.capabilities()` before the first action and, when a permission the task needs is not `granted`, name it (on macOS, Screen Recording or Accessibility for the launching app) and stop instead of working around it; and ask the user when the target is ambiguous or an action still fails after a fresh observation.

## 2026-09-27 - The computer-use QA proves tool_search discovery (#8893)

`computer-use-e2e.mjs` now also drives the path a model takes to a deferred tool. It runs `tool_search` for a desktop-control capability, calls the matched `computer` tool by name, and confirms the eval `computer` global. It passes 5 of 5 against senpi 2026.9.27-2, and the check fails when the query cannot match.

## 2026-09-27 - Computer use acquires its engine for npm installs (#8893)

`omo-ai` installed from npm ships no native binaries. So the `computer-use` component used to report `native-unavailable` unless the engine had been built locally.

The component's default engine source is now `packages/omo-senpi/src/components/computer-use/engine-source.ts`:
- `computer.engine_path` still wins.
- Under an OmO launch, it acquires the engine for OmO's own release. That version comes from the compiled runtime's stamped manifest (`OMO_PACKAGE_DIR`) or from the `omo-ai` package the npm launcher runs from (`OMO_BIN`).
- Acquiring means the local sidecar or prebuild first, then the checksum-verified GitHub release download. `acquireDesktopEngine` (#8923) caches the result.
- Anything else keeps the synchronous locator.

`senpi-desktop-service`'s `ChildFactory` may now resolve asynchronously. The new `acquiringEngineChildFactory` acquires once and reuses the path. When acquisition finds no engine, it rejects with `DesktopEngineUnavailableError` carrying the acquisition diagnostic and spawns nothing.

## 2026-09-27 - Desktop engine binaries join the OmO release channels (#8893)

The compiled OmO binaries stage `senpi-desktop-engine` inside their extracted runtime on supported macOS, glibc Linux x64 and Windows x64 hosts. The locator checks that runtime before the executable directory, while targets without an engine still report `native-unavailable`. The release workflow builds and uploads the engine binaries with checksums. An independent asynchronous API can acquire and verify the corresponding asset into a versioned cache for npm installs; hooking that API into the computer-use component follows the separate component PR.

## 2026-09-27 - Computer-use QA harnesses and OmO documentation (#8893)

The desktop engine's Windows, Linux and macOS QA drivers now live in OmO under `script/qa/desktop/`, alongside the executable Windows PR workflow. Windows runs seven scenarios plus a deliberate sabotage check. Linux covers the source harness's four X11 and three Wayland scenarios, with isolated provisioning and teardown. The macOS driver exercises the real Senpi binary with OmO's computer-use component and supplies a non-live self-test for hosts without an unlocked graphical console.

The root Cargo pin guard now runs with the desktop package tests, and the bunshin desktop capability installer discovers OmO's engine location. The Native computer-use guide and tool reference describe `omo.jsonc`, permission tiers, the eval global, `/computer`, engine lookup and `--mcp` without the unpublished senpi desktop packages.

## 2026-09-27 - omo adopts senpi 2026.9.27-2 (#8893)

Every `@code-yeongyu/senpi` pin moves from 2026.9.27 to 2026.9.27-2: the root devDependency, the `omo-native` dependency, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, and `bun.lock`. The release carries the generic extension hooks that the computer-use component relies on:
- `ToolDefinition.kernelPrelude`, which puts `computer` into the eval kernels.
- `ToolDefinition.permissionParser`, which lets the read and exec permission tiers gate the tool.
- The `tool_activated` event.

It also fixes session rebinding after a repository moves, fork-confirmation answers, and several pty issues. `packages/omo-native/bin/lib/provider-map.json` still matches the new engine's `builtinProviders()`, which `provider-map-registry.test.ts` checks against the installed package, so only its version comment changes.

## 2026-09-28 - omo adopts senpi 2026.9.27-4: task children are never refused for host memory, and a handoff host no longer inherits the caller's session (#8960)

Every `@code-yeongyu/senpi` pin moves from 2026.9.27-3 to 2026.9.27-4: the root devDependency, the `omo-native` dependency, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, and `bun.lock`. The release carries code-yeongyu/senpi#2213, which removes the RSS admission refusal so opening a child session is never refused for host memory, and adds `host_rss_mb` to host status, measured from the OS rather than Bun's process counter. It also carries code-yeongyu/senpi#2220, under which `host handoff` launches the successor from the binary runtime's launch spec with the caller's session variables stripped, bumps the generation exactly once, and lets running parents follow the new generation without a restart. The release also removes senpi's leftover desktop engine crates and packages (code-yeongyu/senpi#2231); omo's computer use already lives in its own workspace packages. The fallback circuit breaker (code-yeongyu/senpi#2201) was reverted before the release (code-yeongyu/senpi#2228, Windows host-lifecycle regression, code-yeongyu/senpi#2227), so it does not ship. `packages/omo-native/bin/lib/provider-map.json` still matches the new engine's `builtinProviders()`, which `provider-map-registry.test.ts` checks against the installed package, so only its version comment changes.

## 2026-09-28 - omo adopts senpi 2026.9.27-3: starting omo no longer empties an upstream pi install (#8039)

Every `@code-yeongyu/senpi` pin moves from 2026.9.27-2 to 2026.9.27-3: the root devDependency, the `omo-native` dependency, the `omo-senpi` and `senpi-task` peer and dev pins, their pin tests, and `bun.lock`. The release carries code-yeongyu/senpi#2215: the first start copies `~/.pi/agent`, `~/.pi/mom` and a project's `.pi` into `~/.omo` instead of moving them, so pi keeps working next to omo, and a pi install that an earlier start already drained gets its settings, credentials, sessions and extensions copied back into `~/.pi/agent` on the next start. It also carries the RPC open-session fixes (senpi#2209, #2206) and the structured `providerDiagnostic` on failed provider turns. `packages/omo-native/bin/lib/provider-map.json` still matches the new engine's `builtinProviders()`, which `provider-map-registry.test.ts` checks against the installed package, so only its version comment changes.

## 2026-09-27 - Committed conflict markers fail the root suite (#8919)

Merge resolutions had left twelve `||||||| <base>` diff3 lines as content: one in `changes.md`, three in `packages/omo-native/changes.md` and eight in `packages/omo-senpi/changes.md`. They are gone, and every tracker keeps all of its entries (128, 17 and 96 headings). `script/conflict-markers.test.ts` now scans every tracked text file in the root `bun test` and fails with `path:line` on a line that opens (`<<<<<<< `), bases (`||||||| `) or closes (`>>>>>>> `) a conflict. A bare `=======` is allowed, because it is a Markdown setext underline, and binary and untracked files are skipped.

## 2026-09-27 - memory usage ledgers resolve the session from the tool callback context (#8864, #8865)

`registerSkillsUsage` and `registerMemoryUsage` (`packages/omo-senpi/src/components/memory/{skills,memory}-usage-wiring.ts`) passed the `tool_call` event to `resolveContext`. Senpi hands a handler the event first and the session-bound extension context second, and only the context carries `sessionManager`, so `sessionIdFrom` returned `undefined`, no tracker was ever created, and `runtime/skills-usage.json` / `runtime/memory-usage.json` never existed: every dream run received `{}` for both. Both recorders now resolve from the second argument, like every other `tool_call` / `tool_result` handler in the package. `usage-ledgers-wiring.test.ts` registers the real memory component and asserts both ledger files after a quitting shutdown; it fails on the previous code. Fix by @MoerAI.

## 2026-09-27 - omo-senpi ships desktop computer use (#8893)

A new `computer-use` component registers the `computer` tool from the moved `@oh-my-opencode/senpi-desktop-*` packages:
- It is search-exposed, so tool_search finds it for desktop tasks, and it starts nothing until it is activated.
- It exposes a `computer` global in the eval kernels while it is active.
- Its read and exec tiers are gated by permission rules such as `computer:exec=deny`.
- `/computer` turns it on or off, reports status, and stops or resumes input (user-only).
- `computer_actions` (OpenAI computer-use actions) is added when `computer.cua_adapter` is set.

Settings live in a new `computer` block of the omo config: `enabled`, `display`, `max_width`, `max_height`, `screenshot_max_bytes`, `stop_hotkey`, `allow_host_relay_only_stop`, `macos_canary`, `audit_log`, `screenshot_gc`, `engine_path` and `cua_adapter`. It is native-only and included in the generated schema. The tiers and the eval global use senpi's new tool hooks (code-yeongyu/senpi#2178), and an older senpi ignores them.

`scripts/qa/computer-use-e2e.mjs` proves this on the real surface with the real engine's fake desktop backend: the screenshot passes an exec deny, the click is refused before the engine, the allowed click is audited, and `eval` sees the global. The bundle budget rises to 1,420,000 bytes for this first-party code, with no new third-party dependency.

## 2026-09-27 - The desktop computer-use TypeScript packages move into omo (#8893)

The five packages that sit between a harness and the `senpi-desktop-engine` binary move from senpi as private `@oh-my-opencode/senpi-desktop-*` workspaces:
- `-protocol`: the JSON-RPC wire types, generated from the engine schema.
- `-engine`: the locator, the ABI handshake and the bunshin descriptor.
- `-prelude`: the `computer` eval global.
- `-service`: the engine child client and the `computer.run` runtime.
- `-tool`: the `computer` tool, its permission tiers and the `/computer` command.

None of them imports senpi. They export their sources directly like the other omo core packages, and senpi's vendored macOS engine prebuild is not carried over, because the locator falls back to the workspace's `target/release` build and platform packages will ship the binary. Each package keeps its vitest suite, excluded from the root `bun test` and run as `bun run test:desktop`: protocol 16, engine 67, prelude 27, service 24 and tool 57. The tool suite's three rule-evaluation cases moved to the upcoming omo-senpi component, where they run through senpi's public permission hook instead of senpi's internals. `desktop-engine.yml` now also runs `test:desktop` against the engine it builds on macOS, Ubuntu and Windows.

## 2026-09-27 - The desktop computer-use engine moves into omo as a Rust workspace (#8893)

Computer use ships from omo, not as separate senpi packages. This step brings over the engine: the ten `crates/senpi-desktop-*` crates, the fake, macOS, X11, AT-SPI, Wayland and Win32 backends, the safety gate, sessions, and the `senpi-desktop-engine` JSON-RPC binary with its `--serve`, `--oneshot`, `--resume` and `--mcp` modes. They come from senpi unchanged (the file trees match byte for byte). The root `Cargo.toml` holds the desktop-only subset of senpi's exact dependency pins, and `Cargo.lock` is pruned to it. `.github/workflows/desktop-engine.yml` runs clippy (`-D warnings`), the tests and a release build on macOS, Ubuntu and Windows, plus the Linux X11 and AT-SPI display tests, whenever `crates/**` or the Rust manifests change. The TypeScript packages, the omo-senpi component and binary delivery follow in later PRs.

## 2026-09-27 - writing drops Claude Fable 5.1 and leads with Claude Opus 5.5 low (#8907)

The `writing` chain was `claude-fable-5-1 (low)` -> `claude-opus-5-5 (low)` -> `claude-opus-4-6 (max)`. The Fable rung is removed, so the chain is `claude-opus-5-5 (low)` -> `claude-opus-4-6 (max)` with unchanged provider lists. Both definitions move together: `packages/senpi-task/src/category/fallback-chains.ts` and its mirror `packages/model-core/src/category-model-requirements.ts`, plus the builtin single-model config in both `kimi-categories.ts` files (`anthropic/claude-opus-5-5`, `low`). The Claude-only contract from #8723 is unchanged, so a registry whose only Claude model is Fable 5.1 now leaves `writing` unavailable. Pinning tests move with the chain, `dead-chain.test.ts` asserts that a Fable-only registry no longer opens `writing`, and `model-requirements-categories.test.ts` asserts Fable is not a `writing` rung. Docs tables and examples (`docs/guide/agent-model-matching.md`, `docs/guide/overview.md`, `docs/reference/configuration.md`, `docs/reference/features.md`, `docs/examples/{default,planning-focused}.jsonc`, `packages/omo-opencode/src/tools/AGENTS.md`) and the regenerated omo-senpi plugin bundles carry the new chain.

## 2026-09-24 - omo doctor and omo setup show which task categories your providers serve (#8858)

A user who migrated with one subscription found out that a task category had no usable model only when a spawn failed (a zai-only machine serves 1 of the 10 builtin categories, an anthropic-only one 7). `omo doctor` now prints a categories line computed from the model list the pinned engine would use for this user: its ModelRuntime over `auth.json`, `models.json` custom providers and provider env keys, read-only, no network, nothing written. When every category is served that is one `PASS task categories: all N usable ...` line; otherwise a `WARN` line with the usable set plus one `WARN` line per unusable category, naming the unconnected chain providers and the two fixes (`/login <provider>`, or pin `categories.<name>.model` in omo.json), in the category-unavailable notice's wording. The `omo setup` summary gets a `categories` row for the plan it is about to apply (the keys and custom providers it imports and the category pins it writes), so a migrant sees it while deciding what to log into. Classification is the spawn path's own resolver (`resolveCategoryCoverage` in `packages/senpi-task/src/category/coverage.ts`, over `resolveAvailableCategoryNames` and the resolver's missing-provider list); the plain-JS launcher reaches it through `plugin/runtime/category-coverage/index.js`, which `build:omo-native` bundles from `packages/omo-native/category-coverage-entry.ts`. Any failure prints no line and omits the row. Details in `packages/omo-native/changes.md`.

## 2026-09-24 - "Migrating from OpenCode" guide for users moving to OmO Native (#8856)

A user coming from the OpenCode edition (oh-my-openagent 4.19.x or a 5.x beta) had to assemble the move from five places. `docs/guide/migrating-from-opencode.md` now tells it once, one command per step: how to tell the legacy package still owns the global `omo` (`omo --version` prints `4.19.4`), the installer line every surface advertises (`bunx oh-my-openagent@beta install --platform=native`) and what it repairs (the one stale `omo` file, never the package), what `omo setup` carries over (API keys, custom providers, MCP servers, global skills, the default model and category/agent choices), what needs `/login` (OAuth logins), what it refuses (command-substitution MCP servers, skill dirs without `SKILL.md`) and what is not carried (`small_model`, OpenCode's `build`/`plan`, agent names omo does not have, OpenCode UI settings and permissions), the habit mapping to the pinned engine's real commands and keys (`/models` -> `/model`, `/connect` -> `/login`, `/sessions` -> `/resume`, `@file`, `!command`, `Shift+Tab` cycles thinking instead of switching agents), how `omo doctor` reports a plugin OpenCode still loads, that omo's first session moves a 4.19.x plugin's `oh-my-openagent.json[c]` into `~/.omo/migration-backup-*` (copy it back to keep that plugin configured), and the update/uninstall order (remove the legacy package with the manager that installed it; `npm uninstall -g oh-my-openagent` takes an npm-installed omo-ai's `omo` with it; `bun remove -g omo-ai` leaves the launcher shim to delete by hand). The installation guide's OmO Native section, the README OmO Native paragraph and each localized README link to it, and `NATIVE_EDITION_GUIDE_URL` (the in-session `/native` dialog's "Open the guide" and the installer's post-install hint) now points at the new page instead of the installation-guide anchor.

## 2026-09-24 - omo setup prints one migration summary and asks one consent for the whole plan (#8851)

`omo setup` used to open with an internal `HARNESS | INSTALLED | PROVIDERS | CREDENTIAL TYPES | MODELS` table (rows for harnesses the user never installed), a "MODEL AVAILABILITY" block whose model column was always `none`, a generic `omo.json` template, and then a separate preview and `[y/N]` question per asset class. It now builds every stage's plan first (credentials, MCP servers and skills, custom providers, model choices; nothing is written while planning) and prints ONE summary in the user's terms: which harnesses it found (installed ones only), then a `logins` row (API keys to import, OAuth logins to redo with `/login <provider>`, keys for providers omo does not serve), `MCP servers` and `skills` rows (imported / refused / skipped, each with its reason), a `providers` row and a `model choices` row (default model, categories, agents), the notes, the installer's anonymous-telemetry line (`OMO_SEND_ANONYMOUS_TELEMETRY=0` / `OMO_DISABLE_POSTHOG=1`) once, and one `Import all of the above into ~/.omo? [Y/n]`. `--yes` prints the same summary and proceeds; `--dry-run` prints it plus the `planned-*` lines and exits; `--ask-each` restores one question per class. The placeholder template only appears when nothing importable was found. What each stage writes is unchanged (the synthetic OpenCode power-user fixture produces byte-identical files before and after this change), and the machine counters (`imported: N`, `mcp-imported: N`, `providers-imported: ...`, `model-choices-carried: ...`) now come in one block after the import. Details in `packages/omo-native/changes.md`.

## 2026-09-24 - omo setup carries OpenCode model choices into the native harness (#8846)

A migrating OpenCode user kept their credentials but lost every model choice: opencode's default `model`, its `agent.<name>.model` overrides, and the OpenCode edition's `categories` / `agents` routing, so the first native session ran on the Recommended ladder. `omo setup` now reads them (the opencode config through the same merged reader the MCP and provider stages use; `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]`, the `[opencode]` block of `~/.omo/omo.jsonc`, or the `~/.omo/migration-backup-*-opencode-config/` copy the config migration moves those files to, since that migration keeps none of their categories or agents). Provider ids are translated through `provider-map.json` like the credential stage (`kimi-for-coding/k3` -> `kimi-coding/k3`, `zai-coding-plan/glm-5.2` -> `zai/glm-5.2`) and every provider/model is checked against the pinned engine's model catalog plus `models.json` (so a default model on a custom provider carried by #8836 validates). After a preview and consent, the default model goes into `<agentDir>/settings.json` `defaultProvider`/`defaultModel` (what interactive sessions start on) and into `[native].model_profile` as a pin (what headless and desktop sessions start on instead of Recommended); categories and agents go into `[native].categories` / `[native].agents`, `fallback_models` folded into `models`. What cannot be carried is listed with its reason and never written: an unknown provider or model, `small_model` (no omo equivalent), and agent names omo has no agent for (`build`, `plan`, `oracle`, ...). Existing keys win, `omo.jsonc` is edited in place so comments survive and is backed up first, `--dry-run` writes nothing, and a second run writes nothing. Details in `packages/omo-native/changes.md`.

## 2026-09-24 - native install resolves a POSIX PATH with POSIX rules on any host; Windows-only tests declare their platform

`resolveOmoBinEnvironment` (`packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts`) split PATH with `node:path`'s host `delimiter` and joined the bun bin dir with the host `join` whenever the described platform was not Windows, so resolving a POSIX environment on a Windows host produced `["/usr/local/bin:/usr/bin"]` and `\\home\\dev\\.bun\\bin` (dev CI `test (windows-latest, 1/2)` red since #8793). It now uses `posix`/`win32` rules chosen by the described platform. `repair-legacy-omo-bin.test.ts` skips the chmod-based write-denial case on Windows (mode bits do not deny unlink there), and `packages/omo-native/test/doctor-migration.test.ts` skips the relative-PATH-entry case when the checkout and the temp dir sit on different roots (Windows runners: `relative()` returns an absolute path across drives).

## 2026-09-24 - ultrawork and Hephaestus report at handoffs instead of staying quiet between state changes (#8847)

The ultrawork directives told the agent `No process narration` and `surface only state changes`, and the Hephaestus GPT-5.6 / GPT-6 prompts told it to update only at meaningful phase changes, so a long run went quiet and the user could not tell what the agent had understood, what was done, or what came next. Each of those sentences is replaced at its source with one handoff block, written at every todo phase change, blocker, plan change, and before a long pass, after weighing what the user asked for and what they need to know now; nothing is said between handoffs. The senpi-native directive (`packages/omo-senpi/skills/ultrawork/SKILL.md`) uses the labeled form `Ask / wanted / For you (ledger, evidence paths, PASS/FAIL, reviewer verdict) / Now / Next`. The Codex directive (`packages/prompts-core/prompts/ultrawork/codex.md`), the Codex ulw-execute continuation directive, and the Hephaestus prompts (`packages/omo-codex/plugin/components/rules/bundled-rules/hephaestus/gpt-5.6.md`, `gpt-6.md`, and `packages/omo-opencode/src/agents/hephaestus/gpt-5-6.ts`, which OpenCode also serves for GPT-6) use the outcome-first form `[Outcome so far] toward [ask + wanted]. You need: [...]. Now: [...]. Next: [...]`. In `gpt-5-6.ts` the handoff paragraph replaces both the old preamble and the during-work paragraph, because the preamble said the same thing a different way. The routing lines (`I detect [intent type] ...`, `I read this as ...`), the first-line and final-message bullets, and the todo fan-out reminder are unchanged. Generated copies are regenerated by their scripts: `packages/omo-senpi/src/components/ultrawork/generated-directive.ts` (`embed-directive.mjs`), `packages/omo-codex/plugin/components/ultrawork/src/directive-content.ts` and `packages/omo-codex/plugin/components/ulw-loop/directive.md` (`sync-directive.mjs`), and the `packages/omo-senpi/plugin/extensions/omo.js` bundle. Word counts (`wc -w`, before -> after): senpi ultrawork SKILL.md 4810 -> 4848, codex.md 4044 -> 4089, Hephaestus gpt-5.6.md 1813 -> 1879, gpt-6.md 2965 -> 3029, gpt-5-6.ts 2360 -> 2425 (rendered OpenCode prompt 2320), ulw-execute continuation directive 1400 -> 1446. Every increase is the handoff block minus the sentence it replaced. Two more sentences contradicted the handoff and are aligned. The GLM ultrawork directive (`packages/prompts-core/prompts/ultrawork/glm.md`) loses `Do not restate the user's request unless it changes the interpretation.` because the handoff's Ask field restates the request by design; the rest of `<output_verbosity_spec>` is unchanged (1728 -> 1716 words). The Grok 4.5 / 4.6 Sisyphus prompt (`packages/omo-opencode/src/agents/sisyphus/grok-4.ts`) replaces `Stay quiet through small changes; start narrating when you touch many files or change direction.` with the same outcome-first handoff block and drops the `Never restate the task back,` clause from the preceding density sentence (the Ask field restates the request by design), keeping `never narrate routine tool calls, no flattery or filler` and the final-answers sentence (1374 -> 1456 words). Neither file has a tracked generated copy. Senpi file-level detail is in `packages/omo-senpi/changes.md`.
## 2026-09-24 - Kibitzer reports an unconfigured recall category as a configuration notice, not a repeating gate failure (#8811)

When no connected provider serves the `memory.recall.category` chain, the Kibitzer sidecar refused to
start and that refusal was retried, counted, and escalated as `✗ Kibitzer gate failed · start_failed ...
after 3 consecutive failures`. The category pinning itself is deliberate policy and is unchanged; only
the lifecycle and the presentation move: the two category refusals (`category_unavailable`,
`beyond_category`) are classified as a permanent configuration state that never feeds the diagnostic
streak, and the session gets exactly ONE `omo-kibitzer:unavailable` warning naming the category, its
unconnected providers, and both fixes (`/login <provider>`, or pinning `categories.<name>.model` /
`memory.recall.category` in `omo.json`). Transient refusals keep their retry/backoff behavior, and the
sidecar re-resolves against the live registry on the next wake, so connecting a provider mid-session
restores judging without a restart. The task tool's dead-chain warning gained the same fix sentence.
Full file-level detail in `packages/omo-senpi/changes.md`; `docs/reference/configuration.md` documents the
notice in the recall section.

## 2026-09-24 - omo setup carries OpenCode custom providers into the engine's models.json (#8836)

An OpenCode power user's hand-configured `provider.<id>` block (an OpenAI- or Anthropic-compatible endpoint with `baseURL`, `apiKey` and a `models` map) used to vanish on migration: `omo setup` reported the id as `skipped-unmapped` and printed a placeholder `omo.json` template instead. Setup now reads those blocks from the same merged OpenCode config files the MCP/skills import reads, previews each one (`custom provider acme -> https://api.acme.example/v1 (openai-completions, from @ai-sdk/openai-compatible), 2 model(s): acme/acme-large, acme/acme-small; key: from opencode config apiKey`), and on consent writes the provider into `~/.omo/agent/models.json` and its key into `~/.omo/agent/auth.json`, so `acme/acme-large` is selectable in the first session. Existing ids in either file are never overwritten, both files get a timestamped backup, `--dry-run` previews only, and a second run changes nothing. The npm package decides the engine api (`@ai-sdk/openai-compatible` -> `openai-completions`, the default OpenCode itself uses when `npm` is absent; `@ai-sdk/anthropic` -> `anthropic-messages`; `@ai-sdk/openai` -> `openai-responses`); any other package, a provider id omo already serves, a baseURL that is not a fixed URL, and a provider with no usable model are reported by name and skipped. The placeholder template is no longer printed when a custom provider was found, and the credential stage no longer lists that id as `skipped-unmapped`. Details in `packages/omo-native/changes.md`.

## 2026-09-24 - native GLM chains pick an imported zai key (#8827)

OmO Native builtin model profiles and senpi-task category chains named OpenCode's `zai-coding-plan` provider, which the pinned engine does not register (engine ids are `zai` and `zai-coding-cn`). After `omo setup` imports that key as `zai` (#8799), Recommended (ranked providers only) and Daily · Normal never selected `glm-5.3` even when `/model` listed `zai/glm-5.3`. Native `GLM_PROVIDERS` and the `unspecified-high` category GLM rung now list `zai`, `zai-coding-cn`, `opencode-go`. `kimi-for-coding` stays next to engine `kimi-coding` because those native arrays copy the senpi-task category pair (leftover OpenCode-id key); they are not shared with the OpenCode edition, which keeps its own table in `packages/model-core`. A test loads the pinned senpi's `builtinProviders()` the same way `packages/omo-native/test/provider-map-registry.test.ts` does and fails if a chain provider id is neither an engine id nor an allow-listed alias.

## 2026-09-24 - omo doctor reports the OpenCode-edition migration leftovers (#8831)

`omo doctor` said nothing about the machine it had just been migrated from: an `omo` earlier on PATH than omo-ai's, the legacy `oh-my-openagent` / `oh-my-opencode` package still installed globally (the one whose `npm uninstall -g` can take omo-ai's `omo` with it, #8793), and the OpenCode plugin still registered in the OpenCode config. `packages/omo-native/bin/lib/doctor-migration.js` is new and adds three report-only checks, printed right after the `INFO Update:` line; `doctor.js` only imports and calls it.

- PATH: every absolute PATH dir except a project `node_modules/.bin` is scanned for `omo` (plus `.cmd`/`.ps1`/`.exe` on Windows). Each entry's owner is the nearest `package.json` above its resolved symlink or above the package path its launcher shim names; a Codex Light wrapper (`# OMO_GENERATED_RUNTIME_WRAPPER`) is `lazycodex@<cached version>`. Every entry before omo-ai's own, or every entry when omo-ai is not on PATH, gets a `WARN another omo precedes omo-ai on PATH: <file> (<owner>)`. The fix is `bunx oh-my-openagent@beta install --platform=native` when the installer repairs that owner (oh-my-openagent / oh-my-opencode / lazycodex); otherwise it is "remove that file, or move <omo-ai bin dir> ahead of <dir> on PATH". The owner rules mirror `packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts`, which omo-native cannot import.
- Legacy package: `oh-my-openagent` / `oh-my-opencode` under an npm global prefix (`npm_config_prefix`, `~/.npmrc` `prefix=`, and the prefix implied by every PATH bin dir) or under the bun global tree (`$BUN_INSTALL/install/global/node_modules`, default `~/.bun`). The warning names the package dir. For npm the remove command is `npm uninstall -g <pkg>`, followed by the doctor's own update command if `omo` disappears; for bun it is `bun remove -g <pkg>`.
- OpenCode registration: every server config file `bin/lib/setup-opencode-assets.js` `opencodeConfigSources` names (the global dir's `config.json` / `opencode.json` / `opencode.jsonc`, `$OPENCODE_CONFIG`, then `~/.opencode` and `$OPENCODE_CONFIG_DIR`, layered the way OpenCode reads them), plus `tui.json` / `tui.jsonc` in each of those dirs, is parsed with `bin/lib/jsonc.js`. Any `plugin` entry naming a legacy package (`<pkg>`, `<pkg>@...`, `<pkg>/tui...`, string or `[name, options]` tuple) yields one `INFO OpenCode still loads the <pkg> plugin (<files>)` line. An unparsable file is skipped because OpenCode reports its own config errors.

Nothing is deleted or rewritten. `runDoctor` options gain `env` / `homeDir` / `platform`, following the existing `env` injection, so `test/doctor-migration.test.ts` runs every check against fixture trees and never reads the real PATH or home.

## 2026-09-24 - omo-senpi component info logs stay off stderr unless OMO_DEBUG is set (#8826)

`packages/omo-senpi/src/extension/compose.ts` `defaultLogger.info` printed every component diagnostic through `console.error`, so `omo -p` / `--mode json` dumped objects (ulw-loop skip, ulw-execute-continuation skip, model-profile selection) onto the user's stderr. `info` is now silent unless `OMO_DEBUG` is set (the same switch the bun launcher shim already uses); `warn` and `error` still go to stderr; stdout is still unused (#8564). The model-profile selection sentence already reaches the user through the engine notice (`pi.sendMessage`); the extra object dump is the debug line. Documented in `docs/reference/configuration.md`. Fixes #8819.

## 2026-09-24 - omo update actually runs the detected package-manager command (#8830)

`omo update` printed `omo is updated via bun: bun add --cwd '<pkg>' -g omo-ai@beta` (or the npm equivalent) and exited 0. The TUI's "Update Available" box showed the same line, so the user copied a package-manager command from a tool that already knew which manager installed it. `--cwd` into the global package dir also does not retarget `bun add -g`: bun still writes `$BUN_INSTALL/install/global` (or `~/.bun`).

The launcher now runs that command. `--dry-run` / `--print` keep the print-only answer. A successful run streams the manager output and prints `omo <before> -> <after> (engine: senpi ...)`. A failed run exits non-zero with the same command to retry by hand. Bun-global installs spawn `bun add -g omo-ai@beta` with `BUN_INSTALL` overlaid from the install prefix; npm stays `npm i -g omo-ai@beta`. The engine pin is untouched: the launcher never updates `@code-yeongyu/senpi` separately.

Verification: `bun test packages/omo-native/test/self-update.test.ts packages/omo-native/test/launcher.test.ts` 54/0; `node --check` on the three JS files. Sandbox `BUN_INSTALL`: overlay the new updater onto `omo-ai@5.0.0-0.beta.88`, `omo update --dry-run` printed only and left 88, `omo update` streamed bun add and reported `omo 5.0.0-0.beta.88 -> 5.0.0-0.beta.89 (engine: senpi 2026.9.24)`.

## 2026-09-24 - native install offers to run `omo setup`; the advertised installer tag follows the plugin's channel (#8828)

`install --platform=native` used to end with "OmO Native installed. Run omo setup to finish onboarding." even though it had just verified that `omo` on PATH is omo-ai. In the interactive installer (`packages/omo-opencode/src/cli/tui-installer.ts`) a verified install is now followed by `Run omo setup now to carry your OpenCode credentials, MCP servers and skills over?` (clack confirm, default Yes); yes runs `<verified path> setup` with the terminal inherited, so setup's own consent prompt works. The path is the one `verifyOmoCommand` probed (`OmoCommandVerification.binPath` -> `NativeInstallOutcome.omoBinPath`), never a fresh `omo` lookup. The decision lives in `cli/install-native/offer-native-setup.ts` (`offerNativeSetup`, injected `confirm` / `runSetup`); a setup that exits non-zero or cannot be spawned leaves a warning pointing back at `omo setup`. An unverified install is never offered and keeps the PATH fix #8793 prints. `--no-tui` (`cli-installer.ts`, unchanged) keeps printing the next step.

`formatNativeInstallEntryCommand` (`cli/install-native/plan.ts`) takes the running plugin's version (default: the bundled `package.json` version via `getBundledVersion`) and uses `@beta` only for a prerelease (`isPrereleaseVersion`); a stable build advertises the bare `oh-my-openagent`, which resolves to `latest`. The nudge toast, the `/native` dialog and the installer hint all go through it, so they follow without their own change; on the current `5.0.0-beta.89` they still say `@beta`.

Verification: `bun test packages/omo-opencode/src/cli` 841/0, native-edition nudge surfaces 60/0, with new cases for the offer (yes -> verified path, no, verify-failed, spawn error), the TUI wiring and `--no-tui`, and the tag per channel; each of three production mutations (bare `omo`, offer when unverified, hard-coded `@beta`) fails its cases. PTY sandbox run of the built installer answering yes: setup starts from `<sandbox>/bun/bin/omo` and imports the seeded OpenCode key after its own `[y/N]`; `--no-tui` run prints the step and writes no `~/.omo`.

## 2026-09-24 - A memory commit mid-session no longer changes the system prompt; the change arrives as a notice (#8470)

The senpi memory block was compiled from the memory repo HEAD on every turn. A commit that added a file (the agent's own `memory create`, a reflection, a facts run, another session) grew `<external_projection>`, a system-file edit rewrote the projected body, and a large edit moved the pressure line; each changed the system prompt hash, so the provider's prefix cache missed the whole conversation behind it (~180K tokens rewritten on a 190K session).

A session now pins the block to its first turn's HEAD and records the pin as an `omo-memory:projection-pin` session entry, so resume, host restart and runtime reload reproduce the same bytes. The pressure line is computed at the same pinned revision. What changed after the pin reaches the model as one line of the existing late `<memory_notice>` message: added/updated/removed `system/*.md` and added/removed external paths, each change once, leaving out commits whose `Omo-Session` trailer is the current session. The block moves only where the cache is already cold or a refresh was asked for: after a compaction, on `/recompile`, or when the pinned commit no longer resolves. New and forked sessions pin fresh. `MemoryBlockCache.compile` takes an optional pinned revision; memory-core adds `projectedChangesBetween` and `revisionExists`. Pinned by `omo-senpi/.../memory/prompt-pinning.test.ts` and `memory-core/src/compile/{changes,cache}.test.ts`.
## 2026-09-24 - "Restart to apply" actually applies: stale OpenCode plugin sandboxes are invalidated (#8801)

OpenCode installs every npm plugin into `<opencode cache>/packages/<spec>/node_modules/<package>` and its `Npm.add()` returns that copy as soon as it exists, without re-resolving the tag. A moving tag (`@latest`, `@beta`, or a bare name, which OpenCode expands to `<name>@latest`) therefore froze at the first version installed: users on 4.19.4 never received 5.x, beta users stayed on the beta they first installed, and neither restarting OpenCode nor re-running the installer changed it - only deleting the sandbox by hand did. The update checker detected that sandbox (#4535 / #4318) and stopped claiming "Updated!", but its "Restart to apply" toast was still a promise nothing kept.

`packages/omo-opencode/src/shared/opencode-plugin-sandbox.ts` now owns that path layout in one place: `toPluginSandboxSpec` (bare name -> `@latest`), `getPluginSandboxDir`, `isPluginSandboxDir` and `removePluginSandbox`. **`isPluginSandboxDir` is the safety guard and must stay on every removal path**: it accepts only a direct child of `<cache>/packages` named for one of `ACCEPTED_PACKAGE_NAMES`, comparing canonicalized paths (`$TMPDIR` symlinks make the raw strings disagree on macOS). The checker reaches its candidate by walking up from `import.meta.url`, which for a project-local, global or linked install resolves to a directory we do not own - removing that would destroy a user's workspace.

`hooks/auto-update-checker/checker/sandbox-refresh.ts` never removes the sandbox during the session: the live session still reads bundled skills, the `./tui` export and provisioned binaries out of that directory. The checker writes a refresh marker (`.omo-refresh-pending`) into the sandbox, and every entry point loaded from a sandbox, the server plugin and the TUI plugin (`tui.ts`), takes a per-pid lease (`.omo-leases/<pid>`) and registers a `process.once("exit")` handler that removes a marked sandbox once no other live process holds a lease. The marker is needed because in the TUI OpenCode runs the server plugin inside a Worker that it stops with `worker.terminate()`, and a terminated Worker never emits `exit`; only the main thread, where the TUI plugin lives, does. The lease is needed because every OpenCode window shares one cache. Removal takes the whole spec directory, not just `node_modules/<package>`, because the sandbox's own `package.json`/lockfile can re-pin the old version on reinstall, and it renames the directory aside before deleting it, so a failed delete (a file Windows holds open, EACCES) never leaves the half-deleted copy that `Npm.add()` would then load. A removal that fails, or is skipped because another window is open, is recorded in the marker, and the next start shows it in the update notice instead of "Restart to apply". The installer (`cli/config-manager/refresh-opencode-plugin-sandbox.ts`, called from both `cli-installer.ts` and `tui-installer.ts` after the config is written) removes the sandbox for the spec it just wrote, marks it for refresh when OpenCode is still running from it, and prints any removal failure.

`hooks/auto-update-checker/checker/semver-compare.ts` adds prerelease-aware comparison, and both `background-update-check.ts` and `check-for-update.ts` now treat only a strictly newer registry version as an update. The old `currentVersion !== latestVersion` test offered a "update" to an OLDER version whenever a local build ran ahead of the channel tag, and `shared/opencode-version.ts` `compareVersions` cannot be used here because it strips prerelease suffixes (it gates OpenCode host features) and so ranks `5.0.0-beta.85` equal to `5.0.0-beta.89`. User-pinned exact versions keep their existing notify-only behavior: no sandbox is touched for them by the checker.

`docs/reference/known-issues.md` #5367 is rewritten to describe the new behavior; the manual `rm -rf` workaround stays, scoped to a session that was killed before it could run its exit handlers.

## 2026-09-24 - native install also retires the Codex Light `omo` wrapper left in ~/.local/bin (#8793)

Pre-rename Codex Light installs (lazycodex <= 4.19.4) wrote `omo` into `~/.local/bin` as a generated shell wrapper (`# OMO_GENERATED_RUNTIME_WRAPPER`, exec'ing `<CODEX_HOME>/plugins/cache/sisyphuslabs/omo/<version>/dist/cli/index.js`), not as a package-manager link, so the owner scan in `packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts` classified it `foreign` and left it shadowing omo-ai on PATH. `resolveOwner` now recognises that wrapper by the same marker the Light installer itself retires it with (`packages/omo-codex/src/install/codex-cache-bins.ts` `removeGeneratedRuntimeWrapper`) plus the Light cache path, and reports it as `lazycodex@<version>`; `LEGACY_OMO_BIN_PACKAGES` gains `lazycodex`. A script without the marker stays `foreign` even when it names the cache path. Only the wrapper file is removed; the Light cache and its other commands stay.

Verification: `bun test packages/omo-opencode/src/cli/install-native` 32/0 three consecutive runs; install-native + both nudge surfaces + hint 98/0. Real surface: a sandbox HOME holding a copy of a real 4.19.4 Light wrapper ahead of the bun bin dir - before `omo --version` = `4.19.4`; `install --platform=native` removed it (`Removed the stale omo command left by lazycodex@4.19.4`), after `omo --version` = `omo 5.0.0-0.beta.89`.

## 2026-09-24 - native install clears the legacy global `omo` bin and verifies what PATH resolves (#8793)

`install --platform=native` used to be a bare `bun add -g omo-ai@beta` / `npm i -g omo-ai@beta`, which is wrong on every machine still carrying oh-my-openagent / oh-my-opencode 4.19.4 or earlier: `latest` is still 4.19.4 and it owns a global `omo` bin, so the npm install dies with `EEXIST: file already exists <prefix>/bin/omo` and the bun install silently lands beside it, leaving `omo --version` printing `4.19.4` whenever the npm bin dir sorts earlier on PATH. The docs described the ordering; no code path detected it.

`packages/omo-opencode/src/cli/install-native/` gains three modules. `legacy-omo-bin.ts` resolves the PATH directories plus the bun global bin dir (`resolveOmoBinEnvironment`, injected as `NativeInstallDependencies.environment`), finds every `omo` entry (Windows `.cmd`/`.ps1`/`.exe` siblings included, dangling symlinks included because they still occupy the name), and classifies each by its owning package: symlink realpath walked up to the nearest `package.json`, else the package path embedded in a launcher shim, and an owner path that is not absolute is never walked so a Windows `.cmd` cannot resolve against the cwd. `omo-ai` is `native`, oh-my-openagent / oh-my-opencode are `legacy`, everything else is `foreign` and is never touched. `repair-legacy-omo-bin.ts` unlinks only the conflicting `omo` entries of legacy owners - the package and its other commands (`oh-my-openagent`, `lazycodex`, ...) stay - and reports the exact path, owner and version, or a warning carrying `rm`/`del` and the `npm uninstall -g` fallback when the unlink fails. `verify-omo-command.ts` runs after the install: the `omo` PATH resolves must be omo-ai's and `omo --version` must answer as `omo ...`, otherwise the outcome carries the exact `export PATH="<dir>:$PATH"` fix for a shadowing entry or an off-PATH install. `runNativeInstall` wires detect -> repair -> install -> verify, and the outcome grows `warnings` and `verified`; `NativeInstallFailure.hints` carries the manual cleanup when a repair failed and the install then hit EEXIST. Both installers print notes and warnings (`cli-installer.ts`, `tui-installer.ts`).

The advertised command changes everywhere a user sees it: the native-edition nudge toast, the `/native` dialog install action, and the installer hint now say `bunx oh-my-openagent@beta install --platform=native` (`npx` without bun) via `formatNativeInstallEntryCommand` (the tag is required: `latest` 4.19.4 rejects `--platform=native`), because that is the one spelling correct on a machine with the legacy bin and on one without. `docs/guide/installation.md` and `docs/reference/omo-ai-publishing.md` describe the new behavior and keep the by-hand ordering.

Auto-removing or auto-upgrading the whole legacy package stays out: upgrading to a release without the `omo` bin means moving a user from stable `latest` (4.19.4) to the 5.x beta, and uninstalling takes away commands they still use. Anything beyond the one orphaned alias is the user's call.

Review fixes: a launcher shim counts as legacy only when the entry file it launches (absolute, or relative to the shim dir via `%dp0%` / `$basedir`) exists inside an installed package whose manifest names a legacy package, so a user's own `omo` script that merely mentions a legacy path stays `foreign`; relative PATH entries and `node_modules/.bin` dirs are no longer scanned; on the npm path the outcome notes that a later `npm uninstall -g oh-my-openagent` also unlinks omo-ai's `omo` (npm removes every bin name the package declares; `bun remove -g` does not) and prints `npm i -g omo-ai@beta` to restore it; the removal note no longer suggests reinstalling the old package; the success line no longer points at `omo setup` while `omo` on PATH is not omo-ai; the docs keep `bun add -g omo-ai@beta` as the lead.

Verification: `bun test packages/omo-opencode/src/cli packages/omo-opencode/src/hooks/native-edition-nudge packages/omo-opencode/src/features/native-edition-nudge` 857/0. Real-surface QA in isolated `HOME`/`NPM_CONFIG_PREFIX`/`BUN_INSTALL` prefixes with oh-my-openagent@4.19.4 present: before, `npm i -g omo-ai@beta` fails EEXIST and `omo --version` prints `4.19.4`; after driving the built CLI, the stale shim is gone, the other legacy bins survive, and `omo --version` prints `omo 5.0.0-0.beta.89 (engine: senpi 2026.9.24)` on both the bun and the npm path. A clean prefix installs with no removal note.

## 2026-09-24 - installation guide: what `omo setup` imports, and what it tells you to do about the rest (#8799)

`docs/guide/installation.md` rewrites the import stage of the `omo setup` section. It now says that a credential whose provider id differs between harnesses is still imported when the endpoint matches (opencode's `zai-coding-plan` key lands on the `zai` provider), and that a skipped credential comes with the command that fixes it: start `omo` and run `/login <provider>` for an OAuth login, or define the provider and its baseUrl in the engine's `models.json` and then `/login` it for an API key nothing serves. The old text pointed at `omo auth`, which only prints or checks credentials that already exist and cannot sign anyone in. Implementation detail lives in `packages/omo-native/changes.md`.

## 2026-09-24 - installation guide: `omo setup` also carries over opencode MCP servers and skills

`docs/guide/installation.md` extends the import stage of the `omo setup` section: alongside credentials, the same stage converts the MCP servers declared in `~/.config/opencode/opencode.json[c]` into the engine's schema and merges them into the global `~/.omo/agent/mcp.json`, and copies global OpenCode skills into `~/.omo/agent/skills/`, with its own preview and confirmation. The text names why both are global rather than per-project, which opencode config files and directories are read (the global dir's `config.json`, `opencode.json` and `opencode.jsonc` merged, with `OPENCODE_CONFIG`, `~/.opencode/` and `OPENCODE_CONFIG_DIR` layered on top), that an existing name - or a skill name omo bundles - is kept and reported, that `mcp.json` is backed up before it is rewritten, and that a server using shell command substitution or a `{file:...}` placeholder, or a skill without a description, is refused with a notice. Implementation detail lives in `packages/omo-native/changes.md`.

## 2026-09-24 - skills instruct the brand command for --list-tips, --onboard, and hyperplan restart (#8794)

`packages/omo-senpi/skills/give-me-tips/SKILL.md` and `onboarding/SKILL.md` told the agent to list tips with `senpi --list-tips`, which is not on PATH for an OmO Native (`omo-ai`) install. They now use `omo --list-tips` on OmO Native (session env carries `OMO_NATIVE=1` / `OMO_BIN`; the npm launcher, compiled omob remapper, and local-install launcher all set both) and `senpi --list-tips` on a plain senpi install, with `"$OMO_BIN" --list-tips` when the brand command is not on PATH. `skills/AGENTS.md` follows. The same brand-command rule covers the onboarding re-run flag (`omo --onboard` / `senpi --onboard`; `--onboard` is an omo-senpi extension flag, not an engine CLI) and the hyperplan restart hint (`omo` / `senpi` without `--no-omo-task`). Onboarding lane 2 (Migration help) is unchanged.

## 2026-09-24 - installer replaces stale tui.json plugin entries instead of appending a second one (#8798)

`packages/omo-opencode/src/cli/config-manager/add-tui-plugin-to-tui-config.ts` now normalizes `tui.json` the way `add-plugin-to-opencode-config.ts` normalizes `opencode.json`: every entry belonging to this plugin is dropped before the entry being installed is appended, so re-running the installer over a config an older installer wrote leaves exactly one entry. Before this, only the `<pkg>/tui` subpath form was filtered, so a 4.19.4-era `tui.json` (`["oh-my-openagent@latest"]`) kept that entry alongside the freshly written spec and the TUI loaded the plugin twice from two different specs.

`isOmoManagedTuiEntry()` in `packages/omo-opencode/src/cli/doctor/checks/tui-plugin-config.ts` is the single predicate for "this entry is ours": bare package name, any tag/version spec, the legacy `oh-my-opencode` name, the `<pkg>/tui` subpath, our `file:` dev entries, and the `file://.../(src|dist)/index.(ts|js)` source specs `addPluginToOpenCodeConfig` already treats as ours, in string or `[name, options]` tuple form. Keep the doctor predicates and this writer sharing it - a second copy is how the two files drifted in the first place. The writer now filters the raw `plugin` array instead of a string-only projection, so foreign tuple entries survive the rewrite (they were silently dropped before).

`ensureTuiPluginEntry` reads a tuple-form server entry in `opencode.json` the same way `addPluginToOpenCodeConfig` does, so `[["oh-my-openagent", { ... }]]` still rewrites `tui.json`. A `plugin` field that is a foreign string is kept as one entry; a non-array non-string `plugin` value is left untouched (`malformed`). `checkTuiPluginConfig` warns when `tui.json` lists more than one managed entry (the leftover `["oh-my-openagent@latest", "oh-my-openagent"]` shape) and passes after the writer collapses it to one.

## 2026-09-24 - agent-model-matching guide follows the OmO Native routing tables (#8805)

`docs/guide/agent-model-matching.md` was re-checked against `packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`, `packages/senpi-task/src/category/{fallback-chains,builtins,*-categories}.ts`, `packages/senpi-task/src/agents/builtin/{fallback-chains,code-reviewer,gate-reviewer,qa-executor}.ts` and Senpi's `prompt-preset/presets.ts` `resolvePresetName`.

- New lead paragraph: with no config the session runs Recommended and children resolve their own chains, so most readers can skip the page.
- "The recommended tier" becomes "The recommended models" (the six-model Recommended ladder); GPT-5.6 Sol and "Fable 5" naming are gone, and Kimi K3 / GLM 5.3 are no longer called unsupported while the default ladder picks them.
- The preset table covers every name `resolvePresetName` returns (GPT-6 family -> `gpt-6-astra`, `claude-fable-5-1`, `claude-opus-5`, the Opus 4.x line, `kimi-k2-6/7/8`, SWE-2 -> `kimi-k3`, the DeepSeek V4 split, `grok-4.7`, the GPT-5 line through `gpt-5.6`).
- Category defaults for `ultrabrain` / `deep-low` / `deep-high` read `chatgpt-subscription/...`; chain rungs list `anthropic-subscription` / `chatgpt-subscription` first as the source does; the `quick` Luna rung lists `openai`; `plan-reviewer` has one elided rung, not two.
- Documented: `requiresModel` gates (`ultrabrain`, `deep-low`, `deep-high`, `architect`), dead-chain hiding, the explicit-config bypass, the ulw reviewer categories, the TUI exception in the rules list, a resolution step for the gate, current Fable 5.1 placements, and Example C moved to `gpt-6-sol`.
- The retired `deep` category name is replaced by `deep-low` / `deep-high`.

`docs/guide/overview.md` and `docs/guide/installation.md` drop the GPT-5.6 Sol recommendation, the retired Capable / Deep work profile names and the "quick runs on Kimi high-speed" claim.
## 2026-09-24 - ulw-research deliverable contract: lane interview, static gates, outcome manifest, bounded repair (#8611)

`packages/shared-skills/skills/ulw-research/scripts/` (new) is a zero-dependency Node CLI, `report-tools.mjs`, dispatching `check`, `layout-probe`, `repair decide`, `outcome init|set|gate|render|state|verify|finish|briefing`, `format-extract` and `--help --json` (exit 0 pass, 1 semantic failure, 2 usage or IO). Modules: `contracts.mjs` (the defect-code table, the only place severities live; enums; manifest and repair-state validators), `outcome.mjs`, `repair-tracker.mjs`, `html-lite.mjs` + `entities.mjs`, `css-lite.mjs`, `design-spec.mjs`, `gates-static.mjs` composing `gates-text.mjs` / `gates-figures.mjs` / `gates-structure.mjs` (G1-G15), `layout-probe.mjs` + `gates-layout.mjs` (L1-L5; the probe is evaluated by the orchestrator through the browser skill's owned headless engine), `format-extract.mjs` + `format-extract-css.mjs`, `cli-support.mjs`, `entry-guard.mjs`, `report-tools-commands.mjs`; every module is at most 250 lines with a co-located bun test. `references/deliverable-phase.md` (new) is the edition-neutral contract (lanes, state, destination defaults, the three-question interview, report-format memory episodes, design spec, gates, repair, manifest, command reference) and `references/report-gates.md` (new) the defect glossary. Both `SKILL.md` editions (`packages/omo-senpi/skills/ulw-research`, `packages/shared-skills/skills/ulw-research`) replace the always-ask format gate and the python briefing one-liner with calls into the CLI; the new skill `AGENTS.md` documents the runtime.

`packages/omo-senpi/plugin/scripts/native-skill-sources.mjs` gives the `ulw-research` entry `sharedAssets` (`scripts`, the two references) and `sync-skills.mjs` overlays them byte-for-byte after the native copy, failing on a missing asset or a native collision; `native-skill-sources.d.mts` (new) types it. `packages/omo-codex/plugin/scripts/sync-skills.mjs` re-anchors the ulw-research overlay on the proofread paragraph (the replacement keeps the visual-QA gate's tail sentence, so it is never empty) with the test-support mirror following. Tests: `skills-sync.test.ts` and the Codex `sync-skills.test.mjs` assert shipped-copy byte equality for the overlaid files; `sync-skills-codex-compatibility.test.mjs` asserts the overlay applies.

## 2026-09-24 - browser skill installs BrowserSkill only into the browser the user actually uses (#8784)

`package.json` / `bun.lock` move the `omowright` pin to the commit that ships code-yeongyu/omowright#23, and `packages/shared-skills/skills/browser/runtime/omowright` is restaged from it. omowright's `bskOnboard({ browser })` now registers the external extension for exactly one browser picked by `identifyBrowser` (explicit `browser` / `OMOWRIGHT_BROWSER` > the OS default browser when it is also running or used in the last 7 days, or when nothing else is > the only browser in use), and returns `needsChoice: true` with every candidate and its signals, registering nothing, for a Safari/Firefox default, an idle default while another browser runs, several browsers in use, or none; `bskDoctor({ browser })` reports `primary`, `identification` and `registeredElsewhere` (entries an older onboarding left behind - reported, never removed). The catalog adds Arc, Dia, Vivaldi, Opera, Comet and Naver Whale; macOS "running" only counts the app bundle in `/Applications` or `~/Applications`, so automation Chromium builds are ignored.

`scripts/browser-install.mjs` accepts `--browser=<id>` and prints/emits `browser`, `needsChoice`, `candidates`, `registeredElsewhere`; on `needsChoice` it tells the agent to ask and re-run with `--browser`. `scripts/browser-doctor.mjs` accepts `--browser=<id>`, adds the `choose-browser` state (checked before `no-extension`) with a remedy that puts the agent's memory first, then asking the user, then recording the answer, and emits `browser`, `candidates`, `defaultBrowser`, `registeredElsewhere`. `SKILL.md` gains the state row and the "install into the browser the user actually uses" rule; `references/install.md` gains the "Which browser" section (signals, order of authority, `registeredElsewhere`) and the store-only row; `docs/reference/features.md` and `visual-qa/references/browser-setup.md` follow.

## 2026-09-24 - ulw-plan anchors every plan on the affected user's ideal state; plan-reviewer checks user, experience, problem, and approach (#8773)

The planner's north star moves from executor-completeness to the ideal state for the affected user. All three hand-maintained `ulw-plan` copies (`packages/omo-senpi/skills/ulw-plan`, `packages/shared-skills/skills/ulw-plan`, `packages/omo-codex/plugin/components/ultrawork/skills/ulw-plan`) get the same hunks: `SKILL.md` replaces the two invariants "Decision-complete is the north star" / "Full scope is the default" with "The ideal state for the affected user is the north star" (name who the output touches, how they use it today and after, the ideal-state rows with reasons, the gap rows with reasons; MVP/phase never invented; an ideal state larger than the request is said in one line and planned) plus "Decision-complete is how the plan gets there"; the opening workflow preview announces the user, ideal state and gap list before the intent verdict; filter (2) resolves a fork against the ideal state before any defensible default. `references/full-workflow.md` rewrites `## North star`, adds a "Define the ideal state" step at the end of Phase 1 recorded in a new draft ledger, makes the approval brief lead with user / IS rows / GAP rows and show forks as resolved against them, adds IS/GAP coverage to the Phase 3 self-review and to the gap-analysis ask, renames F4 to ideal-state fidelity (shortfall becomes new task rows, never a note), renames the handoff "End state" item, and adds `ideal_state_row_unmapped_or_unreachable_for_the_affected_user` to the bounded-convergence blocker eligibility. `intent-clear.md` / `intent-unclear.md` reframe the resolver the same way, add the user/IS/GAP check to CLEARANCE, and rework both worked examples so a fork the ideal state settles (Redis across nodes) is recorded, not asked.

`scripts/scaffold-plan.mjs` in each copy is split: the path guards stay, the emitted text moves to a new `scripts/plan-templates.mjs` (re-exported from `scaffold-plan.mjs`, so `import(scaffold-plan.mjs)` keeps every symbol) - both files under the 250 pure-LOC ceiling. The draft gains an `## Affected user and ideal state` ledger (IS-n / GAP-n rows); the plan skeleton gains `### Affected user and ideal state` under `## Scope`, a `Who this is for and what changes for them` TL;DR line, a `Closes: GAP-<n>` line per todo, `F4. Ideal-state fidelity`, and a `## Success criteria` table mapping every IS row to its delivering todo, proving QA scenario, and evidence path (the header was emitted empty before). `packages/boulder-state` parses the new skeleton unchanged (5 checkbox rows: 1 todo + F1-F4). The Codex planner agent `agents/plan.toml` carries the same Goal sentence, TL;DR line, Scope subsection, `Closes:` line, F4 and Success-criteria table.

`packages/senpi-task/src/agents/builtin/plan-reviewer.ts`: the reviewer now answers two questions - does the plan reach the ideal state it states for its affected user, and can a developer execute it. New check 5 "Affected User and Ideal-State Fidelity": the end user is named (a plan that forgets the consuming program/agent, the operator, or the calling programmer fails), each IS row says what changes for them and which problem is solved, every IS row maps in `## Success criteria` to a todo and a QA scenario, and the approach can reach those rows (an approach that regresses a stated row, solves a different problem, or leaves a GAP row open is a blocker; a different approach that would also work is not). The "APPROVAL BIAS ... 80% clear is good enough", "Good enough is good enough", and "Trust developers" lines are removed; "never reject on taste" and "cite the row" replace them. `plan-consultant.ts` gains an `## Affected user and ideal-state gaps` output block, an ALWAYS rule to hold the plan against its user, and "MUST NOT: Add features not explicitly requested" becomes "... the request or the affected user's ideal state does not require". `plugin/extensions/omo-task.js` (and the shared marker line of the sibling bundles) regenerated under Node 24.

Gates: `bun test packages/senpi-task/src/agents packages/senpi-task/src/tools/task` 371/0, `packages/boulder-state` 55/0, `omo-senpi/src/skills-sync.test.ts` 14/0, `tsgo -p packages/senpi-task` clean, codex `scaffold-plan` + `ulw-plan-skill-contract` + `ulw-plan-review-state-contract` 20/0, `build-extension.mjs --check` / `build-install.mjs --check` / `embed-directive.mjs --check` current under Node 24; scaffold run under node 24 and bun emits identical skeletons. Model-run proxy (Opus, no tools): the new reviewer prompt rejects a plan whose IS-2 row is stated but unmapped (old prompt: OKAY) and a plan naming no affected user (old: OKAY), approves the fully mapped plan; the new SKILL.md brief leads with affected users, ideal-state rows and gaps and resolves the Redis fork from the ideal state instead of asking it.

## 2026-09-24 - OmO Native footer badge: "by Q Kim" credit, coffee cup on omob dev builds (#8771)

`packages/omo-senpi/src/components/native-badge/footer-badge.ts` replaces the single `(😺 OmO Native)` literal with two: `NATIVE_BADGE_TEXT` `(😺 OmO Native by Q Kim)` for release runtimes and `NATIVE_BADGE_DEV_BUILD_TEXT` `(☕ OmO Native by Q Kim)` for dev builds. `resolveNativeBadgeText(env)` picks between them from `OMO_PACKAGE_DIR/package.json`: `script/build-omob.ts` stamps an `omoBuild` object (non-empty `command`, e.g. `omob`) into the dev payload manifest and `packages/omo-native/compile-entry.ts` `remapSenpiEnvironment` points `OMO_PACKAGE_DIR` at that payload; release manifests carry no stamp, and a missing dir, unreadable manifest, or malformed stamp falls back to the cat. `SENPI_BRAND.command` also names `omob`, but senpi `core/brand.ts` parses and scrubs it before extensions load, so it is not visible here. `createNativeBadgeStatus(text)` takes the resolved text, and `createNativeBadgeComponent({ env })` resolves it once at register so tests pass a hermetic env instead of inheriting the caller's runtime. The status key `  omo-native` and its leading sort position are unchanged. Tests: `footer-badge.test.ts` covers stamped, unstamped, absent, and malformed manifests; `index.test.ts` registers with `env: {}`.

## 2026-09-23 - frontend skill: HIG-derived universal motion and feedback rules in the DESIGN.md contract, interaction mechanics, and ambience retrofit (#8755)

A full read of Apple's Human Interface Guidelines (172 pages) against `packages/shared-skills/skills/frontend`, keeping only the platform-agnostic principles (nothing Liquid Glass, scroll-edge, tab-bar, SF Symbols, or visionOS-specific). Every edit lands in a project-original file at the layer where it is applied; no materialized third-party reference, no SKILL.md, no routing, and no test change.

`references/design/design-system-architecture.md`: Section 2 drops the depth rule that contradicted Section 7's choose-one strategy and rewrites the accent rule to say where accent goes (the primary action's background, not its glyph), how many prominent controls a screen carries (one or two), and how peers differ (style, never size). Section 6 gains a Feedback thresholds table (same-frame press feedback; hover-revealed chrome after hover intent; placeholder at once and indicator only past ~1 s; even-paced progress with no mid-task shape swap; failure next to the object, toast only for outcomes not visible in place), allows `filter` alongside `transform`/`opacity` as the rest of the skill already did, merges the two state bullets, adds a transition-identity rule, and reframes reduced motion as reduce-not-remove. Section 7 gains a Radius scale and two rules (concentric nested radii; elevation reads only when scale, shadow and highlight move together). The validation checklist covers thresholds, reduced-motion paths, and radii.

`references/design/interaction-skill.md` Section 4: a meaning-to-motion table under the motion-serves-meaning rule; a "Transitions keep identity" rule (`layoutId`/measured-height morph, move-before-add, still anchor, no reflow under the user's hands, exit mirrors entry); discrete-vs-continuous input folded into the springs bullet (drags track 1:1, settle on release); interruptibility extended with never-snap; reduced motion extended with what stays, blur never animating, and an `aria-live` equivalent for motion-conveyed state; a new "One event, one feedback" rule (no stacked indicators, success by changed state, failure always reported with cause, undo over dialog, outcome-named buttons, neither Cancel nor a destructive action as the Enter default, request sent when input lands). Section 6 verification adds an interruption pass.

`references/design/ambience-skill.md` Section 4: a comfort bullet for viewport-filling motion (fixed reference frame, low-contrast translucent moving layer, motion toward the center, no ~0.2 Hz oscillation); the closing bullet is trimmed to the one-atmosphere-per-page rule the shared axiom does not already state.

Gates: Agent Skills validator OK on the frontend skill; `bun test packages/shared-skills` membership/provenance/packaging pins unchanged; the DESIGN.md template keeps its eight numbered sections plus Section 0.

## 2026-09-23 - one comment-checker release pin for both editions; native downloads it instead of installing the npm payload (#8247)

`packages/comment-checker-core/src/release.ts` (new) is the single description of the checker release both editions consume: `COMMENT_CHECKER_RELEASE_VERSION` (`0.8.0`), the release repo, `resolveCommentCheckerReleaseAsset(platform, arch)` (the five supported targets and their `tar.gz`/`zip` asset name and URL), `commentCheckerBinaryName`, and `commentCheckerCacheDir` (`%LOCALAPPDATA%\<name>\bin` on Windows, `$XDG_CACHE_HOME/<name>/bin` with the `~/.cache` default elsewhere). Exported from the package barrel and declared in `index.d.ts`; `release.test.ts` pins every target, the unsupported-platform null, the version threading, and the cache-dir precedence. `packages/omo-opencode/src/hooks/comment-checker/downloader.ts` drops its private `REPO`/`COMMENT_CHECKER_VERSION`/`PLATFORM_MAP` and derives URL, cache dir and binary name from the descriptor; its six-platform `downloader.test.ts` is unchanged and green, so the OpenCode edition's URLs and cache location are byte-identical. `packages/omo-opencode/package.json` gains one narrow export, `./binary-downloader` -> `src/shared/binary-downloader.ts`, so the Senpi adapter reuses the archive download, tar/zip extraction, entry validation and chmod primitives instead of copying them; `config-migration-export.test.ts` pins the two-entry export map and audits the new subpath's module graph for OpenCode SDK or plugin-runtime imports the same way it audits `config-migration`.

Why at the root: #8745 declared `@code-yeongyu/comment-checker@0.8.0` as an `omo-ai` runtime dependency to fix the missing checker; that package unpacks to 267,670,796 bytes (every platform's binary; 261,416 KiB on disk against 274,732 KiB for the whole engine), the exact payload #8256 removed from the OpenCode edition on 2026-09-14. That declaration shipped in 5.0.0-beta.87; this change reverts it (`packages/omo-native/package.json`, `bun.lock`) and gives native the same lazy pinned-release download into the shared `oh-my-opencode/bin` cache; the per-package details are in `packages/omo-senpi/changes.md` and `packages/omo-native/changes.md`. Root `CHANGELOG.md`: the beta.87 section keeps #8745's entry as released history; a new [Unreleased] `Fixed` entry describes the download path and the removal.

## 2026-09-24 - adopt senpi 2026.9.24 so the terminal default follows the recommended ladder (senpi#2074, #8770)

Every senpi pin moves 2026.9.23-5 -> 2026.9.24: the root `package.json` devDependency, `packages/omo-native`, `packages/omo-senpi` peer+dev, and `packages/senpi-task`. The same change covers `bun.lock`, the `provider-map.json` derivation comment, and the pin assertions (`omo-native` `senpi-pin.test.ts` / `package-shape.test.ts`, `omo-senpi` `package-shape.test.ts`, `senpi-task` `senpi-barrel-host-accessors.test.ts`). The release carries senpi#2074: the recommended-models ladder becomes opus-5-5 medium -> fable-5-1 xhigh -> kimi-k3 max -> gpt-6-astra xhigh -> gpt-6-sol medium -> glm-5.3 max, with ranked provider lanes and gateway aggregators excluded. That is the same order as this repo's unset `recommended` profile, so the TUI and the desktop now start from one ladder. It also carries senpi#2068 (`resolvedToolName` on RPC toolcall records). Between the two tags `builtinProviders()` registration is unchanged (only one-line catalog data edits), so the provider map needs no re-derivation.

## 2026-09-23 - adopt senpi 2026.9.23-5 so truncated bash output stops showing its drop marker (senpi#2063)

Every senpi pin moves 2026.9.23-4 -> 2026.9.23-5 (root `package.json` devDependency, `packages/omo-native`, `packages/omo-senpi` peer+dev, `packages/senpi-task`), with `bun.lock`, the `provider-map.json` derivation comment, and the pin assertions in `omo-native` `senpi-pin.test.ts` / `package-shape.test.ts`, `omo-senpi` `package-shape.test.ts` and `senpi-task` `senpi-barrel-host-accessors.test.ts`. `builtinProviders()` is unchanged between the two senpi tags (only openrouter catalog data moved), so the provider map needs no re-derivation.

The engine release carries code-yeongyu/senpi#2065 (the PTY `bash` tool's `[Showing lines A-B of N; earlier output dropped]` marker and `bash_output`'s `[N earlier chars dropped]` notice become model-only parts, so the TUI and the desktop no longer show them while the model's input stays byte-identical), senpi#2066 (auto-corrected tool names render as direct calls), and the derived cursor-variant grouping fixes.

## 2026-09-23 - adopt senpi 2026.9.23-4 for model-only tool text and codex-style exploration groups (#8732)

Every senpi pin moves 2026.9.23-3 -> 2026.9.23-4 (root `package.json` devDependency, `packages/omo-native`, `packages/omo-senpi` peer+dev, `packages/senpi-task`), with `bun.lock`, the `provider-map.json` derivation comment, and the pin assertions in `omo-native` `senpi-pin.test.ts` / `package-shape.test.ts`, `omo-senpi` `package-shape.test.ts` and `senpi-task` `senpi-barrel-host-accessors.test.ts`. `builtinProviders()` is unchanged between the two senpi tags (only openrouter catalog data moved), so the provider map needs no re-derivation.

The engine release carries code-yeongyu/senpi#2062 (model-only `audience: "model"` text parts: read/bash/find/ls/grep/webfetch notices, injected project rules, and nested AGENTS.md directory context stay in model input but no longer render in the TUI), senpi#2045 (consecutive read/grep/find/ls calls render as one codex-style `• Explored` cell), senpi#2046 (hidden diagnostics no longer duplicate the mouse-enabled frame), senpi#2059 (project-rule notices fold into the Explored cell) and senpi#2061 (skill and memory reads keep their own cards).

## 2026-09-23 - adopt senpi 2026.9.23-3 for the Claude subscription follow-ups (#8700)

Every senpi pin moves 2026.9.23-2 -> 2026.9.23-3 (root `package.json` devDependency, `packages/omo-native`, `packages/omo-senpi` peer+dev, `packages/senpi-task`), with `bun.lock`, the `provider-map.json` derivation comment, and the pin assertions in `omo-native` `senpi-pin.test.ts` / `package-shape.test.ts`, `omo-senpi` `package-shape.test.ts` and `senpi-task` `senpi-barrel-host-accessors.test.ts`. `builtinProviders()` is unchanged between the two senpi tags (only openrouter catalog data moved), so the provider map needs no re-derivation.

The engine release carries code-yeongyu/senpi#2054: settings overrides survive saves/reloads (senpi#2052), the version-floor remedy names the Claude Code that ran and its source, win32 npm `claude.cmd` shims resolve to `claude.exe`, and a promoted-model guard in senpi CI/release (senpi#2053).

## 2026-09-23 - programming skill: Rust references compile, agree with each other, and cover the missing rules (#8739)

A read of `packages/shared-skills/skills/programming`'s Rust material against the 265-rule leonardomso/rust-skills corpus found shipped defects, then the rules worth adopting.

Defects fixed at their source: `cargo-strict.md` paired `edition = "2024"` with `rust-version = "1.83"` (2024 needs 1.85; clippy `msrv` too), repeated `unreachable = "deny"` (a duplicate TOML key cargo rejects), set `too-many-arguments-threshold = 6` against SKILL.md Smell 2's 3, and allowed `missing_errors_doc` while the README template models `# Errors`. `zero-cost-safety.md` used `mem::forget` (denied) and indexing (denied), re-listed group lints at `"warn"` (a downgrade from deny), and showed `#name##Builder` inside `quote!` (invalid; the proc-macro example moved to the new `macros.md` with `format_ident!` and spanned errors). The README asserted size at item level with `const { assert!(..) };` (does not compile), made every const-eligible fn `const` mandatory (contradicting zero-cost-safety's own When NOT), silently discarded a rollback error, and cast with `as`. `async-tokio.md` hard-coded `worker_threads = 8`, had wrong cancel-safety entries (`read_buf` is cancel safe, `write_all` is not), called `CancellationToken` an opt-out, and `expect`ed signal handlers (also in `axum-stack.md`, now deduplicated). `concurrency.md` published through `static mut` + `as_ref().unwrap()` (a 2024-edition error), called parking_lot strictly faster than a futex-based std Mutex, and `unwrap`ed inside `LazyLock`. `libraries.md` combined `deny_unknown_fields` with `flatten` (unsupported by serde), recorded whole arguments with `#[instrument(skip(db))]`, imported `black_box` from criterion instead of `std::hint`, and claimed an unsourced "ahash 2-5x". `ub-taxonomy.md` used pre-2024 `#[no_mangle]` and called `extern "C-unwind"` nightly (stable since 1.71); `miri-sanitizers-loom.md` said Stacked Borrows implies Tree Borrows. `one-liners.md` called cargo-script stable since 1.85 (stable 1.97 still rejects `-Zscript`). The unwrap/expect policy now reads the same in SKILL.md, the README, clippy, and the checker: no unwrap/expect outside tests, invariant `expect` only behind `#[expect(clippy::expect_used, reason)]`.

Added where each topic lives: Rust 2024 FFI forms and `MaybeUninit` rules (`unsafe-discipline.md`); `unexpected_cfgs`, `allow_attributes`, `let_underscore_must_use`, additive features, deterministic `build.rs`, `cargo test --doc` (nextest skips doctests), rustdoc `-D warnings`, an MSRV job and a Tree Borrows miri pass (`cargo-strict.md`); numeric intent (README §9); validated newtypes with `TryFrom`/`FromStr`/`serde(try_from)` and the Deref rule (`type-state.md`); `try_join!`, async traits and `AsyncFn`, blocking std calls in async (`async-tokio.md`); `thread::scope`, `thread_local!`, `watch` borrow discipline (`concurrency.md`); tracing facade/redaction, serde representation choices, profile-first, hasher trust (`libraries.md`); `mem::take`/reuse/drop order (`zero-cost-safety.md`); test placement and doctests (`proptest-insta.md`); new `api-design.md` (naming, conversions, trait design, `#[must_use]`, `#[non_exhaustive]`, visibility, rustdoc sections) and `macros.md`. Rejected from the corpus where it conflicts with the skill: selective pedantic/nursery, `mod.rs`, mock-first tests, clone-before-await, fixed worker counts, weakest-ordering-first atomics, blanket `#[inline]`, fixed-percentage speedup claims.

Scripts: `scripts/rust/check-no-excuse-rules.sh` (the entry SKILL.md names; the unreferenced `.py` duplicate is deleted, and its entry leaves `omo-codex`'s Python inventory) now honors `#[expect(clippy::unwrap_used|expect_used, reason)]` instead of `// SAFE-*` comments, flags every `#[allow]`, `#[expect]` without `reason`, `let _ = call()`, and blocking std calls inside async code, and stays bash 3.2 compatible. New `check-no-excuse-rules.test.ts` (5 of 8 cases fail on the old script). `scripts/rust/new-project.py` produced a project that failed its own gate: it now declares `rust-version` and `publish = false`, writes a documented `main.rs`, drops the `.cargo/config.toml` that forced `-fuse-ld=lld` (link failure on macOS), and emits a cargo-deny v2 `deny.toml`; the scaffold passes fmt, clippy `-D warnings`, cargo-deny, and runs.

Verification: every edited Rust snippet was extracted verbatim into a scratch workspace carrying cargo-strict's own `[lints]` and `clippy.toml`; `cargo check` passes on 1.97 and 1.85, clippy reports no deny-level finding in doc code, the `api-design.md` doctest passes under `cargo test --doc`, and `RUSTDOCFLAGS=-D warnings cargo doc` is clean.

## 2026-09-23 - every Senpi GPT rung lists the openai lane after chatgpt-subscription (#8734)

#8300 (#8303) removed `openai` from every Senpi builtin GPT rung so the API-key lane is never ranked over the ChatGPT subscription, relying on "cross-provider fallthrough" for an `openai`-only registry. That fallthrough exists only at selection time (`delegate-core/model-selection.ts` per-rung `crossProviderCandidates`). The runtime fallback list is built by `senpi-task/src/model-chain.ts` `chainRungCandidates`, which walks each later rung's listed providers only, so an `openai`-only machine never had a GPT rung in `fallback_models`: explore on kimi -> 503 went straight to `claude-haiku-4-5` (task record `fallback_attempts` = kimi, haiku).

Source: every rung naming a GPT model and listing `chatgpt-subscription` now lists `"openai"` directly after it - `senpi-task` `agents/builtin/fallback-chains.ts` (explore, librarian luna; plan-reviewer astra x2), `category/fallback-chains.ts` (ultrabrain x4, deep-low x2, deep-high, quick, unspecified-low), `omo-senpi` `model-profile/builtin-profiles.ts` (deep-work x2). model-core's `quick` luna rung was the one model-core GPT rung without `openai`; it now reads `["openai", "chatgpt-subscription"]` like its siblings. Category defaults (`openai-categories.ts`) keep naming `chatgpt-subscription/*`.

Guards: the two `fallback-chains.test.ts` "no rung lists the openai API lane" assertions became "only gpt-* rungs list openai" plus "chatgpt-subscription leads and openai follows it"; `builtin-profiles.test.ts` the same; `builtin-agent-chain-parity.test.ts` now reorders model-core's `openai, chatgpt-subscription` to senpi's order instead of dropping `openai`. New `resolve-agent-openai-lane.test.ts` case: kimi head + `openai`-only luna + anthropic haiku -> `fallback_models` = luna, haiku (fails on the old chain with luna absent). Docs: `docs/reference/features.md`, `packages/senpi-task/AGENTS.md`. Plugin bundles regenerated.

## 2026-09-23 - unspecified-high runs Opus 5.5 at medium (#8728)

The `claude-opus-5-5` head rung of `unspecified-high` moves from `max` to `medium` in all four definitions: model-core `CATEGORY_MODEL_REQUIREMENTS`, its senpi mirror `CATEGORY_FALLBACK_CHAINS` (`packages/senpi-task/src/category/fallback-chains.ts`), and both builtin category configs (`senpi-task` `category/openai-categories.ts`, `omo-opencode` `tools/delegate-task/openai-categories.ts`). The `glm-5.3` and `kimi-k3` rungs keep `max`; the category stays ungated.

The 15 assertions that pinned the old variant moved with it (model-core `model-requirements-categories`, `category-routing-policy`, `gpt-5.6-copilot-resolution`; senpi-task `fallback-chains`, `resolve-category`, `openai-categories`, `category-routing-policy`, `anthropic-lane`, `resolve-agent-categories`; omo-opencode `tools`, `openai-categories`, `category-routing-policy`). The docs chain tables and example configs (`docs/examples/*.jsonc`, `overview.md`, `agent-model-matching.md`, `configuration.md`, `features.md`, `omo-opencode/src/tools/AGENTS.md`) now say `medium`, and the two hyperplan skill copies under `.agents/` and `.opencode/` replace their stale `kimi-k3 max -> claude-opus-5-5 max -> gpt-5.6-sol high` row with the shipped chain. The omo-senpi plugin bundles (`omo.js`, `omo-task.js`, `omo-init-deep-advisor.js`) are regenerated.

## 2026-09-23 - shipped browser guidance routes through omowright (#8727)

Layer D: `omowright` is a root devDependency pinned to a commit (`github:code-yeongyu/omowright#25781c8…`); `packages/shared-skills/stage-omowright-runtime.mjs` bundles it with `bun build --target=node` (ws and zod inlined) into `skills/browser/runtime/omowright/{index.js,page-bundle.js,manifest.json}` — `page-bundle.js` is read at import time by the library's `injected.js`, so it ships as a sidecar. `materialize-shared-upstreams.mjs` calls the stager after the frontend refs, so `build:materialize-frontend`, `prepack` and both plugin builds stage it; `--check` compares a source digest and per-file sha256. The directory is gitignored (the repo holds no copy) and packed through a sibling `.npmignore`, the same shape as the frontend skill's materialized references. 942 KB + 46 KB against the 30 MB omo-ai cap; no nested `node_modules`, so `verify-omo-ai-payload.mjs` and `browser-skill-payload.test.ts` keep their rules.

Layer A: `skills/browser` is rewritten as the two-engine router (frontmatter name stays `browser`). `scripts/omowright.mjs` resolves the staged bundle (or `OMOWRIGHT_ROOT`, or the checkout's `node_modules/omowright/src`); `browser-doctor.mjs` and `browser-install.mjs` wrap `bskDoctor()` / `bskOnboard()`; `browser-env.mjs` is gone. `references/commands.md` is the `BskSession` method table, `install.md` the external-extension registration table, `owned-engine/*` name the real API (`createCua`, `createCaptcha`, `createNetworkSnoop`, `createRoutes`, `createTrace`, `snapshotWithFrames`, `describeLayers`, `requestHuman`, `emulate`). `visual-qa` (SKILL.md step 2, `references/browser-setup.md`), `ultimate-browsing` (Tier 2, `chrome-stealth.md`, the insane-search README/playwright notes), `debugging` (`references/tools/playwright-cli.md` → `browser-qa.md`, routing table, 08-qa), `frontend` (routing row, `clone-from-url.md`), `review-work` and `ulw-execute` describe omowright.

Layer B: the Manual-QA "Browser use" paragraph in `omo-senpi/skills/ultrawork/SKILL.md`, `ulw-loop/references/full-workflow.md`, `prompts-core/prompts/ultrawork/{default,codex,gpt,gemini}.md`, the codex `plan.toml`, component README and `ulw-execute-continuation/directive.md` is replaced; `embed-directive.mjs` and `sync-directive.mjs` regenerated `generated-directive.ts`, `directive-content.ts` and `ulw-loop/directive.md`. `Playwright APIRequestContext` / `Playwright contexts` wording is gone with it.

Gate: `script/no-retired-browser-tools.test.ts` adds an omowright rule (`playwright-core`, `playwright-cli`, `Bun.WebView`, `launchPersistentContext`, `chromium.launch`) scoped to the senpi/codex guidance roots and both materialized payloads; executable skill code (the ultimate-browsing Python engine and its Playwright templates, the frontend perfection tooling) and the OpenCode edition's sources are exempt. Docs: `docs/reference/features.md` Browser Automation Options, `omo-opencode/src/features/AGENTS.md`, `shared-skills/AGENTS.md`. Out of scope by decision: the OpenCode `browser_automation_engine` provider enum and builtin skills, xterm.js TUI QA, `packages/web` e2e, the extraction engine's own Playwright fallback.

## 2026-09-23 - writing opens only on its own Claude models (#8723)

model-core's `writing` requirement now declares `requiresAnyModel: true`, the same contract `sisyphus` and `hephaestus` use, and the OpenCode edition honours it for a category in three places.

- `tools/delegate-task/categories.ts` `resolveCategoryConfig` returns `null` when no rung of the chain is available (`isAnyFallbackModelAvailable`, the helper Sisyphus registration already uses) and the user has no explicit `categories.writing` entry. Before this, the executor walked the dead chain and landed on the session's system default model.
- `category-resolver.ts` reports that as `Category "writing" has no available model: none of its fallback-chain models (...) is available`, instead of the misleading `Unknown category`.
- `cli/model-fallback.ts` skips a `requiresAnyModel` category whose chain providers are all absent (it used to write `opencode/gpt-5-nano`) and leaves it out of the no-provider config. `cli/openai-only-model-catalog.ts` drops its `writing: openai/gpt-5.6-sol medium` override, which as an explicit entry would also have bypassed the runtime gate.

senpi-task needed no source change: its dead-chain gate already leaves `writing` `model_unavailable` and unlisted, because no production caller passes `systemDefaultModel`. New `dead-chain.test.ts` cases pin that, including that Copilot's dotted `claude-fable-5.1` still opens the lane. The prompt and tool-description listings that still advertise gated lanes are filed separately as #8724.

## 2026-09-23 - ultrawork and the skills verify behavior instead of mandating TDD (#8719)

The ultrawork directive (`packages/omo-senpi/skills/ultrawork/SKILL.md` and its generated pair `src/components/ultrawork/generated-directive.ts`; the Codex variant `prompts-core/prompts/ultrawork/codex.md` with its generated `omo-codex/.../ultrawork/src/directive-content.ts` and byte-equal `ulw-loop/directive.md`; the OpenCode variants `default.md` / `gpt.md` / `glm.md` / `gemini.md`) made a failing test the proof of every change with a seam: `PIN -> RED -> GREEN -> SURFACE`, "Every behavior change needs a failing-first proof captured BEFORE the production change", a RED-before-GREEN criterion bullet, and the same rule echoed in the todo example, Commits, Output, and Constraints. Any simple edit inside a tested module has a seam, so the rule mandated tests that could only restate the change, and RED on a change that creates a module was an import error with zero assertions. The harness had grown counter-rules (the PROSE TARGET / mutation-proof paragraphs, the "test that cannot fail" constraint, the reviewer slop passes) to catch the fallout, and `programming` ("No production line ships without a failing test", "Every feature ships with all three rungs") contradicted the engine presets' "commit tests only where the repository keeps tests for that kind of change".

Each surface now states the engineer's loop once: READ the tests covering the area before touching it (the behavior of record: intent, coverage, pass; one wrong before the change is a FINDING, never edited green; a bug is reproduced first), CHANGE the smallest thing and update tests the change makes stale, add a test ONLY where the repository keeps tests for this behavior AND a regression would otherwise pass unnoticed (never one that restates the change), RUN the real-surface scenario plus those tests. `ultrawork/SKILL.md` 578 -> 549 lines, `codex.md` 494 -> 465, and the four OpenCode variants shrink; `programming/SKILL.md` loses `## TDD DISCIPLINE`, `### The order`, and the all-three-rungs / zero-E2E-is-undone mandates (the pyramid, Given/When/Then, mock ladder, prose-test ban, and anti-patterns stay; one anti-pattern row now names the change-restating test). `debugging` invariant 3 and `06-fix.md` keep the reproduce-first rule as the reproduction rule; `ulw-execute` Hard rules and the delegation router line, `omo-codex ulw-execute-continuation/directive.md` Hard constraints, both `define-goal.md` copies, `hephaestus/gpt-6.md` Verification (now the engine's shared test-decision sentence), and root `AGENTS.md` protocol step 6 follow. Emphasis is UPPERCASE and bold on the words that carry the decision; no surface grows.

Generated artifacts: `embed-directive.mjs` and `sync-directive.mjs` re-run; the omo-senpi plugin bundle regenerated and `--check`ed under Node 24. No sentence-pinning test is added; the existing copy-equality tests (`directive-source.test.ts`, `ultrawork-directive.test.ts`, `ultrawork-prompts.test.ts`) are the machine seams. The engine side of the same change is senpi #2035 / PR #2036 (GPT preset `TEST_FIRST` -> `TEST_DECISION`).

## 2026-09-23 - deep-low drops its GPT-5.6 Sol rung and gate (#8718)

#8714 left `deep-low` ending in a `gpt-5.6-sol` medium rung, with both `deep-low` activation gates still accepting `gpt-5.6-sol`, so the task tool listed `deep-low (requires gpt-6-sol-fast or gpt-6-sol or gpt-5.6-sol)`. The rung is removed from model-core `CATEGORY_MODEL_REQUIREMENTS` and senpi-task `CATEGORY_FALLBACK_CHAINS`, and `DEEP_LOW_GATE_MODELS` (omo-opencode and senpi-task) is now `gpt-6-sol-fast`, `gpt-6-sol`. A GPT-5.6-Sol-only registry now reports `deep-low` unavailable, pinned by new gating, routing and resolver tests, and the installer's OpenAI output carries `gpt-6-sol` as the lane's only `fallback_models` entry. `ultrabrain` keeps its GPT-5.6 Sol max fallback and the OpenCode-edition agent chains are untouched. The unreleased #8714 CHANGELOG entry is corrected rather than contradicted by a second entry.

## 2026-09-23 - explore/librarian trimmed to six rungs on DeepSeek V4.1 Flash; every DeepSeek Flash rung renamed to `deepseek-flash` (#8115)

DeepSeek's 2026-09-10 changelog renames the V4.1 Flash API model to `deepseek-flash` and keeps `deepseek-v4-flash` only as a temporary alias. The pinned engine (senpi 2026.9.23) `providers/data/deepseek.json` lists `deepseek-flash` and `deepseek-v4-pro` and nothing else, so the builtin `deepseek/deepseek-v4-flash` rung in `explore`, `librarian` and `quick` could never resolve on OmO Native. models.dev serves the same id (`deepseek/deepseek-flash`, "DeepSeek V4.1 Flash"), so both editions use it.

`AGENT_MODEL_REQUIREMENTS` (model-core) and its senpi mirror `AGENT_FALLBACK_CHAINS` now carry exactly: kimi-for-coding-highspeed off -> gpt-6-luna-fast low -> deepseek-flash max -> qwen3.7-plus -> minimax-m2.7 -> claude-haiku-4-5, each edition keeping its own provider lists (senpi's `kimi-coding` head and `anthropic-subscription` lane, model-core's `openai` lane). `quick` keeps its shape and only swaps the id. Consequences the tests now pin: the capability snapshot needed a `deepseek-flash` supplemental entry (models.dev limits: 1M context, 384K output, text+image), and an OpenCode install whose only provider is a MiniMax Coding Plan omits `librarian` and gives `explore` the `opencode/gpt-5-nano` ultimate fallback instead of routing both to `MiniMax-M3`. `KNOWN_MODELS.deepseek` adds `deepseek-flash` and keeps `deepseek-v4-flash` so sessions on an older pin are not masked to `custom`.

Proof: a new `resolveAgent` case serves every past and present rung (both DeepSeek ids included) and asserts the winner plus the exact runtime fallback list; it and the pinned tables failed on `dev` (17 failures) before the change. Gate: every test file naming the chain tables, DeepSeek ids, the capability snapshot or the installer config (85 files, 1457 tests) passes.

## 2026-09-23 - deep-high on GPT-6 Astra xhigh, deep-low led by GPT-6 Sol Fast medium (#8714)

`CATEGORY_MODEL_REQUIREMENTS` and senpi-task's `CATEGORY_FALLBACK_CHAINS` change together, as do the two builtin category configs (`omo-opencode` `tools/delegate-task/openai-categories.ts`, `senpi-task` `category/openai-categories.ts`) and both `deep-low` activation gates. `deep-high`'s single `gpt-6-astra` rung moves from `high` to `xhigh`. `deep-low` gains a `gpt-6-sol-fast` medium head rung, on `openai` + `chatgpt-subscription` in model-core and on `chatgpt-subscription` alone in senpi-task (#8300 keeps the metered API lane out of senpi chains). It is kept on those providers because the senpi catalog publishes the Fast tier only on the OpenAI lanes; GitHub Copilot and OpenCode Zen serve plain `gpt-6-sol`, which stays as the next rung, followed by `gpt-5.6-sol`. The installer therefore writes `openai/gpt-6-sol-fast` with `gpt-6-sol` and `gpt-5.6-sol` as `fallback_models` on an OpenAI install, while a Copilot-only install still starts on `github-copilot/gpt-6-sol`.

`gpt-6-sol-fast` gets a supplemental capability entry cloned from `gpt-6-sol` (the same parity `gpt-6-luna-fast` needed, pinned by `model-capability-guardrails.test.ts`), and joins the three OpenAI lanes of the telemetry vocabulary so it exports under its own id; `docs/reference/senpi-telemetry.md` is regenerated from its generator. `ultrabrain` (Astra max -> GPT-5.6 Sol max) and `unspecified-high` (Opus 5.5 max -> GLM 5.3 max -> Kimi K3 max) are already the requested defaults and are unchanged. `docs/reference/configuration.md`'s provider-chain table still listed `gpt-6-astra (high)` as the first `unspecified-high` rung (stale since #8617), and it now shows the shipped chain; the retired single `deep` row in that table, `features.md` and `agent-model-matching.md` is split into `deep-low` and `deep-high` rows.

## 2026-09-23 - Update-checker tests no longer poison their sibling's registry results (#8678)

`hook.test.ts` registered a process-global mock of `checker/latest-version` even though its injected `runBackgroundUpdateCheck` already called the local `latestVersionMock` directly. When the hook test loaded first, the checker barrel retained that mocked export and all five registry-channel assertions received `3.0.1`, including the HTTP 502 case.

The redundant module registration is removed; the injected hook stub and every assertion remain. The ordering reproduction uses explicit `./` file arguments in one Bun invocation, since bare file-name filters let discovery choose the opposite order. The hook-first run was captured at 10 pass / 5 fail before the change; both file orders and the complete updater directory are the verification gates.

## 2026-09-23 - omob installs unpublished engine bundles without resolving their workspaces from npm

The development build packed the current engine and then passed that tarball to `bun install`. Bun resolves declared dependencies even when the tarball bundles them, so an engine source version whose sibling packages are not yet published failed with `No version matching` before the binary build.

`script/omob-senpi-install.ts` extracts the packed graph unchanged, verifies that every declared bundle exists, and installs only non-bundled dependencies and platform-specific optionals with lifecycle scripts disabled. The remaining packages are nested alongside the packed dependencies without replacing them, including packages under the same scope. `build-omob.ts` awaits this installation before caching the artifact.

Regression coverage uses real tarballs and real Bun installs against an isolated local registry: unpublished bundled aliases never request registry metadata, required and optional sidecars remain loadable, and a missing bundle fails before any registry request. The original installation and all three regression cases were captured failing before the repair.

## 2026-09-23 - QA evidence leaves the tree for good: `.qa-evidence/` and `.omo/evidence/` are gone and cannot come back (#8703)

`dev` tracked 3,318 QA capture files: 11 under a root-level `.qa-evidence/` that arrived with #8634 and #8638 on 2026-09-22 (an orchestrator's child briefs named `<worktree>/.qa-evidence/<name>-RED.txt` as the capture path, listed the directory as writable scope, and made its existence part of the stop condition, so the children committed the captures with the fix), and 3,307 under `.omo/evidence/` (51 MB), which the root `AGENTS.md` mandated and a `!.omo/evidence/` negation force-kept through `.omo/*`. #8406 and #4441 had each removed a batch of strays and left the mandate standing, so the same class kept returning: fresh clones opened dirty on two CRLF transcripts and `git rebase` refused to start (#7619), the scheduled model-capabilities refresh failed on every run for the same reason (#6919), and `gpt-mini-reference-audit.test.ts` already had to carve `.omo/evidence/` out of its scan. Both directories are removed from the index and the working tree; history is untouched.

The policy changes rather than the batch: evidence is still written under `.omo/evidence/<slug>/` (the `senpi-qa` resolver, `ulw-loop`'s `ulwLoopEvidenceRoot`, and the QA drivers keep that path) but it stays on the machine that ran the QA, and the PR body's QA & Evidence section carries the four reviewer items plus the decisive excerpts. `.gitignore` drops the two `!.omo/evidence` negations so `.omo/*` covers it again, and adds `.qa-evidence/` and `qa-evidence/` at any depth for the hand-typed roots. A second audit, `script/tracked-evidence-paths-audit.test.ts`, reads `git ls-files` directly and fails on any tracked path under `.omo/evidence/`, `packages/*/.omo/evidence/`, `.qa-evidence/` or `qa-evidence/`, so a future negation or `git add -f` turns CI red instead of silently re-tracking; it is RED against the `origin/dev` index (3318 files) and GREEN on this tree, and the existing tracked-ignored audit stays as the `.gitignore`-consistency layer. The root, `.agents/`, `omo-senpi`, `omo-opencode/src` and `omo-codex` AGENTS.md files, `CONTRIBUTING.md`, the PR template, the `senpi-qa` and `codex-qa` skills, and `docs/templates/AGENTS.md.example` now say the same thing in one sentence each: local file, PR-body summary, never committed. `contributing-accuracy.test.ts` keeps passing because `CONTRIBUTING.md` still names `.omo/evidence`; the lsp-daemon portability test and `codex-hook.test.ts` write their own fixtures and never read committed evidence.

## 2026-09-22 - Claude Opus 5.5 becomes the default Opus at max, and `writing` stops leaving the Claude family (#8684)

Every shipped rung that named `claude-opus-5` now names `claude-opus-5-5`, and the rungs that ran at `xhigh` run at `max`. That covers `CATEGORY_MODEL_REQUIREMENTS` (visual-engineering, artistry, unspecified-high, writing), `AGENT_MODEL_REQUIREMENTS` (sisyphus, oracle, metis, momus), both senpi-task tables (`CATEGORY_FALLBACK_CHAINS`, `AGENT_FALLBACK_CHAINS`), `unspecified-high`'s builtin category config, and the Capable model profile. Opus 5 keeps its catalog row, its prompt variant and its tests; it is a demotion, not a removal.

`writing` is the one chain whose shape changed rather than its ids: it ran fable-5-1 `low` -> kimi-k3 `low` -> opus-4-6 `low`, and now runs fable-5-1 `low` -> claude-opus-5-5 `low` -> claude-opus-4-6 `max`. The chain was declared twice and the two declarations had drifted apart - `model-core` carried the three-`low` shape while senpi-task carried fable `max` -> opus `max` -> kimi `max` - so both were rewritten to the same three rungs rather than one being patched to match a stale sibling. `docs/reference/configuration.md`'s Writing row had drifted a third way (fable `medium` -> kimi `max`) and is corrected to the real table.

The bundled capability snapshot gains the ten `claude-opus-5-5` entries the requirement models need, and nothing else. Regenerating it wholesale would have pulled two months of upstream catalog drift into this diff (2744 -> 3631 models, ~59k lines) and changed capability answers for models this work never touched; that refresh belongs to the scheduled `refresh-model-capabilities` workflow.

`packages/omo-opencode/src/agents/sisyphus/claude-opus-5.ts` keeps serving both releases - the Opus 5 prompting patterns carry over to 5.5 and `isClaudeOpus5Model` already matches both ids - but its `<self_knowledge>` block hardcoded `Claude Opus 5` / `claude-opus-5`, so a 5.5 session was told it was a different model than the one running. The block now renders from the `model` argument the builder already receives. The fallback-architect friendly-name map gained a 5.5 entry BEFORE the generic `claude-opus-5` pattern, which would otherwise label 5.5 as "Opus 5"; the telemetry vocabulary ADDS the new id and keeps the old one, matching #8683's reasoning that a binary on an older pinned engine must not be masked to `custom` mid-rollout.

Evidence that the bundle regeneration landed rather than trusting `--check`: `claude-opus-5-5` occurrences in the nine tracked `plugin/extensions` files went 0 (on dev, all nine) -> 1 in `omo.js`, `omo-task.js` and `omo-init-deep-advisor.js`, and only then does `build-extension.mjs --check` report the build current. Taking dev's bundle during conflict resolution and running `--check` alone would have reported "current" against a bundle that does not contain this change.

The docs sweep was audited against HEAD afterwards rather than trusted: eight rows list an Opus rung and a GPT rung in the same line, so a line-scoped `xhigh` -> `max` replacement flipped GPT-6 Astra's and GPT-5.6 Sol's own levels as collateral. All eight are restored and a per-model token count now shows zero non-Opus `xhigh` losses. The same sweep would have renamed the `claude-opus-5.ts` FILE references in `sisyphus/AGENTS.md`; the file keeps its name and those rows say so.

Gates: `packages/model-core` 403 pass / 0 fail, `packages/senpi-task` 2584 pass / 0 fail, `packages/omo-senpi` telemetry 210 pass / 0 fail after regenerating `docs/reference/senpi-telemetry.md` from its generator (that block is byte-pinned by `schema-doc.test.ts`).

## 2026-09-22 - A DAG node's own output reaches the snapshot, and a silent child is visible (#8674)

`DagRunSnapshot`'s node carried no output field at all. The text was never lost - `persistDagNodeResult` copies every terminal child's final response into the result store synchronously inside the terminal journal mutation, precisely so residency eviction and the task TTL cannot take it - but the ONLY surface that read it back was `createDagWaitSurface`'s terminal `DagRunResult` (`handle.ts:203`). The `workflow` tool's own description tells the model to detach (`action=wait` defaults `detach: true`) and peek with `action=snapshot`, and that path returns `manager.snapshot()`, which is `projectSnapshot(record)` with `nodes: record.nodes` passed straight through. So the recommended flow could never read a claim, which is what #8674 reported as `outputLen=0` on five nodes the scheduler itself had marked `completed`.

The preview is stamped where the durable copy is already being written: `applyDagSchedulerEvent`'s terminal branch holds `terminalResult.record.final_response` (live path) or the text `replayDagNodeResult` just read off disk (replay path), and the checkpoint write happens either way, so `output` (bounded by `DAG_NODE_OUTPUT_PREVIEW_CHARS`, 2000) and `outputBytes` (`persisted.artifact.bytes`, always the FULL size) cost zero additional IO and survive a crash. Reading the artifacts back per snapshot was rejected: `manager.snapshot()` is on the status-UI and RPC-bridge heartbeat paths, so that would have been one file read per terminal node per tick, on up to `max_runs_per_session` runs. `clearedTerminalOutcome` and both `applyDagRunMutation` reducers drop the pair with the rest of the terminal outcome, so a revived or amended node never shows the previous attempt's claim.

The reporter's second symptom, `ended=?`, is NOT a defect: `transitionedNode` stamps `completedAt` for every terminal state and `projectSnapshot` passes it through. A run dumped through the real harness carries `completedAt` on each completed node and on the wire as `completed_at`. Their "related but distinct" run - a node reported `completed` with zero output - collapses into the same projection gap rather than being a second capture bug: an empty `finalResponse` cannot produce a completed node at all, because `manager-outcome.ts:178` only persists `complete` when `outcome.finalResponse.length > 0` and otherwise terminalizes the record as an error. That is why the new `outputBytes: 0` case is pinned against a FAILED node - the real shape a child returning nothing produces.

`lastActivityAt` answers the other half: a running node with no way to tell a working child from a finished-but-unreaped one. It is read from the child's transcript log mtime (`<stateDir>/logs/<taskId>.jsonl`, the path helper now exported from `store/event-log.ts` so writer and reader share one definition), because the manager appends one line per assistant message and per tool call. `TaskRecord.updated_at` cannot answer it: `state/transitions.ts` moves it only on status and residency transitions, so a child silent for an hour still reads as freshly updated. The projection is confined to `scheduled`/`running` nodes holding a `taskId`, so a settled node never reports a stale "last seen", and it is one `statSync` per live node - bounded by the resident-child cap, not by run size. EVERY stat fault reads as "no activity recorded", not just the missing file `throwIfNoEntry` covers: `projectSnapshot` is called on the rpc bridge's and the status UI's timers, where a throw is an `uncaughtException` that ends the session, and win32 answers a stat on a file an indexer is holding with a sharing violation (the failure class #8672 is fixing one directory over). Removing that guard reddens exactly the fault assertion, with a real `ENOTDIR`. `quietNodesNotice` puts the observation on the `snapshot` and detached-`wait` result lines past `DAG_NODE_QUIET_AFTER_MS` (10 min). It states the silence and renders no verdict: one long tool call is indistinguishable from a stalled child, and nothing here cancels or fails a node.

The node never LEAVING `running` is the other defect and is not fixed here. `attachTaskSettlement` (`scheduler.ts:815`) folds a node only when `taskManager.waitFor(taskId)` resolves, which happens only at terminal status, so a child whose record never goes terminal holds its node forever. That is #8659's lifecycle question (a host-session child judged by `hasForeignLiveOwner`'s signal-0 probe rather than `daemonAlive && sessionLive`), and re-deriving liveness inside the DAG would duplicate it in the wrong layer.

Mutation proof, both directions: dropping ONLY the output stamping reddens all four output assertions and leaves the three activity assertions green; dropping ONLY `withNodeActivity` reddens two activity assertions and leaves all four output assertions green. The third activity test asserts ABSENCE on a settled node, so it stays green under that mutation by design - it is an over-projection guard, not feature proof. Gates: `bun test packages/senpi-task/src/dag` 330 pass / 0 fail, the new `dag-quiet-nodes` unit 4 pass / 0 fail, `tsgo --noEmit` clean on both `senpi-task` and `omo-senpi`, extension bundle regenerated and `build-extension.mjs --check` reports current.

## 2026-09-22 - DAG resume stopped re-adopting nodes whose child nothing here can settle (#8657)

`reconcileNodes` re-adopted every node whose owned task record still read `pending`/`running`, using that status as its only liveness signal (`recovery.ts:319`). Status answers "has this child finished"; re-adoption needs "can this run still observe that it finished", and those diverge. A daemon-hosted child is deliberately PARKED rather than lost — `residency_state: rpc_detached`, `suspension_reason: daemon_unavailable`, status kept `running` so `isColdRevivalCandidate` (`revive-policy.ts:38-50`) can reopen it from its transcript later — and a record left `resident` under a foreign pid is deferred untouched by lifecycle reconcile. Re-adopting either hands the node to `attachTaskSettlement` (`scheduler.ts:810`), whose only feedback channel is `taskManager.waitFor`. That resolves from an already-terminal stored record or from this process's own waiter map (`manager.ts:749-782`), so a child nobody here holds never settles: the node stays `running` in the checkpoint, and every later resume re-affirms it. Observed on a run that had been re-adopted across six generations, its two nodes dead for ~8 hours and still `running` after each restart, dependents behind them never unblocking.

The gate is one question asked before re-adoption: does THIS host hold the child, i.e. `taskManager.getResidentHandle(task_id)` — the same `#live` map (`manager.ts:653`) that feeds those waiters. Deliberately NOT a signal-0 probe on `host_pid`: a pid can be alive while the session it hosted is gone, which is exactly how the second specimen node froze. Ordering makes the question decidable: `wireDagLifecycle` registers the task lifecycle's `session_start` before its own (`components/task/index.ts:262-273`), so by the time recovery reconciles, a revivable child already carries a handle and an unrevivable one never will. A node that fails the gate transitions to `failed` with the new `resume_task_orphaned` code, whose message carries the record's residency evidence (`residency_state`, `suspension_reason`, `runner_kind`, `host_pid`); retry and send stay available, and dependents cascade to `skipped` as usual. Children this pass just started are exempt by construction: admission can return them queued (`pending`, no handle yet), so `startedHere` tracks the ids `startOwned` produced in the same reconcile.

RED at `ec999486d` is an assertion, not a timeout: the resume is raced against the fake manager's first `waitFor`, and a settlement wait on an unheld child never resolves, so `expect(race).toBe("resumed")` received `"awaited-orphan:task-parked"`. Reverting only the five-line gate reddens exactly that assertion and leaves both controls green — a node whose child this host does hold is still reattached and folds when the child settles, and a freshly started queued child is not judged orphaned. Live acceptance on the specimen run, resumed twice: before the fix the resume moved it `paused -> running`, generation 5 -> 6, checkpointSeq 47 -> 50, and re-stamped the parked child's `updated_at` to resume time while its pid stayed null; after the fix both nodes read `failed` with `error.code: resume_task_orphaned`.

`recovery.test.ts` and `recovery-nonblocking.test.ts` each carried a fake manager that hardcoded `getResidentHandle(): undefined` while simulating a child it would later settle through `waitFor` — a world the real manager cannot produce. Both now answer "held" from the same map their completions come from, which is what the production seam means. Gates: 323 pass / 0 fail across `packages/senpi-task/src/dag`.

## 2026-09-22 - DAG retention actually runs, and its sweep stopped being quadratic (#8651)

`DagFileStore.pruneExpired()` was typed on the public store surface, covered by four tests, and called from nothing. DAG checkpoints, event logs, results and keys therefore accumulated forever, well past the `retention_days: 7` the settings advertise. Measured on a long-lived project dir: 711 checkpoints with the oldest dated Aug 28, 25 days against a 7-day policy.

The call site is `createDagRuntime` (`dag-runtime.ts`), the single production constructor of the DAG store — `components/task/index.ts:115` is its only non-test caller, so one seam covers every production path. It runs once per runtime rather than per write or per repaint: retention is measured in days, so a sweep per session bounds growth without adding a timer lifecycle to leak, and `writeCheckpointWithinSessionLimit` / `list()` are exactly the latency-sensitive paths #8649 just finished unblocking. The scheduler is injectable (`retentionSweep.schedule`, the same shape as the existing `leaseWatch` / `bridgeTimers` seams) and defaults to an unref'd `setTimeout(0)`, so session start returns before the directory walk begins. A sweep failure is logged, never thrown: a stale checkpoint must not fail a session.

The sweep was also quadratic. `pruneRunArtifacts` re-read the ENTIRE `keys` and `locks` directories for every run it pruned, so 526 expired runs against 711 key files cost 526 x 711 reads. Both directories are now indexed once per sweep into `runId -> files` maps. Against a copy of the real 170MB state dir the sweep went from **4591ms to 646ms (7.1x)** with a byte-identical outcome: 526 runs pruned, 10623 files down to 1779, 170M down to 38M.

`dag-retention-sweep.test.ts` drives all four cases through `createDagRuntime`, never by calling the store method, so deleting the call site turns it red. RED was 2 fail / 2 pass — the expired run survived, and the deferred case failed as `still present after 2000ms`. The two guard cases passed vacuously in RED (nothing pruned anything), so each was mutation-proven separately: removing the retention-window check reddens only "a terminal run inside retention_days ... the run is kept"; removing the terminal-status check reddens only "a paused run ... whose lease holder is alive ... the run is kept"; making the default scheduler inline reddens only "construction returns before the sweep touches the disk". `store-retention-cost.test.ts` pins the complexity by counting directory scans rather than a duration, because a timing threshold flakes on a loaded machine — restoring the per-run re-scan turns it red at `Expected: 1, Received: 6`.

The acceptance criterion "never removes a run whose lease holder is alive" needed no semantic change: a lease holder (`leaseHolderPid`) belongs to a `paused` run, `paused` is not in `TERMINAL_STATUSES`, and non-terminal runs were already skipped. That is now asserted rather than assumed. Gates: 318 pass / 0 fail across `packages/senpi-task/src/dag`, 627 pass / 0 fail across `packages/omo-senpi/src/components/task`, `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` clean.

## 2026-09-22 - unspecified-low leads with MiMo V2.6 Pro and moves its Grok rung to 4.7 (#8652)

`unspecified-low` opened on `grok-4.6 (xhigh)`. The chain now opens on `mimo-v2.6-pro (max)` behind `xiaomi|opencode-go` (both measured to serve it), with the Grok rung bumped to `grok-4.7 (xhigh)`. `grok-4.7` is not served by the `opencode` provider (models.dev, measured this run), so that provider left the rung — an unserved provider on a rung is the #7181 defect class — and `opencode-go`, which does serve it, took its place. The trailing `mimo-v2.5-pro (max)` rung stays as the last resort.

Mirrors moved together: `model-core/category-model-requirements.ts` (source of truth), `senpi-task/category/fallback-chains.ts` (fork quirks preserved: claude-sdk-oauth-headed claude rungs, openai-codex-only OpenAI lane), both `openai-categories.ts` builtin configs (`xiaomi/mimo-v2.6-pro max`), `supplemental-entries.ts` (+`grok-4.7`, `xai/grok-4.7` mirroring the 4.6 shape), and the telemetry vocabulary (`model-vocabulary.ts`: +grok-4.7 on xai/github-copilot/opencode-go, +mimo-v2.6-pro on xiaomi/opencode-go) so no shipped rung masks to `custom`.

New `unspecified-low-chain.test.ts` resolves the category against a registry serving every rung at once — the winner proves order, not availability. RED: 12 fails for the intended reasons. GREEN: 534 pass / 0 fail across 40 files (identifier-scoped gate). Mutation A (engine mirror left on the grok-4.6 head): 5 red including the transcription pin; restored 14/14. Mutation B (grok rung swapped back on top in both senpi mirrors): the order assertion went red; restored 3/3. The 12 skills-sync failures seen on a fresh checkout were proven pre-existing on pristine origin/dev in a throwaway probe worktree (same 12, same reason at `skills-sync.test.ts:85`). Extension bundle regenerated with bun 1.4.2 (the CI pin); `build-extension.mjs --check` green. Evidence: `.omo/evidence/20260922-8652-unspecified-low-chain/`.

Two measured capability facts, named rather than glossed. (1) `xhigh` on any grok model clamps to `high` with reason `unsupported-by-model-metadata` through the variant ladder in `model-settings-compatibility.ts` (`resolveField`), the allowed tiers coming from the grok family registry entry (`model-capability-heuristics.ts`, variants low/medium/high) — identical for 4.6 and 4.7 on every provider, so the rung behaves exactly as its predecessor; the GPT-only GitHub Copilot override plays no part. (2) `variant max` is dropped for mimo models with `unknown-model-family` in the CLI install-config path — the same drop today's `mimo-v2.5-pro` trailing rung already has (measured); the senpi resolution path keeps `max` (asserted). A mimo family ladder in the capability registry is the follow-up, not this change.

The first cut shipped no mimo supplemental entry, and the named guardrail gate caught it: `bun run test:model-capabilities` went red on `model-resolution.test.ts` "does not warn for known provider aliases used by current recommended models" — the doctor's capability diagnostics flagged the new head rung as a compatibility fallback because `mimo-v2.6-pro` had no snapshot backing (the code path: `collectCapabilityResolutionIssues` over the builtin tables). `mimo-v2.6-pro` and `xiaomi/mimo-v2.6-pro` supplemental entries now mirror the catalog's `family: "mimo"` representation with the measured v2.6 limits (context 1048576, output 131072, reasoning true; modalities trimmed to the repo's coding-lane `text+image` convention — models.dev claims audio/video/pdf as well). Gate green after: 58 pass / 0 fail.

## 2026-09-22 - Listing DAG runs stops re-parsing the whole runs directory, so resuming a DAG-bearing session repaints (#8649)

`DagManager.list()` read and `JSON.parse`d every checkpoint in `<stateDir>/dag/runs` on each call, discarding foreign-session records only after parsing them, so one session's repaint paid for every session's history. On a state dir holding 710 checkpoints / 68MB that is 473ms median of synchronous main-thread work (5 runs: 409 / 525 / 373 / 472 / 534). The DAG status widget calls it once per 1Hz frame (`dag-status-ui.ts:161`, `LIVE_REFRESH_MS`), and `dag-runtime.ts:449`'s `mutationListener` calls it three more times for every checkpoint write - `bridge.sync()`, `syncActivitySubscriptions()`, `statusUi.scheduleSync()` - so a single node transition cost around 1.4s of blocking. A resume is a burst of checkpoint writes, which is why the screen froze there: the process stayed alive and answered prompts while its output writer starved.

`list()` now keeps a per-run summary cache validated against `(ino, size, mtimeMs)`. Checkpoints land through a temp+rename (`store.ts` `writeFileAtomic`) that always allocates a new inode, so a matching triple means byte-identical content. The directory listing stays authoritative - the cache holds parses, never membership - so a new run appears, a rewritten run re-reads, and a pruned run disappears exactly as before. Steady state is one `statSync` per file: 3.4ms for the same 710 files, against 473ms.

The `process.kill(pid, 0)` lease probe in `dag-status-row-format.ts:160` was measured rather than assumed, and left alone: 0.20 microseconds per probe, one per *paused run* because the `&&` short-circuits, which is around 2.4 million times cheaper than the `list()` call in the same frame. `syncActivitySubscriptions()` still runs per event; with `list()` cached its remaining cost is the per-live-run `record()` parse, tracked separately rather than folded in here.

`manager-list-cache.test.ts` asserts checkpoint READS per `list()` rather than a duration, because a timing threshold flakes on a loaded machine: unchanged runs read 0, a rewritten run reads exactly 1, a pruned run reads 0 and leaves the list. RED was 0 pass / 3 fail with the cache reverted. The invalidation case was proven fail-able by making the cache skip revalidation, which turns it red at `reads 0, expected 1`. Captures in `.omo/evidence/20260922-dag-list-summary-cache/`.

## 2026-09-22 - The OmO Native wording guard scans docs, native bins, and runtime notices (#8632)

`native-wording-guard.test.ts` scanned only installer sources, `postinstall.mjs`, the install guide, and the five READMEs, so edition-named-after-engine copy in `docs/reference/**` and in runtime notices could land without failing CI. The guard now also walks `docs/reference/**/*.md`, `docs/guide/*.md`, `docs/legal/*.md`, `packages/omo-native/bin/**/*.js`, `packages/omo-senpi/src/components/**/*.ts` (except `*.test.ts`), and `packages/web/src/**/*.{ts,tsx,astro,md}` when that tree exists.

`BANNED_EDITION_WORDING` and the original `ENGINE_NAME_ALLOWLIST` entries are unchanged. Added allowlist rows name engine-owned leftovers the wider scan meets: the `senpi-telemetry` document, `omo_senpi_*` event names, the `omo-senpi:` machine-id prefix, `WARN senpi:` harness warnings, session-id prefixes, issue refs, the `OMO_SENPI` telemetry env prefix, and compound source identifiers such as `resolveSenpi` and `senpiRoot` (a bare `senpi` is deliberately excluded from that row).

The first attempt at absorbing those leftovers exempted `packages/omo-senpi/src/components/**` and `packages/omo-native/bin/**` from the allowlisted-mention rule outright and added a bare `\bSenpi\b` allowlist row. Both were holes: planting `choose senpi today` in the adapter and `Choose Senpi today.` in `docs/reference/known-issues.md` left the guard at 17 pass / 0 fail, and the guard's own can-fail case kept passing only because it spells the word lowercase while that row was case-sensitive. Both were removed. In their place is one rule — the engine may be NAMED but never OFFERED as something to adopt — expressed as a negative lookbehind on `choose|use|install|try|adopt|switch to|move to|get`, which keeps `the Senpi runtime` and `senpi CLI:` while still reporting `Choose Senpi today.`. Can-fail cases now pin the capital-S spelling beside the lowercase one, and the per-family plant proof runs a rule-2-only phrase in addition to the rule-1 phrase, because planting `Senpi edition (beta)` everywhere exercised rule 1 alone and could never have revealed the disabled rule.

Three edition-named-after-engine sentences were reworded rather than allowlisted (`docs/reference/release-process.md`, `docs/reference/omo-ai-publishing.md`, `docs/guide/senpi-task.md`). Two other docs lines were aligned to the existing `senpi engine` allowlist so the guard would not need a bare-`senpi` hole. Planted-fail proof per new family is in `.omo/evidence/20260922-wording-guard-scope/`.

## 2026-09-22 - Docs and setup output name the standalone edition OmO Native, and the CLI reference recommends bun (#8628)

`docs/reference/cli.md` introduces the `omo` bin as OmO Native and leads with `bun add -g omo-ai@beta`, labelling `npm i -g omo-ai@beta` as the fallback. `docs/guide/overview.md`, `docs/guide/binary-install.md`, the Native-harness annotations in `docs/reference/omo-json.md`, and the opening of `docs/reference/senpi-telemetry.md` stop naming the edition after its engine. Custom-endpoint setup copy points at the engine's `models.json`. The `WARN senpi:` prefix on a malformed `auth.json` stays; it is a harness id in a per-harness table, not the product name. Links that targeted `#model-profiles-senpi-harness` or `#git_master-senpi-harness` now use the Native-harness slugs.

## 2026-09-22 - config.jsonc migration emits [native]; reasoning unification visits it too (#8631)

`transformConfigJsoncSources` still wrote `"[senpi]": senpi ?? omo` after #8623 made `[native]` canonical, so a fresh leftover-file migration produced the retired key. It now writes `[native]`, and the overlap diagnostic names that key. `transformReasoningUnification` walked only `["[senpi]", "[codex]"]`. The harness-rename migration runs after it, so a mid-batch file and a hand-written `[native]` block both need the walk; the loop is now `["[senpi]", "[native]", "[codex]"]`. Tests that pinned the retired output spelling are realigned. RED/GREEN in `.omo/evidence/20260922-migration-native-key/`.

## 2026-09-22 - The standalone edition names itself OmO Native in its own notices (#8629)

The footer badge read `(😺 OmO Native)` and the doctor edition line printed `Edition: Native`, while the notices above them opened with the internal adapter id: `telemetry/omo-native-notice.ts` began `omo-senpi sends anonymous usage telemetry`, `model-profile/index.ts` built every notice as `omo-senpi: model profile ...`, and `config-startup/index.ts` prefixed its five migration and diagnostics messages the same way. One screen carried two names for one product.

Every user-rendered notice in those three components now says `OmO Native`. The engine keeps its name where the sentence is about the engine (`keeping senpi's default model`, `mid-session fallback follows senpi's retry chains`), matching the doctor line's `(engine: senpi X)`. The two `ctx.logger.warn` calls in model-profile that never reach a user were deliberately left alone.

Telemetry identifiers did NOT move, and `telemetry/identity-invariants.test.ts` now pins all four - `omo_senpi_daily_active`, the `omo-senpi:` machine-id prefix, and the product `platform`/`productName` - because the dashboards join on them and a rename would break continuity silently. That test was proven fail-able by temporarily renaming the prefix in the production source and capturing the failure before reverting (`.omo/evidence/20260922-native-notice-wording/MUTATION-telemetry-invariant.txt`). The rendered notices are captured by a committed re-runnable driver rather than quoted from source.

## 2026-09-22 - The ulw-loop spawn guard recognizes the renamed reviewer agents (#8630)

`REVIEWER_ROLES_BY_SURFACE["omo-senpi"]` carried the pre-rename agent names, so `REVIEW_AGENT_TYPE_SET` and `GATE_MESSAGE_PATTERN` in `packages/omo-codex/plugin/components/ulw-loop/src/spawn-guard.ts` never matched the canonical `omo-native-*` names the resolver hands over. `reviewAgentType` returned `null`, and both `missingGateArtifact` and `consumeReviewSpawnBudget` bail on `null`: the gate reviewer could spawn with no `g1-manual-qa.md` on disk and the 3-per-reviewer no-progress cap never incremented. The surface id itself is unchanged - `"omo-senpi"` names the staged-bundle marker, not an agent.

The role table now holds the canonical names and `surface.ts` exports `LEGACY_REVIEWER_AGENT_ALIASES` plus `canonicalReviewerAgentName`, consulted by `activeSurfaceReviewerAlias` and folded into `REVIEW_AGENT_TYPES`, `GATE_REVIEWER_AGENT_NAMES` and `GATE_MESSAGE_PATTERN`. Recognition is additive: a legacy-named spawn resolves to the same reviewer lane it always did. What moves is the reported identity - the denial text and the `review-spawn-counts.json` key now name `omo-native-*`, so the guard stops quoting a retired agent name back to the user. The staged `plugin/runtime/agent-toolkit-sdk/sdk.js` was regenerated with the CI-pinned bun.

Coverage: `test/spawn-guard-native-reviewer.test.ts` is a new cluster (the existing `spawn-guard.test.ts` is 552 pure LOC, past this component's ceiling) pairing each canonical-name denial with its allow control, because unmodified code returned `""` for both and only the denial could fail; it pins the cap at 4/3 under the canonical name, asserts the legacy counter key is absent so no lane double-counts, and keeps a legacy-spelling denial case. `surface.test.ts` gains alias-mapping, identity and gate-name-set cases. Three assertions that pinned the retired identity were realigned and tightened. RED/GREEN captures are in `.omo/evidence/20260922-codex-reviewer-alias/`; the component suite is 66 files / 680 tests green with `tsc --noEmit` clean.

## 2026-09-22 - The OmO Native wording guard is green on dev again (#8636)

`native-wording-guard.test.ts` failed on `dev`, so every PR opened against it inherited a red `test (ubuntu-latest, 1/2)` job. The guard's allowlist recognises a reviewer agent id as `omo-senpi-[a-z-]+`, and `docs/guide/installation.md:848` wrote the same public contract in glob form, `omo-senpi-*`; `*` falls outside `[a-z-]`, so the allowlist did not strip it and the bare engine name survived the scan.

A cross-PR interaction neither side's CI could see: `f006837c1` (#8624) added the guard and its allowlist, `1fc396121` (#8623) added the documentation line, and the two merged three minutes apart, each green against a `dev` that lacked the other.

Fixed by naming the three retired ids literally instead of as a glob, so each matches the existing allowlist entry unchanged. `ENGINE_NAME_ALLOWLIST` and `BANNED_EDITION_WORDING` are untouched - widening a pattern so the gate stops reporting a line is the failure mode the guard exists to prevent, and #8618 set the precedent of rewording the prose instead. The sentence still states that the pre-rename spellings resolve. RED at clean dev and GREEN at the rebased HEAD are in `.omo/evidence/20260922-wording-guard-red-on-dev/`.

## 2026-09-22 - The standalone edition is OmO Native everywhere, and `--platform=native` installs it (#8618)

`packages/omo-opencode/src/cli/native-edition-hint.ts` (was `senpi-edition-hint.ts`) exports `NATIVE_EDITION_HINT_TITLE`, `NATIVE_EDITION_INSTALL_COMMAND`, `NATIVE_EDITION_GUIDE_URL`, `nativeEditionHintLines` and `shouldShowNativeEditionHint`, and the copy names the benefit instead of the engine. `InstallPlatform` becomes `opencode | codex | both | native | native-dev`, and `hasSenpi` splits into `hasNative` (the published edition) and `hasNativeDev` (the in-repo adapter); the hint is suppressed for either. `native` is public — listed in `install --help` and in the interactive picker with no env flag — and `install-native/` performs the real install through an injected spawn: `bun add -g omo-ai@beta` when bun is on PATH, `npm i -g omo-ai@beta` with bun named as the recommended runtime when it is not, then it points at `omo setup`. A non-zero exit or an unspawnable package manager returns the reason and the exact manual command instead of throwing. `install-senpi/` becomes `install-native-dev/`, wrapping the engine installer as `runNativeDevInstaller` behind `OMO_ENABLE_NATIVE_DEV_PLATFORM` with `OMO_ENABLE_SENPI_PLATFORM` still accepted as an alias. `postinstall.mjs`, `docs/guide/installation.md`, `README.md` and the four translated READMEs, and the `omo-ai` description all say OmO Native; `senpi` survives only as the engine name, its env vars, its state directory and internal package paths. `native-wording-guard.test.ts` scans those surfaces, fails on the banned edition wording in all five README languages, and requires every remaining `senpi` mention to match an explicit engine-name allowlist.

## 2026-09-22 - unspecified-high drops Astra; quick drops Kimi HighSpeed and explore/librarian lead with it (#8616)

`unspecified-high` led its chain with `gpt-6-astra (high)` and advertised that model as its builtin default, so the catch-all lane ran the flagship GPT reasoning model on ordinary multi-file work. The astra rung is gone from both chain definitions (`packages/model-core/src/category-model-requirements.ts` source of truth and its senpi mirror `packages/senpi-task/src/category/fallback-chains.ts`) and the chain now starts at `claude-opus-5 (xhigh)` -> `glm-5.3 (max)` -> `kimi-k3 (max)`. Both builtin definitions move with it: `anthropic/claude-opus-5 (xhigh)` in `packages/senpi-task/src/category/openai-categories.ts` and `packages/omo-opencode/src/tools/delegate-task/openai-categories.ts`. The category stays ungated and keeps `resolveUnspecifiedHighCategoryPromptAppend`, so a user override onto a GPT-6 model still gets the Astra-tuned append. `ultrabrain`, `deep-high` and `plan-reviewer` are untouched.

The `quick` chain drops its `kimi-for-coding-highspeed` head rung in both tables and starts at `gpt-5.6-luna-fast (low)`; the builtin default follows (`openai-codex/...` in senpi, `openai/...` in the OpenCode edition). The curated `explore` and `librarian` chains gain that model as their new head at `variant: "off"` in both tables. Senpi's catalog gives `kimi-for-coding-highspeed` `reasoning: true` with `compat.forceAdaptiveThinking` and no `supportsDisabledThinking`, so `disableThinkingForRequest` sends no thinking block and `output_config.effort = "low"` - the minimum-thinking form that endpoint accepts. The senpi agent rung carries both registry ids (`kimi-coding`, `kimi-for-coding`) like the category chains do, so `builtin-agent-chain-parity.test.ts` gained a `kimi-coding` normalization beside its existing `openai` one.

Giving `quick` a variant for the first time has one downstream effect: everything that resolves through that category and declares no reasoning of its own now inherits `low`. That covers a user model pinned at `categories.quick` (the inheritance tracked in #8510) and the memory lane's children — `resolveReflectionModel` and `resolveKibitzerSidecarModel` now return `thinking: "low"` where they previously returned none. The category's primary rung already ran Luna Fast at `low`, so the request the children send now matches the category they run on.

Chain and default assertions moved with the change in `fallback-chains.test.ts` (both packages), `resolve-category.test.ts`, `openai-categories.test.ts`, `openai-lane.test.ts`, `category-routing-policy.test.ts` (senpi + opencode + model-core), `anthropic-lane.test.ts`, `dead-chain.test.ts`, `resolve-category-boundary.test.ts`, `resolve-agent-categories.test.ts`, `model-requirements-{agents,categories}.test.ts`, `luna-deepseek-chain-policy.test.ts` (both) and `gpt-5.6-copilot-resolution.test.ts`, which now pins that `unspecified-high` takes the Copilot Opus 5 rung and falls to the system default on a GPT-only Copilot registry. The two manual QA scripts and the runtime-fallback mock provider were retargeted to the new quick rungs. Docs carrying the shipped chains were updated: `docs/reference/{features,configuration,opencode-config}.md`, `docs/guide/{agent-model-matching,overview,installation}.md`, `docs/manifesto.md`, plus the two package AGENTS.md rows.

## 2026-09-21 - OpenCode-edition installs point at the standalone Senpi edition (#8593)

`packages/omo-opencode/src/cli/senpi-edition-hint.ts` owns the install command, the guide URL, the hint lines and the `!hasSenpi` gate. `cli-installer.ts` prints the lines after the Magic Word box and `tui-installer.ts` logs them before the star prompt, so the two installers read one source. `postinstall.mjs` prints a one-line notice naming the edition and the command. `docs/guide/installation.md` uses the bun install line throughout, and the README anchor follows the renamed Senpi heading. Coverage: helper unit tests, CLI and TUI installer tests for both the OpenCode and senpi platforms, and the postinstall notice pin. Real-surface runs of the `--no-tui` installer and `node postinstall.mjs` in an isolated HOME are recorded on PR #8538.

## 2026-09-24 - Memory `<external_projection>` lists one comma line per directory (#8810)

`renderExternalProjection` drew the memory repo's non-`system/`, non-`skills/` paths as a box-drawing tree: every file line paid `├── `/`└── ` plus a `│   ` or blank prefix per depth. On a repo with 1,478 external files the block was 83,779 characters and 43,400 Opus input tokens, about 40% of a first-turn request. The block now opens with `$MEMORY_DIR/` (followed by `: <names>` when the root holds files) and then one line per directory that directly holds files, `<dir>/: <name>, <name>`, directories and names sorted. File names stay exact and every path is still listed, so the block carries the same information; the same 1,478 paths measure 33,231 tokens. Bounding or summarizing the list and the mid-session recompile on added files (#8470) are unchanged. Pinned by `compile/render.test.ts`; the (unread) `compile/fixtures/full.golden.txt` sample follows the new shape.

## 2026-09-21 - Bound deferred LSP daemon startup retries (#8561)

`callToolViaDaemon` ensures the daemon immediately on the first attempt and uses authenticated probes on its two retries, after 100 and 300 ms backoffs. A reachable daemon adds no backoff. `ensureDaemonRunning` records a five-second, endpoint-scoped cooldown after failed readiness; a successful probe clears it. Probe timeout is two seconds. The daemon CLI prints expected startup deferrals on one line and preserves stacks for unexpected errors. Lease ownership, version reaping, file layout, cancellation and written-request replay rules are unchanged.

Regression coverage includes cooldown expiry and endpoint isolation, retry recovery and auth rotation, cancellation, and real CLI stderr. Two isolated engine sessions made ten successful diagnostics calls through the built plugin with one shared daemon. A socket permission fault produced the existing unreachable error and one deferred log line; all QA processes were removed.

## 2026-09-21 - Frontend skill bans coloured accent borders for state (#8552)

The shared axioms, the design README (anti-patterns, execution checklist, Phase Final), the perfection design-system compliance grep, and the design-system-architecture states rule now name the same tell: a coloured or accent-width border on a rounded surface marking selected/focused/active. State is encoded with ink-alpha washes, a glyph for selection, and tonal layering for focus; `focus-visible` rings are the only coloured edge, and the rule covers pre-existing instances on any surface a session touches. The loader-core builtin copy stays byte-equivalent through the same change; the plugin skill dirs are build outputs and pick it up through sync-skills.

## 2026-09-20 - Writing category chain drops to low rungs and gains a claude-opus-4-6 fallback (#8525)

`writing` led with `claude-fable-5-1` at variant `medium` and had one fallback, `kimi-k3` at `max`. Prose delegation does not need that reasoning budget, and the single fallback left no Claude rung once Fable was unavailable, so a Fable outage routed every writing task to a max-variant Kimi run.

The chain is now three rungs, all `low`: `claude-fable-5-1`, `kimi-k3`, `claude-opus-4-6`. Both definitions move together: `packages/senpi-task/src/category/fallback-chains.ts` (senpi provider ids, `claude-sdk-oauth`-headed anthropic lists, dual kimi ids) and its mirror `packages/model-core/src/category-model-requirements.ts`. The builtin single-model config in both `kimi-categories.ts` files moves from `variant: "medium"` to `variant: "low"` so the primary rung and the advertised default agree. Docs tables (`docs/guide/agent-model-matching.md`, `docs/guide/overview.md`, `docs/reference/configuration.md`, `docs/reference/features.md`, `packages/omo-opencode/src/tools/AGENTS.md`) carry the new chain. The chain assertions in `fallback-chains.test.ts`, `resolve-category.test.ts`, `model-requirements-categories.test.ts` and `category-routing-policy.test.ts` move with them.

## 2026-09-19 - Adopt senpi 2026.9.19: extensions with CommonJS dependencies load again (senpi#1838)

The engine pin moves from 2026.9.18-6 to 2026.9.19 across the four manifests that declare it (root, `omo-native`, `omo-senpi` peer + dev, `senpi-task` peer + dev), the three pin assertions, the `provider-map.json` provenance comment and `bun.lock`. The only engine change between the two tags is senpi#1839: the extension loader used to wrap every CommonJS dependency in a prologue that declared `exports` as a constant, so a module written as `module.exports = exports = { ... }` (whatwg-url, jsdom's generated IDL utils) failed to parse and took the whole extension graph down; pi-webfetch was the reported casualty. The loader now evaluates CommonJS inside Node's module function wrapper, gives each file a `require.resolve` that returns the absolute path, hands a module inside a require cycle the partially built exports of the module still evaluating, evicts a module whose body throws, and keeps `.mjs`/`.mts` files on the ESM path. The Codex installer bundle is regenerated because its embedded version string was still beta.75.

## 2026-09-19 - build-omob discards publish-staging residue before every senpi install (#8477)

A repeat `omob` build against a senpi commit that had already been built once failed inside senpi's bundler with `No matching export ... for import prepareReadFolder`, and the builds where every import still resolved were worse: they silently packed an engine carrying the previous build's agent core.

`buildSenpiPackage` in `script/build-omob.ts` runs senpi's publish staging (`scripts/prepare-senpi-bundled-workspaces.mjs`) after the bundle step, and that script copies whole bundled workspaces into `packages/coding-agent/node_modules/@earendil-works/*` and `@code-yeongyu/senpi-codemode` and writes `packages/coding-agent/vendor`. senpi documents the staging as safe only for a disposable checkout, and omob's clone is not disposable: `ensureCacheClone` runs `git clean -ffd` without `-x` on purpose, so ignored build outputs survive for cache reuse, `bun install` does not manage directories it did not create, and `materializeNestedLockDeps` skips any nested path that already exists. The previous build's copies therefore outlived it, and esbuild resolved `@earendil-works/pi-agent-core` from the stale copy instead of the workspace link at the senpi root.

`script/omob-senpi-workspace-reset.ts` now resolves the senpi root's `workspaces` globs - read from the manifest, never a hardcoded list, so it covers the nested `packages/session-backends/*` entry too - and deletes each `<workspace>/node_modules` plus `packages/coding-agent/vendor`, returning the paths it removed. `buildSenpiPackage` calls it immediately before `bun install` and logs the removals under the existing `[omob]` prefix. The root `node_modules` stays bun's to manage and nothing tracked is removed; a checkout without a manifest declares no workspaces, so the unit stays a residue cleanup and leaves rejecting a broken clone to the install and lock steps that need it. `materializeNestedLockDeps` is unchanged, because after the reset and a fresh install its skip-if-exists guard can only preserve what bun itself nested.

## 2026-09-18 - Kimi K2.8 Preview shares the K2.7 prompt across the opencode lane (#8466)

Moonshot rolled Kimi K2.8 Preview out across Kimi Code on 2026-09-11 and upgraded the `kimi-for-coding` model id in place, so clients reach K2.8 through an id that carries no version signal (<https://www.kimi.com/code/docs/en/kimi-code/models.html>, checked 2026-09-18). Every opencode prompt surface picks its variant through `model-core`'s family detectors, and none of them knew K2.8: `isKimiK27Model` matches `kimi-k2(.|-)7` / `k2p7` only, so a K2.8 id fell through to `isKimiK2Model` and took the generic K2.6 Kimi prompt. The same gap sent `kimi-for-coding-highspeed`, which the published table still lists as K2.7 Code HighSpeed, to the K2.6 prompt too.

`model-family-detectors.ts` gained `isKimiK28Model` (version-tagged `kimi-k2.8` / `kimi-k2-8` / `k2p8` shapes plus the rolling `kimi-for-coding` id by exact match) and `isKimiK2CodeModel`, the K2.7-or-K2.8 union; `isKimiK27Model` additionally accepts the rolling `kimi-for-coding-highspeed` id. K2.8 takes the K2.7 prompt rather than a copy of it because it is an efficiency and context upgrade inside the same coding family, not a new prompting contract, so the union predicate replaced the K2.7 check at all four routing sites: `prompts-core`'s `MODEL_MATCHERS["kimi-k2-7"]` (which Atlas resolves through), `resolveSisyphusPromptFamily`, `getSisyphusJuniorPromptSource`, and the Metis prompt switch. K2.6, K2.7 and K3 routing is unchanged, and the rolling ids keep their exact-match treatment so the next in-place upgrade is a one-line move rather than a regex guess.

## 2026-09-17 - Memory startup stops walking the whole memory root (#8412)

A `bun --cpu-prof` capture of an `omo` boot attributed about 190 ms of `statSync` self time to three stacks inside the memory component. Instrumenting the `@oh-my-opencode/memory-core/fs` boundary during a real boot (throwaway HOME and agent dir, against a shape-faithful mirror of a 158-identity memory root) showed the memory stack issuing 3,787 filesystem calls before the first turn, in two places. The registration-time transient sweep (`index.ts` -> `transient-sweep.ts` `newestMtimeMs`) computed the newest mtime of every repo-less identity tree - 2,214 async `stat`, 1,074 async `readdir`, 158 `existsSync` - although both call sites only compare that value to one cutoff, and 107 of 109 repo-less roots already prove themselves fresh from the root's own `stat`. The session-bind filesystem policy (`wiring.ts` -> `policy-guard.ts`) spent 1 `readdirSync`, 157 `existsSync`, 49 `lstatSync` and 49 `realpathSync` building `deniedRoots`, metadata that `check()` never consults. The probe moved into `transient-age.ts` behind an injectable fs and now stops at the first mtime newer than the cutoff, and `deniedRoots` became a memoised getter: deferral rather than caching, because the value is structural and per-binding so there is nothing to invalidate. Measured on the mirrored root: 3,787 filesystem calls to 405, the isolated sweep 70.1 ms to 2.2 ms and policy registration 1.4 ms to 0.1 ms (at ten times the root, 903 ms to 28 ms and 14.4 ms to 0.1 ms), with identical verdicts. Warm-cache startup timing rows are unchanged at this scale and that is reported as measured, not dressed up: the sweep is fire-and-forget, so the saved work overlapped the runtime's own I/O. `sandbox-paths.ts`, `engine-session.ts` and `guard.ts` were cleared by the same instrumentation and left untouched.

## 2026-09-17 - A ulw-execute work whose session died no longer stays active forever (#8413)

`completeBoulder` was the only transition away from `status: "active"` in `.omo/boulder.json`, and it runs only on an explicit completion, so a work whose ulw-execute session ended abnormally - crash, reboot, closed terminal - stayed `active` indefinitely. Observed in a real project: a work whose only session's transcript was last written 41 hours earlier was still `active`, while a sibling work that completed normally in the same file was `completed`. Every later reader - resume options, injected context, and the desktop badge - therefore treated a dead work as running.

`boulder-state` gained `reconcileStaleWorks(directory, options?)` plus the pure `isWorkStale({ lastActivityMs, nowMs, thresholdMs })` predicate behind it. A work is stale when it is `active` and its last activity - the newest of its sessions' transcript mtimes, `updated_at` and `started_at` - is at least `OMO_BOULDER_STALE_WORK_THRESHOLD_MS` (default 6 hours) old; a work with no activity evidence at all counts as stale. Reconcile demotes such a work to `paused`, stamps `stale_since`, and keeps `session_ids` and every other field - including the ones the ulw-execute writer adds, such as `ulw_loop_session` and `mode` - byte for byte. Nothing stale means no write at all, `completed`/`abandoned` and status-less records are never touched, and no failure path throws: an absent, unreadable or unwritable file returns `{ demoted: [], written: false }`.

Both ulw-execute read paths call it where they already read the file, so the next session in a project repairs the record: the OpenCode hook (`hooks/ulw-execute/ulw-execute-hook.ts`, which logs what it demoted) and the Senpi continuation component (`components/ulw-execute-continuation/boulder-eligibility.ts`). Session liveness is resolved through the adapter's own agent-home resolver, which gained `resolveAgentSessionsDirectory`; `boulder-state` itself resolves no home path and takes the directory as an option. Transcripts are looked up only under session directories whose alphanumeric shape matches the work's own cwd or worktree - a full walk of an agent home with 5200 session directories measured 11.3s, the narrowed lookup 12ms - and a session id is matched against a whole file name or the part after the timestamp separator, never by loose substring, so a literal id such as `senpi:unknown` cannot borrow an unrelated transcript's freshness.

Resuming repairs the status the other way: `selectActiveWork` and `appendSessionIdForWork` return a work carrying `stale_since` to `active` and drop the stamp, while a work paused without that stamp keeps its status. Reader semantics are unchanged - `getActiveWorks` and `getWorkResumeOptions` still filter `completed`/`abandoned` only, so a demoted work stays resumable and the omo-codex and omo-senpi continuation predicates (`active` or `paused`) still fire on it.

## 2026-09-17 - Both bun global bins exec bun, and the launcher prefers the engine's bundled entry (#8412)

A bun-global install exposes the launcher at two paths, `<bun root>/bin/omo` and `<bun root>/install/global/node_modules/.bin/omo`; the launcher only ever repaired the first into its sh shim, so a PATH that resolves the global `node_modules/.bin` first ran bun's `#!/usr/bin/env node` symlink and paid a node boot before `maybeReexecUnderBun` handed over (50.6 ms mean against 16.8 ms through the shim, hyperfine 15 runs on a temp bun-root fixture). `ensureBunBinShim` now walks both entries in one pass: the platform, runtime, install-tree and bun-binary gates are still evaluated once per launch, each entry is then judged on its own (bun's own link to this `scriptPath` or a file carrying the shim marker may be replaced; a foreign link, file or entry is reported and left untouched), one entry's write failure never blocks the other, and the return value grew an `entries` array while keeping the primary entry's fields at the top level so the single call site and the existing suite only needed assertion-shape updates. Separately, `resolveSenpi()` now prefers `<senpi>/dist/bundle/cli.js` when the installed engine ships that pre-linked bundle (senpi#1781) and falls back to `dist/cli.js` otherwise, with the missing-CLI and incomplete-engine errors byte-identical; an engine without the bundle behaves exactly as before. Covered by `packages/omo-native/test/bun-bin-shim-node-modules-bin.test.ts` (replacement, foreign-entry refusal, missing entry, already-current shim, one-entry write failure) and `packages/omo-native/test/senpi-bundle-entry.test.ts` (bundle preferred, fallback, incomplete-engine guard).

## 2026-09-17 - Stray session artifacts leave dev and cannot be tracked again (#8406)

`dev` carried a directory literally named `--out-dir/` (a QA report written there because `dag-wait-detach-qa.ts` read `process.argv[2]` verbatim, merged in 19d571cce), six files under `local-ignore/qa-evidence/` (a root the `senpi-qa` skill rejects as stray), 18 `.omo/plans/*.md` plus `.omo/drafts/`, `.omo/plan.md` and `.omo/plan-gpt-6-astra-routing.md` per-session plan artifacts, both `work-with-pr-workspace` skill-eval residue trees (69 files each), and four generated `plugin/skills/*/SKILL.md` copies that the `sync-skills` build rewrites. All of them are gone, and `.gitignore` now states what is committed under `.omo/`: `evidence/`, `fixtures/` and `init-deep.json` carry explicit `!` negations placed after the artifact patterns, so `git add -A` picks up new QA evidence and `local-ignore/` + `.local-ignore/` are ignored. `script/tracked-ignored-paths-audit.test.ts` fails the root suite whenever `git ls-files --cached --ignored --exclude-per-directory=.gitignore` prints anything (3155 paths before this change, 0 after). The three dag QA drivers share `resolveOutDirArg`, which accepts `<dir>` or `--out-dir <dir>` and throws on a bare or unknown flag and on extra positionals, so the `--out-dir/` directory cannot come back; a bare `--out-dir` now exits 1 with the usage error and creates nothing. README.md went through the `polish-ai-tells` pass (score 6.14 in the `fix` band with three metrics over threshold to 0.59 `pass` with none), the install line is `bun add -g omo-ai@beta` in every locale, and the public-surface wording rules are applied.

## 2026-09-17 - A second DAG run no longer fails at start while a sibling run holds the session's resident slots (#8396)

Two DAG runs in one session share one resident-child cap (`task.residency_max_children`, 16 on a 14-core host). When run A's children held every slot, run B failed all of its leaves within seconds with `residency_denied: resident child cap reached and no task can free a slot` and its aggregators skip-cascaded - twice on real research workloads, 17/17 and 28/28 leaves. The scheduler judged "no task can free a slot" from its own `attachedTasks` map, which is empty for a run that has attached nothing yet; the slots belonged to the sibling run and freed minutes later, and `retry` after that admitted the same nodes untouched. The task manager now exposes a session-scoped wake, `residencyChanged(parentSessionId)`, fired when any resident child of the session reaches a terminal status, is evicted or suspended, or drains its last pending send. A residency-denied node stays `scheduled`; its first denial is journaled once as `residency_queued` with the number of residents and how many belong to other owners, and the scheduler arms the wake before each admission probe and waits on it together with its own settlements, foreign journal commits and cancellation. Residency denials now carry a `cause`: `residents` names the holders, `lease` means the per-session admission lease was contended or displaced. Only a denial that names no resident fails the node; a lease denial probes again at once because lease acquisition is itself a bounded wait. The second symptom from the same incident is fixed with it: a pass whose every admission failed at start left the run `running` forever with nothing attached, and `retry` refused it with `run_still_active`. The loop now re-enters the skip cascade and settles the run as `failed` with its dependents `skipped`. The mass-ulw capacity model documents that the queue holds across runs in one session.

## 2026-09-16 - Windows shards stop losing tests to their own wall clocks (#8323)

The residual Windows flake cluster had three distinct causes and each is now addressed at its own layer. **LSP diagnostics** were a real determinism defect: `LspClient diagnostics freshness` and `LspClient diagnostics concurrency` ran a real 500ms/800ms freshness window against a real fixture server over a real pipe, so a starved shard reached the deadline before the server's answer and the cases resolved `[]` instead of the diagnostics they assert. Every case whose exit is a server reply or an exact-version publish now runs on the existing `ControlledClock`, and the two cases whose exit really is the window closing advance it deliberately - through the new `ControlledClock.waitForScheduled`, which orders on the SCHEDULE of the push-fallback wait rather than on a delay value the pull request timeout shares. **Contended lock waits** were a real starvation source: `acquireLock` re-attempted the full exclusive publish - create, write, fsync, hard-link, unlink - on every retry tick, so a waiter at the two-process writer test's 5ms retry delay aimed ~200 fsynced create/unlink cycles per second at the volume the lock holder was committing to; it now reads the lock file first and publishes only when the lock is free, which is the same protocol with the doomed writes removed. **The Windows console probe** answered "does this pid own a visible console" by compiling a C# P/Invoke shim with `Add-Type` in a fresh Windows PowerShell on every call, twice per run, inside a step bounded at 60s; it now asks kernel32/user32 through `bun:ffi` in a throwaway Bun child, and a step that does time out now names its phase instead of throwing a bare `AbortError`. Finally, `script/omob-refresh.test.ts` and `script/release-version.test.ts` joined the shared serial quarantine with measured reasons: both are spawn-heavy (a real `bun build --compile`; five Git Bash spawns) and both blew an inner spawn budget under Windows `--parallel` while identical work finished in a third of the time in the same job. No per-test budget was raised, no test was skipped and no assertion was weakened.

## 2026-09-16 - Parent kernel-tool grants run child-permissioned when the engine can scope them (#8226)

A child whose own tool policy is narrower than its parent's - `tools: { write: false }`, an `excludeTools` denial, any explicit allow/deny - used to be refused a parent JavaScript tool outright (`tools_unavailable`), because the closure's nested `tool.<name>()` calls ran with the PARENT's permissions and granting one would have been a write bypass of the child's own policy. The engine can now bound those nested calls per invocation (senpi#1731, senpi PR #1765), so omo detects that at RUNTIME - `kernelTools.capabilities.invokeScope === true`, duck-typed off the live capability, with no engine pin bump and no senpi type imported - and, when it is there, GRANTS the narrowed child and sends the child's resolved effective tool policy as the execution scope of every invoke made on that child's behalf: `scope.tools.allow` is the exact list the runner installs for that child (senpi session builtins plus merged custom tools, minus the task/team family, minus its denylist, intersected with its allowlist when it defines one, even an empty one), and its literal denylist rides along as `scope.tools.deny`, which the engine lets win. The scope is recomputed at the runner against the child's REAL surface, so a category child whose plan is only known there is scoped to what it actually got. A nested call outside that scope is refused inside the worker and lands on the CHILD's own tool-result channel as a typed `kernel_tool_host_denied` envelope - the child can read it and recover, and the parent's cell never fails for it. The `kernel_tools` status record now says whether the grant was scoped (`scoped: true` plus the `allow`/`deny` summary), so the parent can tell a child-permissioned grant from a parent-permissioned one. Nothing changes on an engine without the marker: the same narrowed children are refused with the same message naming the escalation, and an unscoped invoke posts exactly the frame it always did. Curated read-only agents (`explore`, `librarian`, ...) still receive no parent kernel tools at all, scope or no scope, and team members, process/RPC children and non-JavaScript parents are still typed unavailable.

## 2026-09-16 - ulw-loop never rebuilds goals.json below what its ledger records (#8328)

A ulw-loop run created under the removed `omo_agent_toolkit` tool path could publish `revisions/00000004.json` with one goal, then keep adding goals and evidence straight into `goals.json` and `ledger.jsonl`; the first `agent-toolkit-sdk` read then rebuilt the projection from that snapshot and every later goal, its evidence and its audit entries vanished, after which `record-evidence`/`checkpoint` on those goals failed with `ULW_LOOP_GOAL_NOT_FOUND`. Reconciliation now lets a `goals.json` that names goals the newest snapshot lacks win (when it carries no revision or the snapshot's own), stamps it with that revision so the next publish folds the whole plan into revision N+1 instead of hitting `ULW_LOOP_PUBLISH_CONFLICT` on an existing file, and attributes raw ledger lines appended after a published revision to that revision so a later `ledgerResetRevision` no longer discards them. A cache naming an older revision is still a lagging view and never wins. On top of the fold, every write of `goals.json` (locked reads before a mutation, and each commit) checks the projection against the reconciled ledger: a `goal_added` goal the plan lacks is a typed `ULW_LOOP_PROJECTION_TRUNCATED` refusal that names the missing ids, never a silent truncation.

## 2026-09-16 - A subagent_type that names no agent is an error, not a category (#8348)

`task(subagent_type="architect")` used to resolve `architect` as a *category* and hand the child that category's model - a different model family from anything in the caller's agent table - with no error and no warning; the same silent fallthrough applied to every unknown or disabled agent name that happened to collide with a category key (`visual-engineering`, `writing`, ...). The child planner now treats `subagent_type` as an agent name only: an unknown or disabled name returns a typed `unknown_target` error that names the target, lists the available agents and categories, and, when the string is a category key, says `"architect" is a category, not an agent - use category="architect" instead`. Deliberate category calls are untouched: `task(category="architect")` keeps routing exactly as before, so the shipped plan-consultant, `ulw-plan` and fallback-architect guidance to consult the `architect` category still works. A child's model stays a pure function of the child's own target - the planner still takes no parent category or parent model, and a spawn naming no target at all is still rejected - and both are now pinned by tests. Any status row carrying both the caller's `subagent_type` and a resolving category renders `agent:<asked>->category:<used>(<model>)` instead of dropping the name the caller wrote.

## 2026-09-16 - Parent JavaScript tools reach in-process children (#8226)

A JavaScript `eval` cell that defines tools with `tool(fn)` can now hand named tools to the children it spawns: `task`/`agent` accept `tools: [...]`, and `workpool` create accepts the same names for its workers. The names are resolved at spawn against the parent's live kernel capability, normalized with the MCP name rules, and refused as typed errors — never partially granted — when they duplicate, collide with an existing child tool, hit a reserved host alias, or were never defined. Only non-curated in-process children of a live JavaScript parent receive them: curated read-only agents, process/team children and other kernel languages get `tools_unavailable`/`curated_policy_denied` with no child session and no task record created. A parent closure's nested host calls still run with the PARENT's permissions — the engine offers no scoped execution for them yet — so the grant is also refused when the child's OWN tool policy would be out-permissioned by it. The exact rule: the child's effective tool set is the same list the in-process runner installs — senpi session builtins plus merged custom tools (shared parent tools minus UI-only names, minus the task/team family, plus member-scoped names), minus its denylist, intersected with its allowlist whenever the agent defines one — even an empty one. That list must not be missing any write-capable tool the closure can reach; if it is, the caller gets a typed `tools_unavailable` before anything is created. Write-capability is read from the same host-tool table the child-options path uses to union session builtins; a name that is not on that table counts as write-capable, so an unrecognised MCP or extension tool fails closed. The host-wide exclusions are not refusals: `memory`, `ask_user_question`, `request_user_input` and the task/team family are withheld from every child because they bind to the parent session's identity, UI or spawn graph, and a parent-authored closure may still reach them on the parent's own bridge. Each granted child tool validates its fenced descriptor and calls the live parent closure by name, so a stale kernel generation or a redefined tool returns a typed error on the child's own tool-result channel instead of running the wrong code. The grant is runtime state: no closure, descriptor or requested name is written to a task record, a spawn spec or a session transcript. A child parked for idle time keeps its grant and can call the same tool after it revives in the same live parent, while a kernel reset, a same-name redefinition or a restarted host leaves the revived child with a typed unavailable/stale result instead of a silently rebound or replaced closure - a restored stub never runs a closure, and nothing claims a revived tool survived a dead kernel. Pool workers resolve their grant afresh at every new worker spawn, and a worker that reports a stale tool produces one keyed error and one aggregate rather than an automatic retry. Python, Ruby and Julia parents, and MCP-hosted kernel tools, remain follow-ups.

## 2026-09-16 - Session shutdown and Kibitzer wakes are bounded (#8344)

Session shutdown no longer waits on the Kibitzer sidecar or on facts cancellation past the 1500ms drain deadline: `shutdown-drain.ts` gained `raceDetached`, which always starts the cleanup (it is what hands back the machine-wide wake lease and the sidecar directory owner lock) but races it against the same deadline the drain steps share, logs the existing budget warning with the step name, and lets the work finish detached instead of stalling quit/reload/new/resume. Every Kibitzer wake is now bounded from the admission that opened it: `seed()` and `followUp()` arm the 90s deadline before the child I/O rather than after it, so a `startChild` that never returns ends the wake as `deadline` with its lease handed back and the late handle aborted and disposed without beginning a turn, and every re-arm is clamped to `startedAt + KIBITZER_WAKE_MAX_TOTAL_MS` (300s), so a steer storm can no longer keep one wake - and one machine slot - alive without bound.

## 2026-09-16 - The Kibitzer sidecar grep stops at a budget, an abort, or a .gitignore rule (#8342)

The resident Kibitzer's read-only `grep` no longer reads a whole workspace. Its scan is bounded by a file count (5000), the bytes it actually reads (64MB) and wall-clock time (10s), and it also stops when the turn's AbortSignal fires - which it now receives, because every sidecar tool closure takes senpi's third `execute` argument and `budgeted()` forwards it. Whichever limit trips first keeps the matches found so far and names itself in a new `stopped` field beside `truncated: true`; a scan that trips nothing returns exactly the same JSON as before. In a git work tree the candidate list comes from `git ls-files --cached --others --exclude-standard`, so ignored build output, caches and vendored dependencies are skipped; a non-git root or any git failure falls back to the previous walk, and an explicitly named file is still scanned as given.

## 2026-09-16 - Make Kibitzer candidate collection incremental (#8340)

Kibitzer recall collection runs on the main thread at every prompt and every tool call, and it re-scanned the whole 200-entry transcript window against every corpus document, re-normalized every document haystack once per query, spawned `git rev-parse` for the corpus revision, and re-read the surfaced ledger file — about 235 ms of synchronous CPU per trigger on a large memory corpus. Transcript mentions are now computed once per branch entry and cached by entry id (the newest entry is always recomputed because it can still be streaming, and entries outside the window are evicted), the normalized document haystack is memoized per corpus revision, the HEAD revision is re-resolved only when the git ref files backing it changed, and the surfaced ledger is served from a stat-gated parse cache that its own writer keeps current. Candidates, scores, order, excerpts and the transcript-exclusion set are unchanged — a differential test asserts the new exclusion set equals the old whole-window regex scan for every window of a synthetic branch — and the new `packages/omo-senpi/scripts/qa/recall-collect-bench.mjs` measures 308 ms to 5 ms per trigger on an 800-document fixture.

## 2026-09-15 - Idle sessions stop polling: member acks, lead poller, ulw footer (#8290)

Three idle-session drains are now demand-driven. The member-extension ack loop (`senpi-task` `self-poller.ts`) skips its lockfile lease entirely when the pending-ack queue is empty, so an idle member performs zero filesystem work per minute. The lead poller (`omo-senpi` `lead-poller-lifecycle.ts`) stands down when the session owns no teams — owned teams can only appear through this session's own `team_create`, which now kicks the poller back awake — so a teamless session reads the team registry zero times per minute instead of 60. The ulw footer caches the goal JSON by mtime (`createGoalJsonCache`), so the 320ms frame no longer re-reads and re-parses the file unless it changed.

## 2026-09-14 - Metis heads with Claude Fable 5.1 at max (#8259)

The `metis` pre-planning consultant chain in `model-core` is now `claude-fable-5-1 (max)` -> `claude-opus-5 (max)` ->
`kimi-k3 (max)` (was `claude-opus-5 (high)` -> `kimi-k3 (low)`). The senpi-native `plan-consultant` chain mirrors it
again, `explore` / `librarian` on that edition are back on `qwen3.7-plus`, and a parity test now fails whenever the two
tables disagree. Docs and example configs that documented the retired `claude-sonnet-4-6` head are updated.

## 2026-09-09 - Suspend native DAG runs on committed session switches (#8020)

OMO no longer cancels DAG nodes from the vetoable `session_before_switch` hook. Committed shutdown first retires scheduler admission and settlement, awaits in-flight admission and journal delivery, then persists the pause before task-child suspension. Returning in the same process can reclaim an explicitly released own lease; active self claims and live foreign holders remain protected. Completed output is reused, running children reconcile through their durable task owners, and pending dependents are admitted once. Deliberate workflow cancellation remains destructive. `/session` information and `/resume` selector cancellation are unchanged. External terminal-hosted controllers are outside this native DAG lifecycle fix.

## 2026-09-09 — Preserve Windows omob executable suffixes

Windows omob builds now retain the `.exe` suffix through installation, cache/provenance lookup, and direct refresh. The test fixtures use native compiled executables and platform-native paths while preserving the POSIX launcher contract and all refresh assertions.

## 2026-09-08 — Persist child_session_id on senpi-task records

Spawned senpi-task children now persist `child_session_id` (the child's own session id from the spawn handle) on their `st_*.json` record. Reattach/resume rewrites keep the field. `packages/team-core/AGENTS.md` documents the on-disk `st_*.json` identity fields so external readers can join a grandchild session (`parent_session_id`) back to its parent task.

## 2026-09-08 — Expose team runtime layout and member linkage

Team member task records now carry durable team identity fields, and `packages/team-core/AGENTS.md` documents the runtime state, tasklist, and mailbox paths and JSON shapes consumed by external readers.

## 2026-09-07 — Make the two Windows-flaky tests from #7898 deterministic

Both tests raced the wall clock and lost on the slowest CI runner. The team-mode case
`inbox stays intact when live delivery fails so the fallback path still works` ran the production
prompt-gate schedule in real time: the failed live delivery placed a 2 s post-dispatch hold on the
recipient, then each refused fallback wake waited `max(postDispatchHoldMs, 250*2^n)` = 2 s, 2 s, 2 s
before the fifth `promptAsync` was allowed, so the test needed ~8.6 s on Linux against a 12 s event
budget and exceeded it on Windows. Five neighbouring cases each spent ~2.5 s because the queue re-arms
after a *cancelled* wake with that same 2 s hold. `TeamSendMessageToolDeps` now carries an optional
`dispatchTiming` (`postDispatchHoldMs`, `queueRetryMs`, `fallbackWakeSettleMs`) that
`deliverLive` threads into the live dispatch and into `enqueueFallbackMailboxWake`; every field
falls back to the gate default when omitted, so production behaviour is unchanged and only tests set
it. The six tests inject near-zero timing through `createImmediateTeamSendMessageTool` and wait on
their deferred event with the file's default 3 s circuit breaker; the Windows-only 15 s budgets are
gone. Captured on gorky (bun 1.4.0): tightened test RED on unchanged production code ("timed out
waiting for fallback wake after pre-send transport failure" at 3 s), GREEN at ~100 ms after plumbing;
the whole file dropped from 25.9 s to 8.0 s with no test above 0.6 s.

The hooks-state case `recovers a trusted snapshot at a synchronized legacy truncate/write boundary`
spawned a detached legacy writer that completed its write only after an `fs.watch` notification of
a release file, while senpi's `FileHookStateStorage.read` retries `lockSync` 10 x 20 ms before
returning the fail-closed empty state; cross-process watch latency on Windows exceeded that window and
the reader returned `{ version: 1, hooks: {} }`. `script/fixtures/senpi-hooks-state-legacy-reader.ts`
now simulates the writer in-process: the lock dir is held and the snapshot truncated before the reader
starts, the reader's first `lockSync` is refused by the real `proper-lockfile` (the fixture mocks the
nested copy senpi resolves, capturing the real function before `mock.module` rewires the live
binding), and the writer's remaining work runs inside that refusal, so the boundary is crossed at the
same instruction on every run. The fixture reports `truncatedReads` and `lockAttempts` and the
test pins them at exactly 1 and 2, proving the contention path ran. Two mutations fail the test
(writer never releases -> empty state; snapshot already complete -> no truncated read, one lock
attempt). The detached writer fixture and the `taskkill`/`SIGTERM` timed-out-writer cleanup helper
with its three unit tests are removed because nothing spawns a writer any more. Future syncs must keep
the counters exact and must not reintroduce a second process or a real-time wait into this fixture.

## 2026-09-05 — Sweep the remaining task examples and the delegate schema to background-by-default

The gate review of #7795 found model-facing text that still prescribed `run_in_background=false`: the
delegate tool's own parameter schema (`packages/omo-opencode/src/tools/delegate-task/tools.ts`, "Use true
ONLY for parallel exploration; otherwise omit or pass false"), the category/skills delegation guide that
the GPT-5.5/5.6/6 Sisyphus prompt embeds, the Sisyphus default/gemini and execution examples, the Atlas
section builder and system-reminder template, the wave-plan template in `delegate-task/constants.ts`
("IN PARALLEL" waves with `false`), the task-resume-info continuation line, delegate-core's retry
guidance and its `missing_run_in_background` fix hint, and the GPT Atlas and ultrawork prompts in
`packages/prompts-core` (Atlas said task execution "blocks for verification"; ultrawork spawned oracle
and plan synchronously). Every example now shows `run_in_background=true`; the Atlas rule reads "the
completion notification wakes you to verify; `false` only for a short child whose result gates your very
next call"; the schema and fix hint carry the same rule as the tool description. Left as they are, on
purpose: the anti-examples that already say "never wait synchronously for explore/librarian", the
ralph-loop Oracle review (its continuation flow reads the verdict in the same turn), the refactor
command template that states it needs the result synchronously, and runtime messages that describe a
sync call factually.

## 2026-09-05 — Make background the standard spawn in every task-tool prompt surface

The text the model reads about `run_in_background` now says the same thing on both editions: `true` is the
standard spawn (the call returns at once and the child's result arrives as a message or completion
notification), `false` blocks the turn and is reserved for a short child whose result gates the very next
call. Before this, `packages/senpi-task/src/tools/task/description.ts` said "only for parallel independent
work; the default waits", `params.ts` labelled `false` as the default, `packages/omo-opencode/src/agents/sisyphus/gpt-5-5.ts`
and `sisyphus-junior/gpt-5-5.ts` prescribed `false` "for synchronous work where the next step depends on
the result" and a synchronous Oracle even though the same prompt said Oracle runs in the background, and
`packages/omo-opencode/src/tools/delegate-task/tool-description.ts` allowed `true` "ONLY for parallel
exploration with 5+ independent queries". Each line is rewritten at its source; runtime defaults are
unchanged. This is the omo half of the GPT-6 Astra async-first change (senpi #1381 rewrote the preset's
`## Asynchronous Work` section); a live backtest against gpt-6-astra with the old text showed 6/6
single-dependent delegations spawned in the foreground, and 1/3 still foreground with the new preset but
the old tool text. The delegate-task `AGENTS.md` mode table follows.

## 2026-09-05 — Replace momus's GPT-5.6 rungs with GPT-6 Astra

Momus is the reviewer, so it gets Astra's deepest practical tier instead of the GPT-5.6 pair it used to
lead with. Its chain now opens on `openai|openai-codex/gpt-6-astra (xhigh)`, then
`github-copilot/gpt-6-astra (high)` because GitHub Copilot serves every Copilot GPT reasoning model
through a backend that hangs above `high`, then `openai|openai-codex|opencode/gpt-6-astra (high)` so an
opencode-only account still lands on Astra. The two Terra rungs and the two Sol rungs are gone rather
than demoted — the request was a replacement — and the non-GPT tail (`claude-opus-5 (max)` →
`gemini-3.1-pro (high)` → `glm-5.2`) is untouched and in the same order. Both independent chain
transcriptions move together: model-core's `AGENT_MODEL_REQUIREMENTS` and senpi-task's hand-mirrored
`AGENT_FALLBACK_CHAINS`, whose pinned length for momus drops from 7 to 6.

No prompt gating change was needed: `createMomusAgent` already routes GPT-6 through `isGpt6Model` to the
GPT-5.6-tuned prompt at high reasoning effort and high text verbosity, and the chain's `xhigh` arrives
separately as the resolved variant. The installer's generated config follows the chain, so an
OpenAI-only setup now writes `openai/gpt-6-astra` xhigh with `openai/gpt-6-astra` high beneath it, and a
Copilot-only setup writes `github-copilot/gpt-6-astra` high with the Opus and Gemini rungs beneath.

## 2026-09-05 — Give ultrabrain, deep, and unspecified-high GPT-6 Astra prompt appends and make Astra their real default

The three category prompt appends now have GPT-6 Astra variants in both editions
(`packages/senpi-task/src/category/openai-categories.ts` and
`packages/omo-opencode/src/tools/delegate-task/openai-categories.ts`), selected by `isGpt6Model` through
the existing `resolvePromptAppend` hook. Each append is a delta over senpi's `gpt-6-astra` core preset
rather than a restatement of it: ultrabrain states the success criteria of a max-effort hard-logic
answer (evidence cited from this turn, executable claims executed, a self-falsification pass, rejected
alternatives and open assumptions named, one decision-complete recommendation); deep keeps one goal and
one deliverable with a generous exploration budget, the goal as authorization, numbered steps as one
atomic task, fixes trace at least two levels above the symptom to the root cause, and the harness fact that a question ends the turn unfinished; unspecified-high asks for a
survey of the whole affected surface (callers, sibling modules, tests, docs, schemas, config, CI, git
history), at least two weighed approaches, and delivery across every surface found. The previous
ultrabrain append prescribed a "Bottom line" response format that the Astra preset bans as a stock
phrase; deep on Astra fell through to the generic append because `isGpt5_5OrLaterModel` never matched
`gpt-6`.

The prompts only reach Astra when the category resolves to it, and `resolveModelForDelegateTask` picks
the builtin `config.model` before the fallback chain, so the chain-only routing change in #7790 left
`gpt-5.6-sol` as the effective default wherever Sol was available. The builtin defaults now read
`ultrabrain` = `openai/gpt-6-astra` max, `deep` and `unspecified-high` = `openai/gpt-6-astra` high, and
`unspecified-high` moved from the anthropic category file into the openai one in both editions
(`anthropic-categories.ts` is deleted from omo-opencode). senpi-task's independent chain transcription
(`fallback-chains.ts`) mirrors the #7790 model-core chains for visual-engineering, ultrabrain, deep, and
unspecified-high. `requiresModel` accepts a list: `ultrabrain` and `deep` (senpi-task) and `deep`
(omo-opencode) open on `gpt-6-astra` OR `gpt-5.6-sol`, so a registry with either flagship keeps them and
one with neither still never falls through to a cross-family model. The task tool description renders a
list gate as `(requires gpt-6-astra or gpt-5.6-sol)`.

omo-senpi telemetry adds `gpt-6-astra` to the exportable model vocabulary for the providers that ship an
Astra rung, since a shipped rung must never mask to `custom`, and `docs/reference/senpi-telemetry.md`
carries the regenerated schema block.

## 2026-09-05 — Route GPT-6 Astra through model-core and frontier agent families

GPT-6 Astra is now the high-effort top rung for the visual-engineering, ultrabrain, deep, and unspecified-high category routes, with the existing GPT-5.6 Sol lanes retained as fallbacks. Model-core recognizes Astra's capability limits and canonicalizes OpenAI fast-tier IDs, while omo-opencode treats Astra as a GPT-5.6-class frontier model for prompts, reasoning, tool-schema protection, delegation, and native Sisyphus routing.

## 2026-09-04 — Ship the conditional x-search skill and stop the startup log line

The published omo-ai payload never contained `plugin/skills-conditional/x-search/SKILL.md`. The
plugin's own `files` allowlist shipped that directory, but the payload copy lists in
`script/build-omo-native.ts` and `script/build-omo-binary.ts` did not, and
`stage-x-search-skill.mjs` wrote its copy into the source plugin dir even when the staging build
redirected every other artifact through `OMO_SENPI_PLUGIN_OUTPUT`. With no packaged copy, the
bundled component advertised `plugin/extensions/skill/SKILL.md`, and senpi reported a startup skill
conflict: "skill path does not exist". The staged skill is now copied into the staging plugin root,
is part of both payload allowlists, and is required by the native, installer, and npm payload
checks; `resolveXSearchSkillPath` returns nothing when neither copy exists, so a broken payload
keeps `x_search` working, contributes no skill path, and warns once instead of tripping the
conflict banner.

The `x-search registered` and `x-search skipped: no xAI credential` lines also no longer greet
every startup. Components register before the TUI takes over stdout and the default component
logger writes `info` to `console.info`, so both expected outcomes moved to the optional `debug`
channel.

## 2026-09-03 — Add the credential-gated x_search tool and skill

Senpi can now search X (Twitter) posts through xAI when an xAI account is connected, and stays silent when it is not.

`packages/omo-senpi` gained an `x-search` component that registers the `x_search` tool at extension load (so `tool_search` sees it in the same session) only if `<agentDir>/auth.json` has an `xai` `oauth`/`api_key` entry, or `XAI_API_KEY` when that file is absent. The matching `x-search` skill is staged into `plugin/skills-conditional/` rather than `plugin/skills/` and is contributed via `resources_discover` only when the same gate passes, so machines without xAI never pay for the skill in the index. There is no `omo.json` key.

In-process task children inherit the tool with `exposure` remapped to `direct` (`CHILD_DIRECT_EXPOSURE_TOOL_NAMES`) because they have no `tool_search` builtin; curated `explore` stays on its existing allowlist (no `x_search`), while `librarian` documents the X/social lane. Query recipes and live QA live under `packages/omo-senpi/scripts/qa/x-search-backtest.mjs` and `x-search-live-e2e.mjs`.

## 2026-09-02 — Build missing prebuilt inputs in the omo-native release staging

The omo-native plugin staging now builds `packages/lsp-daemon/dist` and
`packages/ast-grep-mcp/dist/cli.js` through the canonical root scripts
(`build:lsp-daemon`, `build:ast-grep-mcp`) whenever they are absent before
consuming them. The publish-platform workflow installs dependencies with
`--ignore-scripts`, so the root prepare build never produced these artifacts
there and every beta.32 platform build failed with ENOENT on the lsp-daemon
dist. Prebuilt artifacts are still reused untouched when present, and the
staged payload checks are unchanged.

## 2026-09-02 — Give the legacy daemon fixture a cold-Windows readiness budget

The Codex installer test fixture's event-driven readiness wait now allows 30
seconds on Windows, matching the platform-specific execution budgets the
installer integration tests already use. Assertions and event-driven behavior
remain unchanged; only the fixture's failure deadline is widened past the flat
5-second bound that a cold Windows runner exceeded while spawning the fixture
daemon.

## 2026-09-01 — Defer bind-time reflection reconciliation on scheduler contention

Session-start reflection reconciliation now uses a zero-wait scheduler lock and defers when a sibling session is already scheduling the same memory identity. Normal reflection reservation and completion paths retain their existing serialized wait budget.

## 2026-08-28 — Pin Senpi 2026.8.28-2 for the shared interactive host hotfix

`packages/omo-native/package.json`, `packages/omo-senpi/package.json`, and the
root `package.json` now require the exact published `@code-yeongyu/senpi`
`2026.8.28` release. The engine hotfix repairs the beta.23 shared-host
regressions: Shift+Tab no longer prints `Thinking level: [object Promise]`
and the low/med/high options render again, user messages no longer render
twice, and resuming a session held by a live shared host attaches instead of
failing with `session_path_in_use`. The release also carries the compiled
eval-kernel asset resolution fix, restoring the JavaScript and Python eval
kernels in compiled binaries.

## 2026-08-27 — Keep Windows persistence and DAP paths portable

The shared atomic-write helper now opens temporary files with a writable
descriptor, tolerates filesystem-specific `fsync` limitations, uses unique
temporary names, and skips parent-directory `fsync` on Windows where directory
handles reject that operation. The thread mailbox and durable receipt stores
now use that helper rather than maintaining divergent atomic-write code.

The zero-dependency DAP client now accepts only numeric `host:port` strings as
socket adapter specs. Windows drive-letter paths such as
`C:\workspace\fixture-adapter.mjs` remain executable script paths. This fixes
the real adapter launch path without increasing polling deadlines or masking
transport errors.

Focused regression coverage includes the real DAP fixture session, Windows
drive-letter classification, atomic-write replacement with injected `EPERM`
from `fsync`, mailbox persistence, and durable receipt lifecycle behavior.

## 2026-08-27 — Keep platform smoke tests aligned with runtime requirements

The release-binary smoke harness now exports `USERPROFILE` alongside the
isolated Git Bash `HOME` on Windows so Node's `os.homedir()` resolves the same
directory used by the provisioning assertion. Linux x64 musl smoke now installs
the binary's required `libstdc++` runtime package inside Alpine before running
the version check. These changes keep the smoke gate strict while matching the
actual Windows home-directory and musl runtime contracts.

The compiled OmO launcher now materializes its first-run Windows executable by
copying it directly with the platform file-copy API, because Windows rejects
renaming a newly copied `.exe` into place with `EPERM` even when the
destination did not previously exist. POSIX keeps the temporary-copy and
atomic-rename path. Both branches retain hash-checked provisioning and cleanup.
The compiled Windows child now identifies its launched executable from
`process.argv[0]` rather than Bun's original compile path, preventing repeated
self-provisioning and the resulting `AssignProcessToJobObject` loop. Windows
first-run provisioning now continues in-process after materialization, while
POSIX keeps the child reexec handoff.
The dedicated Linux arm64 Alpine smoke lane now installs `libstdc++` before
executing the musl binary, matching the x64 musl smoke contract.

Windows CI now gives the Codex installer integration test and the seven-node
DAG failure E2E their observed platform-specific execution budgets. The
assertions and event-driven behavior remain unchanged; only the test harness
deadlines are widened from the prior 60-second and 15-second ceilings that
expired on the full Windows matrix.

## 2026-08-27 — Keep Windows LSP daemon stamping safe with spaced runtimes

The LSP daemon build helper now disables shell execution when invoking an
absolute runtime path such as `C:\Program Files\nodejs\node.exe`, while keeping
shell lookup for bare `tsc` and `bun` commands on Windows. The release builder
therefore reaches the version-stamping step instead of letting the shell split
the runtime path at `C:\Program`. The command-policy regression tests cover
absolute Windows paths, bare package commands, and POSIX execution.

## 2026-08-27 — Record post-beta.23 merged follow-ups

The root product changelog now records the pull requests merged after the
beta.23 release note was authored: LSP formatting and resident-client caps
(`#7428`), config-watch duplicate-load stand-down (`#7420`), the Codex GPT-5.6
650k context-window contract (`#7429`), Windows portability and the beta.23
source-state merge (`#7432`, `#7427`), and the Senpi daemon-first
post-mutation pipeline (`#7430`). The entries include their merge commits so
the release note remains traceable to the final `dev` history.

## 2026-08-27 — Release OmO Native beta.23 with Senpi 2026.8.27

This release advances the OmO Native engine contract from Senpi `2026.8.26-2`
to `2026.8.27`. The version is exact-pinned in the native package, adapter
peers, task runtime, package-shape contracts, compiled-entry fixtures, and
the generated dependency lock. The package remains beta-channel-only:
install or upgrade it with `npm i -g omo-ai@beta` or the equivalent Bun
command; the intentionally unchanged `latest` tag is not the update channel.

### JavaScript-first eval composition

The eval guidance now teaches JavaScript as the primary composition surface.
The first example cell establishes state in the persistent JavaScript kernel;
the next example fans out independent session-tool calls with
`await Promise.all(...)`; a later example shows the explicit cross-language
escape hatch when the JavaScript kernel is occupied by detached work. This
aligns the examples with the runtime's persistent-kernel and bounded-parallel
execution model, allowing an agent to reuse state and schedule independent
work without first translating the workflow into a separate shell script.

`parallel(thunks)` executes asynchronous thunks through a bounded worker pool
and preserves result order while allowing concurrent progress. The default
pool width is four, and `pipeline(items, ...stages)` creates sequential stage
barriers while using the same bounded fan-out inside each stage. This note
does not claim a percentage speedup: the repository contains instrumentation
for wall-clock savings and round-trip counts, but no committed cross-version
benchmark that would justify one.

### Persistent JavaScript kernel state

JavaScript cells continue to share one session-scoped kernel, so values
created in one cell remain available to the next cell. State persistence now
rewrites only top-level declarations, including destructuring bindings and
uninitialized declarations, while leaving declaration-shaped text inside
strings, comments, and nested function bodies untouched. This makes the
state-carrying transform safe for examples, templates, regular expressions,
and nested implementation snippets.

The JavaScript worker path remains the normal execution mode. When the worker
entry cannot be loaded, the runtime can use its controlled inline fallback;
the fallback preserves the language-level contract without requiring a
build-time worker file to remain at its original source path. Kernel state is
isolated per language, so resetting a Python kernel does not reset JavaScript
state.

### Busy kernels and cross-language continuation

A detached cell keeps its language kernel busy until it reaches a terminal
state. A second eval request in that language receives a diagnostic that
identifies the occupied cell and its available output context, then lists
each idle enabled kernel that can continue the work. This converts a vague
same-language contention error into an explicit scheduling decision. If no
other interpreter is idle, the diagnostic does not invent an escape route.

JavaScript is always available on supported Node runtimes. Python, Ruby, and
Julia remain optional capability-gated interpreters: their absence is
reported as a capability gap rather than making the JavaScript path
unavailable. This preserves a fast default while keeping polyglot workflows
possible when the corresponding interpreter is installed.

### Detached-cell lifecycle and diagnostics

Detached execution remains an explicit lifecycle rather than a hidden
background promise. A cell can be created, started, detached, completed,
failed, stopped, or inspected through `peek`; each terminal transition is
reported once. Completion notifications are delivered as internal,
model-visible messages instead of synthetic user-input queue entries, so
background eval status cannot masquerade as a user steering message.

Detached overflow notices carry plain absolute spill paths, which the regular
agent read surface can consume directly. The `local://` scheme remains an
in-cell kernel helper for session-local artifacts and is not presented as an
agent-facing file path. A wall-clock hard limit, defaulting to 1800 seconds,
continues to run across detachment and bridge calls; reaching it interrupts
the cell and settles it as cancelled instead of leaving unbounded work
behind.

### Tool orchestration and observability

Tools invoked from inside an eval cell continue through the session's real
tool execution surface. Reserved helpers such as `agent`, `output`, and
`tool_schema` use their dedicated bridge path, while recursive eval remains
rejected. The runtime records one bounded `senpi.eval.execution` event per
settled cell, including wall time, kernel time, terminal status, detached
status, nested tool-call counts, and bounded per-tool aggregates. The
external projection excludes prompts, arguments, call identifiers, errors,
and result previews.

The OmO Native telemetry adapter accepts versioned full-detail eval events,
reduces them to scalar rollups, correlates cells to their owning sessions,
and fails closed on duplicate ownership or malformed metadata. Eval-only
waves remain separated from non-eval waves so modeled savings cannot be
inflated by mixing unlike execution modes. These metrics make composition
behavior observable without turning an unmeasured model into a promised
benchmark.

### Failure recovery and compatibility

The JavaScript kernel recovers from worker crashes by settling the active
cell, retiring the failed worker, and preparing a fresh worker for the next
cell. Session-generation fencing prevents callbacks from retired sessions
from emitting into a newer session. Subprocess-backed languages continue to
gate execution on interpreter readiness so startup time does not consume the
cell's execution budget.

The supported runtime contract remains Node `>=24`. JavaScript is available
without a separately installed interpreter; optional languages are detected
independently. OmO Native's launcher continues to support explicit runtime
selection through `OMO_RUNTIME=node` or `OMO_RUNTIME=bun`, with loop guards
preventing accidental re-execution of an already selected runtime. Bun 1.4
remains the release/build toolchain, while the codemode package keeps its
Node-compatible boundary and does not depend on Bun-only APIs.

### Upgrade and verification notes

This is a package-chain update, not a session-data reset. Existing settings,
credentials, sessions, permissions, and enabled extensions remain outside the
package replacement. The exact Senpi version is carried consistently through
the native runtime, adapter peer/dev dependencies, task-engine pins,
compiled-entry identity tests, and lockfile.

The release was verified against the Senpi `2026.8.27` registry identity and
isolated CLI checks, OmO Native package-shape and pin contracts, the
Senpi-adapter test suite, strict type checking, native payload staging, and
the compiled runtime identity check. No percentage latency claim is made
because no cross-version benchmark is committed; users can inspect the
versioned eval telemetry for their own workloads.

## 2026-08-26 — Stop the omo launcher from orphaning its engine

The MCP environment cleaner now accepts an optional ambient environment map,
so callers and tests can represent absent variables without mutating
`process.env`; the default runtime path remains unchanged. This keeps
undefined environment entries out of spawned stdio MCP environments across
Bun platforms.

The native launcher chain blocked in `spawnSync` at both of its layers: `bin/omo.js` waiting on the
engine, and the bun re-exec waiting on the bun launcher. No JavaScript runs while `spawnSync`
blocks, so a launcher that received `SIGTERM` died on the spot and the engine below it was
reparented to pid 1, still holding the terminal and still running. Those orphans are what later
surface as stdin `EIO` crashes and as engine processes lingering for days.

Both layers now go through one asynchronous spawn helper. It forwards `SIGTERM` and `SIGHUP` to the
child, waits for the child to finish its own shutdown within a bounded grace window (10 seconds,
overridable with `OMO_SIGNAL_GRACE_MS`), and re-raises the signal on itself if the child ignores it,
so a supervisor still observes the death it asked for. `SIGINT` is not forwarded, because the tty
delivers it to the entire foreground process group already and a second delivery would interrupt the
engine twice; the launcher merely stops dying underneath it. Exit-status fidelity is unchanged - the
child's exit code passes through, and a child killed by a signal still makes the launcher die by
that same signal. Windows installs no signal handlers, where POSIX signal delivery does not exist.

`omo doctor` now also names the orphans that earlier launcher versions left behind: interactive
engine processes reparented to pid 1, reported with pid, age and tty. Cleaning them up is an
explicit per-pid action, `omo doctor --reap <pid> [pid...]`, which re-reads the live process table
and refuses any pid that is not an orphaned interactive engine at that moment - a live session, an
`--mode` rpc or app-server engine, or anything that is not an engine at all. There is deliberately
no pattern-matching kill.

Real-surface QA drives the whole chain on a pty whose session leader outlives the launcher (so the
kernel's own `SIGHUP` on session teardown cannot be mistaken for a fix), on both the node chain and
the three-deep bun chain a `bun add -g omo-ai` install has. Evidence:
`.omo/evidence/20260826-launcher-signal-forward/`.

## 2026-08-26 — Release OmO beta.21 with Senpi 2026.8.26

Hotfix release: OmO release metadata and platform package pins advance from
beta.20 to beta.21 with the Senpi contract aligned to `@code-yeongyu/senpi`
2026.8.26 (compaction liveness + anthropic sdk peer alignment), carrying the
pi-tui/senpi cross-bundle lazy warm-up fix and status-widget render containment
from #7354. The Bun lockfile is regenerated for the exact release dependency
graph.

## 2026-08-25 — Release OmO beta.20 with Senpi 2026.8.25

OmO release metadata and platform package pins advance from beta.19 to beta.20,
with the native, adapter, task-engine, and package-shape Senpi contract aligned to
`@code-yeongyu/senpi` 2026.8.25. The Bun lockfile is regenerated for the exact
release dependency graph.

The committed Senpi extension and Codex installer bundles were regenerated after
the provenance-safe CI gate reported stale generated output for the beta.20
release-state SHA. The generated payloads now match the release metadata and
must remain synchronized with the exact Senpi dependency and skill inventory.

The staged native-payload test now normalizes Windows CRLF before checking the
shipped `.gitignore` contract. The file content remains `/plugin/`; checkout
line-ending policy no longer creates a false release-gate failure on Windows.

The embedded-runtime provisioning test now treats POSIX file mode assertions as
POSIX-only. Windows does not expose the same `0o644` mode bits, while byte
content, SHA-256 validation, and marker-based skip behavior remain covered.

## 2026-08-24 — Pin OmO beta.19 to Senpi 2026.8.24

The OmO Native launcher, adapter peers/dev dependencies, task engine, root
development dependency, and package-shape tests now move in lockstep to
`@code-yeongyu/senpi` 2026.8.24. This release carries the Bun 1.4 redirect-body
cleanup fix for environments whose Undici body lacks `dump()`, plus the audited
Senpi dependency refresh.

The exact pin is part of the shipped runtime contract and is synchronized before
the beta.19 publishing workflow stamps package versions.

## 2026-08-24 — Refresh compatible dependencies

The beta.19 release refreshes the compatible direct dependency lines used by the
OpenCode, TUI, matching, telemetry, and Senpi adapter surfaces: OpenCode
SDK/plugin 1.18.22, OpenTUI 0.5.8, Picomatch 4.0.7, PostHog Node 5.51.1, and
TypeBox 1.3.18. The Bun lockfile is regenerated from those manifest pins.
The dependency security and Codex component package-shape tests now assert the
new Picomatch 4.0.7 floor instead of pinning the previous safe floor.

The clean-install warnings reported against beta.18 were also reproduced and
audited. Bun intentionally does not let a dependency grant trust to its own
transitive lifecycle scripts, so adding package-local `trustedDependencies`
would be ineffective and was rejected. `@google/genai` runs a declared no-op
preinstall and `protobufjs` runs a compatibility-warning-only postinstall; both
are safe to leave blocked. The Anthropic peer warning remains an intentional
tradeoff: the required `@anthropic-ai/sdk >=0.93.0` line pulls Node credential
modules into the browser bundle, while the retained 0.91.1 pin passes the
browser-safety gate.

## 2026-08-23 — Surface attribution + shared install id on every omo-native event (schema v3)

**What:** `OMO_NATIVE_SCHEMA_VERSION` bumps to 3. `telemetry-core` event clients spread
`product.additionalProperties` into the shared property block (fixed identity keys still win).
`product-identity.ts` gains `getOmoNativeAttribution`/`withOmoNativeAttribution`: `surface`
(`cli` | `desktop`, from `OMO_NATIVE_SURFACE`) and `install_id` (random 64-hex file beside the
session-id salt; `OMO_NATIVE_INSTALL_ID` env wins when valid). Both the session client and the
component's privacy facade attach them, so every event carries attribution. Test fixtures
(`withTempAgentDir`, `useTemporaryAgentDir`) now pin all three agent-dir env names — an ambient
`OMO_CODING_AGENT_DIR` used to leak real-home writes out of tests. Docs updated in
`docs/reference/senpi-telemetry.md`.

**Why:** The OmO Desktop app drives the bundled runtime over RPC; without attribution those
turns counted as CLI adoption and the 264 RPC users could not be split. The install id is the
agent-home file shared with the desktop host, so CLI and Desktop join without deriving anything
from the machine.

**A future refactor or sync must not break:** attribution must never derive from hostname,
hardware, or accounts; keep both capture paths (session client + facade) attributed or events
disagree about their own schema.

## 2026-08-20 — Demand parent-side verification of DAG completions

A DAG node's completion summary was delivered to the orchestrating parent as if
it were established fact, so a node that overstated or fabricated its work could
satisfy the parent without a single artifact being read. Model-facing DAG
completion payloads now carry an explicit verification directive: reconstruct the
node's owed scope from its prompt, open the files and run the commands it claims,
verify each deliverable with the parent's own tool calls, and send corrective
instructions back to the same node until that verification passes.

`CompletionDetails` gains an optional `dag` block (`run_id`, `node_id`) sourced
from the task record's DAG owner, so the parent can address the exact node it
must correct. `buildCompletionMessage` appends the directive once per message
whenever any batched detail is DAG-owned, and run-level terminal wakes
(completed, failed, cancelled) append it to their injection content. A plain
non-DAG completion keeps byte-identical content, and `dag.run.paused` stays
directive-free because a pause is not a completion claim. The width-rendered TUI
path is untouched: `completionMessageLines` and the task-completion renderer
still render from `details`, so this changes only what the model reads.

## 2026-08-18 — Rebuild the Sisyphus runtime prompt on same-family model switches

The Sisyphus runtime prompt reconciler skipped every rebuild whose runtime
model shared the configured model's broad prompt family. The `fallback`
family is not prompt-uniform: `buildFallbackSisyphusPrompt` applies
Gemini-specific override blocks, and other families bake model-dependent
sections (GPT identity text, claude/non-claude planner sections). Switching
between same-family models in the TUI (e.g. Gemini -> MiniMax-M3 or
DeepSeek -> MiniMax-M3) therefore kept the previous model's baked prompt in
place, and the active model reported a stale identity (issue #6966).

The reconciler now skips only when the runtime model is exactly the model the
baked prompt was built for, and the existing rebuilt-versus-baked equality
check suppresses genuine no-op switches (DeepSeek and MiniMax bake
byte-identical fallback bodies, verified against the real prompt builder).
The system-transform handler canonicalizes the opencode hook model record to
`<providerID>/<id>` so bare builtin-provider ids compare exactly. Rebuild work
per request is unchanged for cross-family switches; same-family switches now
rebuild like cross-family ones already did.

## 2026-08-18 — Respect user permission.task on OMO main agents

`applyToolConfig` built the permission object for sisyphus, atlas, hephaestus,
and prometheus by spreading the agent's existing permission first and then
hardcoding `task: "allow"` on top, so any user-configured `permission.task`
was silently discarded while the config looked applied. The default is now
injected before the spread, which keeps `task: "allow"` when the user
configured nothing and lets an explicit user value win otherwise.

The plugin-injected rules that fence delegation (`call_omo_agent: "deny"`,
`task_*`, `teammate`, todo denials, prometheus bash denials) still apply after
the user permission, so only the `task` default changed precedence. Verified
against a real isolated `opencode serve` boot with a user-layer
`[opencode].agents.<agent>.permission.task` override for all four agents, plus
a negative-control boot without user config. Object mappings for
`permission.task` and a configurable deny list remain follow-ups tracked in
the issue.

## 2026-08-18 — Resolve configured category model chains against availability

OpenCode category `models` chains now skip entries that are absent from the connected provider catalog before creating the delegated session. The configured order and per-entry settings remain intact, and fuzzy-normalized model IDs resolve to the provider's available spelling instead of being discarded.

When no configured entry is available, delegation still fails rather than selecting an unrelated default, but the error now names the complete configured chain. Cold-cache behavior remains unchanged until an availability catalog exists.

## 2026-08-17 — Track Senpi 2026.8.17 for the omo-ai beta line

All active native Senpi pins now use `2026.8.17` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The lockfile resolves the complete 2026.8.17 companion family while
the existing Pi `0.84.2` compatibility overrides remain unchanged because
the upstream manifest changed only its Senpi package aliases.

The hand-derived provider registry was checked against the new engine. Its
provider IDs are unchanged, while the upstream Cerebras catalog no longer
advertises `zai-glm-4.7`; only the derivation version changes locally. This is
a host dependency update, not an OMO extension behavior change, so extension
source stays untouched and committed bundles are refreshed only from the
normal build. Conflict zones are the exact manifest pins, `bun.lock`, the
provider-map derivation comment, and generated Senpi extension artifacts.

## 2026-08-18 — Ship @babel/parser with omo-ai for bundled Senpi codemode

`@code-yeongyu/senpi@2026.8.16` bundles the source-only
`@code-yeongyu/senpi-codemode` extension but its bundled-dependency closure
omits the Babel parser that `senpi-codemode/src/kernels/js/rewrite-imports.ts`
imports at runtime. Clean `omo-ai` installs therefore logged a non-fatal
`Failed to load extension ... Cannot find module '@babel/parser'` warning at
boot and silently lost codemode/eval surfaces (verified on a real isolated
`omo-ai@5.0.0-0.beta.8` install: 43 extensions loaded, `senpi-codemode`
absent).

`omo-ai` now declares `@babel/parser@8.0.4` as a direct exact-pinned runtime
dependency. npm installs the full transitive Babel closure next to Senpi, so
the bundled codemode extension resolves its import and loads enabled. This is
a deliberately duplicative downstream compatibility dependency until Senpi
publishes a complete bundle; remove it at the next Senpi pin bump only after
isolated packed-install and RPC boot QA prove the upstream fix.

## 2026-08-17 — Make explicit beta publication ownership-safe

The synchronized `/publish` command and skill now accept an exact semantic version in addition to `patch`, `minor`, and `major`. Exact versions are dispatched through the workflow's `version` input, and the returned workflow run ID is the sole owner followed through release completion; latest-run inference is no longer part of the command.

Prerelease changelogs now compare against the preceding release in the same channel, and GitHub releases explicitly carry prerelease metadata. Stable bump behavior remains unchanged. Senpi RPC model admission diagnostics also report the probed catalog size and child stderr tail while the launch-parity test keeps its process environment fixed at module load.

## 2026-08-16 — Track Senpi 2026.8.16 for the omo-ai beta line

All active native Senpi pins now use `2026.8.16` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The companion Pi compatibility line moves from `0.84.1` to `0.84.2`
to match the upstream host contract incorporated by this Senpi release.

The workspace lockfile, manifest-shape tests, and builtin-provider map move
with the exact engine pin. Senpi 2026.8.16 adds Cursor as a builtin
authentication provider, so the native provider map now includes `cursor`.
Keep these surfaces aligned whenever Senpi changes; a manifest-only update is
incomplete because the published native payload and generated adapter bundle
consume the resolved dependency graph.

## 2026-08-13 — Track Senpi 2026.8.13 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.13` across the root, native
launcher, OmO Senpi adapter, and task engine. Senpi 2026.8.13 adds `baseten`
and `qwen-token-plan-individual`; this update also synchronizes the local map
with the already-available `opengateway` provider. Keep
`packages/omo-native/bin/lib/provider-map.json` synchronized with
`builtinProviders()` whenever the shared pin moves.

The lockfile must move with the exact pins. The focused pin tests continue to
reject manifest drift, while the provider-map contract now compares the local
map directly with the installed engine registry.

## 2026-08-06 — Model packed Senpi installs in compatibility fixtures

The root Senpi compatibility fixture now passes the packed plugin path explicitly when exercising
`runSenpiInstaller`. This keeps the hermetic packed-layout test on the immutable verification path
after source installs began rebuilding generated artifacts unconditionally.

Future compatibility fixtures must choose the installer mode deliberately: omit `pluginPath` only
for a real source-tree refresh, and provide it when modeling a published or packed plugin.

## 2026-08-11 — Publish native task lifecycle snapshots over RPC

The OmO Senpi task component now emits safe `omo.task.updated` snapshots on session start and every
task-store mutation. Snapshots are scoped to the captured parent session and include only display,
model, lifecycle, residency, timing, and optional terminal run-stat fields; durable notification and
root-session bookkeeping must never cross the RPC boundary. Older Senpi hosts without `pi.rpc`
remain a no-op compatibility path.

## 2026-08-12 — Require the request-capable Senpi release

All native Senpi workspace pins now use `2026.8.11-6`, the first published release that exposes
`pi.rpc.handle`, `extension_request`, and `RpcClient.requestExtension`. Earlier releases can still
receive extension events but cannot serve desktop task send/cancel/output requests.

Keep the root, native launcher, OmO Senpi adapter, and task engine pins aligned. Downgrading any one
of them to an emit-only host silently turns the interactive task panel back into telemetry-only UI.

## 2026-08-12 — Track Senpi 2026.8.12-4 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.12-4` (root, native launcher, OmO Senpi adapter, and
task engine), moving the omo-ai 5.0.0 beta line onto the Senpi 2026.8.12 engine train. The
four-surface alignment rule above still holds: `packages/omo-native/test/senpi-pin.test.ts` fails any
manifest that drifts from the shared pin, so all four move in one commit.

## 2026-08-13 — Record the OmO 5.0.0 beta.7 release

Release PR #6797 merged the `v5.0.0-beta.7` source state at
`923726cdeb0bd0c1d60cdf83dc4cf6fe1117a548` and published
`omo-ai@5.0.0-0.beta.7`. The published package pins
`@code-yeongyu/senpi@2026.8.12-4`; future release preparation must keep the
root, `omo-native`, `omo-senpi`, `senpi-task`, lockfile, generated extension
bundle, and pin tests aligned before tagging.

The release also includes `d694add58dd1` (`fix(omo-native): emit doctor report
atomically`). Doctor output now becomes visible only after a complete report is
ready, so consumers must not reintroduce partially written report files or
split the atomic write path during future release refactors.

## 2026-08-18 — Make the lsp-daemon test budget dominate its subprocess budgets

`packages/lsp-daemon/vitest.config.ts` declared no `testTimeout`, so vitest's
5s default applied while `test/qa-driver-portability.test.ts` granted its `bun`
cancellation smoke 10s (an `execFileSync` timeout and a `setTimeout` guard
around its `spawn`). The harness therefore killed the test before the inner
guard could ever fire, so a slow-but-correct subprocess reported `Test timed out
in 5000ms` instead of an assertion result. Windows CI runners routinely spend
more than 5s spawning `bun`, which is why "Run vendored lsp-daemon tests" failed
on `windows-latest` with no product defect behind it.

The package now sets `testTimeout`/`hookTimeout` to 30s, exported from the
config as `TEST_TIMEOUT_MS` alongside the documented `MAX_IN_TEST_BUDGET_MS`
ceiling of 10s. The invariant is that the harness budget strictly exceeds every
budget a test grants a subprocess or timed promise; `test/test-timeout-budget.test.ts`
reads both the configured value and the real budgets out of the test sources and
fails if that ordering is ever reintroduced. Keep the bound proportionate: it
exists to survive a cold Windows process spawn, not to hide a genuine hang.

## 2026-09-06 — Keep lead polling alive through runtime access windows

Lead polling now suppresses repeated `EPERM` and `EACCES` runtime-directory errors, reports the first unavailable transition and the subsequent recovery, and leaves mailbox state untouched while the runtime directory cannot be enumerated. Mailbox reads and missing-directory handling remain unchanged.

## 2026-09-22 — omo.json speaks `[native]`, and the ulw-loop reviewers are `omo-native-*`

The standalone edition is branded OmO Native, but its two public identifiers were
minted from the engine's package name before the edition had a brand: the harness
block in `omo.json` was `[senpi]`, and the three reviewer agents users delegate to
by name were `omo-senpi-code-reviewer`, `omo-senpi-qa-executor` and
`omo-senpi-gate-reviewer`. Both are user-typed, so neither could be renamed outright.

`[native]` is now the canonical harness block in all three config shapes, and
`OMO_CONFIG_HARNESS_IDS` is `["opencode", "native", "codex"]` with `senpi` kept as an
exported alias. The loader canonicalizes the legacy block when the config is READ,
which is what keeps a config the startup migration cannot reach — a locked run, a
read-only project file — applying every value it sets instead of being silently
ignored. When a file carries both spellings `[native]` wins and the ignored block is
named in a `deprecated-keys` diagnostic. A caller still passing `harness: "senpi"`
resolves the same view, so no consumer had to change. The `git_master` and
`telemetry` harness key scopes moved to `native` with it.

A first-launch migration (`2026-09-harness-native-rename`) rewrites the key in the
file once, following the shape `2026-09-category-deep-split` shipped: gated on
content, so a config that never named `[senpi]` is not rewritten at all — no backup,
no journal entry, no `_migrations` marker — and the rename surfaces as a startup
notice naming the key.

The reviewer trio is renamed to `omo-native-*`. The old names keep resolving through
`LEGACY_AGENT_NAME_ALIASES`, consulted at the resolution site (`resolveAgent`) rather
than by registering a second definition, so each agent still has exactly one
definition and `availableAgents` lists only the canonical names. The team member
validator canonicalizes before its reviewer check, so a team spec naming an old
reviewer still gets the "delegate via the task tool" refusal instead of an unknown-agent
error. The ulw-loop quality gate on the `omo-senpi` surface still names the pre-rename
identities; they reach the renamed agents through that alias, which is the one release
line of grace the rename gets.

Telemetry identifier VALUES are untouched: the platform string stays `omo-senpi`, and
so do the machine-id prefix and cache directory, because dashboards key off them.
