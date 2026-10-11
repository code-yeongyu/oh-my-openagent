# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**omo runs on senpi 2026.10.10-12, and a task shard stops soon after the session that owns it exits.** Task shards are now started with senpi's caller-lifetime ownership, so a multi-GB `p-*` shard host no longer stays resident for the full idle window after its owning session quits; peers and running turns still keep it alive. The engine also waits for its host child to really exit before releasing a stopped host, and required compaction no longer wedges on an unsafe newest message. Full engine notes: [senpi 2026.10.10-12](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-12). (code-yeongyu/senpi#3044, code-yeongyu/senpi#3054, code-yeongyu/senpi#3060)

Dropping the queued messages of a finished child (`completed`, `interrupted` or `error`) ends that queued continuation as `error`, marks it killed, and advances its run epoch, so the parent receives exactly one terminal result for it that names how many messages were not delivered; `task_output` then shows `error` rather than the original status. A failed runtime-fallback handoff instead reports its undelivered messages inside its one failure result. ([#9861](https://github.com/code-yeongyu/oh-my-openagent/issues/9861), [#9868](https://github.com/code-yeongyu/oh-my-openagent/pull/9868))

## [5.1.29] - 2026-10-09

**Child tasks and Kibitzer wakes of a fast-mode session no longer fail with `model_unavailable`: a `-fast` pin is accepted when the session starts on its paired base model.** Since 5.1.25, a category pinned to a `-fast` catalog variant such as `chatgpt-subscription/gpt-6-luna-fast` was refused after start, because senpi starts a `-fast` pin on its base model with the priority tier. Kibitzer recall wakes failed on every wake, and the built-in fast-first chains (`quick`, `deep-low`, `deep-high`, `ultrabrain`) silently skipped their first model. A run that started on the standard tier instead of priority is now accepted and recorded on the task (`effective_model.service_tier`) instead of refused. ([#9793](https://github.com/code-yeongyu/oh-my-openagent/issues/9793), [#9808](https://github.com/code-yeongyu/oh-my-openagent/pull/9808), [#9812](https://github.com/code-yeongyu/oh-my-openagent/issues/9812), [#9813](https://github.com/code-yeongyu/oh-my-openagent/pull/9813))

**omo runs on senpi 2026.10.10-11.** `tool_schema("eval:environments")` now documents `packages.install` and its `environment_install_timeout`, so JavaScript and Python cells can discover how to install packages without changing the default eval description or parameters. Julia, Ruby and Python cells do less fixed work per cell: no globals walk below the memory thresholds, no awaited cwd stat, and leaner Python queue and capture bookkeeping. A scheduled prompt created in a desktop thread before the OmO desktop moved that folder now fires, and `--session`, `--resume` and `--continue` find such sessions in the folder's new home. A session another live process already holds is refused with a typed `session_held` error instead of being opened twice. Sessions that share MCP servers but resolve different MCP configs no longer break each other's tools. A goal whose continuation stops also stops its timer. On Windows, stopping a command's process tree can no longer kill an unrelated process that reused a pid. On macOS and Linux, processes a JavaScript eval cell starts get their own process group, so a group kill can't stop the agent, and leftover grandchildren are stopped when the cell ends. Full engine notes: [senpi 2026.10.10-11](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-11). (code-yeongyu/senpi#3003, code-yeongyu/senpi#3028, code-yeongyu/senpi#3033, code-yeongyu/senpi#3034, code-yeongyu/senpi#2990, code-yeongyu/senpi#2951, code-yeongyu/senpi#2597, code-yeongyu/senpi#3007, code-yeongyu/senpi#2999, code-yeongyu/senpi#2995, code-yeongyu/senpi#3020, #9825)

### Fixed

**A background child no longer stays suspended while its parent is running.** A child parked while its parent session was still live was only revisited at the parent's next start, so it could sit suspended for hours and a goal waiting on its result waited forever. It is now revived right away, or ends with one result. ([#9350](https://github.com/code-yeongyu/oh-my-openagent/issues/9350), [#9799](https://github.com/code-yeongyu/oh-my-openagent/pull/9799))

**omo.dev shows its live stats more reliably.** A cold page load whose first stats refresh hit one upstream blip showed the fallback numbers; it now falls back to the last complete set instead. ([#9820](https://github.com/code-yeongyu/oh-my-openagent/issues/9820), [#9821](https://github.com/code-yeongyu/oh-my-openagent/pull/9821))

## [5.1.28] - 2026-10-09

**omo runs on senpi 2026.10.10-10.** With several Anthropic Subscription accounts, a session no longer switches accounts on a transient error and back on the next turn; it retries the same account, then stays on whichever account holds its transcript. With `resumeMode: "off"`, the conversation is no longer written to the prompt cache again on every turn. A long streamed tool call on the Anthropic Subscription lane no longer fails with "session stream queue exceeded 256 messages". Full engine notes: [senpi 2026.10.10-10](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-10). ([senpi#2891](https://github.com/code-yeongyu/senpi/issues/2891), [senpi#2982](https://github.com/code-yeongyu/senpi/issues/2982), [senpi#2822](https://github.com/code-yeongyu/senpi/issues/2822), [#9798](https://github.com/code-yeongyu/oh-my-openagent/pull/9798))

**Search, docs and quick work now run on Claude Haiku 5.5.** The default `explore`, `librarian` and `quick` lineups use `claude-haiku-5-5` at medium reasoning, right after GPT-6 Luna Fast, instead of Claude Haiku 4.5 at the end of the chain. On an Anthropic-only machine, the memory and Kibitzer sidecars run on it too. The Claude Code `haiku` alias now means Haiku 5.5. ([#9802](https://github.com/code-yeongyu/oh-my-openagent/pull/9802))

**Approval and authorization questions can't be read as permission, whichever model asks them.** ulw-plan's approval gate, its authorization block and mass-ulw's scope, spend and irreversible decisions are asked with `required: true`, so an unanswered gate ends the turn instead of continuing on best judgment. The plugin also sets the flag itself on gating questions, recognized by their pinned headers, for models that leave it out. ([#9735](https://github.com/code-yeongyu/oh-my-openagent/issues/9735), [#9775](https://github.com/code-yeongyu/oh-my-openagent/pull/9775), [#9774](https://github.com/code-yeongyu/oh-my-openagent/issues/9774), [#9782](https://github.com/code-yeongyu/oh-my-openagent/pull/9782))

**`chatgpt-subscription/gpt-6.1-sol-ultrafast` is available without a local extension**, with the Ultrafast service tier and default `xhigh` reasoning. Thanks to @audreyt. ([senpi#2975](https://github.com/code-yeongyu/senpi/pull/2975))

### Fixed

**A config migration no longer reformats your `omo.jsonc`.** The first start against an existing config rewrote every top-level value, dropping nested comments, trailing commas and your formatting. Migrations now edit only the values they change, in the file's own style. ([#9777](https://github.com/code-yeongyu/oh-my-openagent/issues/9777), [#9783](https://github.com/code-yeongyu/oh-my-openagent/pull/9783))

**A child that won't stop no longer keeps finished children resident.** One child that ignored SIGTERM stalled the idle sweep, so finished process children piled up (about 2 GB each). Every teardown step is now bounded, idle residents are reclaimed one by one, and `task_cancel` releases a finished resident; cancelling a running child that never answers its abort no longer hangs either. Thanks to @lee98www for the report. ([#9785](https://github.com/code-yeongyu/oh-my-openagent/issues/9785), [#9788](https://github.com/code-yeongyu/oh-my-openagent/pull/9788), [#9791](https://github.com/code-yeongyu/oh-my-openagent/issues/9791), [#9792](https://github.com/code-yeongyu/oh-my-openagent/pull/9792))

**Binary downloads validate every archive entry on localized systems.** Tar listings in a non-English locale (localized month names) or from GNU tar were not parsed, so their entries skipped validation; the downloader now lists archives in the C locale, parses both formats, and refuses a listing line it can't parse. Thanks to @MoerAI. ([#9685](https://github.com/code-yeongyu/oh-my-openagent/issues/9685), [#9780](https://github.com/code-yeongyu/oh-my-openagent/issues/9780), [#9779](https://github.com/code-yeongyu/oh-my-openagent/pull/9779))

**A suspended background task no longer looks like it is working.** Its row in the live task widget shows a still mark instead of a spinner and no climbing timer, names why it stopped (for example, the parent session restarted), and offers a message only where sending one would revive it. ([#9350](https://github.com/code-yeongyu/oh-my-openagent/issues/9350), [#9795](https://github.com/code-yeongyu/oh-my-openagent/pull/9795))

**Memory no longer writes empty transcript journals.** A session with nothing to record wrote an empty journal at every start; none is written now, and empty journals left by older builds are removed. ([#9737](https://github.com/code-yeongyu/oh-my-openagent/issues/9737), [#9739](https://github.com/code-yeongyu/oh-my-openagent/pull/9739))

## [5.1.27] - 2026-10-08

**omo runs on senpi 2026.10.10-9, which stops automatic turns from running without bound.** After one message from you, stream-rule nudges, goal continuations and other automatic follow-ups pause after 150 turns, or once 12 automatic turns in a minute do no work, and each stream rule corrects a message at most once. When it pauses, the session says so, and your next message picks it back up. Full engine notes: [senpi 2026.10.10-9](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-9). ([senpi#2967](https://github.com/code-yeongyu/senpi/issues/2967), [senpi#2969](https://github.com/code-yeongyu/senpi/pull/2969), [#9772](https://github.com/code-yeongyu/oh-my-openagent/pull/9772))

**A required question can't be read as permission.** senpi's `ask_user_question` accepts `required: true` for a question that gates an action, such as an approval before an irreversible step: if it times out, is dismissed or can't be shown, the model is told not to take that action. ([senpi#2949](https://github.com/code-yeongyu/senpi/issues/2949), [senpi#2959](https://github.com/code-yeongyu/senpi/pull/2959))

**The configuration guide documents the Anthropic 1-hour prompt cache and the cache keep-alive.** ([#9770](https://github.com/code-yeongyu/oh-my-openagent/issues/9770), [#9771](https://github.com/code-yeongyu/oh-my-openagent/pull/9771))

### Fixed

**Memory locks stop churning on machines with many sessions.** A session waiting on a memory lock no longer republishes a recovery lock on every retry: it reads first, and lock polls back off with jitter instead of a fixed 25 ms. Locks and candidate files left by processes that died are reclaimed, so the lock directory stops growing. ([#9749](https://github.com/code-yeongyu/oh-my-openagent/issues/9749), [#9750](https://github.com/code-yeongyu/oh-my-openagent/pull/9750))

**Single-turn answers no longer carry the progress-ledger block.** Hephaestus and Sisyphus keep the Now/Next ledger for multi-step work tracked in todos; a request finished in one turn gets a plain answer, without lines such as `Next: none`. Thanks to @cynkai. ([#9616](https://github.com/code-yeongyu/oh-my-openagent/issues/9616), [#9676](https://github.com/code-yeongyu/oh-my-openagent/pull/9676))

**A provider that sets its own `anthropic-beta` header keeps the betas a request needs**, so Claude 5.5 models through such a route no longer fail their first call. ([senpi#2957](https://github.com/code-yeongyu/senpi/issues/2957), [senpi#2963](https://github.com/code-yeongyu/senpi/pull/2963))

**Deprecating platform packages for a release that never shipped rechecks the registry before failing**, so a deprecation that is still propagating no longer fails the workflow. ([#9769](https://github.com/code-yeongyu/oh-my-openagent/pull/9769))

## [5.1.26] - 2026-10-08

5.1.25 was not released: its Linux x64 binaries went over the 150 MiB per-binary size budget during publishing, so no `omo-ai`, `lazycodex-ai`, `oh-my-opencode` or `oh-my-openagent` 5.1.25 exists. Everything planned for it ships here. Some 5.1.25 platform packages did reach npm and are deprecated; nothing installs them.

**omo runs on senpi 2026.10.10-8, which keeps a saved MCP sign-in with the authorization server that issued it.** The bundled MCP SDK moves to 1.32.1 (GHSA-6qxp-vccf-f47h), and senpi records which authorization server issued each saved sign-in and refreshes only there. If an MCP server's authorization server changes, you are asked to sign in again instead. MCP servers signed in with very old senpi versions may ask you to sign in again once their access token expires. An MCP HTTP endpoint that redirects to a different origin is no longer followed, and the connect error names both origins and the URL to put in the server's config. Full engine notes: [senpi 2026.10.10-8](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-8). ([senpi#2940](https://github.com/code-yeongyu/senpi/issues/2940), [senpi#2944](https://github.com/code-yeongyu/senpi/pull/2944), [#9757](https://github.com/code-yeongyu/oh-my-openagent/pull/9757))

**A relayed report or a quoted mention no longer turns on ultrawork.** A message that opens with a sender header (`[REPORT]`, `[a -> b]`, `Name (id) to recipient:`), a Markdown block quote, or a double-quoted span is now read as someone else's words, so pasting a report that describes ultrawork into a session no longer arms it there. A skill name inside an identifier, a path, a URL, or a prohibition ("no ultrawork", "do not use mass-ulw") no longer arms ultrawork or a skill pointer either. Typed asks, such as "ulw <task>" or a keyword at the end of your own sentence, still arm. ([#9600](https://github.com/code-yeongyu/oh-my-openagent/issues/9600), [#9606](https://github.com/code-yeongyu/oh-my-openagent/pull/9606), [#9738](https://github.com/code-yeongyu/oh-my-openagent/issues/9738), [#9740](https://github.com/code-yeongyu/oh-my-openagent/issues/9740), [#9744](https://github.com/code-yeongyu/oh-my-openagent/pull/9744))

**An opt-in side panel for the Senpi TUI.** Set `side_panel.enabled: true` in `omo.json` (or pass `--omo-side-panel` for one run) to get a right-hand column with the session, goal, context, subagents, tools, changed files and memory at a glance; the transcript reflows beside it, and clicking a file row opens its diff. Subscription usage is a separate opt-in (`side_panel.sections.usage`) because it is the one section that reads credentials. It is off by default and hides itself on terminals narrower than 120 columns. Thanks to @IvoryKir. ([#8092](https://github.com/code-yeongyu/oh-my-openagent/pull/8092))

**A bundled `visualize` skill renders inline HTML pages.** Charts, tables, diagrams and mockups come back as a self-contained page shown in the session; where the html preview is not available, the skill opens the page file through the browser skill instead. ([#9700](https://github.com/code-yeongyu/oh-my-openagent/issues/9700), [#9702](https://github.com/code-yeongyu/oh-my-openagent/pull/9702))

**Arch Linux users can install OmO from the community AUR package `omo-bin`.** The install guide now documents it: `yay -S omo-bin` (or any AUR helper) installs the official Linux binary from our GitHub releases after checking it against the release's `SHA256SUMS`. It's maintained by @sTiKyt, not the OmO team, so update it with your AUR helper rather than `omo update`. ([#9584](https://github.com/code-yeongyu/oh-my-openagent/issues/9584), [#9610](https://github.com/code-yeongyu/oh-my-openagent/pull/9610))

### Fixed

**The release binary size budget is 160 MiB, and every build reports its headroom.** Linux x64 reached 157.6 MB, over the old 150 MiB budget, which stopped 5.1.25. The budget exists to keep each install and update download small; release builds now print each target's headroom and warn when one is within 5 MiB of the budget. ([#9760](https://github.com/code-yeongyu/oh-my-openagent/pull/9760))

**A task child spawned with an explicit model runs on that model, or the spawn fails and says why.** A pin with a thinking level such as `anthropic/claude-opus-5-5:medium` used to be dropped silently, so the child ran on the default model instead; the pin is now resolved once against the live model registry, and the child's own reported model is checked after it starts. A model that cannot be resolved, or a child that comes up on a different model, fails the spawn with a typed error, and `task_output` shows the model the child actually ran next to the one requested. ([#9722](https://github.com/code-yeongyu/oh-my-openagent/issues/9722), [#9736](https://github.com/code-yeongyu/oh-my-openagent/pull/9736))

**The planner asks its approval question through the question tool.** `ulw-plan` and `mass-ulw` ask owner decisions and the plan-approval gate as a real question instead of chat text, and a dismissed or timed-out approval writes no plan. ([#9735](https://github.com/code-yeongyu/oh-my-openagent/issues/9735), [#9748](https://github.com/code-yeongyu/oh-my-openagent/pull/9748))

**Delegated task children stay out of ultrawork orchestration.** A child spawned to do one piece of work no longer starts orchestrating its own team when its brief mentions ultrawork. Thanks to @Dante-dan. ([#9600](https://github.com/code-yeongyu/oh-my-openagent/issues/9600), [#9602](https://github.com/code-yeongyu/oh-my-openagent/pull/9602))

**A process-runner task child gets its own model fallback chain.** A child running as a separate process now falls back the same way an in-process child does, and its start never waits on that setup: if the chain is refused or not answered within 10 seconds it warns and sends the prompt anyway. ([#9582](https://github.com/code-yeongyu/oh-my-openagent/issues/9582), [#9587](https://github.com/code-yeongyu/oh-my-openagent/pull/9587))

**A suspended task child is revived or ended after its session is resumed.** When a resumed session finds a child it could not revive right away, it retries with backoff, and a child that still cannot be revived is marked lost with the last reason and the retry count, so the parent is notified instead of waiting forever. ([#9498](https://github.com/code-yeongyu/oh-my-openagent/issues/9498), [#9714](https://github.com/code-yeongyu/oh-my-openagent/pull/9714))

**omo sees every model senpi lists.** omo's background check of which models a task child may use read `senpi --list-models` through a pipe that the engine could close before the whole list arrived, so models late in the list (xAI's, for example) could be refused as unknown. The list is now read from a file. ([#9068](https://github.com/code-yeongyu/oh-my-openagent/issues/9068), [#9745](https://github.com/code-yeongyu/oh-my-openagent/pull/9745))

**The slash picker lists each bundled skill once.** The bare alias takes the place of its `skill:<name>` row instead of appearing next to it. ([#9648](https://github.com/code-yeongyu/oh-my-openagent/issues/9648), [#9650](https://github.com/code-yeongyu/oh-my-openagent/pull/9650))

**A session started in your home folder no longer migrates `.sisyphus` into `~/.omo`.** The legacy workspace migration refuses the home target and never overwrites an existing file, so the OmO desktop's data under `~/.omo/desktop` is never touched. ([#9727](https://github.com/code-yeongyu/oh-my-openagent/issues/9727), [#9731](https://github.com/code-yeongyu/oh-my-openagent/pull/9731))

**Engine fixes in senpi 2026.10.10-8.**
- An Anthropic subscription account blocked by an authentication error recovers on its own when its saved refresh token is still accepted, instead of every request failing with "blocked until re-login". ([senpi#2926](https://github.com/code-yeongyu/senpi/issues/2926))
- A long, tool-heavy turn on a small context window, such as Claude Haiku 5.5's 100K, no longer ends with "compaction did not complete": the earlier steps of the turn are summarized and the latest one is kept. ([senpi#2925](https://github.com/code-yeongyu/senpi/issues/2925))
- The reasoning effort you pick for Claude Opus 5 / 5.5, Sonnet 5.5 and Fable 5.1 now reaches Anthropic; it was always sent as `high`. ([senpi#2912](https://github.com/code-yeongyu/senpi/issues/2912))
- A model picked in the terminal applies to that session only instead of silently changing the default; press Ctrl+S in the picker or type `/model <id> --default` to make it the default. ([senpi#2870](https://github.com/code-yeongyu/senpi/issues/2870))
- A fallback model whose context window cannot hold the session no longer ends the fallback; the next model in the chain is tried. ([senpi#2894](https://github.com/code-yeongyu/senpi/issues/2894))
- `senpi --list-models`, `--version`, `--help` and `--export` no longer lose output when their stdout is a slowly read pipe. omo's own model probe was hit by this (fewer models listed than exist). ([senpi#2937](https://github.com/code-yeongyu/senpi/issues/2937), [senpi#2939](https://github.com/code-yeongyu/senpi/pull/2939))
- An `ask_user_question` answer is no longer put inside the tool result, where models that treat tool results as untrusted (Claude Haiku 5.5) may ignore it; the answer reaches the model as your own message. ([senpi#2920](https://github.com/code-yeongyu/senpi/issues/2920))
- Children that senpi starts from a script no longer re-run a caller that embeds senpi from `node -e` or `bun -e`. Thanks to @MoerAI. ([senpi#2599](https://github.com/code-yeongyu/senpi/issues/2599), [senpi#2950](https://github.com/code-yeongyu/senpi/pull/2950))
- Kimi K3 cache writes on Moonshot's API and in the Kimi Coding estimate are priced at the official $3 per million tokens; they were counted as free. ([senpi#2954](https://github.com/code-yeongyu/senpi/pull/2954))
- A config hot reload no longer loops on omo's `omo.jsonc`. ([senpi#2878](https://github.com/code-yeongyu/senpi/issues/2878))
- Paths the OmO desktop moved with its data home are refused with their new location instead of being written to. ([senpi#2898](https://github.com/code-yeongyu/senpi/issues/2898))
- Claude Haiku 5.5 is available on Anthropic, Bedrock, OpenCode, OpenRouter, Vercel AI Gateway and Venice, with its own system prompt. ([senpi#2892](https://github.com/code-yeongyu/senpi/issues/2892), [senpi#2917](https://github.com/code-yeongyu/senpi/issues/2917))

## [5.1.24] - 2026-10-07

**A task child that fails to start now says why.** Instead of only "Child prompt failed to start.", the task record, the event log and the tool result name the cause in one line: the host took too long to answer, the host refused the prompt (with its error code), the connection was lost, or the child exited first (with its exit code or signal). Raw error text still never reaches any of them. ([#9703](https://github.com/code-yeongyu/oh-my-openagent/issues/9703), [#9704](https://github.com/code-yeongyu/oh-my-openagent/pull/9704))

### Fixed

**Memory catches more disguised forms of secret-like text.** The memory secret scanner, which refuses secret-like values in memory commits and masks them wherever memory text is shown, now recognizes more obfuscated forms of those values, and `/doctor` and the maintenance receipts say when a scan had to fall back. ([#9653](https://github.com/code-yeongyu/oh-my-openagent/issues/9653), [#9689](https://github.com/code-yeongyu/oh-my-openagent/issues/9689), [#9707](https://github.com/code-yeongyu/oh-my-openagent/pull/9707), [#9717](https://github.com/code-yeongyu/oh-my-openagent/issues/9717), [#9718](https://github.com/code-yeongyu/oh-my-openagent/pull/9718))

**A long session no longer runs out of background task graphs.** `task.dag.max_runs_per_session` (default 16) now counts only graphs that are still running, as the bundled `mass-ulw` guidance describes it; finished, failed and cancelled ones used to count until they were pruned a week later, so a busy session could be refused with nothing running. The refusal now says how many are active. ([#9712](https://github.com/code-yeongyu/oh-my-openagent/issues/9712), [#9713](https://github.com/code-yeongyu/oh-my-openagent/pull/9713))

## [5.1.23] - 2026-10-07

### Changed

**omo runs on senpi 2026.10.10-6, so a background task no longer fails to start on a busy machine with "Provider scope is closed".** The engine host now acknowledges a child's first prompt as soon as it arrives instead of timing it out after 30 seconds ([senpi#2871](https://github.com/code-yeongyu/senpi/issues/2871)). On the Claude subscription lane, senpi now summarizes a long conversation itself by default, the same way it does on every other provider, and Claude Code's own auto-compact stays off so the two never both rewrite it; `compactionOwner: "sdk"` hands the job back to Claude Code ([senpi#2746](https://github.com/code-yeongyu/senpi/issues/2746), [senpi#2749](https://github.com/code-yeongyu/senpi/pull/2749), thanks @trac3r00). Anthropic sessions no longer fail on every request after a tool change ([senpi#2864](https://github.com/code-yeongyu/senpi/issues/2864)), a first message no longer waits for MCP servers to connect ([senpi#2843](https://github.com/code-yeongyu/senpi/issues/2843)), and a restored subscription session whose last reply was never recorded is rebuilt instead of resumed unchecked ([senpi#2858](https://github.com/code-yeongyu/senpi/issues/2858)). Full list: [senpi 2026.10.10-6](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-6).

## [5.1.22] - 2026-10-07

**An agent or the command line can now steer a terminal session you have open.** Thread tools switch a terminal session's model and thinking level and interrupt its turn, applied exactly as the pane's own `/model`, level selector or Esc would; a terminal on an older engine keeps refusing them. A message delivered by another session or the command line shows up in the receiving terminal under one line naming its sender, with the message as written. ([#9660](https://github.com/code-yeongyu/oh-my-openagent/issues/9660), [#9662](https://github.com/code-yeongyu/oh-my-openagent/pull/9662), [#9664](https://github.com/code-yeongyu/oh-my-openagent/pull/9664))

### Added

**`/doctor` now checks the memory files themselves.** It reports broken links, invalid frontmatter, duplicated notes, files outside the memory folders, unreadable files and an oversized system section, and `/doctor --json` returns the same findings with secret-like text masked. The background memory cleanup now fixes what it finds. ([#9652](https://github.com/code-yeongyu/oh-my-openagent/issues/9652), [#9654](https://github.com/code-yeongyu/oh-my-openagent/pull/9654))

**Secret-like text stays out of memory.** A memory commit that contains a token, API key or PEM block is refused, and memory text injected into a turn is masked. ([#9653](https://github.com/code-yeongyu/oh-my-openagent/issues/9653), [#9655](https://github.com/code-yeongyu/oh-my-openagent/pull/9655))

### Fixed

**A memory maintenance run that dies mid-way no longer blocks the runs after it.** Reflection, dream and facts runs now keep a receipt of each outcome, which `/doctor` shows. A run whose process died is quarantined with its files kept and the reason written down, so later runs proceed. A result the run had already committed before its supervisor died is kept instead of lost. ([#9689](https://github.com/code-yeongyu/oh-my-openagent/issues/9689), [#9691](https://github.com/code-yeongyu/oh-my-openagent/pull/9691))

**Memory no longer slows down every prompt.** The check for whether this session saved memory read the identity's whole history and could take seconds, or time out with a raw error under memory pressure; it is now bounded, its failures stay quiet, and the memory repository is packed in the background. ([#9667](https://github.com/code-yeongyu/oh-my-openagent/issues/9667), [#9671](https://github.com/code-yeongyu/oh-my-openagent/pull/9671))

**The memory file list in every turn stays small.** The list of non-system memory names was measured at about 158 KB (roughly 39K tokens) on a long-lived corpus; it now shows the newest names per directory within a byte budget and says how many it left out. ([#9687](https://github.com/code-yeongyu/oh-my-openagent/issues/9687), [#9688](https://github.com/code-yeongyu/oh-my-openagent/pull/9688))

**The browser skill works in the release binary.** Since 5.1.11 the binary installed the skill without its bundled omowright runtime, so loading it always failed for binary installs. ([#9661](https://github.com/code-yeongyu/oh-my-openagent/issues/9661), [#9665](https://github.com/code-yeongyu/oh-my-openagent/pull/9665))

**GPT-6 Astra stops repeating checks that already passed.** When a child's run already proved a command passes, Astra reuses that result instead of running it again, and its ultrawork instructions are shorter. Thanks to @ashmoonori-afk. ([#9642](https://github.com/code-yeongyu/oh-my-openagent/pull/9642), [#9649](https://github.com/code-yeongyu/oh-my-openagent/pull/9649))

**omo.dev keeps rendering styled pages across deployments.** A page served from a previous build could load without its stylesheet; deploys now carry the previous build's static assets forward. ([#9617](https://github.com/code-yeongyu/oh-my-openagent/issues/9617), [#9623](https://github.com/code-yeongyu/oh-my-openagent/pull/9623))

**Code mode replies always reach the right run.** Replying to or cancelling a running code-mode task through its handle can no longer land on a different, newer run. ([#9562](https://github.com/code-yeongyu/oh-my-openagent/issues/9562), [#9695](https://github.com/code-yeongyu/oh-my-openagent/pull/9695))

### Changed

**omo runs on senpi 2026.10.10-5.** You can scroll back through a long conversation while a reply is still streaming: the terminal no longer jumps back to the top on every update ([senpi#2836](https://github.com/code-yeongyu/senpi/issues/2836)). When an app reopens a thread whose session is still open elsewhere, the thread's current permission mode now applies, so a thread switched from full access to ask starts asking for approval again ([senpi#2823](https://github.com/code-yeongyu/senpi/issues/2823)). In code mode, stopping a JavaScript cell that waits on something that never settles keeps the worker and its globals ([senpi#2788](https://github.com/code-yeongyu/senpi/issues/2788)), live eval rows lead with the cell's summary on one line ([senpi#2802](https://github.com/code-yeongyu/senpi/issues/2802)), cells can call `require` and shadow names the kernel defines ([senpi#2792](https://github.com/code-yeongyu/senpi/issues/2792), [senpi#2793](https://github.com/code-yeongyu/senpi/issues/2793)), and a standalone agent gets a `show_html_page` tool that writes an offline page. Full list: [senpi 2026.10.10-5](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-5).

**omo runs on senpi 2026.10.10-4.** The input box no longer gets pushed off-screen when something writes to the terminal behind the TUI ([senpi#2815](https://github.com/code-yeongyu/senpi/issues/2815)). A default extension shim left behind by an earlier install (for example after switching from npm to bun or to the standalone binary) no longer stops every start with `Cannot find module` ([senpi#2765](https://github.com/code-yeongyu/senpi/issues/2765)). Two processes rebinding the same session no longer fail with `ENOENT` ([senpi#2828](https://github.com/code-yeongyu/senpi/issues/2828)). In code mode, a stopped detached cell shows its output instead of reading as still running, and an isolated cell names QuickJS as its runtime ([senpi#2811](https://github.com/code-yeongyu/senpi/issues/2811)). Full list: [senpi 2026.10.10-4](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-4).

**OmO's test suites got smaller and stricter.** A cleanup across seven repositories (47 merged PRs) removed 61 test files and 393 test cases that couldn't catch a real regression, about 8,100 net lines, plus 380 lines of dead product code. It also repaired 47 tests so they now fail when the code they guard breaks, each one proven by breaking that code on purpose, and nothing that was guarded before is unguarded now. Suites that never ran in CI now do, including the Codex plugin component suites and 146 web end-to-end tests. ([#9285](https://github.com/code-yeongyu/oh-my-openagent/issues/9285), [#9336](https://github.com/code-yeongyu/oh-my-openagent/pull/9336))

## [5.1.21] - 2026-10-06

**5.1.20 was never published.** Its run stopped on a Windows smoke-test failure after the platform packages reached npm but before `omo-ai` did, so 5.1.21 is the first release carrying the changes below. The orphaned `oh-my-opencode-<platform>@5.1.20` packages are not installed by any `omo-ai` or `oh-my-opencode` release, and this release moves their `latest` tag on. ([#9618](https://github.com/code-yeongyu/oh-my-openagent/issues/9618))

**Queued goals resume after stale or failed compaction feedback.** A goal message accepted while compaction was running could remain queued after the summary was rejected. The engine now attempts that continuation through its normal admission checks. Cancelling compaction does not restart work, and required-compaction limits still apply. ([senpi#2778](https://github.com/code-yeongyu/senpi/issues/2778), [senpi#2780](https://github.com/code-yeongyu/senpi/pull/2780))

### Added

**`hideFreeModels: true` keeps a provider's free models out of the picker, so its paid models are quick to find.** Set it on the provider block in `models.json`; without it, nothing changes. Thanks to @Bearmancer. ([senpi#2720](https://github.com/code-yeongyu/senpi/issues/2720), [senpi#2773](https://github.com/code-yeongyu/senpi/pull/2773))

**Keenable can serve web search.** `websearch.json` accepts `keenable`, using its keyed API when an `apiKey` is set and its shared public tier otherwise. It is used only when listed; the default search chain is unchanged. Thanks to @audreyt. ([senpi#2775](https://github.com/code-yeongyu/senpi/pull/2775))

**Code mode can run each JavaScript kernel in its own process.** With `isolation.js: "process"`, a kernel crash (a segfault, out-of-memory, `process.exit`) no longer takes the session down; the next cell starts on a fresh kernel and a notice names the crash. It is off by default and guards against crashes, not hostile code. ([senpi#2752](https://github.com/code-yeongyu/senpi/issues/2752))

**The frontend skill routes tone and situation to more component catalogs.** A new reference tells the agent which catalog to read for AI-agent UI, charts, landing sections, brutalist or Tailwind-only builds and other tones, how to explore a catalog's registry, and which licences and site terms allow what. ([#9644](https://github.com/code-yeongyu/oh-my-openagent/issues/9644))

**`/mcp` opens an interactive server manager in the terminal.** Server rows offer the actions available for their current state: enable or disable, change exposure, test, reconnect, and sign in or out. Tool, detail, and log views are available alongside them. Only trusted global and project servers can be edited, and edits preserve the rest of the config. Imported, extension, skill, and untrusted project servers remain read-only. Non-TUI clients receive status text. Thanks to @wuhaoyujerry. ([senpi#2716](https://github.com/code-yeongyu/senpi/issues/2716), [senpi#2747](https://github.com/code-yeongyu/senpi/pull/2747))

### Fixed

**A long retried request is no longer cut off after 11 minutes.** Once a retried request starts streaming, the retry watchdog stops timing it, so a long answer, tool calls or further turns are no longer aborted at 660 seconds. A retry that never starts still ends, with a message saying so. ([senpi#2804](https://github.com/code-yeongyu/senpi/issues/2804), [senpi#2805](https://github.com/code-yeongyu/senpi/pull/2805))

**The Windows release smoke test tolerates a briefly held checkout.** Moving the checkout's `.omo` aside could fail with `EPERM` while a file scanner still held a handle, which stopped the 5.1.20 release. The smoke now retries that rename for up to about 12 seconds and, if it still fails, names the processes it can see holding the directory. ([#9618](https://github.com/code-yeongyu/oh-my-openagent/issues/9618), [#9657](https://github.com/code-yeongyu/oh-my-openagent/pull/9657))

**A session's first turn no longer stalls when a gateway refuses a forced tool choice.** When an OpenAI-compatible gateway refuses a forced `tool_choice` inside a successful stream, the request is retried once without it, as it already was for the same refusal returned as an error, so you no longer have to type `continue`. ([senpi#2801](https://github.com/code-yeongyu/senpi/issues/2801), [senpi#2806](https://github.com/code-yeongyu/senpi/pull/2806))

**A reload during session startup waits instead of breaking extensions.** A reload requested while startup handlers are still running is deferred, so later handlers no longer fail with `stale extension generation after reload`. Thanks to @Bearmancer. ([senpi#2719](https://github.com/code-yeongyu/senpi/issues/2719), [senpi#2771](https://github.com/code-yeongyu/senpi/pull/2771))

**Codex plugin updates stop selecting stale cached hooks.** Successful installs remove obsolete selectable cache versions, so restarting Codex picks up the requested version and its hook trust. Actual hook changes still require review. ([#9631](https://github.com/code-yeongyu/oh-my-openagent/issues/9631), [#9632](https://github.com/code-yeongyu/oh-my-openagent/pull/9632))

**Wake notices explain why waiting ended and report the elapsed wait.** They distinguish a timer firing from background work ending. Cache figures are labeled cumulative estimates, and compaction logs include the session identity so an event can be attributed when several sessions share an agent directory. ([senpi#2778](https://github.com/code-yeongyu/senpi/issues/2778))

**Code-mode settings that were accepted but ignored now take effect.** `kernelTools.enabled: false` disables JavaScript `tool(fn)` and Python `@tool`. `languages.pyInterpreter` selects the exact Python executable; an unusable path makes Python unavailable with a warning naming the setting. `prompt.advertiseHelpers: true` adds the helper-documentation pointer to the eval description. Unknown settings and fallback-to-default warnings now reach the user. ([senpi#2763](https://github.com/code-yeongyu/senpi/issues/2763), [senpi#2764](https://github.com/code-yeongyu/senpi/pull/2764))

**A project-selected Python executable requires project trust before session startup.** A code-mode config that names an interpreter now follows the same trust boundary as a project MCP config. ([senpi#2772](https://github.com/code-yeongyu/senpi/pull/2772))

**RPC model lists pick up credentials changed by another session.** A fresh model-list request reflects newly connected or removed providers without reopening the session, fixing the empty-list case after connecting a provider. ([senpi#2769](https://github.com/code-yeongyu/senpi/issues/2769), [senpi#2770](https://github.com/code-yeongyu/senpi/pull/2770))

**Model-family fallback requires an explicit selector for OpenGateway and Vercel AI Gateway.** Having credentials for one of these gateways no longer makes an unqualified fallback choose it silently. ([senpi#2774](https://github.com/code-yeongyu/senpi/issues/2774), [senpi#2776](https://github.com/code-yeongyu/senpi/pull/2776))

**`/btw` answers render as Markdown.** Headings, bold text, inline code, lists, and code blocks display in the side panel instead of exposing their raw markup. Thanks to @nahwan-kim. ([senpi#2766](https://github.com/code-yeongyu/senpi/pull/2766))

### Changed

**OmO runs on senpi 2026.10.10-3.** Full engine notes: [senpi 2026.10.10-2](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-2) and [senpi 2026.10.10-3](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10-3).

**GPT-6 Astra gets a shorter goal-continuation prompt.** It now carries only the goal contract (objective, allowed turn endings, the blocked floor); other models keep the full prompt. ([senpi#2796](https://github.com/code-yeongyu/senpi/issues/2796))

## [5.1.19] - 2026-10-05

**Code mode can install JavaScript packages per session.** 5.1.19 runs on senpi 2026.10.10. A cell that is only `%bun add <package ...>` or `%npm add <package ...>` installs packages into the session's own managed environment without restarting the kernel, and the next cell imports them. The project's `package.json` and `node_modules` are untouched and package scripts never run. ([senpi 2026.10.10](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10))

### Added

**A Python cell's `@tool` functions can be granted to a task child**, the same way JavaScript `tool(fn)` tools already were. ([#9529](https://github.com/code-yeongyu/oh-my-openagent/pull/9529))

### Changed

**An idle gateway store gives back its worker thread.** After 60 seconds with no store call in flight, the worker is retired, and the next call starts a fresh one with its registrations restored. That frees about 2.9 MB per terminal control endpoint. ([#9592](https://github.com/code-yeongyu/oh-my-openagent/pull/9592))

**omo runs on senpi 2026.10.10.** It warns when a requested thinking level isn't available instead of dropping it, keeps project rule discovery inside the project on Windows, and keeps the resident Claude subscription session receiving only new messages when `compaction.model` is set. Code mode also gets opt-in isolated cells (`isolate: true` with `sandbox.enabled`). Full list: [senpi 2026.10.10](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.10).

Thanks to @Dante-dan for the manifesto reveal fixes on the site ([#9586](https://github.com/code-yeongyu/oh-my-openagent/pull/9586)) and a test-fixture fix ([#9599](https://github.com/code-yeongyu/oh-my-openagent/pull/9599)).

## [5.1.18] - 2026-10-04

**`omo models discover`, `omo schedule` and the other one-shot engine commands run again instead of opening the TUI.** 5.1.18 runs on senpi 2026.10.9. The launcher passed only a fixed list of commands straight to the engine and put `--extension <plugin>` in front of everything else, so the engine never saw its own command and started an interactive session with the arguments. Every engine command is now handed over unchanged. Thanks to @ushion0a for the report and the repro. ([#9572](https://github.com/code-yeongyu/oh-my-openagent/issues/9572), [#9573](https://github.com/code-yeongyu/oh-my-openagent/pull/9573))

### Fixed

**omo holds every Bun to the 1.4 floor the engine needs.** A `bun add -g` install, or `OMO_RUNTIME=bun`, ran under whatever Bun it found, so on Bun 1.3.x `/computer on` failed with `No such built-in module: node:sqlite`. Now a Bun you chose that is older than 1.4 stops at startup and says to run `bun upgrade`; an older Bun nobody chose hands off to Node, as other installs already did. ([#9563](https://github.com/code-yeongyu/oh-my-openagent/issues/9563), [#9564](https://github.com/code-yeongyu/oh-my-openagent/pull/9564))

**A task child that has its own fallback models falls back through them on the shared task host.** Its category's or agent's chain used to be ignored there, so a child whose model hit a limit failed even with a chain configured. Children without fallback models behave as before. On a host that can't carry the chain (an older engine, or the per-child process runner) the child runs as today and you are warned once instead of losing the chain silently. ([#9512](https://github.com/code-yeongyu/oh-my-openagent/issues/9512), [#9518](https://github.com/code-yeongyu/oh-my-openagent/pull/9518))

**An empty `/tasks` answer says when other sessions have tasks** and that `/tasks --all` lists them. Thanks to @cynkai. ([#9569](https://github.com/code-yeongyu/oh-my-openagent/issues/9569), [#9588](https://github.com/code-yeongyu/oh-my-openagent/pull/9588))

**The `ulw-plan` skill names only delegation categories that exist.** It listed `git` and the retired `deep`, so a plan following it delegated to a category the session didn't have. Thanks to @DevNewbie1826 for the report. ([#9561](https://github.com/code-yeongyu/oh-my-openagent/issues/9561), [#9565](https://github.com/code-yeongyu/oh-my-openagent/pull/9565))

### Added

**Code mode's `wait()` and `handle()` work on omo's own task children and workpools**, not only on engine runs. ([#9541](https://github.com/code-yeongyu/oh-my-openagent/pull/9541))

### Changed

**omo runs on senpi 2026.10.9.** A permission prompt sent to an app names the tool call it approves, so each prompt shows its own call's input; a reply that only answers a question is just the answer, never wrapped in a quote; code mode gets Python `agent(prompt, tools=[...])`, cell-defined tools for `workpool`, `%load <path>` and `%pip install` without a kernel restart. Full list: [senpi 2026.10.9](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.9).

**`/memfs` maintenance commands load on first use**, which trims the plugin bundle by about 8 KB; their output is unchanged. Thanks to @Dante-dan. ([#9526](https://github.com/code-yeongyu/oh-my-openagent/pull/9526))

Thanks also to @Dante-dan ([#9575](https://github.com/code-yeongyu/oh-my-openagent/pull/9575), [#9579](https://github.com/code-yeongyu/oh-my-openagent/pull/9579)) and @MoerAI ([#9589](https://github.com/code-yeongyu/oh-my-openagent/pull/9589)) for test and release-pipeline fixes.

## [5.1.17] - 2026-10-04

**An idle engine host now exits after its idle window once its sessions are done.** 5.1.17 runs on senpi 2026.10.8. Before, a host counted a session busy on every `agent_start` but cleared it only once per run, so any run that retried, continued after compaction or took a follow-up left the host busy forever and it never exited; a session closed mid-run did the same. The host now tracks runs and drops a session when it closes. Thanks to @DevNewbie1826 for the report. ([senpi#2713](https://github.com/code-yeongyu/senpi/issues/2713), [senpi#2717](https://github.com/code-yeongyu/senpi/pull/2717))

### Fixed

**A workpool create that reuses a pool name no longer inherits that pool's tools.** A second `workpool` create with the same name from the same session got the first pool, and the tools it was granted, even when it asked for different tools or none. Now a pool is reused only when the tools asked for match its grant; any other grant is refused as a name conflict. ([#9548](https://github.com/code-yeongyu/oh-my-openagent/issues/9548))

**Replies no longer come back formatted as a quote.** Several bundled prompts showed their reply-format examples (handoff templates, the routing line) as markdown quote lines, and the model copied the `>` into its answer, so whole replies rendered as blockquotes. The examples are now plain lines; the wording is unchanged. ([#9538](https://github.com/code-yeongyu/oh-my-openagent/issues/9538), [#9550](https://github.com/code-yeongyu/oh-my-openagent/pull/9550))

**A cold Python start on a busy machine no longer fails as a hang.** The Python kernel counts CPU use and output during startup as progress, with an absolute ceiling, instead of failing after a fixed silent window. ([senpi#2718](https://github.com/code-yeongyu/senpi/issues/2718), [#9495](https://github.com/code-yeongyu/oh-my-openagent/issues/9495))

**On Windows, memory reflection works again instead of parking itself.** A failed reflection on Windows was recorded as "refused by its provider", so automatic reflection parked after a few runs and stopped saving facts. A build with this fix un-parks on its next successful reflection; run `/reflect` to trigger one now, and use `/facts retry` for facts that were parked while it was stuck. ([#9553](https://github.com/code-yeongyu/oh-my-openagent/issues/9553), [#9554](https://github.com/code-yeongyu/oh-my-openagent/pull/9554))

### Changed

**omo runs on senpi 2026.10.8.** The bundled Claude Agent SDK moves to 0.3.289 (Claude Code 2.1.289); `continue_from_leaf` acknowledges when the continued turn starts, so a long desktop continuation no longer times out; code mode gets Python kernel tools beside a parked cell. Full list: [senpi 2026.10.8](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.8).

**omo can now inject a chat gateway scope's operating rules into bound sessions** as one block in the system prompt; it takes effect once the gateway connector that pushes them ships. Every other session's prompt is unchanged. ([#9540](https://github.com/code-yeongyu/oh-my-openagent/pull/9540))

## [5.1.16] - 2026-10-04

**After an upgrade, the first turn no longer fails with "No provider available" while an old engine host is still around.** 5.1.16 runs on senpi 2026.10.7, where `host handoff` (which the desktop runs when the engine changed) can replace an old host that still serves the client's own socket with no session open, instead of refusing it until the host is drained by hand. A host that holds a session is still refused, with the command that retires it. `host status` also names the right engine build for a generation started by a handoff. ([senpi#2701](https://github.com/code-yeongyu/senpi/issues/2701), [senpi#2698](https://github.com/code-yeongyu/senpi/issues/2698))

### Added

**Code-mode `wait()` and `handle()` now work on omo's own task children and workpools.** An eval cell can wait on several agents and get their values in order, and check, cancel, steer or read the output of a run it started. Every call is fenced to the session that started the run and to that exact run: a handle from before a revive is refused as stale and never touches the new run, while a model fallback inside the same run keeps the handle working. Sending to a finished agent starts a new run, and the reply says so (`revived as epoch N`) with the new handle. Watching a run never delays or duplicates its completion notification.

### Fixed

**A stranded transient memory run is reported once instead of on every memory sweep.** When a transient memory identity can't be promoted because a durable one with the same id already exists, the warning (with the manual fix) is now logged the first time only; one daemon log had held it 621 times. The identity is still counted on every sweep. Thanks to @cynkai. ([#8646](https://github.com/code-yeongyu/oh-my-openagent/issues/8646), [#8869](https://github.com/code-yeongyu/oh-my-openagent/pull/8869))

### Changed

**omo runs on senpi 2026.10.7.** Code mode gets an in-cell `wait()` barrier and `handle()` views in all four kernels, and the JavaScript kernel gains `tool.defined()`, `tool.undefine(name)` and named tools; eval recovers after a cancelled session switch or a failed runtime start instead of staying broken for the rest of the session; the Ruby kernel's memory notice works on Ruby 2.6 again. Full list: [senpi 2026.10.7](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.7).

**The bundled `visual-qa` skill checks UI work against an Apple HIG checklist**, with a light and dark capture matrix at phone and desktop widths and a pass or fail verdict per item. ([#9533](https://github.com/code-yeongyu/oh-my-openagent/issues/9533), [#9536](https://github.com/code-yeongyu/oh-my-openagent/pull/9536))

## [5.1.15] - 2026-10-04

**A new `auto` permission preset approves only what it can prove stays inside your project.** 5.1.15 runs on senpi 2026.10.6, whose `auto` preset approves an action without asking only when it can show the action stays inside the project, judged on the exact file each tool will open; anything it can't pin down still asks, and your own deny and ask rules still win. ([senpi#2614](https://github.com/code-yeongyu/senpi/pull/2614), [senpi#2688](https://github.com/code-yeongyu/senpi/pull/2688))

### Fixed

**A question a session relayed to a chat thread closes when you answer it in the terminal.** Before, a relayed ask_user question answered (or timed out, or dismissed) in the session's own client stayed pending in the gateway store, so a chat connector kept that thread's later replies waiting until someone answered in chat. Outbox rows now also say whether a relayed answer is still being handed to the session (`answer_state`), so a connector waits for a delivered answer instead of treating a claim as settled. Thanks to @effortprogrammer. ([#9506](https://github.com/code-yeongyu/oh-my-openagent/pull/9506))

**Editing your config no longer gets a hot reload rejected over a deprecated-key notice.** Renamed keys such as `deep` -> `deep-low` still load, but any edit that touched one produced a new notice, and the reload was refused. Thanks to @davhdavh for the report and @cynkai for the fix. ([#8555](https://github.com/code-yeongyu/oh-my-openagent/issues/8555), [#8878](https://github.com/code-yeongyu/oh-my-openagent/pull/8878))

**`thread_read` pages forward when given `next_cursor`.** A truncated read returned a cursor, but retrying with it returned the same first window again. Thanks to @cynkai. ([#9435](https://github.com/code-yeongyu/oh-my-openagent/pull/9435))

**A memory usage write that fails after shutdown is logged instead of surfacing as an unhandled rejection.** Thanks to @Dante-dan. ([#9524](https://github.com/code-yeongyu/oh-my-openagent/pull/9524))

### Changed

**omo runs on senpi 2026.10.6.** Besides the `auto` preset above, in that release the startup banner folds into one summary line; a 429 or 5xx from the provider shows as one retry banner instead of raw JSON, while a failed compaction still shows as an error; tool-card diffs read at 7:1 contrast and each edit card shows its change count; the `apply_patch` streaming preview stays bounded; `/files` and `/diff` open on Windows again; a first run with no provider gets the `/login` guidance; Linux x64 gets the native PTY backend. Full list: [senpi 2026.10.6](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.6).

**A finished subagent's card reads as a summary**, for example `ran 2m 14s · 5 tools · $0.4213 (CH: 87%)`, instead of a line of debug tokens. ([senpi#2654](https://github.com/code-yeongyu/senpi/issues/2654), [#9513](https://github.com/code-yeongyu/oh-my-openagent/pull/9513))

**Memory's `/doctor` checks load on first use** instead of with the extension, so startup loads less; the command behaves the same. Thanks to @Dante-dan. ([#9520](https://github.com/code-yeongyu/oh-my-openagent/pull/9520))


## [5.1.14] - 2026-10-03

**Permission checks can no longer switch themselves off.** Up to 5.1.13, a failure while the permission system started (a misspelled `permissionPreset` in settings or on the command line, a `null` permission rule, or an unreadable approvals file) left every tool call running with no permission check, and nothing said so. 5.1.14 runs on senpi 2026.10.5, which refuses tool calls with `Permission setup failed: <reason>` until the setting is fixed. If you can't update yet, check that `permissionPreset` names a preset that exists and that no permission rule is `null`. ([senpi#2617](https://github.com/code-yeongyu/senpi/issues/2617), [senpi#2618](https://github.com/code-yeongyu/senpi/pull/2618))

### Fixed

**A first-turn forced tool call that a strict-schema gateway refuses no longer ends the turn.** When a gateway answers 400 and names the forced tool (its `tools.N` position or its quoted name), the request is retried once without forcing; a generic 400, or one naming another tool, still fails as before. Thanks to @rhyme227 for the report. ([#9507](https://github.com/code-yeongyu/oh-my-openagent/issues/9507), [senpi#2648](https://github.com/code-yeongyu/senpi/issues/2648))

**`apply_patch` keeps each file's line endings and no longer drops an indented file section.** CRLF and mixed-ending files are no longer rewritten to LF, and a file header indented in the patch applies instead of being skipped while the tool reported success. ([senpi#2638](https://github.com/code-yeongyu/senpi/issues/2638), [senpi#2636](https://github.com/code-yeongyu/senpi/issues/2636))

**An NVIDIA-only setup starts on a model its catalog still lists.** The previous NVIDIA default was retired upstream; the default is now `nvidia/nemotron-3-ultra-550b-a55b`. ([senpi#2645](https://github.com/code-yeongyu/senpi/issues/2645))

**Codex edition (LazyCodex): a language server that isn't installed no longer blocks every edit.** LazyCodex's post-edit language-server check answered `block` with the install guidance on each edit, even after you declined the install; it now follows your install decision, as the Native edition does. ([#9509](https://github.com/code-yeongyu/oh-my-openagent/issues/9509), [#9510](https://github.com/code-yeongyu/oh-my-openagent/pull/9510))

**A computer-use permission denial is an error in code mode too.** Through a JS or Python eval, a denied computer call came back without the error flag, so a model could miss the denial and keep acting; it now fails the call there as it does on a direct call. ([#9475](https://github.com/code-yeongyu/oh-my-openagent/issues/9475), [#9482](https://github.com/code-yeongyu/oh-my-openagent/pull/9482))

**Windows: a delegated task you kill is reported as killed, not as a crash, and memory no longer loses a state write to a briefly held file.** A kill is now recognised from the runner's own request instead of from the child's stderr, and memory's atomic state rename retries the few-millisecond hold Windows places on an open target. ([#9471](https://github.com/code-yeongyu/oh-my-openagent/issues/9471), [#9501](https://github.com/code-yeongyu/oh-my-openagent/pull/9501), [#9491](https://github.com/code-yeongyu/oh-my-openagent/pull/9491))

**The computer-use doctor check on macOS reports an engine that never replied as a timeout instead of failing with `EPERM`.** Cleaning up the timed-out probe now treats a process group that is already exiting as gone. Thanks to @MoerAI. ([#9422](https://github.com/code-yeongyu/oh-my-openagent/issues/9422), [#9464](https://github.com/code-yeongyu/oh-my-openagent/pull/9464))

Thanks to @MoerAI for moving the task engine's child event channel into `senpi-task`, where the computer-use component now imports it from. ([#9454](https://github.com/code-yeongyu/oh-my-openagent/issues/9454), [#9467](https://github.com/code-yeongyu/oh-my-openagent/pull/9467))

### Changed

**omo runs on senpi 2026.10.5** (through 2026.10.4): the permission fix above; an eval kernel (Python, Ruby or Julia) whose interpreter dies is replaced once instead of failing every later cell; idle shared hosts give their cost back; the Claude Agent SDK moves to 0.3.288; and pasting in terminals without bracketed-paste markers works. Full lists: [senpi 2026.10.4](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.4), [senpi 2026.10.5](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.5).

**The task tool no longer suggests delegating a few reads or small foreground checks.** Its description and the ultrawork routing named those as delegation targets, and GPT-6 Astra followed them literally, waiting on children for work it could do in a few calls. ([#9499](https://github.com/code-yeongyu/oh-my-openagent/issues/9499), [#9500](https://github.com/code-yeongyu/oh-my-openagent/pull/9500))

### Added

**The browser skill follows the browser the OmO desktop app picks for the session.** With a connected browser it uses only that browser and says "Connect your browser" when it's missing; with the in-app browser or none chosen it refuses to drive your own browser. It reports what the browser is doing, and asks before an irreversible action in your own browser. In a terminal nothing changes. ([#9486](https://github.com/code-yeongyu/oh-my-openagent/issues/9486), [#9502](https://github.com/code-yeongyu/oh-my-openagent/pull/9502))

**Chat connectors and other integrations can keep their own state in the session-gateway database** and update it in the same transaction as sending, binding or acknowledging a message. The session-gateway store supports namespaced extensions: compiled operations can update their registered objects and enqueue messages through bindings, bind conversations, or acknowledge outbox rows in one transaction. A persistent ownership registry protects core and other extensions' objects; matching a name prefix never grants access. Core-colliding names, triggers and views are refused. Migrations are coordinated across processes, forbidden schema changes roll back, and a joined enqueue creates its wake marker inside the transaction, so a rollback removes it. Failures return typed refusals without stopping the worker. Core schema v6 adds the extension registry, preserves existing rows and records `author.user_id` as nullable `deliveries.actor_user_id`. ([#9331](https://github.com/code-yeongyu/oh-my-openagent/pull/9331), Refs [#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143))

A session-gateway store or store extension whose schema is newer than the running omo is refused with `gateway_schema_too_new` and left untouched: an older binary neither migrates nor lowers the core `user_version`, and an extension that registers fewer migrations than its stored version keeps its stored version, data and existing registration. ([#9331](https://github.com/code-yeongyu/oh-my-openagent/pull/9331))

## [5.1.13] - 2026-10-03

**MCP tools work again when memory is on.** Since 5.1.10, a finished memory child or delegated task shut the shared MCP servers down for the whole process, so every MCP call failed with `MCP server <name> is disabled`. This release runs on senpi 2026.10.3, which gives each session its own binding to the shared servers; it was verified with the shipped bundle. If you can't update yet, turn memory off until you do: set `"memory": { "enabled": false }` in `~/.omo/omo.json`, or start omo with `--omo-senpi-memory-disabled=true`.

### Fixed

**MCP calls no longer fail with `MCP server <name> is disabled` after a child session ends.** A memory child or a delegated task that finished released the MCP service for every session in the process; now it releases only its own binding, and the shared servers stay up. Thanks to @Tygb99 for the report. ([#9461](https://github.com/code-yeongyu/oh-my-openagent/issues/9461), [senpi#2524](https://github.com/code-yeongyu/senpi/pull/2524))

**Codex edition (LazyCodex): a project's own registered agent roles can be spawned.** The spawn guard accepted only LazyCodex's 12 bundled roles, so a role registered in `.codex/agents` or `$CODEX_HOME/agents` was refused even though Codex offered it; it now accepts any role with a registered role file and still refuses unregistered ones. Thanks to @aconley-vultr for the report. ([lazycodex#171](https://github.com/code-yeongyu/lazycodex/issues/171), [lazycodex#164](https://github.com/code-yeongyu/lazycodex/issues/164), [#9462](https://github.com/code-yeongyu/oh-my-openagent/pull/9462))

**Cancelling a delegated task while its host can't list its sessions keeps the cancel pending** instead of finishing it with the session still open; it completes once the host answers again. ([#9450](https://github.com/code-yeongyu/oh-my-openagent/issues/9450), [#9459](https://github.com/code-yeongyu/oh-my-openagent/pull/9459))

**Skills are listed in a stable order**, so the tool prefix of a prompt stays the same between turns and keeps hitting the prompt cache. ([#9433](https://github.com/code-yeongyu/oh-my-openagent/pull/9433))

**OpenCode edition fixes, thanks to @cynkai:** an explicitly chosen model no longer falls back through the built-in chain ([#8808](https://github.com/code-yeongyu/oh-my-openagent/pull/8808)); a plugin-load telemetry failure no longer prints into the TUI ([#8804](https://github.com/code-yeongyu/oh-my-openagent/pull/8804)); a background task whose session stopped on an error is finalized ([#8814](https://github.com/code-yeongyu/oh-my-openagent/pull/8814)) and skips fallback models no connected provider serves ([#8844](https://github.com/code-yeongyu/oh-my-openagent/pull/8844)); Sisyphus stays available when Hephaestus isn't registered ([#8841](https://github.com/code-yeongyu/oh-my-openagent/pull/8841)); and `omo.schema.json` embeds the `[opencode]` schema once and no longer marks defaulted fields as required ([#8871](https://github.com/code-yeongyu/oh-my-openagent/pull/8871), [#8873](https://github.com/code-yeongyu/oh-my-openagent/pull/8873)). Tool argument rewrites in the OpenCode edition also keep the original arguments object ([#9466](https://github.com/code-yeongyu/oh-my-openagent/pull/9466)).

`omo host status --all` and `omo thread list` no longer show an older session entry as the latest activity when the final JSONL entry is large, partial or invalid. Both surfaces use the same bounded final-record policy, show `null` when freshness cannot be proved, and list known activity newest-first with unknown activity last. ([#9222](https://github.com/code-yeongyu/oh-my-openagent/pull/9222))

A message to a published terminal session that the engine still reports as not answering is kept offline instead of being sent straight to its socket, so `omo thread list`, a send and a steer always agree on whether that session can be reached right now; the message is delivered once a later check lists the session live again. A bound send that names its session no longer pays the same lookup twice. ([#9222](https://github.com/code-yeongyu/oh-my-openagent/pull/9222))

### Changed

**omo runs on senpi 2026.10.3** (the MCP fix above, plus the Bun `-e` host-launch and WebView readiness fixes). Full list: [senpi 2026.10.3](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.3).

**OpenGateway tasks run without a concurrency limit by default.** ([#9427](https://github.com/code-yeongyu/oh-my-openagent/pull/9427))

### Added

_The session gateway entries below are its store foundation; the thread tools become usable with 5.1.14._

**Every session can reach every other one, terminal sessions included.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) Messages between sessions now go through a session gateway: one small database in the agent directory, with no daemon to run and nothing to configure. A terminal session opens a private control socket, so a Desktop thread, a task child or a script can list it, read it and send to it; the thread tools list terminal sessions with their real names and times. A message never interrupts what you are doing: while you are typing, or a submission of yours is on its way, it waits, and the session shows one line saying a remote message is queued. A message to a session that is not running is kept for 24 hours and taken when the session runs again. Fixed limits stop runaway loops: a session cannot message itself or reply straight back into the chain that messaged it, a chain of messages stops after 4 hops or 64 messages, one turn reaches at most 16 sessions, and one sender gets a burst of 8 messages to a session, then one every 5 seconds.

**`omo thread` talks to running sessions from scripts and chat connectors.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) `omo thread list|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack` runs the thread tools' operations without an agent session, with `--json` output that is one JSON value (also on failure) and exit codes a script can branch on: 0 done, 1 refused, 2 usage, 3 nothing answering, 4 unsupported here, 5 internal error. JavaScript can import the same operations from the plugin (`runtime/thread-sdk/sdk.js`) without spawning `omo`. It never starts a host. Reference: [`docs/reference/omo-thread.md`](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/omo-thread.md).

**A session can be bound to a chat thread, and report back through it.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) A binding attaches one session to one external thread (any platform; OmO ships no chat connector itself). Messages from the thread arrive with `omo thread send --binding`, admitted once per platform event. The session posts milestones, reports, questions and its completion to the binding's outbox with `thread_report`, and a connector reads them with `omo thread outbox` and acknowledges them. A question carries a reply token that only an answer through the same binding can use. A completion is written only when you ask for one, and survives a restart. At most one active binding holds a thread; unbinding and rebinding name the revision they expect, and a rebind never extends the binding's lifetime.

**A chat connector can say who wrote each message, and how it should land.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) `omo thread send --binding` takes `--author-id` and `--author-name` (and `--author-user-id`). The session sees the author as quoted fields in the message's provenance header, outside the text, so a message cannot pretend to come from someone else. Each author gets their own rate budget in a busy thread. `--mode follow_up` lets one message land more gently than its binding allows, and never more strongly. `answer` takes the same author flags, and the outbox records who answered a question. A connector can watch `<agent dir>/gateway/outbox.marker` to learn about new outbox rows. The reference now spells out that outbox delivery is at-least-once, and that `(binding_id, cursor)` is the key to dedupe by.

**`omo host status --all` shows when each terminal session was last active.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) Every terminal (`tui`) row now carries `last_activity_at`: the time of the newest entry in its session file, the same time `omo thread list` shows, or `null` when it is not known.

**`omo daemon adopt` moves a session from a host into your terminal.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) `omo daemon adopt <session>` asks the host holding a Desktop thread or a background session to hand it over, then resumes it in the current terminal, in the session's own directory. A session in the middle of a turn is refused unless you pass `--interrupt`, and input the interrupt took out of its queue becomes your first prompts. A session a Desktop window has open is refused unless you pass `--force`. `omo daemon status` now lists terminal sessions as `tui` rows, and `handoff` and `stop --all` leave them alone.

### Removed

**`omo daemon attach` and the shared-host opt-in env (`OMO_ENABLE_SHARED_HOST`) are removed; interactive sessions always run standalone.** ([#9143](https://github.com/code-yeongyu/oh-my-openagent/issues/9143)) A terminal session no longer joins an engine host; it always runs its own session in its own process, and other sessions reach it through the gateway. `OMO_ENABLE_SHARED_HOST` no longer changes anything. To continue a session that lives on a host in a terminal, use `omo daemon adopt`.

## [5.1.12] - 2026-10-03

**The desktop app can now see when computer use is waiting on a system permission, and a cancelled task on Windows no longer shows up as a crash.** This release runs on the senpi 2026.10.2 engine, which carries the upstream pi v1.0.0 changes.

### Added

**A computer-use permission request reaches the root session as an event.** When a computer-use action, an eval cell or a delegated task stops because the system has not granted a permission computer use needs (such as Screen Recording or Accessibility), omo emits `omo.computer.permission_required` on the root session, with that session's id, once per missing permission. The desktop app can show the request instead of a bare tool error, and other failures never turn into permission events. ([#9393](https://github.com/code-yeongyu/oh-my-openagent/pull/9393))

### Changed

**omo runs on senpi 2026.10.2.** Reloading or replacing a session while a monitor or an eval cell is running no longer kills the process, and the engine carries the upstream pi v1.0.0 changes. Full list: [senpi 2026.10.2](https://github.com/code-yeongyu/senpi/releases/tag/v2026.10.2).

### Fixed

**On Windows, a cancelled delegated task is recorded as cancelled, not as a crash.** A killed task child could be recorded as an error carrying Bun's child-reaper message when enough of those messages filled the end of its error output; it now counts as killed, while any real error output still marks a crash. ([#9443](https://github.com/code-yeongyu/oh-my-openagent/pull/9443))

**A platform package is published only if its release binary passed the smoke.** The platform publish uploaded its npm package before the release-binary smoke ran, so a platform whose smoke failed still published its package (5.1.8 published both Windows x64 packages from a run whose smoke failed). The package is now uploaded only after that platform's smoke passes, so a failed smoke stops exactly that platform's publish while the others still publish, and the linux-arm64 smokes now finish before their packages publish. ([#9385](https://github.com/code-yeongyu/oh-my-openagent/issues/9385), [#9439](https://github.com/code-yeongyu/oh-my-openagent/pull/9439))

## [5.1.11] - 2026-10-02

**New tasks no longer queue forever behind a delegated task that lost its connection to the host.** Such a task used to stay suspended with its lane taken until the session restarted; now it reconnects, or ends within a bounded time and frees the lane. This release runs on the senpi 2026.10.1-3 engine.

### Fixed

**A delegated task that loses its connection to the host is reattached, or fails with `transport lost` within a bounded time.** Either way its lane is released and its own processes are cleaned up, so the next task starts instead of waiting. After a host restart, lanes still held by tasks that died are reclaimed. ([#9403](https://github.com/code-yeongyu/oh-my-openagent/issues/9403), [#9407](https://github.com/code-yeongyu/oh-my-openagent/pull/9407))

Cancelling a delegated task finishes only once the host confirms the child closed, a stopped task whose handle was let go still ends as cancelled, and a stopped task is never continued afterwards. ([#9407](https://github.com/code-yeongyu/oh-my-openagent/pull/9407))

**The OpenCode edition's skill tool lists skills and commands in a stable order, so its tool definitions stay cacheable.** Skills and commands in the same scope were listed in discovery order, which varies between processes, so the tool definition changed from session to session and each new session and subagent missed the prompt cache. They are now ordered by scope, then by name. Thanks to @kimchupa-l10n for the report. ([#9432](https://github.com/code-yeongyu/oh-my-openagent/issues/9432))

## [5.1.10] - 2026-10-02

**Hotfix: `omo -p` exits again after a delegated task.** Since 5.1.8, a headless or scripted run whose agent handed work to an in-process task printed its answer and then never exited, so CI jobs, cron entries and wrappers that wait on it hung until killed. Interactive sessions leaked a loopback bridge server and its socket for every such task. This release runs on the senpi 2026.10.1-3 engine.

### Fixed

**`omo -p` exits after an in-process task child finishes, and the child's resources are released.** Since 5.1.8 an in-process child loads the engine's builtin extensions, but its teardown disposed the session without running their `session_shutdown` handlers, so codemode's per-session bridge server stayed listening and kept the process alive. Child teardown now runs those handlers first, within the host's shutdown budget, on both the normal path and the path that discards a child whose handle never started. ([#9413](https://github.com/code-yeongyu/oh-my-openagent/issues/9413), [#9418](https://github.com/code-yeongyu/oh-my-openagent/pull/9418))

A delegated task that the host recovers after a restart is reported as continued only once its continuation prompt is acknowledged; a refused or timed-out prompt is now reported as lost instead of a successful reattach. Thanks to @Dante-dan. ([#9406](https://github.com/code-yeongyu/oh-my-openagent/pull/9406))

## [5.1.9] - 2026-10-02

**In the desktop app's restricted modes, the agent's own tools stop asking for approval, and a bash call from an eval cell no longer hangs.** Files that ship with the app no longer count as outside paths, the first Python cell after a cold start works on Windows x64, and delegated tasks keep your timeout settings and run at thinking levels their models accept. This release runs on the senpi 2026.10.1-3 engine.

### Fixed

In the desktop app's "Work in this project" and "Ask first" modes, senpi's own internal tools (todo, tool search, ask-user, monitor, memory) no longer ask for approval, reading files that ship inside the app no longer counts as an outside path, and a bash call from an eval cell shows its approval prompt instead of hanging. Real commands, outside reads and outside watches still ask. ([senpi#2511](https://github.com/code-yeongyu/senpi/issues/2511), [senpi#2513](https://github.com/code-yeongyu/senpi/issues/2513), [senpi#2512](https://github.com/code-yeongyu/senpi/issues/2512))

On Windows x64, the first Python cell after a cold start no longer fails with "Python kernel did not become ready": Python eval waits on the kernel's own readiness stages instead of a 5-second deadline and names a stalled stage in the error. This was a known issue in 5.1.8.

Tool search keeps working after a reload or session replacement. Thanks to @jerilkuriakose for the report. ([senpi#2509](https://github.com/code-yeongyu/senpi/issues/2509))

Toggle-only reasoning models offer only the thinking states their API accepts. Thanks to @effortprogrammer. ([senpi#891](https://github.com/code-yeongyu/senpi/issues/891))

On a Claude subscription, a long run survives a lost session whose re-sent conversation is rejected as too long, and images the agent read with a tool are no longer re-sent as new attachments (thanks to @willowite). ([senpi#2480](https://github.com/code-yeongyu/senpi/issues/2480), [senpi#2490](https://github.com/code-yeongyu/senpi/issues/2490))

A delegated task that runs in-process now keeps your timeout and retry settings, such as `retry.provider.streamStartTimeoutMs`, instead of the built-in defaults. Thanks to @rhyme227 for the report. ([#9353](https://github.com/code-yeongyu/oh-my-openagent/issues/9353))

Builtin category chains only name thinking levels their models accept, so child sessions no longer flood `fallback.log` with `validation_warning` lines and each rung runs at its declared level instead of a silent clamp. Thanks to @markshikada for the report and the byte-compare that pinned it down. ([#9378](https://github.com/code-yeongyu/oh-my-openagent/issues/9378))

On macOS, a repeated permission denial no longer claims the privacy pane was just opened; it points at the pane opened earlier, or tells you to open it when the first attempt failed.

## [5.1.8] - 2026-10-01

**A packaged install runs Bun itself again when you call `bun` from an eval cell or the bash tool.** Before, it started a second agent and handed back that agent's reply as a passing result. Geeky · Heavy and `deep-high` move to GPT-6 Astra at high, Geeky · Normal to GPT-6.1 Sol Fast at medium, a session opened from the desktop app keeps the permission mode it asked for, and memory recall now matches Chinese and Japanese characters one by one. This release runs on the senpi 2026.10.1-2 engine.

### Added

A session opened from the desktop app or another multi-session client runs with the permission mode it asked for (full access, accept edits or ask first). Before, the mode was recorded but every session ran with the host default. ([senpi#2461](https://github.com/code-yeongyu/senpi/issues/2461))

`web_search` has two hosted routes: a ChatGPT subscription session searches through the subscription's own web search with your ChatGPT login, and Google Search grounding is available as an opt-in entry in `websearch.json`. ([senpi#2341](https://github.com/code-yeongyu/senpi/issues/2341))

Ultrafast can be selected explicitly with a model decorator such as `chatgpt-subscription/gpt-6-astra:xhigh:ultrafast`, in `models.json` or per session. Thanks to @audreyt. ([senpi#2412](https://github.com/code-yeongyu/senpi/issues/2412))

Memory recall also matches Chinese characters and Japanese kanji one by one, so a question worded differently from the note can still find it; a question without any such character gets the same candidates as before. Thanks to [@ashmoonori-afk](https://github.com/ashmoonori-afk). ([#9341](https://github.com/code-yeongyu/oh-my-openagent/pull/9341))

Memory recall can widen its own searches with synonyms, keywords in your other languages and related terms when you set `memory.recall.query_expansion` to `true`; an added term counts for less than the same match on one of the query's own words, a note that holds every word of the query stays first, and with the setting off, the default, nothing changes. Thanks to [@ashmoonori-afk](https://github.com/ashmoonori-afk). ([#9342](https://github.com/code-yeongyu/oh-my-openagent/pull/9342))

### Changed

Geeky · Heavy and the `deep-high` category now run GPT-6 Astra at high reasoning instead of xhigh. Geeky · Normal now starts on GPT-6.1 Sol Fast at medium; without the Fast tier it uses plain GPT-6.1 Sol at medium, and Copilot or OpenCode users still get GPT-5.6 Sol at medium. `deep-low` keeps GPT-6.1 Sol at medium. ([#9372](https://github.com/code-yeongyu/oh-my-openagent/issues/9372))

When a delegated task stops because its model hit a usage limit, the result now says so, says when no other model in the category's chain could take over (as on `deep-high`, which runs GPT-6 Astra only), and how to recover, instead of ending on the provider's raw error. ([#9372](https://github.com/code-yeongyu/oh-my-openagent/issues/9372))

### Fixed

**Hotfix: `eval` and `bash` calls that run `bun` no longer start a phantom agent turn in the packaged engine.** In a compiled engine, a `bun` subprocess ran the engine itself as a second agent instead of the requested script. ([#9362](https://github.com/code-yeongyu/oh-my-openagent/issues/9362), [senpi#2494](https://github.com/code-yeongyu/senpi/pull/2494))

Manual `/compact` on a Claude subscription replaces the resident Claude transcript with the compacted summary, so the next request really uses the smaller context. Thanks to @ayalcoh for the fix and @Tinycute00 for the report. ([senpi#2331](https://github.com/code-yeongyu/senpi/issues/2331))

With two or more logins for one provider, a usage limit reported only in words switches the request to the next account instead of failing it. Thanks to @orientpine. ([senpi#1768](https://github.com/code-yeongyu/senpi/issues/1768))

Package installs and updates no longer flash a console window on Windows. Thanks to @willowite. ([senpi#2450](https://github.com/code-yeongyu/senpi/issues/2450))

Standalone release binaries now run JavaScript, Python, a real file read and cell listing on all nine natively executable targets, including Alpine musl. Seven legs run that smoke before their binary is uploaded; the linux-arm64 and linux-arm64-musl smokes run after the build, in parallel with the npm platform publish, and a failure there fails the platform release workflow's result. All twelve target manifests preserve the same derived codemode sidecars, and required wasm assets fail packaging if missing. ([#9291](https://github.com/code-yeongyu/oh-my-openagent/issues/9291))

Piping the recommended installer to `sh` or `dash` now hands the script to Bash instead of failing on Bash syntax. If Bash is unavailable, the installer prints the exact `curl ... | bash` command to use and exits cleanly. ([#9325](https://github.com/code-yeongyu/oh-my-openagent/issues/9325))

## [5.1.7] - 2026-09-30

**Computer use on macOS says what it needs and where its engine comes from.** A downloaded install trusts the engine shipped inside its own app, a missing Screen Recording or Accessibility grant opens the right System Settings pane, and `/computer status` and `omo doctor` show which engine you have before it starts. This release runs on the senpi 2026.9.30 engine, like 5.1.6.

### Added

`/computer status` and `omo doctor` report where the computer-use engine is and where it came from (the app bundle, the cache or a path you set) without starting it, name hosts it does not support, and give the same answer. `omo doctor` never downloads the engine. ([#9286](https://github.com/code-yeongyu/oh-my-openagent/issues/9286), [#9311](https://github.com/code-yeongyu/oh-my-openagent/pull/9311))

### Changed

Test cleanups from an internal audit, with no change to behavior. ([#9302](https://github.com/code-yeongyu/oh-my-openagent/pull/9302), [#9304](https://github.com/code-yeongyu/oh-my-openagent/pull/9304), [#9310](https://github.com/code-yeongyu/oh-my-openagent/pull/9310), [#9312](https://github.com/code-yeongyu/oh-my-openagent/pull/9312), [#9314](https://github.com/code-yeongyu/oh-my-openagent/pull/9314), [#9315](https://github.com/code-yeongyu/oh-my-openagent/pull/9315), [#9316](https://github.com/code-yeongyu/oh-my-openagent/pull/9316), [#9317](https://github.com/code-yeongyu/oh-my-openagent/pull/9317), [#9318](https://github.com/code-yeongyu/oh-my-openagent/pull/9318), [#9319](https://github.com/code-yeongyu/oh-my-openagent/pull/9319), [#9321](https://github.com/code-yeongyu/oh-my-openagent/pull/9321))

### Fixed

On macOS, an install downloaded from the web trusts the computer-use engine shipped inside its own app when the engine sits inside the install and matches the checksums shipped beside it. Before, the download quarantine made that engine look untrusted. Any other quarantined engine is still refused. ([#9283](https://github.com/code-yeongyu/oh-my-openagent/issues/9283), [#9301](https://github.com/code-yeongyu/oh-my-openagent/pull/9301))

When computer use is missing the Screen Recording or Accessibility grant, it opens that System Settings pane once, names the app to enable, and tells you to quit and relaunch it. A denied Accessibility listener now reads as a permission problem instead of "supervisor not live". ([#9284](https://github.com/code-yeongyu/oh-my-openagent/issues/9284), [#9309](https://github.com/code-yeongyu/oh-my-openagent/pull/9309))

On Windows set to a language other than English, unpacking a download no longer fails when `tar` lists month names outside ASCII. Thanks to @willowite for the report, the reproduction and the fix. ([#9289](https://github.com/code-yeongyu/oh-my-openagent/issues/9289), [#9303](https://github.com/code-yeongyu/oh-my-openagent/pull/9303))

Editing a file with no extension, such as a shebang script or a `Makefile`, no longer returns "LSP errors detected ... please fix" when no language server covers it. Thanks to @MoerAI for the fix and @floweredao for the report. ([#9292](https://github.com/code-yeongyu/oh-my-openagent/issues/9292), [#9296](https://github.com/code-yeongyu/oh-my-openagent/pull/9296))

Your home folder no longer counts as a project by itself, so a dotfiles `.git` or a stray `~/package.json` stops the language-server install prompt from firing for every file in it. A project with its own marker inside your home folder still counts. Thanks to @MoerAI. ([#9227](https://github.com/code-yeongyu/oh-my-openagent/issues/9227), [#9297](https://github.com/code-yeongyu/oh-my-openagent/pull/9297))

On OpenCode, picking a non-GPT model for Hephaestus fails with an error saying Hephaestus needs a GPT model, instead of an opaque `UnknownError`. Thanks to @RaviTharuma. ([#7704](https://github.com/code-yeongyu/oh-my-openagent/issues/7704), [#7707](https://github.com/code-yeongyu/oh-my-openagent/pull/7707))

On OpenCode, `opencode run --agent sisyphus` and the other original config keys pick that agent again after display names are applied. A category or an unknown name passed to `--agent` fails with a clear error instead of quietly running the default agent. Thanks to @RaviTharuma. ([#7701](https://github.com/code-yeongyu/oh-my-openagent/issues/7701), [#7703](https://github.com/code-yeongyu/oh-my-openagent/issues/7703), [#7708](https://github.com/code-yeongyu/oh-my-openagent/pull/7708))

On OpenCode, ordinary chat no longer turns into a goal, and a message containing pause, resume or clear leaves your goal alone. A prompt longer than 2,000 characters no longer fails with `InvalidObjectiveError`. Goals change only through an explicit `/goal` command, or from your first message when `default_mode.goal` is on. Thanks to @RaviTharuma for the fix and @Cle2ment for the report. ([#6391](https://github.com/code-yeongyu/oh-my-openagent/issues/6391), [#7979](https://github.com/code-yeongyu/oh-my-openagent/pull/7979))

On Codex, updating removes the retired `features.child_agents_md` setting that Codex 0.156 rejects at startup, and the bundled rules no longer mention it. Thanks to @LilMGenius. ([#8693](https://github.com/code-yeongyu/oh-my-openagent/pull/8693))

On Codex, the spawn examples in the bundled Hephaestus rule name their `agent_type`, so a session that follows them spawns its subagents instead of being blocked by the spawn guard. Thanks to @LilMGenius. ([#8298](https://github.com/code-yeongyu/oh-my-openagent/pull/8298))

## [5.1.6] - 2026-09-30

**Hotfix: reopening a session with an unanswerable question no longer crashes the TUI.** ([#9268](https://github.com/code-yeongyu/oh-my-openagent/issues/9268)) When a session was resumed with a pending question whose saved arguments no longer formed a valid question set, the question widget showed "0 unanswered" and crashed with `Cannot read properties of undefined (reading 'question')` as soon as you expanded it. The call now settles as lost in a restart, so the model learns the question is gone and can ask again, and clicking a widget whose questions all have answers submits them. Thanks to @copycatcode for the report. This release runs on the senpi 2026.9.30 engine.

### Added

A new `accept-edits` permission preset lets the agent read and edit files in the project without asking, while shell commands, paths outside the project and other tools still wait for your approval. ([senpi#2430](https://github.com/code-yeongyu/senpi/issues/2430))

Chat bridges can ask the engine for a chat prompt surface, which drops the routing line, the handoff block and todo lines from replies meant for people in a conversation. Terminal and app prompts stay as they are. ([senpi#2398](https://github.com/code-yeongyu/senpi/issues/2398))

### Changed

The recommended `curl` installer now offers `Remove the other omo install at <path>? [y/N]` when it verifies a second installation. Non-interactive runs keep both unless `--remove-other-installs` is explicit, and `omo doctor` prints the exact Bun, npm, or standalone removal command for the non-active install. ([#9324](https://github.com/code-yeongyu/oh-my-openagent/issues/9324))

The engine's recommended OpenAI model is GPT-6.1 Sol at medium, one slot below GPT-6 Astra. Models you listed yourself in `recommendedModels` stay as you set them. ([senpi#2390](https://github.com/code-yeongyu/senpi/issues/2390))

ultrawork reuses QA and review evidence per target instead of rerunning everything after each patch, while keeping the nets that catch what the changer cannot see: each artifact records the commit and what it exercised; after an increment the session reruns the tests of every touched file and its importers, the scenarios that exercise them, and anything whose dependencies or environment moved, cites the capture for the rest, and still runs the full set once before the final message. Every re-review spawns a new reviewer with the delta diff and the cited blockers, at most twice. Defects inside the change's blast radius are fixed in the same run to the ideal state; defects outside it get a tracked issue and a line in the final message instead of growing the run. The memory line now also records every regression a check caught and each QA scenario with its invocation. ([#9294](https://github.com/code-yeongyu/oh-my-openagent/issues/9294), [#9298](https://github.com/code-yeongyu/oh-my-openagent/pull/9298))

### Fixed

On a Claude subscription, a `write` or `edit` to a file outside the working directory runs once and returns one result. Before, Claude Code's own read check refused the call while the change still went through, so a retry could apply an edit twice. Thanks to @haamsuk-collab. ([senpi#2401](https://github.com/code-yeongyu/senpi/issues/2401))

A running session keeps working through an update that changes how the engine's dependencies are laid out. Bash, monitor and `eval` used to fail with `ENOENT` until you restarted. The first launch after an update takes 2 to 3 seconds longer once while the engine copies its dependencies. ([senpi#2408](https://github.com/code-yeongyu/senpi/issues/2408), [senpi#2409](https://github.com/code-yeongyu/senpi/issues/2409))

An answer sent to a terminal session's question through its control endpoint reaches the model with its text, and answering such a question no longer triggers the first-turn todo reminder. ([senpi#2407](https://github.com/code-yeongyu/senpi/issues/2407), [senpi#2419](https://github.com/code-yeongyu/senpi/issues/2419))

The prompt-cache keep-alive pings in real sessions again, with the same tool list as the turn it keeps warm. Thanks to @MoerAI. ([senpi#2389](https://github.com/code-yeongyu/senpi/issues/2389))

An `eval` cell's return value reaches the model whole up to the normal output budget instead of stopping after 768 bytes, and any output that is still cut says so. ([senpi#2402](https://github.com/code-yeongyu/senpi/issues/2402))

On macOS, computer use keeps its Accessibility and Screen Recording permissions across updates, because the signed desktop engine now always runs from the same path. ([#9282](https://github.com/code-yeongyu/oh-my-openagent/issues/9282), [#9288](https://github.com/code-yeongyu/oh-my-openagent/pull/9288))

On Windows, killing a running background task marks it as killed instead of reporting a crash. Thanks to @Dante-dan. ([#9228](https://github.com/code-yeongyu/oh-my-openagent/issues/9228), [#9233](https://github.com/code-yeongyu/oh-my-openagent/pull/9233))

## [5.1.5] - 2026-09-30

**Big thanks to [@ashmoonori-afk](https://github.com/ashmoonori-afk), whose [#9209](https://github.com/code-yeongyu/oh-my-openagent/pull/9209) teaches memory recall to find Korean, Japanese and Chinese notes and to pick the right note out of a big memory.**

**Hotfix: `eval` works again in the standalone `omo` binary.** ([#9248](https://github.com/code-yeongyu/oh-my-openagent/issues/9248), [#9250](https://github.com/code-yeongyu/oh-my-openagent/pull/9250)) The 5.1.3 and 5.1.4 binaries from GitHub Releases and get.omo.dev left out `@babel/parser`, which the `eval` tool loads, so JavaScript and Python `eval` were missing on every OS; npm and bun installs were fine. Each release now refuses a binary in which `eval` does not register and run.

### Added

Memory recall finds Korean, Japanese and Chinese notes and picks the right note out of a large memory with nothing to configure, while an English phrase that matches a note word for word still comes first. ([#9209](https://github.com/code-yeongyu/oh-my-openagent/pull/9209))

The Recommended profile tries GPT-6.1 Sol (medium) before GPT-6 Sol on your ChatGPT subscription or the OpenAI API, and GitHub Copilot and OpenCode Zen keep GPT-6 Sol. ([#9237](https://github.com/code-yeongyu/oh-my-openagent/pull/9237))

In the standalone binary, `omo setup` now imports your settings, `omo doctor` prints the same sections as an npm install, and `omo doctor --reap` cleans up the binary's own stale engines. ([#9252](https://github.com/code-yeongyu/oh-my-openagent/issues/9252), [#9253](https://github.com/code-yeongyu/oh-my-openagent/pull/9253), [#9265](https://github.com/code-yeongyu/oh-my-openagent/pull/9265))

omo.dev has guide pages on mass ulw runs, agents, keywords, telemetry and desktop updates under `/docs/`. ([#9261](https://github.com/code-yeongyu/oh-my-openagent/pull/9261), [#9264](https://github.com/code-yeongyu/oh-my-openagent/pull/9264))

### Fixed

OmO no longer slows your machine down with many sessions open, because memory recall reads the memory repository with one git batch per reload instead of one git process per note. ([#9251](https://github.com/code-yeongyu/oh-my-openagent/issues/9251), [#9254](https://github.com/code-yeongyu/oh-my-openagent/pull/9254))

The Windows release `.exe` runs from the folder you downloaded it to instead of failing at startup. ([#7485](https://github.com/code-yeongyu/oh-my-openagent/issues/7485), [#9255](https://github.com/code-yeongyu/oh-my-openagent/pull/9255))

The standalone binary downloads the Claude Code version it is pinned to on your first Claude subscription turn, checks its hash and caches it, so you no longer need `claude` installed yourself, and `omo doctor` shows it. ([#9262](https://github.com/code-yeongyu/oh-my-openagent/issues/9262), [#9266](https://github.com/code-yeongyu/oh-my-openagent/pull/9266), [#9276](https://github.com/code-yeongyu/oh-my-openagent/issues/9276), [#9277](https://github.com/code-yeongyu/oh-my-openagent/pull/9277))

One invalid value in `omo.jsonc` no longer switches off the whole file: only that key is ignored, `omo doctor` prints one warning naming it, and an unsafe key like `__proto__` is dropped without losing its valid neighbors. Thanks to @mooire733. ([#7676](https://github.com/code-yeongyu/oh-my-openagent/pull/7676), [#9249](https://github.com/code-yeongyu/oh-my-openagent/pull/9249))

On Windows those config warnings name the file as `~/.omo/omo.jsonc`. ([#9244](https://github.com/code-yeongyu/oh-my-openagent/pull/9244))

`omo daemon` reads its settings from `~/.omo/omo.jsonc` like the rest of OmO, and a setting left in the old `~/.omo/agent/omo.json` still applies with a warning in `omo doctor`. ([#9192](https://github.com/code-yeongyu/oh-my-openagent/issues/9192), [#9199](https://github.com/code-yeongyu/oh-my-openagent/pull/9199))

A foreground subagent waits at most 15 minutes before it moves to the background, even when a long prompt-cache window would allow an hour. ([#9236](https://github.com/code-yeongyu/oh-my-openagent/pull/9236))

## [5.1.4] - 2026-09-29

### Changed

OmO Native moves from senpi 2026.9.29-4 to senpi 2026.9.29-5, and the engine changes below come with it.

**GPT-6.1 Sol arrives, and `deep-low` and Geeky · Normal lead with it at medium.** ([#9214](https://github.com/code-yeongyu/oh-my-openagent/issues/9214), [senpi#2390](https://github.com/code-yeongyu/senpi/issues/2390)) The engine adds `gpt-6.1-sol` and its Fast tier `gpt-6.1-sol-fast` on the OpenAI API, ChatGPT subscription, Azure, GitHub Copilot, OpenCode Zen, OpenRouter, Venice and Vercel lanes with the documented `low`..`max` efforts, and makes it the implicit default for the OpenAI and ChatGPT-subscription providers where GPT-6 Sol was. It runs on the GPT-6 system prompt, which gains the two writing rules from OpenAI's own GPT-6.1 Sol template. The default deep delegation lane now starts on `gpt-6.1-sol` (medium) from your ChatGPT subscription or the OpenAI API, then `gpt-6.1-sol-fast`, and keeps GPT-5.6 Sol (medium) and GPT-5.6 Sol Fast behind them, so GitHub Copilot, OpenCode Zen and an engine that does not list GPT-6.1 Sol yet still run the lane on GPT-5.6 Sol as before. The `geeky-normal` model profile likewise applies GPT-6.1 Sol (medium) first and GPT-5.6 Sol (medium) when 6.1 Sol is not served. The effort stays medium on every rung. The other categories and model profiles are unchanged.

**A host can give each session the chat-style app prompt.** ([senpi#2377](https://github.com/code-yeongyu/senpi/issues/2377)) With `SENPI_PROMPT_SURFACE=app`, or `open_session.promptSurface: "app"` on a multi-session host, replies drop the terminal routing line and keep tool and hook feedback with the agent unless it changes what you get. Terminal sessions keep today's prompts.

### Fixed

**Editing a file outside a project no longer asks you to install a language server.** ([#9223](https://github.com/code-yeongyu/oh-my-openagent/issues/9223)) After an edit to OmO's own config, a scratch file in a temp folder, or any file with no project around it, the LSP check told the agent to install the missing server "in THIS repository" and to ask you first, which would have created a `package.json` in your home or temp folder, and it came back on every edit. Those files now get no install prompt, and inside a project the prompt for a missing server appears once per session instead of after every edit. Thanks to @haamsuk-collab for the report.

**Kibitzer recall and quick delegation work with a single Z.ai or Xiaomi login.** ([#9202](https://github.com/code-yeongyu/oh-my-openagent/issues/9202)) The `quick` category had no Z.ai or Xiaomi model, so on a machine logged in to only one of them recall stayed off and quick tasks were unavailable. It now falls back to `glm-5.3-flash` (Z.ai) and `mimo-v2.6-flash` (Xiaomi) at low effort, after every model it already used, so machines that had a quick model keep the same one.

**Engine fixes from senpi 2026.9.29-5.** Remote compaction works again on the ChatGPT subscription lane instead of silently falling back to a local summary ([senpi#2378](https://github.com/code-yeongyu/senpi/issues/2378)). A session no longer leaves an empty `.omo/` folder in the project ([senpi#2386](https://github.com/code-yeongyu/senpi/issues/2386)). RPC `get_auth_providers` reports each login method's status separately ([senpi#2384](https://github.com/code-yeongyu/senpi/issues/2384)). The embedded tree-sitter grammars load on Node again ([senpi#2032](https://github.com/code-yeongyu/senpi/issues/2032)).

## [5.1.3] - 2026-09-29

### Changed

- OmO Native moves from senpi 2026.9.29-3 to senpi 2026.9.29-4; the engine changes below come with it.

**Breaking: an untrusted project's legacy `.pi/` resources no longer load.** ([senpi#2375](https://github.com/code-yeongyu/senpi/pull/2375)) Extensions, skills, prompt templates, themes and hooks under a project's `.pi/` now follow project trust like the rest of the project config. A project whose only project resources are in `.pi/` now asks whether you trust it instead of opening as trusted. Trusted projects load them as before.

**Breaking: interactive sessions no longer join a shared engine host.** ([senpi#2328](https://github.com/code-yeongyu/senpi/issues/2328)) Every interactive launch runs on its own local runtime. Extensions lose `pi.sharedHostEnabled`, and the `experimental.sharedHost` setting and the `SENPI_ENABLE_SHARED_HOST` / `SENPI_DISABLE_SHARED_HOST` variables are ignored if set. On first load `experimental.sharedHost` is removed from the global settings file.

**Local sessions can pass messages and whole sessions to each other.** ([senpi#2328](https://github.com/code-yeongyu/senpi/issues/2328)) An extension can open a terminal session to other local sessions with `pi.session.registerControlEndpoint`, and each message delivered that way is admitted once and waits while you are typing. A multi-session host hands a quiet session to your terminal with `release_session`, and with `interrupt: true` it stops the running work first and returns what it took out of the queue. Host status shows each endpoint's kind, whether it answers and who owns it, and a suspended terminal no longer holds the listing for 10 seconds.

**Claude answers in your language.** ([senpi#2366](https://github.com/code-yeongyu/senpi/issues/2366)) With a "reply in Korean" rule, or when you write in Korean, the routing line, the handoff block and todo labels come back in that language. The handoff labels (`Ask`, `For you`, `Now`, `Next`) stay as they are. Thanks to @floweredao for the report.

**The engine installs smaller and faster.** ([senpi#2360](https://github.com/code-yeongyu/senpi/issues/2360), [senpi#2362](https://github.com/code-yeongyu/senpi/issues/2362)) senpi now declares its real dependencies instead of shipping its whole dependency tree inside the tarball, and it no longer ships sourcemaps.

### Fixed

**Memory recall works on a machine whose quick-category pin names only providers you are not logged into.** ([#9216](https://github.com/code-yeongyu/oh-my-openagent/issues/9216)) With `categories.quick.models` pinned to, say, OpenAI while only another provider is connected, Kibitzer started its recall judge on the pinned model, which failed at once with "No API key found", so recalled-memory nudges never arrived. Kibitzer now starts on the first connected model, your pins first and then the category's built-in chain, and when nothing is connected it shows the "Kibitzer unavailable" notice naming the providers to connect. The `task` tool still uses your pin as written.

**Teams and process-mode subagents work again on installs made under `umask 002`.** ([#9208](https://github.com/code-yeongyu/oh-my-openagent/issues/9208)) With the Ubuntu default umask for private-group users, npm installed the task-host launch spec group-writable, the task host refused it, and every `team_create` failed with only "The task host is unavailable." OmO now makes that file private (0644) when it launches, never following a symlink and never touching a file another user owns. When the task host still refuses the spec, the task, the `team_create` error and `omo doctor` name the file and the fix (`chmod 644 <path>`). Reported and diagnosed by @devswha.

**An npm-installed comment checker is found again, in the old and the new package layout.** ([#9180](https://github.com/code-yeongyu/oh-my-openagent/issues/9180)) The OpenCode edition's comment-checker hook looked for `@code-yeongyu/comment-checker` only in the `bin/` folder its install script used to fill, so an npm install of 0.7.1 or later (binaries under `vendor/`) was never used and the hook fell back to downloading its own copy. The hook, `omo doctor` and the LazyCodex fallback now find the binary under `vendor/` and in the per-platform packages the checker is moving to. Those packages cut its install from about 255 MiB to 51 MiB.

**Agent mailbox state no longer lands in your repository.** ([#9201](https://github.com/code-yeongyu/oh-my-openagent/issues/9201)) OmO Native's thread tools kept their mailbox and receipts in `<project>/.omo/thread-tools`. They now live in the same per-project state folder as task state, outside the project. A project that already has the folder keeps using it.

**A Claude `Request not allowed` error no longer strands a session on a fallback model.** ([senpi#2376](https://github.com/code-yeongyu/senpi/issues/2376)) A transient 403 from a Claude subscription is retried on the same model before the session falls back. A fallback target that answers with a billing error no longer pins the session: that provider is skipped for its cooldown, and the next turn returns to your original model with a notice saying why.

**A project you trusted loads its `.agents/skills` again.** ([senpi#2371](https://github.com/code-yeongyu/senpi/issues/2371)) They appear under `/skill:` without launching with `--approve`. An untrusted project no longer picks up resources another session loaded from the same folder as trusted. Thanks to @sorenjuul for the report and the root-cause analysis.

**Session files survive a failed write.** ([senpi#2328](https://github.com/code-yeongyu/senpi/issues/2328)) Opening a session saved by an older version rewrites it through a complete copy, so a full disk or an I/O error keeps the original intact. A write refused for permissions or space no longer leaves the refused entry in the session, and a prompt whose messages could not be saved reports that error. A refused delivery, a half-written first save or the release of a never-saved session no longer leaves a session stuck or ends an engine host.

**Every `extension_ui_response` gets a reply.** ([senpi#2372](https://github.com/code-yeongyu/senpi/issues/2372)) A host or a terminal endpoint that settles one answers with the frame's own id, so a client can tell a delivered answer from a lost one.

**The startup banner is no longer red.** ([#8442](https://github.com/code-yeongyu/oh-my-openagent/issues/8442)) Under Bun, `omo` printed its version banner, the `omo setup` credentials hint and the legacy-settings notice in the error color, so a healthy start looked like a failure. They now print without color; the text and the stream are unchanged. (#8870 by @cynkai)

**`omo update` no longer reports success while leaving the old version installed.** ([#9198](https://github.com/code-yeongyu/oh-my-openagent/issues/9198)) It now looks up the version published on your channel and installs exactly that, for example `bun add -g omo-ai@5.1.2`. If you are already on it, nothing is installed. If the package manager finishes but OmO is still on the old version, `omo update` says `omo is still <old>; <new> is published`, prints the command to retry, and exits with an error. `omo update --dry-run` shows the exact command. When the npm registry can't be reached, it installs the unpinned `omo-ai` as before and tells you it could not confirm the version.

**`omo update --help` shows help instead of updating.** ([#9207](https://github.com/code-yeongyu/oh-my-openagent/issues/9207), reported by @devswha) `omo update --help` and `omo update -h` used to run the install, and so did a mistyped flag. They now print what `omo update` does and its flags. A flag it doesn't know, such as `--forse`, stops with `omo update: unknown option --forse` and installs nothing. The compiled `omo` binary answers the same way.

## [5.1.2] - 2026-09-29

### Added

**A one-line installer at get.omo.dev.** ([#9166](https://github.com/code-yeongyu/oh-my-openagent/issues/9166)) `curl -fsSL https://get.omo.dev/install.sh | bash` on macOS and Linux, or `irm https://get.omo.dev/install.ps1 | iex` in Windows PowerShell, installs the native `omo` binary for your OS and CPU into `~/.local/bin`, after checking it against the release `SHA256SUMS`. When get.omo.dev is unreachable it falls back to the npm registry and GitHub Releases. `bun add -g omo-ai` keeps working. omo.dev now shows the command for your OS and has an install page at `/docs/install` ([#9177](https://github.com/code-yeongyu/oh-my-openagent/issues/9177)).

**`web_search` can use your own SearXNG.** ([senpi#2339](https://github.com/code-yeongyu/senpi/issues/2339)) Add `{ "provider": "searxng", "baseUrl": "http://localhost:8888" }` to `websearch.json`.

### Changed

**An unknown slash command no longer reaches the model by accident.** ([senpi#2348](https://github.com/code-yeongyu/senpi/issues/2348)) A typo like `/ulw-exec` goes back into the editor with a `Did you mean /skill:ulw-execute?` hint instead of being sent as a prompt. A second Enter on the unchanged text sends it as a normal message, and Esc keeps editing.

**Moving from the OpenCode edition, OmO Native tells you which model choices it ignores.** ([#9147](https://github.com/code-yeongyu/oh-my-openagent/issues/9147), [#6794](https://github.com/code-yeongyu/oh-my-openagent/issues/6794)) On its first start, Native lists each agent and category model from your OpenCode edition settings that it ignores, with the `omo setup` step and the `omo.jsonc` key that carries it over. `omo setup` itself now carries the edition's `metis` and `momus` models over to `plan-consultant` and `plan-reviewer`.

**Hosted web search runs on the provider's cheaper search model.** ([senpi#2340](https://github.com/code-yeongyu/senpi/issues/2340)) On the same login, for example `claude-haiku-4-5` on Claude routes, when your model list shows it at a lower price than the session model. If it fails or finds nothing, the search retries on the session model. `"nativeModel": "session"` in `websearch.json` restores the old behavior.

**Without a `websearch.json`, `web_search` tries more than DuckDuckGo.** ([senpi#2339](https://github.com/code-yeongyu/senpi/issues/2339)) It now tries DuckDuckGo, Exa, Startpage, Mojeek, Ecosia and Google in turn and pauses an engine that blocks it, so your queries may reach these services. List only the providers you want in `websearch.json` to keep them away from the rest.

**Remote MCP servers declared by a skill no longer receive your `bearerTokenEnv` token.** ([senpi#2345](https://github.com/code-yeongyu/senpi/issues/2345)) The skill picks the server's URL, so declare that server in your own `mcp.json` to keep its auth. Stdio servers from skills you installed now expand `${VAR}` the way your own `mcp.json` does.

### Fixed

**A running session survives `omo update`.** ([senpi#2358](https://github.com/code-yeongyu/senpi/issues/2358)) `omo update` and `bun install -g` replace the installed package, and a session started earlier used to fail every later request with `Cannot find module './<chunk>-<hash>.js'` until you restarted it. Each launch now runs from its own copy of the engine.

**Config you edit in `~/.pi/agent` is no longer silently ignored.** ([#9173](https://github.com/code-yeongyu/oh-my-openagent/issues/9173)) After OmO copied `~/.pi/agent` to `~/.omo/agent`, edits to the old copy had no effect. The next start now warns once per edited file and names the file OmO reads, `omo doctor` lists the same files, and `omo config import-pi <file>` copies the edit over.

**`omo doctor` no longer fails its computer-use check on every OS.** ([#9193](https://github.com/code-yeongyu/oh-my-openagent/issues/9193)) 5.1.1 shipped without an asset the check reads, so it always reported `ENOENT` for `assets.generated.json`.

**A finished task child no longer stays "running" after its parent's host dies.** ([#9183](https://github.com/code-yeongyu/oh-my-openagent/issues/9183)) The child's record kept its dead owner, so Desktop showed a working agent that no longer existed and task status and DAG waits kept waiting on it.

**Scrolling on X11 delivers every wheel click.** ([#9136](https://github.com/code-yeongyu/oh-my-openagent/issues/9136)) A foreground scroll from computer use sometimes dropped clicks and still reported success.

**Bedrock accepts tool schemas with a root `anyOf`, `oneOf` or `allOf`.** ([senpi#1947](https://github.com/code-yeongyu/senpi/issues/1947)) It also accepts schemas without an object type, which it used to reject.

**Memory reflection works when your only provider comes from an extension.** ([#9175](https://github.com/code-yeongyu/oh-my-openagent/issues/9175)) If that provider disappears you get one notice instead of the same failure on every run.

**Cursor runs each tool call once.** ([senpi#2334](https://github.com/code-yeongyu/senpi/issues/2334)) It used to run every call a second time, and the replayed write could undo a file fix.

**A resumed Claude conversation keeps its resume point.** ([senpi#1972](https://github.com/code-yeongyu/senpi/issues/1972)) When a monitor or goal starts the first turn on restore, the conversation no longer resends its whole history.

**In headless runs, a late Kibitzer verdict no longer replaces the final answer.** ([#9158](https://github.com/code-yeongyu/oh-my-openagent/pull/9158)) It used to add a turn after the answer that ended in `NO_REPLY`.

**An MCP server that changes its tool list mid-session gets the new list registered.** ([senpi#2188](https://github.com/code-yeongyu/senpi/issues/2188)) Added tools now show up and removed ones stay gone.

**Native OpenAI requests with hosted web search no longer fail every turn with `Tool choice 'web_search' not found in 'tools' parameter`.** ([senpi#2234](https://github.com/code-yeongyu/senpi/issues/2234))

**Web search through OpenAI and xAI lists only pages the search returned.** ([senpi#2337](https://github.com/code-yeongyu/senpi/issues/2337)) Links the model wrote on its own are no longer counted as sources.

**A rejected OpenAI Responses WebSocket request shows the provider's message.** ([senpi#2235](https://github.com/code-yeongyu/senpi/issues/2235)) It used to show `Error Code undefined: undefined`.

**Claude subscription sessions keep the field descriptions in custom tool schemas.** ([senpi#2145](https://github.com/code-yeongyu/senpi/issues/2145)) Claude no longer wastes a call on a missing required field.

**The OpenAI-compatible adapter merges back-to-back user messages for non-OpenAI hosts.** ([senpi#2120](https://github.com/code-yeongyu/senpi/issues/2120)) Direct OpenAI requests are unchanged.

**Extensions that depend on sloppy-mode CommonJS packages load again under Bun.** ([senpi#1841](https://github.com/code-yeongyu/senpi/issues/1841))

**Picking a skill that needs input from the slash menu now waits for you to type it.** ([#9168](https://github.com/code-yeongyu/oh-my-openagent/issues/9168)) On OmO Native, choosing `/ulw-execute`, `/ulw-plan`, `/ulw-loop`, `/ulw-research`, `/mass-ulw`, `/hyperplan`, `/init-deep`, `/refactor` or `/remove-ai-slops` from the slash menu with Enter sent it right away with nothing after it, so the skill started without the plan name, request or goal it works on. These skills now declare what they take, and Enter leaves `/ulw-execute ` (or `/skill:ulw-execute `) in the input with the hint shown in the menu; type the arguments and press Enter again to send. Skills that take no input still run on one Enter. The waiting half needs the engine release that reads the hint (code-yeongyu/senpi#2258); until OmO adopts it, the menu behaves as before.

**Your own `computer-use` skill no longer opens every session with a "Skill conflicts" warning.** ([#9160](https://github.com/code-yeongyu/oh-my-openagent/issues/9160)) With computer use on, OmO Native added its built-in `computer-use` skill on every start, even when you already had a skill of that name (Orca CLI ships one), so each session opened with a collision box. The built-in skill now steps aside for a same-name user, project or package skill, which is the one that loads, and `/computer status` says so in one line. The same applies to the `x-search` skill. `disabled_skills` now hides both the way it hides the bundled skills; the `computer` and `x_search` tools stay available either way.

## [5.1.1] - 2026-09-29

### Changed

**The `unspecified-low` category now opens on Claude Sonnet 5.5 at `medium`.** ([#9144](https://github.com/code-yeongyu/oh-my-openagent/issues/9144)) `unspecified-low` is where delegated work lands when no specialist category fits and the job is contained. It led with MiMo V2.6 Pro at `max`; Claude Sonnet 5.5 at `medium` now comes first, on the Claude subscription, Anthropic API, GitHub Copilot and OpenCode lanes. Every earlier rung stays, in the same order, behind it: MiMo V2.6 Pro, Grok 4.7, GPT-5.6 Terra, Claude Sonnet 5, Qwen 3.8 Max Preview, DeepSeek V4 Pro and MiMo V2.5 Pro. OmO Native picks Sonnet 5.5 once the engine release that lists it is adopted; until then the category keeps running on MiMo V2.6 Pro.

**The `deep-low` category now opens on plain GPT-5.6 Sol at `medium`.** ([#9144](https://github.com/code-yeongyu/oh-my-openagent/issues/9144)) `deep-low` led with the GPT-5.6 Sol Fast tier and fell back to plain GPT-5.6 Sol where the Fast tier is not served. The order is now reversed: plain GPT-5.6 Sol at `medium` runs first on every lane that serves it, and the Fast tier is the fallback on the OpenAI lanes. The category still opens when either Sol tier is connected.

**Each session's task children now run on their own host.** ([#9003](https://github.com/code-yeongyu/oh-my-openagent/issues/9003)) On macOS and Linux, background task children used to run as sessions of one engine host shared by every session on the machine, so one crash or one stuck host hit everybody's children. Now every session gets its own host (the Desktop app moves each thread onto its own host in its own release). A crash, idle exit or upgrade of one host leaves the others alone, and a finished session's host exits 15 minutes after its last client leaves. Isolation costs memory. With 4 parent sessions of 4 children each we measured 2.7 GB RSS and 0.8 GB physical footprint, against 0.78 GB and 0.24 GB for one shared host. An idle host costs 126 MB of physical footprint, about what the old shared host cost idle (137 MB). A session's host now starts in the background on its first prompt (`task.host_shard_prewarm`, default `first-turn`; `session-start` and `off` are also available), so the first child no longer waits for a host to boot: 1116 ms p50 / 1678 ms p95 from the `task` call to the child's first model request, against 1666 / 3280 ms without the pre-warm and 979 / 1593 ms on the old shared host when it was already running. Nothing caps the number of hosts. Children started by the previous release stay on the shared host until they finish. Before you downgrade, read the rollback steps in [docs/reference/omo-daemon.md](docs/reference/omo-daemon.md). Skipping them can leave a retained child stuck.

**`omo daemon` and `omo doctor` show every host.** ([#9003](https://github.com/code-yeongyu/oh-my-openagent/issues/9003)) `omo daemon status` (and `--json`) and `omo doctor` list the shared daemon and every per-session host with its pid, sessions, memory and crash count. `omo daemon gc` removes the state of hosts that have provably exited. `omo daemon stop --all` and `omo daemon handoff` act on every host, and `omo daemon stop --drain --all --wait` waits until every host has really stopped. `omo daemon rollback-prepare` moves retained children back to the shared host before a downgrade. `omo daemon run --foreground` now exits 2 because the engine host always runs detached; `--persistent` is still accepted.

**A crashed task host tells its parent once, and says when the children are back.** ([#9003](https://github.com/code-yeongyu/oh-my-openagent/issues/9003)) When a session's task host crashes while a child is working, the session gets one warning naming the host, its supervisor pid ("supervisor pid N") and the cause, and how many children are reattaching ("1 child" or "N children"). A closing line follows when they are all back; it adds ", C cancelled" when some of them were cancelled during recovery.

**`thread_read` labels tool results as `tool`.** A thread read from a live host now marks tool results with role `tool`, the same as a thread read from its transcript file. Models that read `thread_read` output see one role for tool results on both paths.

### Fixed

**LazyCodex keeps the model you picked for a subagent role.** ([#5245](https://github.com/code-yeongyu/oh-my-openagent/issues/5245)) Every reinstall and marketplace auto-update copied the bundled agent files over `~/.codex/agents/` and put `explorer`, `librarian` and the other roles back on the bundled model, even when you had changed it. A model you set in those files now survives updates; a model LazyCodex wrote itself still moves to the new default. For a durable choice, set `[codex].agents.<role>.model` (and `reasoning`) in `~/.omo/omo.jsonc`; each sync applies it, and removing it restores the bundled default.

## [5.1.0] - 2026-09-28

5.1.0 adds computer use to OmO Native as an experimental feature, and fixes Claude subscription logins across many sessions, GitHub Copilot tokens and hosts, goals that looped on a rejected login, and a long list of background task problems. `omo update` installs it, or run:

```bash
bun add -g omo-ai
```

### Computer use (experimental)

- **Experimental:** OmO Native agents can now drive your real desktop. They take screenshots, list windows, click, type, scroll, press keys, read the accessibility tree and use the clipboard, through a `computer` tool and a `computer` global in the eval kernels. Behaviour may still change, so please send feedback and bug reports.
- **Per OS:**
  - macOS (arm64, x64): background input by default, so your frontmost app, focus and cursor stay put.
  - Windows x64: background input varies by app, and nothing can reach elevated apps.
  - Linux x64 on X11: XTEST/XSendEvent plus AT-SPI.
  - Linux x64 on Wayland: portals and libei, with no single-window capture.
  - No engine ships yet for Linux arm64 or Windows arm64.
- **Turning it on:** it is on by default on supported hosts, but its code and native engine load only on first use, so sessions that never use it pay nothing at startup. The agent finds `computer` through tool search, or you run `/computer on`. `/computer status` shows the engine, the stop path and the OS permissions. Set `computer.enabled: false` to remove it entirely. macOS needs Screen Recording and Accessibility.
- **Scrolling:** `dx`/`dy` are pixels on every OS (one wheel notch is 40 px), and a positive `dy` scrolls down everywhere, macOS included. ([#9101](https://github.com/code-yeongyu/oh-my-openagent/issues/9101), [#9055](https://github.com/code-yeongyu/oh-my-openagent/issues/9055))
- **Kill switch:** Control+Option+Command+Escape on macOS, or Ctrl+Alt+Shift+Escape on Linux and Windows, stops all computer input at once, including typing already in progress. Input stays stopped until you run `/computer resume`; the agent cannot resume it.
- **Safety:** screenshots need `computer:read` and input needs `computer:exec`. Before input, OmO checks the stop path, the screen lock, the OS permissions and that the target point is uncovered.
- **Known limits:** some toolkits ignore synthetic background input; OmO then reports it instead of pretending it worked. X11 background input doesn't reach GTK, Qt or Chromium yet (#9108). Wayland's stop chord needs the GlobalShortcuts portal. Full guide: [`docs/guide/computer-use.md`](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/computer-use.md).

### Added

- `omo app-server` threads load the OmO plugin, so they get `task`, `workpool`, `memory`, `lsp_*` and the other OmO tools, and `app-server daemon restart` keeps it. ([#9117](https://github.com/code-yeongyu/oh-my-openagent/issues/9117), [#9122](https://github.com/code-yeongyu/oh-my-openagent/pull/9122), [senpi#2313](https://github.com/code-yeongyu/senpi/issues/2313))
- Durable scheduled prompts: the `schedule_prompt` tool stores a reminder, follow-up or recurring prompt, and `schedule run` fires it later, also for `--print` runs. ([senpi#2216](https://github.com/code-yeongyu/senpi/issues/2216))
- Sessions follow a moved or re-cloned repository: `--session`, `--resume` and `/resume` offer to move them here, keeping their history, goal, loops and monitors. ([senpi#2181](https://github.com/code-yeongyu/senpi/issues/2181), [senpi#2184](https://github.com/code-yeongyu/senpi/issues/2184))
- `models discover <provider>` fills an OpenAI-compatible provider's model list in `models.json` from its `/models` endpoint, including the reasoning levels it advertises. ([senpi#2196](https://github.com/code-yeongyu/senpi/issues/2196))
- Eval kernels say when they hold a lot of memory, name the largest globals, and restart once past a ceiling (`memory.noticeMb`, `memory.ceilingMb`). ([senpi#2261](https://github.com/code-yeongyu/senpi/issues/2261))
- `host status --all` lists every RPC host endpoint, `host gc` clears the state of hosts that are provably gone, and `host status` shows `memory_pressure`. ([senpi#2226](https://github.com/code-yeongyu/senpi/issues/2226), [senpi#2245](https://github.com/code-yeongyu/senpi/issues/2245))
- A native crash of an interactive or print session leaves one entry in `process-crashes/crashes.jsonl` on the next start. ([senpi#2194](https://github.com/code-yeongyu/senpi/issues/2194))

### Changed

- OmO Native moves from senpi 2026.9.27 to senpi 2026.9.28-7; the engine fixes below come with it.
- A parent no longer runs out of room for its task children: `task.residency_max_children` defaults to `"unlimited"`. Set a number in `omo.json` to keep a bound. ([#8999](https://github.com/code-yeongyu/oh-my-openagent/issues/8999))
- Memory extracts facts from one very long conversation entry (up to 512 KiB) in a bounded extra run instead of parking it forever, which can mean extra model calls. ([#8984](https://github.com/code-yeongyu/oh-my-openagent/issues/8984), contributed by @deadcode-walker in [#8985](https://github.com/code-yeongyu/oh-my-openagent/pull/8985))
- After an account-wide usage limit, a task's fallback tries the next provider's models first and keeps the spent provider as the last resort; a limit on one model or family still moves to the next model in order. ([#8296](https://github.com/code-yeongyu/oh-my-openagent/issues/8296))
- A fallback-chain model that keeps failing is skipped for a cooldown (60 s, doubling up to 30 minutes) by every session in the process, and a provider's `Retry-After` is honored. ([senpi#2198](https://github.com/code-yeongyu/senpi/issues/2198))
- GPT-6 Astra, Sol and Luna stay on the stated goal and report unrelated errors in the final message instead of chasing them. ([senpi#2256](https://github.com/code-yeongyu/senpi/issues/2256))
- OpenCode Go and Fireworks default to `kimi-k3`, since their old Kimi defaults left the catalogs. ([senpi#2295](https://github.com/code-yeongyu/senpi/issues/2295), [senpi#2175](https://github.com/code-yeongyu/senpi/issues/2175))

### Fixed

**Providers and logins**

- Claude subscription sessions no longer hit `401 OAuth access token has been revoked` and end up "blocked until re-login" when several sessions run at once; they pick up the refreshed token instead. ([#8762](https://github.com/code-yeongyu/oh-my-openagent/issues/8762), [senpi#2225](https://github.com/code-yeongyu/senpi/issues/2225), [senpi#2281](https://github.com/code-yeongyu/senpi/issues/2281), [senpi#2282](https://github.com/code-yeongyu/senpi/issues/2282))
- `/login` into a blocked Claude account now replaces the revoked token instead of keeping it. ([senpi#2222](https://github.com/code-yeongyu/senpi/issues/2222))
- A Claude subscription turn no longer fails with "pre-replay buffer overflow" while Claude Code runs a background turn of its own. ([senpi#2192](https://github.com/code-yeongyu/senpi/issues/2192))
- GitHub Copilot recovers when GitHub revokes its cached token: the token is re-exchanged once and the request re-sent, so every model no longer fails with HTTP 403 until `/login`. ([senpi#2297](https://github.com/code-yeongyu/senpi/issues/2297), [senpi#2302](https://github.com/code-yeongyu/senpi/issues/2302))
- GitHub Copilot Business and Enterprise accounts reach their own API host instead of failing with `421 Misdirected Request`, for chat, `/btw` and web search. ([#8662](https://github.com/code-yeongyu/oh-my-openagent/issues/8662), [senpi#2309](https://github.com/code-yeongyu/senpi/issues/2309), [senpi#2310](https://github.com/code-yeongyu/senpi/issues/2310))
- Copilot turns no longer fail with a bare HTTP 400 when more than 128 tools are exposed; the extras are left out and you're told how many. ([senpi#2298](https://github.com/code-yeongyu/senpi/issues/2298))
- Copilot models compact before Copilot's own prompt limit instead of failing the turn. ([senpi#2299](https://github.com/code-yeongyu/senpi/issues/2299))
- A Copilot 402, 403 or quota 429 says whether it's a quota or a refusal and includes the GitHub request id. ([senpi#2297](https://github.com/code-yeongyu/senpi/issues/2297))
- A goal stops on the first 401 or 403 a provider keeps returning and tells you what to do (for example `Run /login github-copilot ...`) instead of looping to the continuation cap; your next message resumes it. ([senpi#2293](https://github.com/code-yeongyu/senpi/issues/2293))
- The first message no longer fails on providers that only accept automatic tool choice, for example Kiro behind a proxy; `compat.supportsForcedToolChoice: false` skips the forced choice entirely. ([#9096](https://github.com/code-yeongyu/oh-my-openagent/issues/9096), [senpi#2218](https://github.com/code-yeongyu/senpi/issues/2218), [senpi#2224](https://github.com/code-yeongyu/senpi/issues/2224))
- Devin SWE-2 lists only the lanes Devin serves (`swe-2-medium`, `swe-2-high`, `swe-2-max`), `devin/swe-2-medium` gets the SWE-2 prompt preset, and a config naming `swe-2`, `swe-2-low` or `swe-2-high-lite` gets a startup warning. ([#9111](https://github.com/code-yeongyu/oh-my-openagent/issues/9111), [senpi#2306](https://github.com/code-yeongyu/senpi/issues/2306), [senpi#2308](https://github.com/code-yeongyu/senpi/issues/2308))

**Memory**

- Kibitzer and the other memory sidecars fall back to their category's builtin models when a pinned model refuses, instead of failing every wake. ([#9111](https://github.com/code-yeongyu/oh-my-openagent/issues/9111))
- The Kibitzer failure notice names the model that failed and the `omo.json` setting to change. ([#9111](https://github.com/code-yeongyu/oh-my-openagent/issues/9111))
- Memory reflection moves to the next model when one hits a spent usage or quota limit, instead of ending the run. ([#8296](https://github.com/code-yeongyu/oh-my-openagent/issues/8296), [#6808](https://github.com/code-yeongyu/oh-my-openagent/issues/6808))
- Memory dreaming sees which skills and memory files you actually read again. ([#8864](https://github.com/code-yeongyu/oh-my-openagent/issues/8864), reported by @katamana, fixed by @MoerAI in [#8865](https://github.com/code-yeongyu/oh-my-openagent/pull/8865))

**Tasks and subagents**

- Task children wait for a busy task host instead of failing with "Task runner failed to start." within 30 s. ([#9067](https://github.com/code-yeongyu/oh-my-openagent/issues/9067), [senpi#2209](https://github.com/code-yeongyu/senpi/issues/2209))
- A task child that kept working through a host hiccup or handoff is no longer left "suspended" until the parent restarts. ([#9069](https://github.com/code-yeongyu/oh-my-openagent/issues/9069))
- A task waiting for a free slot on its fallback model shows as queued with its position, not as running. ([#9069](https://github.com/code-yeongyu/oh-my-openagent/issues/9069))
- A task's status follows its child: a nudged child no longer shows as failed, and a child that wakes up on its own sends a `task completion (resumed turn)`. ([#9069](https://github.com/code-yeongyu/oh-my-openagent/issues/9069))
- A delegated task no longer hangs in `running` (and `omo -p` no longer stays open) when its first model fails and it moves to the next one.
- A task child whose host restarted mid-turn continues its interrupted turn when the parent resumes. ([#9003](https://github.com/code-yeongyu/oh-my-openagent/issues/9003))
- A suspended task child frees its concurrency slot, so `task_send` no longer answers `lane_capacity` after a few restarts. ([#8973](https://github.com/code-yeongyu/oh-my-openagent/issues/8973))
- Task start failures say why the child couldn't start instead of only `Task runner failed to start.` ([#8960](https://github.com/code-yeongyu/oh-my-openagent/issues/8960))
- A child whose host dies while it opens reports `host_unreachable`. ([#9020](https://github.com/code-yeongyu/oh-my-openagent/issues/9020))
- A re-prompted child on a loaded host no longer prints `Timeout waiting for response to prompt` over the parent's screen. ([#9093](https://github.com/code-yeongyu/oh-my-openagent/issues/9093))
- A task whose whole fallback chain failed says so in its transcript. ([#8301](https://github.com/code-yeongyu/oh-my-openagent/issues/8301), contributed by @MoerAI in [#9022](https://github.com/code-yeongyu/oh-my-openagent/pull/9022))
- Live task progress, stats and transcripts keep updating after a child reconnects to its host. ([#8983](https://github.com/code-yeongyu/oh-my-openagent/issues/8983), contributed by @deadcode-walker in [#8978](https://github.com/code-yeongyu/oh-my-openagent/pull/8978))
- DAG nodes finish when their child task finishes, also in projects reached through a symlink. ([#8932](https://github.com/code-yeongyu/oh-my-openagent/issues/8932), reported by @ayalcoh)
- A cancel, a cleanup sweep or a reload during a model fallback no longer ends a revived run, loses a lane slot, or starts the next model beside a child that's still closing.

**Task host**

- The shared host keeps opening sessions after a session's directory is deleted, instead of failing every new task child with `ENOENT`. ([senpi#2206](https://github.com/code-yeongyu/senpi/issues/2206))
- The shared host no longer refuses task children when its memory is high, and it leaves memory pressure once memory is actually freed. ([#8960](https://github.com/code-yeongyu/oh-my-openagent/issues/8960), [senpi#2207](https://github.com/code-yeongyu/senpi/issues/2207), [senpi#2261](https://github.com/code-yeongyu/senpi/issues/2261))
- A transient task daemon idle-exits again while omo runs, and polling `host status` no longer keeps hosts alive. ([#9041](https://github.com/code-yeongyu/oh-my-openagent/issues/9041), [senpi#2242](https://github.com/code-yeongyu/senpi/issues/2242), [senpi#2227](https://github.com/code-yeongyu/senpi/issues/2227))
- An old host generation exits after a handoff even when one of its sessions misbehaves, and a handoff no longer inherits the calling session's identity or model. ([senpi#2285](https://github.com/code-yeongyu/senpi/issues/2285), [senpi#2208](https://github.com/code-yeongyu/senpi/issues/2208))

**Commands and sessions**

- `/ulw-execute <plan>` and every bundled skill name work as bare commands, like `/skill:<name>`. ([#9042](https://github.com/code-yeongyu/oh-my-openagent/issues/9042))
- A bare `/skill` or `/skill:` opens the skill list instead of going to the model. ([senpi#2249](https://github.com/code-yeongyu/senpi/issues/2249), [senpi#2251](https://github.com/code-yeongyu/senpi/issues/2251))
- `/thinking` works again, `/sessions` opens the session picker, and `/help` says how to change the thinking level and reopen a session. ([senpi#1437](https://github.com/code-yeongyu/senpi/issues/1437))
- Answering `y` to "Fork this session into current directory?" forks it instead of printing `Aborted.` ([senpi#2180](https://github.com/code-yeongyu/senpi/issues/2180), [senpi#1042](https://github.com/code-yeongyu/senpi/pull/1042) by @beengineer500)
- Starting omo no longer empties an upstream pi install, and a `~/.pi/agent` an earlier start drained gets its files copied back. ([#8039](https://github.com/code-yeongyu/oh-my-openagent/issues/8039), [senpi#2215](https://github.com/code-yeongyu/senpi/issues/2215))
- MCP tools register once per session instead of twice. ([senpi#2177](https://github.com/code-yeongyu/senpi/issues/2177))
- Unhandled errors go to the debug log instead of over the TUI, and a fatal crash prints one line with the log path. ([senpi#2284](https://github.com/code-yeongyu/senpi/issues/2284))
- ulw plan progress counts `T1.2`, `F1`-style task ids and blocked `- [~]` rows, and a plan with no countable tasks no longer triggers a `0/0` continuation. ([#9019](https://github.com/code-yeongyu/oh-my-openagent/issues/9019), [#6233](https://github.com/code-yeongyu/oh-my-openagent/issues/6233))
- Session search in the `coding-agent-sessions` skill finds prompts from the middle of a session. ([#9012](https://github.com/code-yeongyu/oh-my-openagent/issues/9012))

**Edits and eval**

- When the formatter rewrites a file after `write`, `edit` or `apply_patch`, the model always gets the "auto-formatted, re-read before exact-text edits" notice, also when diagnostics come back clean. ([#9123](https://github.com/code-yeongyu/oh-my-openagent/issues/9123))
- The comment checker replaces a stale cached binary with the pinned release, and warns in the session when it can't run instead of going quiet. ([#8850](https://github.com/code-yeongyu/oh-my-openagent/issues/8850), contributed by @cynkai in [#8877](https://github.com/code-yeongyu/oh-my-openagent/pull/8877) and [#8880](https://github.com/code-yeongyu/oh-my-openagent/pull/8880))
- `new Bun.WebView()` works in eval cells on Windows and Linux, and with `backend: "chrome"` on macOS, and no longer leaves Chrome running. ([senpi#2248](https://github.com/code-yeongyu/senpi/issues/2248), [senpi#2272](https://github.com/code-yeongyu/senpi/issues/2272))
- Eval memory goes back to the machine without a reset, settled cells no longer pin their images in memory, and retired workers don't leave zombie processes. ([senpi#2259](https://github.com/code-yeongyu/senpi/issues/2259), [senpi#2260](https://github.com/code-yeongyu/senpi/issues/2260), [senpi#2261](https://github.com/code-yeongyu/senpi/issues/2261), [senpi#1962](https://github.com/code-yeongyu/senpi/issues/1962))
- Eval cells that print a lot of output finish about 4x faster. ([senpi#2262](https://github.com/code-yeongyu/senpi/issues/2262))

**Install, update and doctor**

- `omo update` on a compiled binary picks the newest release on its own channel and the asset it was built as, and prints a command that replaces the running binary; the TUI update notice says `omo update`.
- `omo doctor` treats a standalone omo binary as an OmO install instead of an unknown file to delete, and warns once when it and omo-ai are both on PATH.
- On Windows, `omo doctor` and `install --platform=native` recognize a Bun-installed omo, and `omo update` uses `bun add -g` for a legacy Bun home install. ([#8909](https://github.com/code-yeongyu/oh-my-openagent/issues/8909))
- The computer use engine for Intel Macs starts: it was built for macOS 10.12 and could not load its Swift libraries, and the release now runs its selftest under Rosetta. ([#9139](https://github.com/code-yeongyu/oh-my-openagent/pull/9139))

## [5.0.1] - 2026-09-27

A patch release for problems people hit on 5.0.0. `omo update` installs it, or run:

```bash
bun add -g omo-ai
```

### Changed

**OmO Native moves to senpi 2026.9.27.** ([#8906](https://github.com/code-yeongyu/oh-my-openagent/issues/8906), [senpi#2157](https://github.com/code-yeongyu/senpi/issues/2157)) The fixes below come with it. npm, pnpm and Yarn installs now run on Bun when Bun 1.4.0 or newer is installed, the way `bun add -g` installs already did; set `OMO_RUNTIME=node` to stay on Node.js. When OmO Native does start on Node.js, it says once per version how to move to Bun.

**A local `omo` install now tells you to update with bun.** The launcher that `oh-my-openagent install` writes for a local checkout answered `omo update` with `npm i -g omo-ai`; it now prints `bun add -g omo-ai` (`omo-ai@beta` on a prerelease build), like every other install instruction. Installs from npm keep getting the npm command from `omo update`.

**`writing` leads with Claude Opus 5.5 at `low` and no longer runs on Claude Fable 5.1.** ([#8907](https://github.com/code-yeongyu/oh-my-openagent/issues/8907)) The builtin `writing` chain is now `claude-opus-5-5` (low), then `claude-opus-4-6` (max), on both OmO Native and the OpenCode edition, with the same Claude providers as before. It stays Claude-only: with neither model connected the category is unavailable instead of falling back to another family, so a setup whose only Claude model is Fable 5.1 no longer offers `writing` unless you pin `categories.writing.model`. A `writing` entry in your own config still wins over the default.

### Fixed

**Extensions load on Bun 1.3.x again.** ([senpi#2164](https://github.com/code-yeongyu/senpi/issues/2164), reported by @odurif0) An extension that declared its package directory as the entry (`"pi": { "extensions": ["."] }`) or depended on a package that requires a JSON file (ajv does) failed with `Cannot find module 'file:/…'`. Both load now.

**Session titles work on models that cannot turn reasoning off.** ([senpi#2163](https://github.com/code-yeongyu/senpi/issues/2163), [senpi#1239](https://github.com/code-yeongyu/senpi/issues/1239), reported by @jtoronto and @VXNCXNX) Z.ai GLM 5.3 and other mandatory-reasoning models rejected the title request with `Reasoning is mandatory for this endpoint and cannot be disabled. (HTTP 400)`. The title request now asks for the lowest reasoning level the model supports, and a title that still fails is written to `logs/session.log` instead of showing an error. Thanks to @ImStillBlue, whose [senpi#1266](https://github.com/code-yeongyu/senpi/pull/1266) took the first shot at this fix.

**One rejected image no longer breaks the rest of a session.** ([senpi#2170](https://github.com/code-yeongyu/senpi/issues/2170)) After a provider rejected an image, every later turn failed, text-only ones too. The rejected image is now replaced by a note naming its file, and the next message goes through, also after a restart. The read tool also finds a file whose path is wrapped in quotes, like the one Windows Explorer's "Copy as path" produces.

**A stable build no longer calls itself beta.** ([#8901](https://github.com/code-yeongyu/oh-my-openagent/issues/8901)) The 5.0.0 startup banner printed `omo (omo-ai beta 5.0.0)`. Both the npm launcher and the compiled binary now take the channel from the version, so 5.0.1 prints `omo (omo-ai 5.0.1)`.

**A terminal session's output no longer picks up a stray line break** when another session is spawned at the same moment. ([senpi#2161](https://github.com/code-yeongyu/senpi/issues/2161))

**An expired Claude login no longer breaks the first headless or desktop turn.** With no `model_profile` set, OmO Native starts on the Recommended ladder, and a Claude subscription whose saved login can no longer be refreshed still counted as connected: the session was pinned to Claude Opus 5.5, every turn failed on the refresh, and the retry walked only other Claude models before giving up, even when another provider on the ladder (for example Z.ai GLM 5.3) was connected. A model profile now resolves a rung's credentials the way its first turn would before picking it: a login that cannot be refreshed drops that provider and the walk moves on; a provider with several accounts stays eligible while any of them (the pinned one, when an account is pinned) resolves, unless rotation is turned off for it (`credentials.rotation: false` in `models.json`, or a runtime API key), in which case only its default credential counts; a model whose own request configuration fails to resolve drops only that model. The start notice names what was skipped and how to recover on that surface: the desktop points at Provider authentication settings, a headless run at an interactive session's `/login <provider>`. A literal `provider/model` pin in `model_profile` is still applied as written. The resolution runs once per attempted account at session start, sequentially, so a rejected login can add up to the provider's refresh timeout before the next rung is picked.

**A delegated task no longer retries a provider that already rejected your credentials.** When a subagent's turn failed because a provider refused the key (for example an OpenCode Go key whose subscription lapsed, carried over by `omo setup`) or an OAuth login could not be refreshed, the task retried the next model on the same provider, which failed the same way. It now skips the rest of that provider and moves to the next provider in the category, or, when none is left, reports the error with how to re-authenticate that provider (Provider authentication settings on the desktop, `/login <provider>` in an interactive session). This covers subagents running as separate processes (the default on macOS and Linux); an in-process subagent still walks its chain inside the engine.

## [5.0.0] - 2026-09-26

### PLEASE REMOVE OPENCODE V1 FOR OMO, LAZYCODEX, IMMEDIATELY.

Because OmO Native is out for real. 5.0.0 is its first stable release, and `bun add -g omo-ai` installs it from npm's default channel with no `@beta` tag.

```bash
bun add -g omo-ai
```

Strictly speaking you don't have to remove anything. The OmO plugin for OpenCode v1 and LazyCodex keep running, but from here on they get degraded support: new features land in OmO Native first, and some never reach the plugins because the hosts cannot carry them. We recommend removing them anyway. We stopped using them weeks ago, not out of neglect, but because OmO Native is what we keep reaching for.

OmO Native is the `omo` command: the pi-based senpi engine with the OMO extension built in. The rest of these notes are for people who run omo today as the OpenCode plugin (oh-my-openagent) or as LazyCodex on the Codex CLI.

### Moving from the OpenCode edition or LazyCodex

```bash
bunx oh-my-openagent install --platform=native   # or: bun add -g omo-ai
omo setup
omo doctor
```

The installer removes the stale global `omo` that oh-my-openagent 4.19.x and older shipped, installs `omo-ai` with bun (npm when bun is missing) and checks that `omo` on your PATH is the new one. `omo setup` reads what your OpenCode install already knows and carries it across after one confirmation: provider API keys, custom OpenAI- or Anthropic-compatible providers from `opencode.jsonc`, MCP servers, global skills and your model choices. OAuth logins are listed with the `/login` command to run, since tokens do not move between tools. `omo doctor` then prints which task categories your connected providers can run and what the OpenCode edition left behind, each with the command that fixes it. `omo update` updates in place.

### What you get that the plugins could not give you

| | OpenCode edition / LazyCodex | OmO Native |
| --- | --- | --- |
| Runtime | a plugin inside someone else's host, restarted to apply | one `omo` binary on the senpi engine |
| Tool calls | one tool per model turn | first-party CodeMode: code that calls tools, in parallel |
| Memory | none built in | git-backed memory with a self block, reflection, and Kibitzer recall |
| Multi-model work | Team Mode (OpenCode), `spawn_agent` (Codex) | mass ulw: a DAG of nodes routed to different models |
| Browser | MCP add-ons | omowright built in, attached to your own browser |

**The engine.** senpi is our fork of pi. The OMO extension loads into it directly instead of negotiating with a host's plugin API, so hooks, tools and the TUI behave the same on every platform. Cold start to ready fell from 5.8 s to 850 ms across three profiling rounds, and `omo --help` answers in 28 ms.

**Memory, and Kibitzer.** Memory lives in a git repository of markdown files. Persona, the person you work with, and a self block are projected into every session. The self block is how the agent forms a self: from what you call it and how you work with it. Reflection and dreaming run as sandboxed background workers after a session settles. Kibitzer is the new part. It is a second agent loop that runs beside your main session on the cheap `quick` category, and it wakes only when a turn touches a memory it has not judged yet. It reads with five read-only tools, checks, and then drops the "oh right" into your conversation through a single hidden nudge. It cannot write memory. Recall costs about 5 ms per tool call on a large corpus, down from 308 ms, and the model it runs on is pinned to the `quick` chain so it never lands on a frontier-priced model.

**CodeMode.** Every step can be a JavaScript or Python eval cell whose prelude carries `tool.<name>()`, `parallel()`, `pipeline()` and `agent()`. Twenty reads become one cell and one round trip. On our own sessions, with the model held the same, OmO Native used about half the context per round trip that the OpenCode edition did (0.39x on GPT-5.5, 0.69x on Opus 4.8), and a live GPT-6 Astra session reports a 97.5% prompt-cache hit in its footer.

**mass ulw.** Put "mass ulw" in a prompt and the work becomes a graph: nodes with dependency edges, each routed by category to a different model, fed through workpools with retries and recovery. The graph runs live in the TUI and in a herdr side pane ([omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag) by @jc01rho).

**Browser use.** omowright ships with OmO Native. It drives the browser you already use, with your logins, through BrowserSkill, and hands off to you for a login, CAPTCHA or one-time code. For bot-scored sites it runs its own Chromium on a cloaked profile. Nothing to install.

**You can see what it is doing.** Your first request opens a phased todo list. Every todo change names your original request, the task in progress and the next one, and the agent reports when the plan is set, when a phase closes and when the work ends. A turn that stops with todos open gets one nudge to finish them. Persistent monitors survive a restart, and questions arrive as cards you answer with a digit or a click.

**Lighter on your machine.** Subagents run as sessions inside one shared daemon instead of one engine process each. File watching is one worker per host, where 1,000 sessions used to mean 1,023 threads. Background processes die with the session that started them.

**Models.** You name the kind of work and omo picks the model for it. `deep-low`, the default deep lane, now runs GPT-5.6 Sol Fast at medium. Model profiles offer Daily and Geeky lanes, each in Normal and Heavy. Claude, ChatGPT, Kimi and GLM subscriptions sign in with `/login`.

### OpenCode v2

We know about OpenCode v2. Our answer to it is coming, and it takes time. Until then, please run OmO Native: it is the version we use every day, and the one this release was built with.

### Next

A desktop app is coming soon, and computer use after it.

### Changed

**`deep-low` runs GPT-5.6 Sol Fast at medium.** ([#8885](https://github.com/code-yeongyu/oh-my-openagent/issues/8885)) The default deep delegation lane now starts on `gpt-5.6-sol-fast` (medium) on the ChatGPT subscription and OpenAI API lanes and falls back to `gpt-5.6-sol` (medium), which GitHub Copilot and OpenCode Zen also serve. The lane is offered whenever one of those two models is connected, so an account that only has GPT-6 Sol no longer sees it; pin `categories.deep-low.model` to keep a GPT-6 Sol setup.

**A stable release ships OmO Native on `latest`, and a stable build stops asking for `@beta`.** ([#8887](https://github.com/code-yeongyu/oh-my-openagent/issues/8887)) The release pipeline now takes omo-ai's channel from the version it publishes: a prerelease still goes to `beta` as `X.Y.Z-0.<suffix>`, while a stable version goes to `latest` as exactly `X.Y.Z`, so `bun add -g omo-ai` installs it with no tag. The dist-tag guard and the live-install check follow the same channel. Every place that prints an install or update line (the update banner, `omo update`, `omo doctor`, the launcher's reinstall hints, the OpenCode installer and its in-session nudge, the post-install notice, and the release-notes footer) derives it from the running build's version.

**OmO Native moves to senpi 2026.9.26.** ([#8882](https://github.com/code-yeongyu/oh-my-openagent/issues/8882), [senpi#2139](https://github.com/code-yeongyu/senpi/issues/2139), [senpi#2137](https://github.com/code-yeongyu/senpi/issues/2137), [senpi#2135](https://github.com/code-yeongyu/senpi/issues/2135), [senpi#2143](https://github.com/code-yeongyu/senpi/issues/2143)) The Cursor CLI lane now sends your request together with the hidden messages of the same turn, so the first request of a session no longer reaches the model as an empty plan reminder. The first-turn plan waits for your own first request instead of arming on an onboarding greeting. A handoff block that restates your request is no longer mistaken for a repeating turn, while a turn that really repeats is still stopped.

## [5.0.0-beta.90] - 2026-09-24

### Changed

**You can see the agent's plan and its progress without asking, and weaker models no longer stop halfway through it.** ([senpi#2121](https://github.com/code-yeongyu/senpi/issues/2121), [#8847](https://github.com/code-yeongyu/oh-my-openagent/issues/8847)) The OmO Native engine moves to senpi 2026.9.24-3. The first work request of a session now opens with a phased todo list, and every todo update names your original request, the task in progress, and the next one. When the plan is created, a phase closes, or the work finishes, the agent writes a short report of what you asked for, what you need to know now, what it is doing, and what comes next. The final message uses that report and says plainly what is done and what is not. If a turn ends with todo items still open and no question for you, the agent gets one reminder to finish them. Models that refuse a forced first tool call with thinking on now continue normally instead of failing the first turn. The first-turn plan and the turn-end reminder can be turned off with the `todo.firstTurnPlan` and `todo.turnEndBackstop` settings.

**Moving from the OpenCode edition to OmO Native now carries your setup over in one run.** ([#8815](https://github.com/code-yeongyu/oh-my-openagent/issues/8815), [#8816](https://github.com/code-yeongyu/oh-my-openagent/issues/8816), [#8817](https://github.com/code-yeongyu/oh-my-openagent/issues/8817), [#8799](https://github.com/code-yeongyu/oh-my-openagent/pull/8799), [#8803](https://github.com/code-yeongyu/oh-my-openagent/pull/8803)) `omo setup` reads what your OpenCode install already knows and brings it across after one confirmation: API keys for every provider omo can serve (an OpenCode `zai-coding-plan` key lands on `zai`), custom OpenAI- or Anthropic-compatible providers from `opencode.jsonc` with their models and keys, MCP servers, global skills, your default model, and the model you gave each category or agent. It prints a single summary first. OAuth logins it cannot copy are listed with the `/login <provider>` command that restores them, and anything it will not bring over says why: an MCP server that runs command substitution, a skill folder with no `SKILL.md`, OpenCode's `small_model`, the `build` and `plan` primary agents, or an agent name omo does not have. Running it again changes nothing that is already there.

**A migrated user sees which task categories their providers serve before the first delegation fails.** ([#8857](https://github.com/code-yeongyu/oh-my-openagent/issues/8857)) `omo doctor` prints the categories your connected providers can run and, for each one they cannot, the providers to connect or the `categories.<name>.model` pin that fixes it; `omo setup` shows the same for the providers it is about to import. A Z.AI-only key serves 1 of 10 builtin categories, an Anthropic-only login 7 of 10. The list comes from the same resolver the `task` tool gates spawns with, so what doctor says matches what a delegation would do.

**The native installer finishes the move instead of leaving you a to-do.** ([#8823](https://github.com/code-yeongyu/oh-my-openagent/issues/8823), [#8793](https://github.com/code-yeongyu/oh-my-openagent/pull/8793)) `bunx oh-my-openagent@beta install --platform=native` removes a stale global `omo` left by the old package (and the Codex Light wrapper in `~/.local/bin`), installs omo-ai, checks that `omo` on your PATH is really omo-ai, and then offers to run `omo setup` for you. It removes only the conflicting command, never the package. The command the nudge, the `/native` dialog and the installer hint show now follows your plugin's channel: `@beta` on a beta, the bare name on a stable release.

**`omo update` updates.** ([#8821](https://github.com/code-yeongyu/oh-my-openagent/issues/8821)) It used to print a package-manager command and exit. It now runs that command with the package manager that installed omo, streams its output, and reports `omo <before> -> <after>`. `omo update --dry-run` still only prints it.

**`omo doctor` knows what the OpenCode edition left behind.** ([#8818](https://github.com/code-yeongyu/oh-my-openagent/issues/8818)) It warns when another `omo` sits ahead of omo-ai on your PATH or the old `oh-my-openagent` / `oh-my-opencode` package is still installed globally, each with the command that fixes it, and notes when OpenCode still loads the plugin so you can keep or remove it on purpose.

**Geeky · Normal runs GPT-5.6 Sol at medium.** ([#8807](https://github.com/code-yeongyu/oh-my-openagent/issues/8807)) The `geeky-normal` model profile now applies GPT-5.6 Sol (medium) from your ChatGPT subscription, the OpenAI API, Copilot or OpenCode, in that order, instead of GPT-6 Sol Fast then GPT-6 Sol. It no longer falls back to a GPT-6 model: when none of those providers serves GPT-5.6 Sol, the session keeps its model and prints the unavailable notice. Geeky · Heavy, the Daily lanes and the Recommended default are unchanged.

**`ulw-research` stops asking which format when the destination already says so, and proves its report before handing it over.** ([#8611](https://github.com/code-yeongyu/oh-my-openagent/issues/8611)) A research run used to stop before the first wave and wait for you to pick a format, even when you had already said "post it in the thread" or pointed at last month's report. It now derives the format from the request and where the result is going, asks at most three questions only about what is still missing (the recommended default first, a free-text "describe the format" answer, and "don't care"), and starts collecting without waiting. A preference you state outright, or the same choice made on two runs, is remembered, so the next request offers it first. When you point at a document, its colors, fonts, breakpoints, section skeleton and citation style are copied into the report's design spec mechanically instead of retyped. Before anyone looks at the pages, a deterministic check reads the rendered report for broken Korean line wrapping, colors outside the palette, emoji, em dashes, over-long headings, numbers with no source or lineage tag, charts without a captioned figure or axis labels, serif Korean fonts, uncited sections, a missing sources or how-this-was-made section, broken images, and layout overflow. Repairs stop after three attempts, two attempts without improvement, a repeated defect set, or fifteen minutes, and the report ships with the remaining defects listed, unless one of them means the content itself is incomplete. Every promised format is tracked until it is delivered, skipped or impossible in that session with a reason, and the closing briefing (sources, domains, minutes, deliverables, gates, remaining defects) is printed from that record rather than recalled.

**The `/resume` picker opens large session directories in under 2 seconds.** ([senpi#2087](https://github.com/code-yeongyu/senpi/issues/2087)) The OmO Native engine moves to senpi 2026.9.24-2. A session directory with over a thousand sessions now opens in 0.6 to 2.0 s cold instead of 15 to 29 s: senpi writes a `.session-summaries.index` alongside your sessions directory and reads it in one sequential pass on the next launch. Per-keystroke filtering falls from 75 to 235 ms to 0.6 to 27 ms: search text is cached once per session row at list time, and fuzzy matching and path resolution both run once per list instead of once per keystroke.

### Fixed

**There is now a "Migrating from OpenCode" guide.** ([#8822](https://github.com/code-yeongyu/oh-my-openagent/issues/8822)) `docs/guide/migrating-from-opencode.md` walks a user of the OpenCode edition through the move in one place: how to tell the legacy package still owns `omo`, the installer line and what it repairs, what `omo setup` carries over, what needs `/login`, what it refuses or leaves behind and why, an OpenCode-habit to omo-command table, keeping the OpenCode plugin alongside, and the update and uninstall order. The installation guide, the READMEs, the `/native` dialog's "Open the guide" and the installer's post-install hint link to it.

**The Agent-Model Matching guide describes the models OmO Native actually runs.** ([#8805](https://github.com/code-yeongyu/oh-my-openagent/issues/8805)) The guide now opens by saying most people can skip it, since OmO Native picks the main model from the providers you connect and every category and curated agent resolves its own chain. Its recommended section names the six models of the Recommended ladder (Claude Opus 5.5, Claude Fable 5.1, Kimi K3, GPT-6 Astra, GPT-6 Sol, GLM 5.3) instead of GPT-5.6 Sol; the preset table lists every preset Senpi picks, including the `gpt-6-astra` preset the whole GPT-6 family runs on; the category table shows the `chatgpt-subscription` defaults of `ultrabrain`, `deep-low` and `deep-high`; and it documents the category availability gates, the categories behind the ulw reviewers, and that the interactive TUI ignores `model_profile`. The overview and installation guides stop recommending GPT-5.6 Sol and stop naming the retired Capable and Deep work profiles.

**Setting up the browser extension no longer installs it into a Chrome you do not use.** ([#8784](https://github.com/code-yeongyu/oh-my-openagent/issues/8784)) The `browser` skill used to register the BrowserSkill extension into every Chromium browser that had ever left a profile on disk, and asked you to restart Chrome first. It now picks the one browser you actually work in - your default browser when you are using it, otherwise the only browser you are using - and installs only there, naming that browser in the one step you have to do. Arc, Dia, Vivaldi, Opera, Comet and Naver Whale are recognised alongside Chrome, Edge, Brave and Chromium. When it cannot tell (your default is Safari or Firefox, or you use several browsers), it installs nothing and the agent asks you which one to use, then remembers the answer.

**The OpenCode plugin's "Restart to apply" now loads the new version.** ([#8801](https://github.com/code-yeongyu/oh-my-openagent/pull/8801)) OpenCode keeps every npm plugin in a cache sandbox and reused it without checking the tag again, so an install on `@latest` or `@beta` stayed on the first version it ever downloaded, however often you restarted. The plugin now clears a sandbox that lags its tag, so the restart the update toast asks for picks up the release.

**Re-running the installer leaves one TUI plugin entry.** ([#8798](https://github.com/code-yeongyu/oh-my-openagent/pull/8798)) A `tui.json` written by an older installer kept its `oh-my-openagent@latest` entry next to the new one, and the TUI loaded the plugin twice. The installer now replaces its own entries.

**GLM model profiles use a `zai` key you imported.** ([#8824](https://github.com/code-yeongyu/oh-my-openagent/issues/8824)) Recommended and Daily · Normal looked for OpenCode's provider id, which the OmO Native engine does not register, so an imported `zai` key never selected GLM 5.3. The GLM rungs now name the engine's `zai` and `zai-coding-cn` providers.

**`omo -p` and `--mode json` keep stderr clean.** ([#8819](https://github.com/code-yeongyu/oh-my-openagent/issues/8819)) The model-profile selection and the other component diagnostics no longer print as objects on stderr; set `OMO_DEBUG=1` to see them.

**An unconfigured recall category is one notice, not a repeating failure.** ([#8820](https://github.com/code-yeongyu/oh-my-openagent/issues/8820), [#8811](https://github.com/code-yeongyu/oh-my-openagent/pull/8811)) When none of your connected providers serves the Kibitzer recall category, the session shows one warning that names the category, the providers it needs, and both fixes (`/login <provider>`, or pinning a model for the category in `omo.json`) instead of `Kibitzer gate failed ... after 3 consecutive failures`. A task category with no usable model names the same fixes.

**Tips and onboarding tell you the command you actually have.** ([#8794](https://github.com/code-yeongyu/oh-my-openagent/pull/8794)) The tips and onboarding skills now say `omo --list-tips` and `omo --onboard` on OmO Native instead of `senpi`, which is not on your PATH there.

**An existing `[codex] codegraph` setting no longer breaks the installer.** ([#8166](https://github.com/code-yeongyu/oh-my-openagent/issues/8166)) The retired key is now dropped during config migration instead of failing validation before `~/.omo/omo.jsonc` is written.

**A memory commit made during a session no longer rewrites that session's system prompt.** ([#8470](https://github.com/code-yeongyu/oh-my-openagent/issues/8470)) The memory block is compiled once per session; a later commit reaches the model as one line of the existing memory notice, so the cached prompt stays intact.

## [5.0.0-beta.89] - 2026-09-24

### Changed

**`ulw-plan` now plans for the person the result touches, and the plan reviewer checks that it gets them there.** ([#8773](https://github.com/code-yeongyu/oh-my-openagent/issues/8773)) Before asking you anything, the planner names who the change affects - a customer, another programmer, a program or agent consuming the output - how they use it today, the state in which nothing snags, regresses or degrades for them, and every gap from today, each with its reason. Forks are resolved against that state first, so you are asked only the decisions that are genuinely yours; "MVP" or "phase 1" cuts are never invented, and when the ideal state is larger than what you literally asked for the brief says so in one line and plans it anyway. The plan file carries the user and the ideal-state rows under `## Scope`, a `## Success criteria` table that maps every row to the task that delivers it and the QA scenario that proves it (that section used to be empty), and a final `Ideal-state fidelity` gate whose shortfall becomes new tasks, never a note. The plan reviewer no longer approves at "80% clear": it checks who the end user is, what changes for them, which problem is solved, that every ideal-state row is delivered and proven, and that the approach can actually reach that state - a wrong approach for the stated user is a blocker, while a different approach that would also work is not its concern. The same rules ship in the OpenCode and Codex editions of the skill.

**With no model profile set, OmO starts on the recommended model.** ([#8770](https://github.com/code-yeongyu/oh-my-openagent/issues/8770)) A fresh OmO Desktop or headless session with no `model_profile` now runs Recommended instead of Daily · Normal: Claude Opus 5.5 (medium), then Claude Fable 5.1 (xhigh), Kimi K3 (max), GPT-6 Astra (xhigh), GPT-6 Sol (medium), and GLM 5.3 (max), whichever you have connected first. The Claude subscription wins over the Anthropic API, and gateway aggregators such as OpenGateway and OpenRouter are never picked for this default. The OmO Native engine moves to senpi 2026.9.24, so the terminal follows the same order through the engine's recommended-model switch ([senpi#2074](https://github.com/code-yeongyu/senpi/issues/2074)). The four Daily/Geeky lanes are unchanged and apply when you pick one; `model_profile: "recommended"` selects the default explicitly.

**The OmO Native footer badge credits its author and tells a dev build apart.** ([#8771](https://github.com/code-yeongyu/oh-my-openagent/issues/8771)) The status row now reads `(😺 OmO Native by Q Kim)`, and a session started from an `omob` dev build shows `(☕ OmO Native by Q Kim)` instead, so you can see at a glance which binary you are running.

### Fixed

**Memory writes no longer fail with "'description' exceeds 1024 characters" when the model garbles the call.** ([#8774](https://github.com/code-yeongyu/oh-my-openagent/issues/8774)) Most `○ Not remembered` notices came from one model mistake: closing the memory tool's `description` argument with `</description>` instead of `</parameter>`, which folds the note's whole body into the description. The memory tool now splits such a call back into its description and body and saves it, and tells the model what it repaired. A call that cannot be repaired unambiguously is refused as a garbled call rather than a too-long description, so the model resends it instead of trimming, and the notice says so in a plain sentence (`The description was 6,242 characters; the limit is 1,024.`) instead of the raw engine error.

## [5.0.0-beta.88] - 2026-09-23

### Changed

**The `frontend` skill's motion rules now say what makes a transition read as natural, not only how long it lasts.** ([#8755](https://github.com/code-yeongyu/oh-my-openagent/issues/8755)) The DESIGN.md contract every project inherits gains a feedback-threshold table (press feedback in the same frame, hover-revealed controls after intent, a spinner only past about one second with a placeholder immediately, progress at an even pace, failure reported next to the object), a radius scale with concentric nested corners, and a reduced-motion policy that reduces rather than removes: positional and depth motion becomes a cross-fade while fades, gesture-tracked motion, and progress indicators stay. The interaction reference adds a meaning-to-motion table (a still indicator reads as frozen; a permanent loop is not "new"), a transition-identity rule (a surface that resizes animates from its old geometry, panels leave the way they came, one element stays still as the anchor, nothing reflows while the user types or drags), a discrete-versus-continuous input rule (taps animate, drags track 1:1 and settle on release), and a one-event-one-feedback rule (no double spinners, success shown by the changed state, undo over confirmation dialogs, neither Cancel nor a destructive action takes the default role). The ambience reference gains a comfort rule for viewport-filling motion (fixed reference frame, low-contrast moving layer, no motion at the viewport edges, no ~0.2 Hz oscillation). Two contradictions inside the skill are removed: the DESIGN.md template no longer pre-decides "depth without shadows or borders" in Section 2 while asking you to choose a depth strategy in Section 7, and `filter` is allowed as a composited property in the template as it already was everywhere else in the skill.

### Fixed

**Truncated shell output no longer ends with a "lines dropped" marker.** ([senpi#2063](https://github.com/code-yeongyu/senpi/issues/2063)) The OmO Native engine moves to senpi 2026.9.23-5. When a long `bash` result is cut, the card just ends with the kept output; the marker still reaches the model, so it knows output was dropped.

**A fresh OmO Native install has the comment checker, and a missing checker never breaks a write.** ([#8247](https://github.com/code-yeongyu/oh-my-openagent/issues/8247)) The shipped extension asks for the checker after every successful `write`, `edit`, or `apply_patch`, but `omo-ai` never shipped one: before 5.0.0-beta.87 a clean install had no comment checking at all, and on a Bun 1.3.x runtime the miss surfaced as `Extension error (...omo.js): ResolveMessage: Cannot find module '@code-yeongyu/comment-checker'` after every write. OmO Native now does what the OpenCode edition already does: on the first write of a session it downloads the pinned checker release (v0.8.0) for your platform into the cache both editions share (`~/.cache/oh-my-opencode/bin`, `%LOCALAPPDATA%\oh-my-opencode\bin` on Windows), reuses it from then on, and prefers `OMO_COMMENT_CHECKER_BIN`, an installed `@code-yeongyu/comment-checker` package, or a `comment-checker` on `PATH` when one exists. If none of those work, the checker turns itself off for the session with one warning instead of an extension error. 5.0.0-beta.87 fixed the miss by declaring `@code-yeongyu/comment-checker` as a dependency; that package carries every platform's binary and added about 255 MiB to each install, so the dependency is removed again in favor of the download. Thanks to @gunggme for the report, the diagnosis, and the resolver fix.

**The terminal keeps the model you started with.** `model_profile` now applies only in OmO Desktop and headless runs. The interactive TUI has no way to show or change a lane yet, so it no longer switches a fresh session to Daily · Normal (Opus 5.5 medium) over the default model in your settings, and a lane you set in `omo.json` waits for the desktop too.

**A customized model profile keeps its lane name.** Replacing the chain of `daily-normal`, `daily-heavy`, `geeky-normal`, or `geeky-heavy` under `model_profiles` without a `display_name` no longer turns the session notice label into the raw id; it still reads Daily · Normal and so on.

## [5.0.0-beta.87] - 2026-09-23

### Fixed

**A global install no longer fails to find the comment checker.** ([#8247](https://github.com/code-yeongyu/oh-my-openagent/issues/8247))

The shipped extension asks for `@code-yeongyu/comment-checker` after a write-like tool result, but `omo-ai` never declared it, so an install that had no other copy of that package raised `Cannot find module '@code-yeongyu/comment-checker'`. The package now declares it as a pinned runtime dependency, and the manifest test pins the declaration so it cannot disappear again.

### Changed

**Tool cards stop showing the model's bookkeeping, and runs of reads collapse into one "Explored" entry.** ([#8732](https://github.com/code-yeongyu/oh-my-openagent/issues/8732)) The OmO Native engine moves to senpi 2026.9.23-4. Hints meant for the model, such as `[143 more lines in file. Use offset=58 to continue.]`, "limit reached", `Full output: <path>`, grep statistics, and the project-rules or AGENTS.md text injected into a read, still reach the model unchanged but no longer appear in the terminal UI. Consecutive `read`, `grep`, `find` and `ls` calls now render the way Codex shows them: one `• Explored` entry listing `Read a.ts, b.ts`, `Search <pattern>` and `List <dir>`, expandable to the original cards. Hidden diagnostics also no longer duplicate the screen when mouse capture is on.

**The `programming` skill's Rust guidance compiles and no longer contradicts itself.** ([#8739](https://github.com/code-yeongyu/oh-my-openagent/issues/8739)) Agents writing Rust got several examples that did not build or broke the skill's own strict lint config: an edition 2024 template declaring Rust 1.83, a duplicate lint key cargo rejects, `mem::forget` and `static mut` patterns the config denies, a serde struct combining two attributes serde cannot combine, and a project scaffold that failed its own lint gate and could not link on macOS. Every edited example now compiles under the skill's configuration on Rust 1.85 and current stable, and the scaffold builds, lints, and runs clean. The Rust references also gained what they were missing: Rust 2024 FFI syntax, explicit overflow and conversion rules, validated-newtype construction, async trait and cancellation guidance, public-API naming and trait design, macro hygiene, doctests, and an MSRV check. The bundled checker now also flags `#[allow]`, silently discarded results, and blocking calls inside async code.

**Model profiles detect GPT providers with the same subscription-first priority as task routing.** ChatGPT subscriptions take priority over the `openai` API/proxy lane, and the non-fast Sol fallback remains available. Custom profile chains can choose their own provider and reasoning; a provider-qualified candidate no longer silently runs through a different provider when its named provider is unavailable. ([#8735](https://github.com/code-yeongyu/oh-my-openagent/issues/8735))

**Memory reads as the agent remembering, in one quiet notice.** ([#8733](https://github.com/code-yeongyu/oh-my-openagent/issues/8733)) Background reflection no longer draws its own lifecycle into your conversation: the `Memory reflection started`, `no changes`, single-run failure and "older completions collapsed" rows are gone, and so are their toasts (which the Desktop app also showed as warning rows). Everything that actually changed memory now uses the same blue notice: a memory write reads `Remembered · 4th entry today` with one sentence such as `Added 22 lines to reference/project/x.md.`, a deletion reads `Let go` (`Cleared <file>. One less thing to carry.`), a reflection that committed reads `Remembered · on reflection` with the first sentence of what it learned, and a refused write reads `Not remembered` with a plain reason instead of the raw engine error. Repeated reflection failures still raise their alert.

**Model profiles are four lanes: Daily/Geeky × Normal/Heavy.** ([#8735](https://github.com/code-yeongyu/oh-my-openagent/issues/8735)) The old `capable` and `deep-work` ids are gone, with no alias or migration: a config still naming them gets the unknown-profile notice listing `daily-normal`, `daily-heavy`, `geeky-normal`, and `geeky-heavy`. Daily · Normal (Claude Opus 5.5 `medium`, then Kimi K3 `max`, then GLM 5.3 `max`) is the default on a fresh session when `model_profile` is unset. Daily · Heavy is Claude Fable 5.1 `xhigh`. Geeky · Normal is GPT-6 Sol Fast `medium` on a ChatGPT subscription, then GPT-6 Sol `medium` on Copilot or OpenCode. Geeky · Heavy is GPT-6 Astra `xhigh`. The session-start notice names the lane, the selected model, and the thinking level. If no rung is in this session's model registry, the notice lists those candidates instead of claiming a provider is disconnected. A `--model` flag, a scoped model, a resume, a fork, and a user `model_profiles` overlay behave as before.

**Every browser instruction OmO Native and Codex ship now goes through omowright.** ([#8727](https://github.com/code-yeongyu/oh-my-openagent/issues/8727)) The `browser` skill bundles the [omowright](https://github.com/code-yeongyu/omowright) library (staged at build time from a pinned dependency, no nested `node_modules`) and routes between its two engines: the **attached** engine drives the browser the user is already signed into through BrowserSkill's daemon and extension from the js-eval kernel (`connectBrowserSkill()`, `bskSnapshot()`, no `bsk` process per call), and the **owned** engine launches a browser the code controls (`connectPipe()`, CloakBrowser via `connectCloakProfile()`) with snapshots, coordinate control, captcha helpers, network snooping, routes and flight traces. The skill's `browser-install.mjs` now installs the CLI, starts the daemon and registers the Web Store extension through Chrome's external-extension mechanism, so the only step left for the user is one **Enable** click; `browser-doctor.mjs` reports the exact state. `visual-qa`, `debugging`, `frontend`, `review-work`, `ulw-execute`, `ulw-loop`, `ultimate-browsing` (Tier 2) and the ultrawork directives on both editions describe that library instead of `Bun.WebView` and hand-written `playwright-core` scripts; the `debugging` skill's Playwright CLI reference is replaced by `references/tools/browser-qa.md`. The shipped-guidance gate (`script/no-retired-browser-tools.test.ts`) now also rejects `playwright-core`, `playwright-cli`, `Bun.WebView`, `launchPersistentContext` and `chromium.launch` in those editions' payloads. The OpenCode edition's `browser_automation_engine` providers are unchanged.

**`unspecified-high` runs Claude Opus 5.5 at `medium` instead of `max`.** ([#8728](https://github.com/code-yeongyu/oh-my-openagent/issues/8728)) The catch-all high-effort lane still leads with Claude Opus 5.5, on both OmO Native and the OpenCode edition, but at `medium` reasoning, so ordinary multi-file work no longer pays for maximum thinking on every call. Its fallbacks are unchanged: GLM 5.3 at `max`, then Kimi K3 at `max`. An `unspecified-high` entry in your own config still wins over the default.

### Fixed

**Claude subscription sessions keep the model you chose, say which Claude Code is too old, and find npm-installed Claude Code on Windows.** ([#8700](https://github.com/code-yeongyu/oh-my-openagent/issues/8700)) The engine moves to senpi 2026.9.23-3. `--no-model-fallback` and `SENPI_NO_FALLBACK=1` now hold for the whole session: they were dropped the first time the session saved any setting, so a turn that Claude Opus 5.5 rejected with "Claude Code 2.1.278 does not support this model" still walked down to Opus 5, 4.8 and 4.6 and answered from a model the run had excluded. `--no-ask-user` and `--theme` had the same hole. When the local Claude Code is too old for a model, the message now names the binary that ran and where it came from (`CLAUDE_CODE_EXECUTABLE`, the copy OmO ships, or `claude` on your PATH) and gives the fix for that binary, instead of always saying "update senpi/omo" next to the API's "run `claude update`". On Windows, a Claude Code installed with `npm i -g @anthropic-ai/claude-code` (a `claude.cmd` wrapper) is now found and used when it is newer than the bundled copy. senpi's release now fails when a recommended, default or fallback Claude model is unknown to the Claude Code it bundles, which is how Opus 5.5 shipped unusable in beta.84-beta.85.

**GPT models in the builtin chains work when OpenAI is set up as the `openai` provider, not only as the ChatGPT subscription.** ([#8734](https://github.com/code-yeongyu/oh-my-openagent/issues/8734)) On OmO Native, every builtin GPT rung (GPT-6 Astra, GPT-6 Sol and Sol Fast, GPT-6 Luna Fast, GPT-5.6 Sol, in the category chains, the `explore`, `librarian` and `plan-reviewer` agents, and the `deep-work` profile) listed only `chatgpt-subscription`. A machine whose OpenAI access is an API key, or an OpenAI-compatible proxy configured as `openai`, never got a GPT model from them: `explore` skipped `gpt-6-luna-fast` and fell to `claude-haiku-4-5`, and when an earlier rung failed at runtime the fallback list skipped every GPT rung too. Each of those rungs now lists `chatgpt-subscription` first and `openai` right after it, so the subscription still wins when both are configured and nothing is billed per token that was not before. In the OpenCode edition, the `quick` category's `gpt-6-luna-fast` rung gains `openai` like every other GPT rung there.

**`writing` is unavailable when none of its Claude models is connected, instead of running on another model.** ([#8723](https://github.com/code-yeongyu/oh-my-openagent/issues/8723)) The `writing` chain is Claude Fable 5.1, then Claude Opus 5.5, then Claude Opus 4.6. In the OpenCode edition, a machine without any of them still accepted `task(category: "writing")` and ran it on the session's default model. The installer went further: on an OpenAI-only setup it wrote `writing` as GPT-5.6 Sol, and on a setup with no matching provider it wrote the `opencode/gpt-5-nano` last resort. Now the OpenCode runtime refuses the lane with `Category "writing" has no available model`, and the installer leaves `writing` out of the generated config. OmO Native already treated the lane as unavailable. An explicit `categories.writing` model in `omo.json` still opens it.

## [5.0.0-beta.86] - 2026-09-23

### Changed

**ultrawork and the bundled skills verify behavior instead of mandating TDD.** ([#8719](https://github.com/code-yeongyu/oh-my-openagent/issues/8719))

The ultrawork directive (OmO Native, Codex, and every OpenCode variant), `programming`, `debugging`, `ulw-execute`, `ulw-loop`'s goal reference, the Hephaestus GPT-6 rule, and the root protocol no longer demand a failing test before every change. They read the tests that already cover the area as the behavior of record, reproduce a bug before fixing it, let the run on the real surface prove the change, and add a test only where the repository keeps tests for that behavior and a regression would otherwise pass unnoticed. Sessions stop producing tests that only restate a small change, and every rewritten surface is shorter than before.

**`deep-high` runs GPT-6 Astra at `xhigh`, and `deep-low` leads with GPT-6 Sol Fast.** ([#8714](https://github.com/code-yeongyu/oh-my-openagent/issues/8714))

The escalation lane `deep-high` still has one rung, GPT-6 Astra, and now runs it at `xhigh` instead of `high`. The default deep lane `deep-low` starts on `gpt-6-sol-fast`, GPT-6 Sol's Fast (priority) tier, at `medium`, on the OpenAI and ChatGPT subscription providers that serve that tier. It then falls back to plain `gpt-6-sol` at `medium`, so GitHub Copilot and OpenCode Zen, which do not offer the Fast tier, keep the lane. GPT-5.6 Sol is no longer a `deep-low` model: a setup that serves only GPT-5.6 Sol now reports `deep-low` as unavailable instead of running it there ([#8718](https://github.com/code-yeongyu/oh-my-openagent/issues/8718)). `ultrabrain` stays on GPT-6 Astra at `max`, and `unspecified-high` stays on Claude Opus 5.5 at `max` first. The configuration reference's provider-chain table, which still listed GPT-6 Astra as the first `unspecified-high` rung, now matches the shipped chain.

**`explore` and `librarian` run a six-rung chain, and every DeepSeek Flash rung is DeepSeek V4.1 Flash.** ([#8115](https://github.com/code-yeongyu/oh-my-openagent/issues/8115))

Both agents now fall back in this order: `kimi-for-coding-highspeed` (off), `gpt-6-luna-fast` (low), `deepseek-flash` (max), `qwen3.7-plus`, `minimax-m2.7`, `claude-haiku-4-5`. The two M3 rungs (OpenCode Go and the Coding Plan) and `gpt-5.4-nano` are gone, so an install whose only provider is that Coding Plan no longer gets a generated `explore`/`librarian` model from it. DeepSeek renamed its API model to `deepseek-flash` when V4.1 Flash shipped on 2026-09-10 and only routes the retired `deepseek-v4-flash` name to it temporarily; the pinned engine's `deepseek` catalog already lists `deepseek-flash` and no longer lists `deepseek-v4-flash`, so the old rung could not resolve on OmO Native. `explore`, `librarian` and the `quick` category now name `deepseek/deepseek-flash`, and the telemetry vocabulary reads the new id while still recognizing the old one.

### Fixed

**Claude subscription sessions run and advertise Claude Code 2.1.280 on every install.** ([#8713](https://github.com/code-yeongyu/oh-my-openagent/issues/8713))

Beta.85 still shipped Claude Agent SDK 0.3.278, whose bundled Claude Code 2.1.278 is older than the 2.1.280 that Claude Opus 5.5 requires. Installs made with `ignore-scripts=true` in `~/.npmrc`, or through a Bun install that blocked the package's postinstall, also skipped the step that raises the advertised version, so they kept sending `claude-cli/2.1.251`. The engine now pins the SDK at 0.3.280 and declares 2.1.280 itself. The first `omo` launch prepares an engine that install scripts never touched and records it in the engine directory, so later launches skip the work. If that preparation fails, `omo` prints the reinstall command and starts anyway. A newer Claude Code on your PATH (after `claude update`, for example) now runs instead of the bundled copy, and `CLAUDE_CODE_EXECUTABLE` still overrides both.

**`omob` can build an engine version before its workspace packages reach npm.** The development build now uses the dependencies already packed into its local engine tarball instead of asking Bun to resolve their unpublished versions from the registry. Platform-specific optional packages still install normally, and an incomplete bundle fails explicitly rather than fetching a replacement.

**CI update-checker tests no longer depend on sibling test order.** An unnecessary module mock leaked a fixed version into the registry-channel tests, failing all five assertions when the hook tests ran first. The hook now uses only its existing injected stub; runtime update behavior is unchanged. ([#8678](https://github.com/code-yeongyu/oh-my-openagent/issues/8678))

## [5.0.0-beta.85] - 2026-09-23

### Added

**GPT-6 Sol and GPT-6 Luna are supported models, and Hephaestus now runs on GPT-6 Sol.** Both tiers are registered with their published capabilities: a 1.05M context window, a 128K output limit, text and image input, no temperature, and a reasoning ladder of `none` through `max`. Hephaestus leads with `gpt-6-sol` at medium effort across OpenAI, OpenAI Codex, GitHub Copilot and OpenCode Zen, and keeps its previous `gpt-5.6-sol` medium rung as a fallback, so the agent still resolves on a provider that has not shipped GPT-6 Sol yet. The Fast service-tier ids `gpt-6-sol-fast` and `gpt-6-luna-fast` canonicalize to their base models the same way `gpt-6-astra-fast` already did. GPT-6 Luna is not a default for any agent or category and is available as a manual override.

### Changed

**The model profiles are now Capable and Deep work; Simple work is removed.** ([#8704](https://github.com/code-yeongyu/oh-my-openagent/issues/8704))

The profile picker lists `capable`, then `deep-work`. Capable starts on Claude Fable 5.1 at `xhigh` instead of `max`, then Claude Opus 5.5, Kimi K3 and GLM 5.3 at `max` as before. Deep work is GPT-6 Astra at `high`, then GPT-6 Sol at `medium`, and stops there instead of continuing to GPT-5.6 Sol. The `simple-work` profile no longer ships: a configuration that still sets `"model_profile": "simple-work"` shows the unknown-profile notice listing the remaining profiles and keeps the default model, and a `model_profiles.simple-work` entry you wrote yourself keeps working as your own profile.

**`deep-low` runs on GPT-6 Sol, and every Luna rung is GPT-6 Luna Fast.** ([#8701](https://github.com/code-yeongyu/oh-my-openagent/issues/8701))

The default deep lane leads with `gpt-6-sol` at `medium` across OpenAI, ChatGPT Subscription, GitHub Copilot and OpenCode Zen and keeps `gpt-5.6-sol` at `medium` as its fallback rung, so a registry that has not picked up GPT-6 Sol yet still opens the lane; `deep-high` stays Astra-only. Wherever a builtin chain, default or profile named `gpt-5.6-luna-fast` it now names `gpt-6-luna-fast` at the same `low` effort: the `quick` category, the `explore` and `librarian` agents, the OpenAI-only installer catalog and the installer's explore default. The `deep-work` profile picks up the new Sol rung, `gpt-6-luna` and `gpt-6-luna-fast` join the telemetry vocabulary, the post-compaction budget knows the GPT-6 Sol (400k) and Luna (922k) prompt budgets, and `gpt-6-luna-fast` has a capability entry so the model-capability guardrail no longer reports a built-in model missing from the snapshot. The docs, shipped example configs and the generated telemetry schema follow.

**Fable 5.1 chains step down to Claude Opus 5.5 before Kimi.** ([#8701](https://github.com/code-yeongyu/oh-my-openagent/issues/8701))

The `artistry` category and the `prometheus` agent, both led by `claude-fable-5-1`, now carry `claude-opus-5-5` at `max` as their second rung ahead of `kimi-k3`, matching senpi's own Fable 5.1 fallback ladder. `architect` is unchanged: it is hard-gated on Fable 5.1 and never falls back.

### Fixed

**Claude Opus 5.5 works on a fresh OmO Native install with a Claude subscription.** ([#8705](https://github.com/code-yeongyu/oh-my-openagent/pull/8705))

Every request to `claude-opus-5-5` on a subscription login was rejected with `400 claude_code_version_too_old` (`Claude Code 2.1.251 does not support this model; version 2.1.280 or newer is required`) and the turn fell back to Claude Opus 5, so the recommended Anthropic model never answered. The postinstall step that raises the advertised Claude Code version only rewrote the pi-ai module, while the launcher runs the engine's pre-linked `dist/bundle`, which carries its own copy of the version. The floor is now `2.1.280` and postinstall applies it to every declaration under `dist/bundle` as well, rewriting only the version string and never lowering one that is already higher. Thanks to youngminsw for the diagnosis and the fix.

**The Capable model profile no longer bills a Claude subscription user through OpenCode Zen.** ([#8704](https://github.com/code-yeongyu/oh-my-openagent/issues/8704)) On a machine logged in to a Claude subscription that also held an OpenCode Zen key, the Capable profile picked the metered `opencode` copy of Claude Fable 5.1, because the profile's Claude rungs never listed the subscription lane. Every Claude rung in the builtin profiles now tries the subscription first, the same order the delegation categories already use.

**A reasoning effort of `none` is no longer silently raised to `low` on GPT-6 models that support it.** Every model id containing `gpt-6` shared one capability rule, which was written for GPT-6 Astra and therefore mapped `none` onto `low`. GPT-6 Sol and GPT-6 Luna both document `none` as a supported effort, so anyone who configured the cheapest tier on those models was quietly billed and throttled at `low` instead, with the change recorded as `unsupported-by-model-family`. The Astra rule is now matched on its own id and keeps its documented clamp, while the rest of the GPT-6 family accepts `none`. A per-model capability override could not have fixed this, because family effort aliases are applied before capability metadata.

## [5.0.0-beta.84] - 2026-09-22

### Changed

**Claude Opus 5.5 is the Opus every default reaches for now, and it runs at `max`.** ([#8684](https://github.com/code-yeongyu/oh-my-openagent/issues/8684))

Every rung that named `claude-opus-5` now names `claude-opus-5-5`: the `visual-engineering`, `artistry`, `unspecified-high` and `writing` category chains, the Sisyphus, Oracle, Metis and Momus agent chains, the senpi-task category and builtin-agent tables, `unspecified-high`'s builtin config, and the Capable model profile. The rungs that ran at `xhigh` run at `max`, because that is the level Opus 5.5 is recommended at. Claude Opus 5 stays selectable and keeps its own prompt variant; it is no longer what you get without asking.

**The `writing` category chain is Fable 5.1, then Opus 5.5, then Opus 4.6.** ([#8684](https://github.com/code-yeongyu/oh-my-openagent/issues/8684))

`writing` ran Fable 5.1 at `low`, then Kimi K3 at `low`, then Opus 4.6 at `low`. It now runs Fable 5.1 at `low`, then Claude Opus 5.5 at `low`, then Claude Opus 4.6 at `max`, so prose work stays inside the Claude family end to end. The chain was declared in two places that had drifted apart - `model-core` and `senpi-task` disagreed on both the rungs and their levels - and both now read the same three rungs.

**A Claude Opus 5.5 session no longer introduces itself as Opus 5.** ([#8684](https://github.com/code-yeongyu/oh-my-openagent/issues/8684))

Opus 5.5 routes to the Opus 5 orchestrator prompt, which is right - the Opus 5 patterns carry over - but its self-knowledge block hardcoded the name and id of the earlier model, so the running model was told it was something else. The block now names whichever of the two is running. Telemetry gained the new id while keeping the old one, so a session on an older pinned engine is still recorded rather than masked to `custom`.

## [5.0.0-beta.83] - 2026-09-22

### Added

**`oh-my-openagent install --platform=native` now installs OmO Native for you, so you no longer have to know the package name or the recommended runtime.** `native` is a public platform now, listed in `install --help` and in the interactive picker beside OpenCode, Codex and Both. Choosing it performs the real install - `bun add -g omo-ai@beta` when bun is on PATH, `npm i -g omo-ai@beta` when it is not, with bun named as the recommended runtime - and then points you at `omo setup`. When the global install fails, the exact command to run by hand and the reason it failed are printed instead of a raw error. The in-repo development adapter keeps today's behaviour under `--platform=native-dev`, still gated by an environment flag (`OMO_ENABLE_NATIVE_DEV_PLATFORM`, and the old `OMO_ENABLE_SENPI_PLATFORM` is still accepted). ([#8618](https://github.com/code-yeongyu/oh-my-openagent/issues/8618))

**An OpenCode session can point you at OmO Native from inside the TUI.** The only pointer used to print at install time, which npm hides by default and which scrolls away for everyone else. A throttled toast on session start now names OmO Native and the install command, and `/native` in the command palette opens a dialog: install prints the command for you to run, or you can open the guide, be reminded in a week, or stop asking. The toast stays off when Native is already installed, when `native-edition-nudge` is in `disabled_hooks`, in a child session, and when the toast cannot record itself - a showing that cannot be remembered is skipped, so it cannot nag every session. Automatic showings stop after four, with widening gaps, and at most once per process. ([#8619](https://github.com/code-yeongyu/oh-my-openagent/issues/8619))

### Changed

**The `unspecified-low` category now runs on MiMo V2.6 Pro first, and its Grok rung moves to Grok 4.7.** ([#8652](https://github.com/code-yeongyu/oh-my-openagent/issues/8652))

`unspecified-low` is where delegated work lands when no specialist category fits and the job is contained. The chain led with Grok 4.6 at `xhigh`; it now leads with MiMo V2.6 Pro at `max`, served by Xiaomi or opencode-go, with Grok 4.7 at `xhigh` right behind it. Grok 4.7 is not served by the opencode provider, so that lane left the rung and opencode-go joined it. The rest of the chain - GPT-5.6 Terra, Claude Sonnet 5, Qwen 3.8 Max Preview, DeepSeek V4 Pro - is unchanged, and MiMo V2.5 Pro stays as the last rung.

**Write your harness block as `[native]` in `omo.json`, and delegate to the `omo-native-*` reviewers.** ([#8620](https://github.com/code-yeongyu/oh-my-openagent/issues/8620))

The standalone edition is branded OmO Native, but the block you write in `omo.json` to override settings for it was spelled `[senpi]`, and the reviewer agents you delegate to by name were `omo-senpi-code-reviewer`, `omo-senpi-qa-executor` and `omo-senpi-gate-reviewer`. Both spellings came from the engine's package name.

`[senpi]` keeps working. It is canonicalized when the config is read, so a config nothing can rewrite still applies every value it sets, and first launch rewrites the key in the file once and names it in a startup notice. A file carrying both blocks resolves `[native]` and reports the ignored one. A config that never mentioned `[senpi]` is not touched at all.

The reviewer agents now answer to `omo-native-code-reviewer`, `omo-native-qa-executor` and `omo-native-gate-reviewer`. The old names still resolve for one release line, so existing skills and AGENTS.md files keep working while you rename them.

The engine underneath OmO Native is still senpi and still called senpi. The `senpi` command, `@code-yeongyu/senpi`, `SENPI_CODING_AGENT_DIR` and the telemetry identifiers are unchanged.

**The catch-all `unspecified-high` category no longer runs on GPT-6 Astra.** ([#8616](https://github.com/code-yeongyu/oh-my-openagent/issues/8616))

Work lands in `unspecified-high` when no specialist category fits and the job is big, so that lane absorbs a large share of delegated turns. Its chain led with Astra at `high`, which put the most expensive reasoning model on the most generic lane.

The chain now starts at the rung that already sat behind Astra: Claude Opus 5 at `xhigh`, then GLM 5.3 at `max`, then Kimi K3 at `max`. The default written in the category config moves to Opus 5 with it, so the primary rung and the model a user reads in their config agree.

Astra stays where it was chosen on purpose: `ultrabrain`, `deep-high`, and the plan reviewer. Point the category back at a GPT-6 model in your own config and the child still gets the Astra-tuned prompt append.

**`quick` drops Kimi HighSpeed from its model chain, and the two search agents (`explore`, `librarian`) pick it up with thinking off.** ([#8616](https://github.com/code-yeongyu/oh-my-openagent/issues/8616))

Kimi HighSpeed led the `quick` chain and no other lane used it. The `quick` chain now starts at GPT-5.6 Luna Fast at `low`, followed by DeepSeek V4 Flash at `off`.

`explore` and `librarian` now lead with Kimi HighSpeed at variant `off`. The Kimi endpoint rejects an explicit disabled-thinking block, so senpi sends the request with no thinking parameter and the lowest adaptive effort, which is what a grep-and-report agent needs. A machine with no Kimi Code subscription falls through to Luna Fast, the model those two agents ran on before this change.

**The standalone edition is called OmO Native everywhere.** The installer hint, the package postinstall notice, the installation guide, the README and its four translations, and the `omo-ai` package description called it the "Senpi edition" - a name the product itself never used, having said `OmO Native` in the TUI footer and `Edition: Native` in `omo doctor` all along. The telemetry, model-profile and config-startup notices on that same screen opened with `omo-senpi`. They all say OmO Native now, and the hint names what you get: the same omo as one `omo` command, with no OpenCode host required, while the install you already have keeps working. `senpi` still names the engine, in `omo doctor`, in this file's engine headings, and in its own environment variables and paths. Telemetry identifiers are unchanged. A regression test fails if the old edition wording comes back. ([#8618](https://github.com/code-yeongyu/oh-my-openagent/issues/8618), [#8629](https://github.com/code-yeongyu/oh-my-openagent/issues/8629))

### Engine: senpi 2026.9.22-2

**A shared RPC host compiles one extension module generation per source version, not one per session.** Opening a session used to compile a fresh copy of every extension and leave it in the module registry for the life of the host, so a long-lived daemon retained another full graph each time. Sources are compiled once and reused until a source file changes; each session still gets its own extension instance. Measured on one machine, retained size per session fell from 74.6 MiB to 3.1 MiB. (senpi [#1952](https://github.com/code-yeongyu/senpi/issues/1952))

**Grok 4.7 is a supported model family.** Every grok-4.7 id shape - including aggregator ids like `openrouter/x-ai/grok-4.7` and Venice's dashed `grok-4-7` - reuses the Grok 4.6 system prompt, `grok-4.7` is a `promptPreset` value, and the xAI provider default moves from grok-4.5 to grok-4.7. (senpi [#1990](https://github.com/code-yeongyu/senpi/issues/1990))

**A hard OpenAI usage-limit 429 is terminal on the first failure.** `usage_limit_reached` / "The usage limit has been reached" used to classify as a transient rate limit, so a turn spent five retries over about a minute on an account that cannot serve another request until the quota resets. The same wording now pins a billing fallback for the rest of the session. Warnings that only approach the limit still retry. (senpi [#1969](https://github.com/code-yeongyu/senpi/issues/1969))

**Normalizing a tool call's arguments no longer rewrites the assistant message the model produced.** Two argument normalizers — the 80-character clamp on an eval cell's summary and the edit tool's rewrite of its `edits` list — used to change that message in place. On the `claude-sdk-oauth` lane that was the usual cause of `Session continuity lost - resent the full conversation (assistant_rewritten)`. They now run on a detached copy. The 80-character eval summary limit is unchanged: it is enforced on the rendered line. (senpi [#1472](https://github.com/code-yeongyu/senpi/issues/1472))

**A supervised RPC host whose supervisor loses its observer keeps reconnecting, and a host whose socket file is deleted drains and exits.** The supervisor retried a lost observer once and then gave up, which kept an idle window from ever elapsing because an unhealthy observer counts as busy; reconnects now continue until they succeed, and an observer that stays unhealthy for a whole idle window no longer counts as busy. Removing the workspace or deleting the socket used to leave the pair running until reboot; attached sessions finish, then the host exits. A host started as `persistent` still never exits for idleness. (senpi [#1979](https://github.com/code-yeongyu/senpi/issues/1979), [#1961](https://github.com/code-yeongyu/senpi/issues/1961))

**Opening a second terminal on a live Claude SDK session no longer throws away the resumable binding (the saved link that lets the next turn continue the conversation instead of resending it).** The startup notice it appends used to retire the binding, so the next turn re-sent the entire conversation as `registry_miss`. Append-only entries after the committed assistant keep the binding; a later assistant message, a compaction, a branch summary and an explicit invalidation still discard it. A fork point (the message the conversation branched from) that Claude Code reports missing is dropped instead of being requested again every turn. (senpi [#1964](https://github.com/code-yeongyu/senpi/issues/1964), [#1958](https://github.com/code-yeongyu/senpi/issues/1958), [#1973](https://github.com/code-yeongyu/senpi/issues/1973))

**A session whose worker dies while it is being opened now reports `open_failed` carrying the worker's reason**, instead of `session_closing`, which means a session somebody else is tearing down. (senpi [#1953](https://github.com/code-yeongyu/senpi/issues/1953))

### Fixed

**A DAG snapshot now carries what each node actually returned, and shows when a running node's child last did anything.** ([#8674](https://github.com/code-yeongyu/oh-my-openagent/issues/8674))

`workflow` tells you to detach and peek with `action=snapshot`, but the snapshot never carried a node's output. The text was being saved - it just was not reachable except through the blocking wait, so a run you were supervising showed six nodes with nothing to read, and the only way to learn what a child had done was to look at the files it wrote.

A settled node now carries `output` (the child's final message, up to 2000 characters) and `outputBytes` (its full size, so you can tell a truncated preview from the whole thing, and a node that returned nothing reads as `0` rather than as nothing recorded). A running node carries `lastActivityAt`, the last time its child wrote anything at all, and `snapshot` names any running node that has been silent for more than ten minutes. Silence is reported, never judged - one long tool call looks the same as a stalled child - but a node quiet for fifty minutes is now something you can see instead of something you have to guess.

The end time was already recorded, under the name `completed_at`. A node stuck in `running` because its child finished but was never reaped is a separate defect, tracked in [#8659](https://github.com/code-yeongyu/oh-my-openagent/issues/8659).

**A crashed reclaimer's stale sentinel can no longer wedge DAG lock acquisition on Windows.** ([#8671](https://github.com/code-yeongyu/oh-my-openagent/issues/8671))

Clearing a stale `.reclaim` sentinel renames and unlinks files that the host's antivirus or search indexer can briefly hold open; on win32 that surfaces as EPERM/EBUSY sharing violations that POSIX rename does not have. The quarantining rename threw the refusal raw, and the lock-wait budget — which resets only when the canonical holder changes — charged the reclaim's own I/O until acquisition timed out behind an unchanged dead holder. The rename now retries transient refusals the way the final unlink already did, clearing a stale sentinel republishes the reclaim mutex in place instead of handing a wasted poll back to the waiter, and a pass that cleared a sentinel resets the wait budget: the loop observes the sentinel's disappearance, not the clock. `LOCK_WAIT_TIMEOUT_MS` is unchanged and nothing is skipped on win32.

**A git that dies mid-command no longer hangs isolation work until its helpers exit.** `runGit` settled on the child `close` event, which fires only after every stdio pipe closes — but git's `!` alias shells inherit those pipes. On Windows, killing git alone (`TerminateProcess` has no tree semantics) left those shells holding every handle, so a run whose git had already failed stayed pending until the last survivor exited; in CI that raced the 30-second test budget and intermittently lost, with the survivor's locked working directory surfacing as an `EBUSY` on fixture teardown. A git that exits to a signal death or a disallowed exit code now settles at once: what remains of the tree is killed immediately, and pipes still held a second later are force-closed so the typed `GitCommandError` surfaces with the output kept so far. Normal commands are unaffected — their pipes close in milliseconds anyway. ([#8663](https://github.com/code-yeongyu/oh-my-openagent/issues/8663))

**A resumed DAG no longer shows nodes as running when nothing is running them.** ([#8657](https://github.com/code-yeongyu/oh-my-openagent/issues/8657))

Resuming a session re-adopted every DAG node whose child task record still said `running`, without asking whether anything in the resuming process still held that child. A child whose host went away is kept as `running` on purpose, so it can be reopened from its transcript later - but a DAG node waiting on one waits forever, because the run folds a node only when its child settles here. The node therefore stayed `running` in the run's saved state through restart after restart, with the work behind it blocked, and the widget kept counting hours on children that had died hours ago.

Such a node now fails at resume with a reason naming the task and why it cannot be reached, the nodes behind it skip as they would for any failure, and retry or send still revives it. A node whose child this session really does hold is reattached as before.

**Resuming a session that has DAG history no longer freezes the TUI.** Listing DAG runs parsed every checkpoint in the runs directory on each call, and the status widget asked for that list about once a second, so a resume - a burst of checkpoint writes - starved the screen while the process stayed alive and still answered prompts. The list now keeps a per-run summary cache. On a directory of 710 checkpoints, one call fell from 473 ms median to 3.4 ms. ([#8649](https://github.com/code-yeongyu/oh-my-openagent/issues/8649))

**DAG run history is pruned on the advertised 7-day retention.** The prune existed, was tested, and was called from nowhere, so checkpoints, event logs, results and keys accumulated forever. A long-lived project directory held 711 checkpoints, the oldest 25 days old against a 7-day policy. The sweep now runs once per DAG runtime after session start, off the start path so a stale file cannot fail the session, and indexes the keys and locks directories once per sweep. A paused run whose lease holder is still alive is kept. Against a copy of a 170 MB state directory the sweep cut 10,623 files to 1,779 and 170 MB to 38 MB. ([#8651](https://github.com/code-yeongyu/oh-my-openagent/issues/8651))

**Migrating a leftover `config.jsonc` writes `[native]`, and a `[native]` block gets the same reasoning cleanup as the old name.** First launch used to copy the retired harness key into the new file, so a later pass had to rename it. The leftover-file transform now emits `[native]`. Reasoning-key unification walks `[native]` as well as the old spelling, because that cleanup runs before the rename pass and a file already written with the documented name was being skipped. ([#8631](https://github.com/code-yeongyu/oh-my-openagent/issues/8631))

**A failed turn in a delegated task is no longer counted as a turn.** When a provider error ends an assistant turn, that turn now lands in a new `failed_turns` stat instead of inflating `turns`, and its usage - typically an all-zero block the provider sends alongside the error - contributes no tokens, no cost and no generation time. A run that never produced a successful turn reports token and cost coverage as `unavailable` and omits the cost field entirely, instead of claiming `turns: 6` for six consecutive failures. A successful turn that cost $0 keeps reporting a cost of 0, and a failure re-anchors the generation window so the next successful turn's throughput is measured from the failure, not from spawn. The live task row now tells the same story: it reads `starting` until the first successful turn lands - no phantom `turn 0`, no cost token - shows `failed N` with the verb `retrying` while provider attempts keep failing, and returns to `running` only after a real turn. Both the TUI status line and the background task row draw their stats tokens from one shared builder, so the two grammars cannot drift apart again. ([#8627](https://github.com/code-yeongyu/oh-my-openagent/issues/8627))

**The ulw-loop gate reviewer is enforced again on the Codex surface.** ([#8630](https://github.com/code-yeongyu/oh-my-openagent/issues/8630))

Renaming the reviewer agents to `omo-native-*` left the Codex-side ulw-loop guard (which checks that a gate reviewer only starts after a manual-QA artifact exists) matching only the retired `omo-senpi-*` spellings. Because the resolver (which maps a reviewer's old name to its new one before any check runs) canonicalizes a name before the guard sees it, the guard received a name it did not recognize and treated the spawn as ordinary work: the gate reviewer could start without a manual-QA artifact, and the per-reviewer no-progress cap stopped counting. Both checks apply again, and either spelling is recognized, so nothing that named the old reviewer breaks. The denial message and the spawn counter now name the reviewer that actually ran.

### Known issues

**One Windows-only test flake is not fixed in this release.** On a slow Windows CI runner, the DAG lock test in `senpi-task` (`store.test.ts`) can still fail with `Timed out acquiring DAG lock` when an earlier run crashed while it was clearing a lock. The fix ([#8672](https://github.com/code-yeongyu/oh-my-openagent/pull/8672)) ships in 5.0.0-beta.84. It changes only how that leftover lock file is cleared on Windows; nothing in this build behaves differently for users.

## [5.0.0-beta.82] - 2026-09-21

### Added

- The OpenCode edition now tells you the standalone Senpi edition exists. Finishing `oh-my-openagent install` — the interactive setup or `--no-tui` — prints a short pointer: omo also ships as a standalone Senpi edition with one `omo` command and no OpenCode host, installed with `bun add -g omo-ai@beta`, with a link to the installation guide. The package postinstall prints the same one-line notice. Installs that target the senpi platform itself do not get the pointer. ([#8593](https://github.com/code-yeongyu/oh-my-openagent/issues/8593))
- `@oh-my-opencode/isolation-core`, a copy-on-write task isolation PAL with baseline capture and merge-back. Filesystem backends — APFS clonefile, btrfs and ZFS reflink clones, fuse-overlayfs, ReFS block clone, and a git-worktree rcopy fallback — write only inside the supplied context base directory; an unavailable backend surfaces as a typed `IsolationUnavailableError` and falls through to the next candidate. Baselines capture staged, unstaged and untracked work under a per-repository budget, and merge-back replays it as a patch or a task branch without ever committing the user's overlapping WIP: a failed replay retains the isolated tree with a manual recovery command. A new Linux CI job exercises publication, copy-on-write and teardown on real loopback btrfs and ZFS. ([#8573](https://github.com/code-yeongyu/oh-my-openagent/issues/8573))

- **A delegated task can now run in a copy-on-write clone of your checkout.** Pass `isolated: true` to the task tool (or turn on `task.isolation.enabled`) and the child works in a clone instead of your working tree, so its edits cannot collide with what you are doing. When the child completes, its changes are merged back and the clone is removed; any other ending merges nothing and keeps the delta as a patch and a summary you can read. A merge that cannot apply cleanly leaves your files untouched, reports the conflict, and parks the clone beside its original with the exact `git apply --3way` command to finish by hand. A repository that cannot be cloned refuses the spawn instead of quietly using the real checkout, and if the host dies mid-run the next session salvages the clone's delta before reclaiming it. ([#8574](https://github.com/code-yeongyu/oh-my-openagent/issues/8574))

### Fixed

**A task that waits on the child it just spawned no longer deadlocks at the concurrency cap.** A task held its lane slot for its entire run, so spawning a child with `run_in_background: false` on a full lane left the child queued behind the very parent that was waiting for it, and the whole spawn tree stopped. The parent's slot is now parked for the length of the wait - outside lane and global room - so the child is admitted immediately, and the parent is re-admitted ahead of anything that queued while it waited. Promoting the child to the background re-counts the parent right away instead of making promotion wait, cancelling a parked parent releases its slot, and `task_output` reports whether a task currently holds or has parked its lease. ([#8575](https://github.com/code-yeongyu/oh-my-openagent/issues/8575))

**A sandboxed memory reflection now reads the same credentials as the session that started it.** The reflection sandbox granted the agent directory the adapter detected on its own, while the child asked the engine where its agent directory was - and the two answers differ whenever a project-local config directory, a brand prefix, or a second layout on the same machine is involved. The child then locked `auth.json` outside the grant, so a reflection died with `EPERM` on the credential lock and `No API key found`, while the parent stayed authenticated. The child now inherits the directory the engine resolved for the session: it is granted to the sandbox and pinned in the child's environment, so the reflection worktree it runs in cannot send it looking somewhere else. ([#8595](https://github.com/code-yeongyu/oh-my-openagent/issues/8595))

## [5.0.0-beta.81] - 2026-09-21

### Fixed

- Task child processes are reclaimed on session shutdown even when the closing context no longer exposes its session ID. Cleanup recovers ownership from that engine's resident handles, preserves resumable task records, and leaves sibling sessions alone. ([#8562](https://github.com/code-yeongyu/oh-my-openagent/issues/8562))

**A task child survives its daemon dying or dropping the connection.** A lost connection to the shared session daemon used to end every delegated child at once as `crashed (transport_gone)`, even though the child's session went on running on the daemon - or sat complete in its transcript after the daemon process itself died. The child now reconnects: it re-ensures the daemon, reopens the same session, and when the daemon still had the session the running turn simply continues over the new connection; when the daemon had to reopen the session from its transcript, the interrupted turn is re-prompted once to continue from where the transcript ends. Commands sent while the reconnect is in flight wait for it instead of failing. Only a daemon that never comes back ends the child as before. A daemon that refuses a new child because it is above its memory watermark (`host_memory_pressure`) is now a bounded wait for the retry hint it sends, never a reason to start a separate process. ([#8563](https://github.com/code-yeongyu/oh-my-openagent/issues/8563))

**The "Memory updated" notice shows the reflection report again.** The omo-senpi component logger wrote its info lines to stdout, and a reflection worker's stdout is the report, so the notice previewed `omo-senpi ulw-execute-continuation skipped { reason: "not-continuable" }` in place of the first lines of the report. Component diagnostics now go to stderr on every level. ([#8564](https://github.com/code-yeongyu/oh-my-openagent/issues/8564))

### Changed

**Native launchers no longer keep a redundant runtime alive on POSIX.** The Node-to-Bun handoff, engine launch and compiled runtime relocation now replace the launcher process with `execve`, preserving its PID and stdio. Windows and runtimes where replacement is unavailable or fails keep the existing signal-aware child fallback. `omo daemon attach` remains spawn-based. ([#8560](https://github.com/code-yeongyu/oh-my-openagent/issues/8560))

**Every direct dependency moves to its latest release inside its current major, and the security overrides move with them.**

`bun audit` reports one advisory row where it reported 43. The hono, fast-uri and express-rate-limit overrides now sit past their advisories, and `@hono/node-server` moved to the 2.1.1 the engine already asks for. Nothing in the tree needs a 1.x copy, so the old `^1.19.13` override was itself what held the package below the serve-static path-traversal fix. qs and ip-address gained overrides because the engine pins both to exact versions and no range refresh reaches the fixed releases; brace-expansion and browserslist needed none, since their existing ranges already cover theirs. What remains is one low-severity @babel/core file read, held in place by the exact pin @opentui/solid puts on it.

Then the sweep: vitest 4.1.11, @opencode-ai/plugin and sdk 1.18.31, opentui 0.5.11, zod 4.6.5, typebox 1.3.34, js-yaml 5.4.2, posthog-node 5.52.4, @clack/prompts 1.8.1, terser 5.51.2, puppeteer-core 25.11.0, yaml 2.9.1, @types/node 26.6.2 and biome 2.5.14 wherever they are declared, and in the web package react 19.3.0, three 0.186.0, tailwindcss 4.3.3, wrangler 4.135.0, next-intl 4.14.5 and the rest of its set. next, eslint and the ai SDK keep their majors; those belong to their own change.

Two generated artifacts moved with the versions. zod 4.6.5 writes a boolean-or-string union as a single type array instead of an anyOf pair, so both JSON Schema files were regenerated. And because the Senpi extension inlines zod, js-yaml and posthog-node into one non-split file, its bundle grew from 1,202,188 to 1,260,200 bytes; the size budget moved to 1,300,000 with the measurement written into the test comment.

**The frontend skill now refuses the coloured accent border.**

A selected row no longer earns a `border-l-2 border-primary` stripe, and a focused card no longer gets a primary-tinted outline — the skill names that pattern as the most recognizable AI-generated-UI tell and treats it as a defect, including instances that already exist on a surface it touches. State is expressed the way this repo's design systems already express it: washes of one ink, a check glyph for selection, tonal layering for focus. Keyboard focus rings stay coloured.

### Fixed

**LSP requests stop repeatedly launching daemon candidates when startup is deferred.** Each request makes one startup attempt and only probes on later retries. After a failed startup, the same client process waits five seconds before spawning another candidate for that endpoint; a reachable daemon is still reused immediately. Probes allow two seconds for a busy daemon to answer, and expected deferred startups produce one log line instead of a stack trace. Authentication, ownership and written-request replay rules are unchanged. ([#8561](https://github.com/code-yeongyu/oh-my-openagent/issues/8561))

**A session that reattaches to another host generation keeps its memory.** Your memory identity was derived from the directory the host process happened to be started in, not from the session's own workspace. One shared host serves sessions from many projects, so a host ensured from somewhere else handed its own identity to every session that reattached to it: the session was told `memory identity conflict: session is bound to <workspace>-<hash>, but config resolved server-<hash>`, and its memory tools went away while the workspace had not moved at all. Identity now comes from the session's own working directory, and a reattach that still disagrees rebinds to the identity recorded in the session and notes it in the log instead of stopping. The error is kept for the case it was written for: you pointed `memory.agent` at a different identity yourself. ([#8556](https://github.com/code-yeongyu/oh-my-openagent/issues/8556))

## [5.0.0-beta.80] - 2026-09-20

### Changed

**The engine moves to senpi 2026.9.20, and two long-standing TUI annoyances go with it.**

Provider network failures now collapse into a single retry status instead of printing their whole error payload on every attempt. The status updates in place, clears itself when the provider recovers, and stops claiming a failed retry when you cancel a turn. An exhausted chain leaves one notice with a next step, and partial answers and the stored error detail survive reopening the session.

Answering an `ask_user_question` card with the mouse no longer kills the keyboard. Clicking the option rows and the Submit line handed focus to the wrapper around them, which has no key handler, so every later keystroke went nowhere while output and tools carried on as usual. Focus now resolves to a component that can receive keys, and a focus change made by a click handler is no longer overwritten afterwards.

Picking a model the conversation does not fit into yet no longer discards the choice. The switch is held, your next message compacts first, summarized by the model that can still read the whole transcript and sized for the window it is moving into, and the new model takes over from there. An automatic fallback repairs a rung the same way instead of rejecting it, and Ctrl+P passes over only a model that could never serve the session. Fable 5 also has a default fallback chain again, and it stays in the Anthropic family: Opus 5, then Opus 4.8, then Opus 4.6.

Startup and session opens got faster. The `senpi` command was still booting an unbundled module graph, which took a real TUI launch from 6.3 s to 1.2 s. The shared host stopped rebuilding the same model catalog and re-resolving the same installed packages for every session, so a single open lands about 40% sooner and eight at once about 30% sooner. An open that waits behind other opens now reports its place in the queue as soon as the request is accepted, so a slow start can be told apart from a broken one, and each open is given its own deadline measured from when it was sent.

Also from the engine: Ctrl+V pastes in the published bundle again, skills shipped inside the packaged binary load instead of being dropped with a conflict warning, an extension's `import ... with { type: "file" }` returns a path again, sending `.` resumes a blocked goal, pending questions survive a reload without resetting their deadline or answering twice, and reopening a session file joins the existing session instead of starting a second one on top of it.

**A managed `omob` launch spends about half as long before the engine starts, and an omo-only rebuild finishes about a third sooner.** The launcher ran a refresh check before it execed the engine, and that check cost more than the engine's own startup: the `senpi` and `omo` cache clones were fetched one after the other, each clone answered the same question with four git processes, and the installed binary was spawned purely so the check could read its `--version`. The two fetches now run together, a single `git log` answers both the commit and its date, and the version comes from a provenance marker written beside the executable. The marker records a sha256 of the bytes it describes, so it is believed only while it still describes the file on disk, and a missing, stale, malformed or mismatched marker falls back to spawning the executable as before. Measured pre-exec overhead: 1287.7 ms to 649.8 ms. Separately, every `omob` build produced the Senpi plugin payload twice, because `bun install` in the cache clone ran the whole product graph while the binary embeds only what the native build step produces itself. The build graph now accepts a profile naming the nodes a consumer needs, which takes an omo-only rebuild from 15.27 s to 9.53 s across 17 graph nodes down to 3. With no profile the graph is unchanged, so `bun run build`, publish and CI still build what they built before. ([#8521](https://github.com/code-yeongyu/oh-my-openagent/issues/8521), [#8522](https://github.com/code-yeongyu/oh-my-openagent/issues/8522))

**`deep` is now two lanes, and the cheaper one is the default.** The old category announced itself as MANDATORY for backend, logic, algorithms, browser use and multimodal work. Almost every coding task matches that list, so almost every delegated task ran on `gpt-6-astra` at high reasoning, and the `gpt-5.6-sol` rung beneath it was reached only when no Astra was connected. The lane you get is now decided by capability instead of by domain. `deep-low` (`gpt-5.6-sol` medium) is the default and takes any goal whose decisions the child can settle from what it reads. `deep-high` (`gpt-6-astra` high) takes a goal whose central decision cannot be settled that way: a trade-off with no single right answer, a contract change crossing a package or process boundary, a mechanism with no pattern in the repo to copy, or correctness that has to be argued from invariants. Breadth alone does not qualify; wide but mechanical work stays in `deep-low`. The domain list moved to the caller-facing `deep-low` description, where the routing choice is actually made, and left the child prompts, which never chose a category. A `deep-low` child that runs into one of those decisions stops before editing and returns `ESCALATE: deep-high` with what it read and the options it saw, and the caller re-spawns the same brief on the escalation lane. Each lane is one rung gated on its own model, so a machine missing Astra loses `deep-high` instead of quietly getting Sol under that name. ([#8516](https://github.com/code-yeongyu/oh-my-openagent/issues/8516))

**The writing category runs at low reasoning and keeps a Claude fallback.** The builtin `writing` chain led with `claude-fable-5-1` at medium and fell back to `kimi-k3` at max, so prose delegation paid a reasoning budget it does not need, and a Fable outage moved every writing task onto a max-variant Kimi run with no Claude rung left. The chain is three rungs at low now: `claude-fable-5-1`, then `kimi-k3`, then `claude-opus-4-6`. ([#8525](https://github.com/code-yeongyu/oh-my-openagent/issues/8525))

### Deprecated

**The `deep` category name, with nothing for you to do.** If your `omo.json` configures `categories.deep`, the first launch renames it to `categories.deep-low`, along with `deep` used as a team member's category or as the memory reflection category, in the base block, in `[senpi]`/`[opencode]`/`[codex]`, and inside every profile. A config that never mentioned `deep` is not touched at all: no rewrite, no backup file, no migration marker. A file the rewrite cannot reach, because the run is locked or the file is read-only, still works, because the name is canonicalized when the config is read and a startup notice names the key to rename. `task(category: "deep")` from a skill or an AGENTS.md still runs, on `deep-low`. ([#8516](https://github.com/code-yeongyu/oh-my-openagent/issues/8516))

### Fixed

- A machine that cannot persist its telemetry stamp no longer reports itself active on every launch. The daily-active gate read the stamp, wrote it back, and decided from the read while swallowing any write failure, so an unwritable state directory reported a new active day indefinitely, and several processes starting at once on a fresh day each reported one. The decision is now the result of an exclusive file create, so exactly one caller per UTC day proceeds and an unwritable directory is capped at one report per process. Event names, properties and identity derivation are untouched, and a day already stamped still returns without writing anything. ([#8519](https://github.com/code-yeongyu/oh-my-openagent/issues/8519))

- The memory pressure advisory counts the text your model is actually shown again. A recent change estimated from the sizes git stored, which reads low for any `system/` file holding invalid UTF-8 and reported no pressure at all when the repository could not be read; both are restored, and the estimate is still computed once per commit rather than once per prompt.

- `omo doctor` sees your running sessions again. It recognised engines by one spelling of their command line, and the launcher stopped producing that spelling when it moved onto the engine's pre-linked bundle, so the stale-session report and its reap command had been looking at an empty list on current installs.

- The reminder that your soul files changed no longer re-reads the whole memory history to find out. It asked git for every commit since the last notice that touched `system/`, which on an identity with thousands of commits costs most of a second on every prompt; it now reads a page and only looks further when that page is entirely memory-tool writes. The notice it produces is the same one.

- Every prompt in a directory with a memory identity re-read the same files from git. The memory pressure advisory listed the repository tree and read each `system/*.md` blob again on every turn, and the save reminder asked git for the entire commit history and searched it here. Both answers only change when the memory repository gains a commit, so both are now derived once per commit: five fewer git processes per prompt, and a megabyte of commit history that no longer crosses the process boundary on a repository with three thousand commits. What the model receives is unchanged.

**A detached task session no longer crashes the host during heartbeat or shutdown.** State polling
now catches synchronous connection errors, and shutdown stops polling before dropping the
connection. A failed abort is logged without preventing the child from closing.
Child-process heartbeat calls have the same protection, and disposal observes and logs a failed
detach instead of leaving an unhandled rejection.
Thanks to @ayden94 for the heartbeat fix.
([#8494](https://github.com/code-yeongyu/oh-my-openagent/issues/8494))

**The architect nudge follows the refusal now, not one model id.** When a model refuses a turn and the session falls back, omo injects a hidden directive telling the agent to route the hard parts to `task(category: "architect")`. It armed only when the refusing model was `claude-fable-5`, so a session on `claude-fable-5-1`, which is the model the architect category itself runs, never saw it. Any refusal-driven fallback arms it now, and the directive no longer calls the consultant the model that just refused unless it is. ([#8513](https://github.com/code-yeongyu/oh-my-openagent/issues/8513))

**Writing memory no longer steals focus on Windows.** Every `memory` tool write auto-commits, and each git command behind it spawned `git.exe` with no `windowsHide`, so Windows built a fresh console window and brought it to the front. The lock protocol's start-time probe did the same with `powershell.exe`, and on a Node runtime it did it on every probe. That probe falls back from an in-process kernel32 reader reached through `bun:ffi`, which Node cannot import, so the visible fallback was the normal path there. Both spawns are hidden now, along with the formatter, the worktree-root lookups and the init-deep git probes that flashed the same way. The interactive launcher keeps its console on purpose and says so at the call site. ([#8501](https://github.com/code-yeongyu/oh-my-openagent/issues/8501))

## [5.0.0-beta.79] - 2026-09-19

### Fixed

**Task children can use providers installed through configured packages.** Process-mode children
now inherit the package extensions actually loaded by the parent, so providers such as glm-zcode
and commandcode are available when a task resolves its model. Every child-launch path resolves the
same list, so a revived child keeps the provider it started with, and team members and pool workers
get it too instead of only a first spawn. ([#8492](https://github.com/code-yeongyu/oh-my-openagent/issues/8492))

**A task that cannot serve its model now says so.** A `task({ category })` spawn whose model was missing from the child's own profile died with `Task runner failed to start.` and nothing else. The admission probe knew the real reason and said it plainly, but the manager mapped only four failure kinds to a message and `model_unavailable` was not one of them, so the useful half never reached the caller. The reason now travels as a closed set of parent-authored codes rather than as text, which is what makes it safe to show: the child's stderr stays out of every record and tool result, and the caller gets a sentence that names the cause. ([#8492](https://github.com/code-yeongyu/oh-my-openagent/issues/8492))

**A category with four spare models stops giving up on the first one.** A category resolves to a chain, but only the leading entry was ever attempted. When admission refused it, the spawn failed outright and the remaining entries were never tried, even when the next one was a built-in provider that would have worked. In a graph run that also skip-cascaded every dependent node. A refusal that means "this child cannot serve this model" now walks to the next entry in the chain; every other kind of start failure still fails immediately, because it would repeat identically on the rest of the chain. ([#8492](https://github.com/code-yeongyu/oh-my-openagent/issues/8492))

## [5.0.0-beta.78] - 2026-09-19

### Engine: senpi 2026.9.19-2

**Goal-driven sessions compact before the wall.** A session running under a goal loop had every one of its turns started by the goal extension, and those turns skipped the compaction extension's proactive policy entirely: nothing compacted between the 80% threshold and the hard reserve valve at 96% of the window, the idle warm summary was never applied, and the turn that finally crossed the valve paid a from-scratch summarization while the screen sat on `Compacting...` for five to eight minutes. On a 1M-token model that looked like omo hanging. Hidden trigger turns now pass through `before_agent_start` the way a typed prompt does, so the proactive policy and the warm summary apply to them too (senpi#1329).

## [5.0.0-beta.77] - 2026-09-19

### Engine: senpi 2026.9.19

**Extensions that pull in jsdom or whatwg-url load again.** The engine's extension loader wrapped every CommonJS dependency in a prologue that declared `exports` as a constant, so a module written as `module.exports = exports = { ... }` (the published shape of `whatwg-url/lib/utils.js` and jsdom's generated IDL utils) failed to parse and took the whole extension graph down with `This assignment will throw because "exports" is a constant`. pi-webfetch was the reported casualty. CommonJS now evaluates inside Node's module function wrapper, the per-file `require` carries a `resolve` that returns the file's absolute path (jsdom locates its XHR sync worker that way), and a module inside a require cycle receives the partially built exports of the module still evaluating instead of `undefined`, so `@acemir/cssom`'s mutual requires resolve. A dependency whose body throws is evicted, so a later require re-throws instead of returning a half-built module, and `.mjs` / `.mts` files stay on the ESM path even without import or export statements.

### Fixed

**A repeat omob build no longer ships the previous build's engine copies.** The reusable senpi cache clone kept the publish staging that the last build wrote into its workspaces, and the bundler resolved the agent core from that stale copy instead of the commit being built. Once the engine gained an export that copy lacked, every refresh failed with `No matching export ... for import "prepareReadFolder"` and the launcher refused to start; before that, it silently bundled a three-day-old agent core. The staging is now discarded before every install. ([#8477](https://github.com/code-yeongyu/oh-my-openagent/issues/8477))

## [5.0.0-beta.76] - 2026-09-19

### Engine: senpi 2026.9.18-6

**A published install can start its daemon again.** Every release from 2026.9.18-4 onward shipped a bundle that could not start a shared host at all: the bundler emitted no `host-lifecycle` entry, so the deferred import resolved to a chunk nobody wrote, and once that was fixed the launcher spawned the emitted chunk itself - a module, not a program - which returned without ever listening. `host ensure` answered `exited with code 0 before answering get_protocol_info`, and the daemon's stderr log was empty because it is truncated on every generation start, so nothing was left to read. Bundled builds now re-enter the CLI through the same internal route compiled binaries use, and the CLI entry comes from the package's declared `bin` rather than from counting `..`, which lands on the package root once the module is bundled.

**The engine pin moves as one.** The senpi version is declared in four manifests plus their peer dependencies and resolutions; advancing only the root resolves two copies at once and produces a type error that reads exactly like a breaking API change but is not. They now move together, and the lockstep test that catches a half-applied bump moves with them.

## [5.0.0-beta.75] - 2026-09-18

### Engine: senpi 2026.9.18-4

**Kimi K2.8 Preview gets the Kimi prompt.** Moonshot rolled K2.8 out across Kimi Code on 2026-09-11 and upgraded the `kimi-for-coding` model id in place, so every Kimi Code session has been served by K2.8 while omo matched no Kimi rule for it. Both lanes now route it to the Kimi K2.7 prompt: the engine gains a `kimi-k2-8` preset that renders the K2.7 prompt verbatim apart from the model name it announces, and the opencode side sends K2.8 to the same prompt across Sisyphus, Sisyphus Junior, Atlas and Metis, where an unmatched Kimi id used to fall through to the K2.6 one. K2.8 is an efficiency and context upgrade inside the same K2 coding family, and the prompting contract is unchanged, so it shares the prompt instead of getting a copy that would drift. Moonshot's model table still lists `kimi-for-coding-highspeed` as K2.7 Code HighSpeed, so that id resolves to the K2.7 prompt too. The version-tagged shapes land there as well: `moonshotai/kimi-k2.8`, the `k2p8` shorthands, and a catalog row whose display name says `Kimi K2.8 Preview`. You can still force any of it with `promptPreset`, which now accepts `"kimi-k2-8"`. ([#8466](https://github.com/code-yeongyu/oh-my-openagent/issues/8466), senpi [#1826](https://github.com/code-yeongyu/senpi/issues/1826))

**A busy daemon keeps its sessions.** An ensure used to end a host that missed the protocol probe budget, which on a loaded machine meant killing a daemon that was answering fine and taking every live session with it. A host whose socket still accepts connections is now refused as `host_busy` instead of replaced.

**Releases stop losing a hand-shipped provider.** When models.dev stops describing a provider the fork ships itself, a catalog regeneration used to drop it out of the built-in catalog entirely. `kimi-coding` is now owned by the fork the way `devin` already was, so it survives a regeneration that upstream no longer covers.

## [5.0.0-beta.74] - 2026-09-18

### Engine: senpi 2026.9.18-3

**Agent-directory extensions load reliably on Windows.** An extension discovered in an agent directory could fail to start with `Cannot find package 'runtime'`, and did so on every Windows shard for three releases. The engine's loader served that import from a virtual module registration that intermittently stopped answering Bun's resolver under a loaded parallel test shard; it now resolves to a real file and keeps the virtual route only for compiled binaries, where no file exists to point at.

## [5.0.0-beta.72] - 2026-09-18

### Engine: senpi 2026.9.18-2

**omo boots again on Bun 1.3.x.** Every build since beta.69 crashed at startup there with `webidl.util.markAsUncloneable is not a function`, TUI and headless alike. The engine's bundled `undici` creates a `CacheStorage` at module init, and that constructor reaches for `worker_threads.markAsUncloneable`, which Node added in 23 and Bun 1.3 does not have. The bundle prologue now installs a no-op when the runtime lacks it; nothing in the engine ever used `caches`. (senpi [#1806](https://github.com/code-yeongyu/senpi/issues/1806))

**Devin and Cursor login work again.** Both failed with `Cannot find module .../dist/bundle/chunks/devin.js`. The engine reaches each provider's login flow through a relative import the bundler cannot see, so it ships those flows as sibling files next to the chunk that loads them; the Devin and Cursor flows, and their two provider streams, had been left off that list while the other seven providers were on it. They ship now, and the engine's bundle smoke test starts a login for six providers under Node and Bun on every build. (senpi [#1810](https://github.com/code-yeongyu/senpi/issues/1810))

**One command now gets you the shared engine daemon.** `senpi host ensure|status|stop|handoff` reads a launch spec, probes what already serves the socket, and reuses it, starts one, hands off to a newer generation, or refuses with a named reason. Every invocation prints one JSON line and reports the outcome in its exit code, so a terminal, a desktop, and a task runner all reach a daemon the same way instead of each re-implementing the decision. The launch spec is a file, not stdin or argv, because a machine-wide daemon needs an owner to check: it is refused when not owned by the current user, when group- or world-writable, when an extension path escapes the spec directory, or when it sets an environment key outside the allowed set. (senpi [#1812](https://github.com/code-yeongyu/senpi/pull/1812))

**Extensions can import named bindings from CommonJS packages.** `import { Readability } from "@mozilla/readability"` (and `jsdom`, and anything reaching `tldts` through `tough-cookie`) failed to load with `Export named 'X' not found in module 'senpi-extension:...'`, though the same line works in plain Bun and Node. The loader wrapped CommonJS as `default`-only; it now rewrites named, aliased, and namespace imports of a CommonJS target to bind off `module.exports`, which is the semantics CommonJS has anyway. `pi-webfetch` loads. (senpi [#1807](https://github.com/code-yeongyu/senpi/issues/1807))

### Fixed

**The memory reconcile pass no longer replays a settled reflection run on every launch.** A run directory whose durable completion record already existed could never be re-settled byte for byte, because the rebuilt record folds in launch-dependent values (the current failure streak, the clock when the ledger has no `finalizedAt`). The strict comparison threw before `final.json` landed, so every bind logged `memory bind-time reconcile failed: Reflection completion record mismatch for reflection-run-1` and tried again next time. Settlement now adopts the existing record and finishes the terminal artifacts, so the directory turns terminal after one pass. ([#8437](https://github.com/code-yeongyu/oh-my-openagent/issues/8437))

## [5.0.0-beta.71] - 2026-09-18

### Engine: senpi 2026.9.17-4

**Downstream builds can bundle the engine again.** `ws` ships two optional native accelerators, `bufferutil` and `utf-8-validate`, and both reach their bindings through `node-gyp-build`'s computed require, which a bundler cannot follow. Any consumer that had them installed failed with `Bundle left unexpected external imports: <runtime>`; senpi's own CI never saw it, because neither package is installed there and `ws` quietly falls back to pure JS. They are now marked external. (senpi [#1804](https://github.com/code-yeongyu/senpi/issues/1804))

## [5.0.0-beta.70] - 2026-09-17

### Engine: senpi 2026.9.17-3

**The published engine ships its tree-sitter assets again.** senpi's publish staging copied a bundled workspace's `dist` but not its `assets`, so the tarball carried compile-time `type: "file"` imports pointing outside the package. Any consumer bundling it with `bun build --compile` — omo's own release binaries included — failed to resolve them. (senpi [#1800](https://github.com/code-yeongyu/senpi/issues/1800))

**Cold startup reaches ready in under a second; warm in under 900 ms.** Three rounds of profiling cut cold time-to-ready from 5.8 s to 850 ms and warm from 1.5 s to 886 ms on a loaded host. The banner-to-spinner wait (the gap where nothing is on screen) fell from 4.6 s to 175 ms cold and from 550 ms to 177 ms warm. The last round found that MCP server attach consumed 255 ms of a 292 ms serial `session_start` dispatch on a real config (0.2 ms with no servers configured); it now starts past the first frame and the first turn still carries the full tool set. The auto-theme detection no longer repaints on every launch: the detected background is persisted and seeds the next start. The app-server MCP inventory stays current after deferred attach through a wire-status subscription. Managed-tool detection uses PATH stats instead of process spawns. The model runtime and resource loader run concurrently instead of in sequence. Measured same-commit for the final round: time-to-ready 1,014 to 797 ms (n=10 interleaved). The cross-version headline compares installed beta.68 against current dev, not only this work. ([#8412](https://github.com/code-yeongyu/oh-my-openagent/issues/8412), senpi [#1781](https://github.com/code-yeongyu/senpi/issues/1781))

**`$skill` mentions expand on submit.** A bare `$name` is now executable when it names a loaded skill. Chained skill blocks appear in the session export. (senpi [#1778](https://github.com/code-yeongyu/senpi/issues/1778))

**A shared-host RPC session can be retained across its last client's disconnect.** `open_session` accepts `retain_on_disconnect`; the next `open_session` with the same id reattaches. (senpi [#1776](https://github.com/code-yeongyu/senpi/issues/1776))

**The bundled CLI runs under custom exec arguments again.** A launch carrying a profiler or inspector flag replays those arguments onto a copy of itself instead of spawning a sibling the bundle step had dropped. (senpi [#1785](https://github.com/code-yeongyu/senpi/pull/1785))

**JS eval kernel: a cell that would shadow a platform global is rejected before execution.** (senpi [#1786](https://github.com/code-yeongyu/senpi/pull/1786))

**Claude-sdk-oauth re-login refreshes the blocked slot** instead of appending a duplicate. Stored credential-pool blocks are bound to a credential revision. (senpi [#7084](https://github.com/code-yeongyu/oh-my-openagent/issues/7084))

**Compaction summarization retries without the reasoning override after an empty stop.** (senpi [#1773](https://github.com/code-yeongyu/senpi/issues/1773))

**RPC socket host: session-event credit on queue acceptance, 30 s dead-peer stall budget, observable cut notice.** (senpi [#1774](https://github.com/code-yeongyu/senpi/issues/1774))

### OmO

**Startup work that nobody waits for no longer runs before the first paint.** Three pieces of the omo-senpi plugin ran on the path the user waits through before the prompt appears, and none of them is observable before the first turn: the init-deep advisor spawned `git rev-parse` and stat'd the onboarding marker from its `session_start` handler just to decide it was ineligible (12.4 ms warm, 20.6 ms cold), the OmO-native session telemetry read the model inventory, loaded omo config twice and built its PostHog client on the same dispatch path (1.8 ms warm, 14.2 ms on the first session of a UTC day), and the LSP component built its mutation formatter - an omo-config read plus a formatter-marker scan - while it registered, for a step only a `tool_result` can reach. The advisor and the telemetry capture now run on the first post-paint edge (`input` / `before_agent_start`, or a 750 ms backstop), the formatter is constructed on the first mutation tool result, and the legacy telemetry product config no longer reads the package manifest at module scope. Tool, command, flag and hook registration is untouched: the engine's tables are complete before the first prompt exactly as before. Measured through a real senpi launch with the plugin (15 interleaved ABBA rounds): `interactiveMode.init` 97 ms to 84 ms median, 83 ms to 69 ms min; the plugin's `factory` row is unchanged at 37 ms. ([#8412](https://github.com/code-yeongyu/oh-my-openagent/issues/8412))

### OmO

**Subagents now run on the shared engine daemon by default.** `task.default_execution_mode` ships as `auto`: the first subagent of a session asks the machine's engine daemon whether it can host children, and from then on that session's own-process subagents are sessions of that daemon instead of new engine processes. The question is asked once per session, so a daemon that goes down later never changes how the next subagent runs, and the answer is always conservative - Windows, a daemon that lacks the features this build needs, or `task.process_runner: "child-process"` all keep the one-process-per-child behaviour, and the reason is reported once in `task_output` as a `host_unavailable:<reason>` note. Anything you set yourself still wins: `in-process` or `process` in `omo.json` is honoured without even contacting the daemon, per-agent overrides are unchanged, and the curated read-only agents (explore, librarian, plan-consultant, plan-reviewer) stay in-process regardless. Two new settings come with it - `task.process_runner` to pick the runner outright and `task.host_engine_policy` to say whether a daemon running a different engine build is handed over or left alone - plus `task.host_idle_exit_ms` for the idle lifetime of a daemon this client starts. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**One plugin now serves many sessions without leaking one session's role into another.** Because every subagent of the daemon shares one loaded plugin, each component decides what it is from the session it was loaded for rather than from process-wide environment variables: a DAG node's child no longer gets the task tools it was never meant to have, a team member loads only the member surface and takes its identity from the session, machine hygiene sweeps run only in the session you launched, and a member keeps a wake signal up for as long as its team run is live so the engine never parks it mid-message. Subagents that run as their own process are unaffected - they still read the same environment variables they always did. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**Subagents hosted by the shared engine daemon now survive the things that used to lose them.** Quitting a parent detaches from its children instead of stopping them, and resuming reattaches to the sessions still running rather than replaying their prompts. Cancelling one closes its session on the daemon instead of signalling a process it does not have, and a parked child stays reachable: sending it a message reopens its transcript and delivers, where it previously refused as "not continuable". When the daemon is replaced by a newer build, children whose session is still being handed over wait for it and reattach instead of being marked lost; when the daemon disappears entirely, they are parked and retried three times before `task_output` reports "suspended (daemon unavailable)" - never lost, and never a signal to a pid that belongs to no child. Subagents that run as their own process are unaffected. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**Compiled omo binaries now carry the engine's build identity.** An omob (dev) binary compiles in the engine commit's unix epoch and short sha, so `omo --version` prints `+<epoch>.<sha7>` and scheme `epoch`. A release binary derives the same pair from the pinned engine package's `gitHead` and commit timestamp when that metadata is present; when it is not, the defines are omitted and `--version` reports scheme `nodef`, which never initiates a generation handoff. The epoch is never invented from the clock. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

### OmO

**Task children can join one shared engine daemon instead of each starting their own.** omo now carries the client half of that attach-or-create: it probes the machine's public engine socket, asks the engine whether the running host may be reused, upgraded by handover or must be refused, and only then asks the engine to ensure it. The daemon's command line and environment come from ONE place - the launch profile shipped beside the plugin - so a daemon started by `omo daemon run` and a daemon a task child triggers are byte-identical, and the shared name list for the socket is now read by both the task runner and the thread tools instead of being spelled out twice. Nothing here starts a second host beside a daemon it may not use: an incompatible protocol fails fast, while exactly four conditions fall back - loudly - to today's one-process-per-child runner (a daemon missing a capability this build needs, an engine the caller asked to fall back from, Windows, and a Node runtime with no bun, where a shared host cannot reap the children a terminated session worker leaves behind). An ensured daemon is trusted for five seconds before the socket is probed again. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**Every daemon-hosted child talks to the engine over its own connection.** A child never shares a connection with a sibling: it asks the daemon who it is before opening anything (recording which engine build and which host process is serving it, and falling back - loudly - to the one-process-per-child runner when that daemon lacks the per-session features this build needs), then opens its own session, marked as a background worker, kept alive across a disconnect and never auto-titled. On that connection the child ignores anything addressed to another session, answers any interface prompt with an immediate safe decline so a headless child never waits on a human, and reports the three ways a session can end apart - the daemon parked it, the daemon closed it (with the reason), or the connection itself was lost - instead of calling all of them a crash. A session file another owner still holds is reported as exactly that, with how long to wait, and is never retried behind the caller's back. Leaving a child running while its parent goes away (detach) and ending it for good (close) are now distinct operations. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**Process-mode subagents can now run as sessions of that shared daemon.** When a task child is started in its own-process mode, omo asks the machine's daemon to host it first: the child becomes a background session of that daemon - opened at its own transcript file, in its own working directory, on the model and thinking level the parent resolved, tagged with what it is (a plain child, a DAG node's child or a team member), kept alive across a disconnect and never auto-titled - instead of a brand-new engine process. A child resumed after its parent went away re-joins the session it left, or reopens it from its transcript, and is never asked to redo work it already started: the first prompt is sent only for a genuinely new child, and a resume never rewrites which transcript the session is on. When the daemon cannot host a child for one of the reasons the engine marks as fallback-allowed - a daemon missing a capability this build needs, an engine the caller asked to fall back from, Windows, or a Node runtime with no bun - the child runs on today's one-process-per-child runner instead and the reason is reported once per parent; every other refusal fails that child rather than quietly starting a second engine beside the daemon. A model the child's own profile cannot resolve is still refused before the daemon is contacted at all, and a child whose very first prompt is refused takes its session down with it (stop the turn, close the session) instead of leaving an orphan session on the machine. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

**A child that lives on the shared daemon is steered, cancelled and ended like any other subagent - without a process to kill.** Messages sent to it queue behind a running answer instead of interrupting it, an explicit stop is reported as a cancellation rather than a failure, its last answer is tracked the same way, and a periodic liveness check keeps its record fresh. What changes is the ending: such a child has no process of its own, so omo never records a process id for it and never signals anything - cancelling asks the engine to stop the turn and then to close the session, each under its own time budget, so a silent daemon can never hold a shutdown open. The ways a session can end are now told apart: one omo closed is a clean finish, one omo cancelled is a kill, a daemon that shut down or a connection that dropped is a crash that keeps the reason, a session that never opened is a startup failure - and a session the daemon merely suspended, because it sat idle or because an upgrade handed it over, is not an ending at all: the child keeps its status and wakes on the next message. ([#8415](https://github.com/code-yeongyu/oh-my-openagent/issues/8415))

### OmO

**Adopts senpi 2026.9.17.** That release carries the engine startup work tracked in code-yeongyu/senpi#1781: the published package now ships a pre-linked bundle that the launcher prefers, TypeScript extensions are imported through Bun's native transpiler on any bun runtime instead of jiti, the terminal PTY package and the MCP SDK load on first use instead of at every boot, command- and mode-only module graphs are deferred to their branch points, and directory-scan migrations are skipped once a marker records them. Measured on an Apple Silicon workstation through the real launcher and plugin, interleaved against the previous engine: banner to spinner 1,209 ms to 196 ms warm and 4,608 ms to 560 ms cold, time to ready 6,197 ms to 1,986 ms cold, and the extensions phase 800 ms to 409 ms cold. ([#8412](https://github.com/code-yeongyu/oh-my-openagent/issues/8412), [senpi#1781](https://github.com/code-yeongyu/senpi/issues/1781))

### OmO

**Session startup stops walking the whole memory root.** A boot profile attributed about 190 ms of synchronous `statSync` time to the memory component, and instrumenting the filesystem boundary during a real boot showed it issuing 3,787 filesystem calls before the first turn: the registration-time transient sweep computed the *newest* mtime of every repo-less identity tree although both callers only compare it to one cutoff, and the session-bind filesystem policy enumerated its denied roots eagerly for metadata that nothing reads at bind time. The age probe now stops at the first mtime that proves a tree active, and denied roots are resolved when a host first reads them. On a 158-identity agents root that is 3,787 filesystem calls down to 405 (synchronous existence checks 328 to 171, `lstatSync` 58 to 9, `realpathSync` 53 to 4, async `stat` 2,214 to 129, async `readdir` 1,074 to 33), the isolated sweep drops from 70.1 ms to 2.2 ms and policy registration from 1.4 ms to 0.1 ms, every verdict unchanged. On a warm cache at this scale the startup timing rows do not move (the sweep is fire-and-forget, so its work overlaps the runtime's own I/O); the win lands on a cold cache, which is where the original profile measured it. ([#8412](https://github.com/code-yeongyu/oh-my-openagent/issues/8412))

### OmO

**A ulw-execute work whose session died no longer shows as running forever.** `.omo/boulder.json` only ever left `status: "active"` on an explicit completion, so a crash, a reboot or a closed terminal left the work `active` for good - one real project still advertised a work whose only session's transcript had been quiet for 41 hours, next to a sibling work the same file had recorded as `completed` ([#8413](https://github.com/code-yeongyu/oh-my-openagent/issues/8413)). Both ulw-execute read paths now reconcile the file where they already read it: a work is demoted to `paused` and stamped `stale_since` once its last activity - the newest of its sessions' transcript mtimes, `updated_at` and `started_at` - is at least six hours old, configurable with `OMO_BOULDER_STALE_WORK_THRESHOLD_MS`. Session ids, plan, mode and every other field survive the demotion, a work with recent activity is never rewritten, `completed` and `abandoned` records are untouched, and an unreadable or absent file changes nothing. Resuming a demoted work returns it to `active` and clears the stamp, and it stays listed as resumable the whole time.

### OmO

**A bun-global `omo` no longer boots node before it runs.** `bun add -g` links the launcher into two bins - `<bun root>/bin/omo` and `<bun root>/install/global/node_modules/.bin/omo` - and a PATH that lists the global `node_modules/.bin` first reached the second one, which is bun's own `#!/usr/bin/env node` symlink: every launch there paid a full node boot before the launcher re-execed itself under bun. The launcher already replaced the first bin with a tiny sh shim that execs bun directly; it now repairs both, judging each entry independently under the same safety rules (only bun's own link to this install, or a shim this launcher wrote, is ever replaced; a foreign file or link is left alone, one entry's failure never blocks the other, and the whole repair stays fail-open and silent unless `OMO_DEBUG`). Measured with hyperfine (15 runs, temp bun-root fixture, Apple Silicon): the `.bin/omo` path drops from 50.6 ms mean / 46.6 ms min to 16.8 ms / 16.4 ms, level with the already-shimmed bin at 17.7 ms. The launcher also prefers the engine's pre-linked bundle (`<senpi>/dist/bundle/cli.js`) when the installed engine ships one and falls back to `dist/cli.js` otherwise, so the engine-side bundle lands without another launcher change. ([#8412](https://github.com/code-yeongyu/oh-my-openagent/issues/8412), [senpi#1781](https://github.com/code-yeongyu/senpi/issues/1781))

### Changed

- **deps:** adopt senpi 2026.9.17-3 with the restored engine tree-sitter assets ([#8428](https://github.com/code-yeongyu/oh-my-openagent/pull/8428))

## [5.0.0-beta.68] - 2026-09-16

### OmO

**A second DAG run in the same session waits for a resident slot instead of failing at start.** Every run, team and `task` spawn of a session shares one resident-child cap (`task.residency_max_children`, 16 on a 14-core host). When one run's children held every slot, a second run failed all of its leaves within seconds with `residency_denied: resident child cap reached and no task can free a slot`, its aggregators were skipped, and the run then sat `running` forever because nothing was attached to drive it to a terminal state ([#8396](https://github.com/code-yeongyu/oh-my-openagent/issues/8396), [#8398](https://github.com/code-yeongyu/oh-my-openagent/pull/8398)). The scheduler had judged the whole session by its own bookkeeping, which is empty for a run that arrives second. The task manager now exposes a session-scoped wake that fires when any resident child reaches a terminal status, is evicted or suspended, or drains its last pending send; a denied node stays `scheduled`, its first parking is journaled once as `residency_queued` with how many residents hold the cap and how many belong to other owners, and the scheduler re-probes on every wake. Only a denial that names no resident still fails a node. A run whose every leaf fails at admission now settles `failed` with its dependents `skipped`, so `retry` works on it. The mass-ulw capacity model documents that the queue holds across runs.

**Children with a narrower tool policy can now receive parent JavaScript tools, scoped to their own permissions.** A child spawned with `tools: { write: false }`, an `excludeTools` denial or any explicit allow/deny used to be refused a parent `tool(fn)` outright with `tools_unavailable`, because the closure's nested `tool.<name>()` calls ran with the parent's permissions. When the engine advertises per-invocation scoping (`kernelTools.capabilities.invokeScope`, senpi 2026.9.16-3 and later), OmO grants the narrowed child and sends its resolved effective tool policy as the scope of every nested call made on its behalf: the exact allow list the runner installs for that child plus its literal deny list ([#8226](https://github.com/code-yeongyu/oh-my-openagent/issues/8226), [#8394](https://github.com/code-yeongyu/oh-my-openagent/pull/8394)). A nested call outside that scope is refused inside the worker and lands on the child's own tool-result channel as a typed `kernel_tool_host_denied` envelope, so the child can recover and the parent's cell never fails for it. The `kernel_tools` status record says whether the grant was scoped. Curated read-only agents, team members, process children and non-JavaScript parents are unchanged.

**ulw-loop no longer rebuilds `goals.json` below what its ledger records.** A run created under the removed `omo_agent_toolkit` tool path could publish a revision with one goal, keep adding goals and evidence straight into `goals.json` and `ledger.jsonl`, and then lose every later goal, its evidence and its audit entries the first time the `agent-toolkit-sdk` rebuilt the projection from that older snapshot; `record-evidence` and `checkpoint` on those goals failed with `ULW_LOOP_GOAL_NOT_FOUND` ([#8328](https://github.com/code-yeongyu/oh-my-openagent/issues/8328), [#8388](https://github.com/code-yeongyu/oh-my-openagent/pull/8388)). Reconciliation now lets a `goals.json` that names goals the newest snapshot lacks win, stamps it so the next publish folds the whole plan into revision N+1, and attributes ledger lines appended after a published revision to that revision. Every write of `goals.json` is checked against the reconciled ledger: a goal the plan lacks is a typed `ULW_LOOP_PROJECTION_TRUNCATED` refusal that names the missing ids, never a silent truncation.

**One `kibitzer_summary` telemetry event per session measures the memory sidecar.** How many nudges it delivered and on which wake the first one landed, what the wakes cost in tokens and wall time, how often they interrupt (median and p90 gap between nudges), and how many wakes were buffered by the cooldown or had nothing new to say ([#8389](https://github.com/code-yeongyu/oh-my-openagent/issues/8389), [#8390](https://github.com/code-yeongyu/oh-my-openagent/pull/8390)). The event carries counts, durations and a masked model id only; nudge paths and hint text never reach telemetry. An idle session emits nothing.

**LSP diagnostics no longer miss a publish that lands before the wait registers, and contended lock waits stop hammering the disk.** The diagnostics client could resolve an empty list when the server's answer arrived in the gap before its freshness wait was armed; the wait now orders on the schedule of that publish. `acquireLock` re-attempted a full exclusive publish (create, write, fsync, hard-link, unlink) on every retry tick, so a waiter aimed roughly 200 fsynced create and unlink cycles per second at the volume the lock holder was writing to; it now reads the lock file first and publishes only when the lock is free ([#8323](https://github.com/code-yeongyu/oh-my-openagent/issues/8323), [#8391](https://github.com/code-yeongyu/oh-my-openagent/pull/8391)). The Windows console probe asks kernel32 through `bun:ffi` instead of compiling a C# shim on every call, and the two spawn-heavy scripts that starved under Windows `--parallel` run in the shared serial quarantine with their measurements recorded. No test budget was raised and no assertion weakened.

## [5.0.0-beta.67] - 2026-09-16

### Engine: senpi 2026.9.16-3

**`omo --help` answers in tens of milliseconds instead of booting the engine.** A help screen used to build the whole runtime before it could print one line: migrations, settings, the model runtime with its catalog and availability scan, every extension plus skills, prompt templates, themes and context files, and a session. One Windows user measured 47.8 seconds for it ([#8371](https://github.com/code-yeongyu/oh-my-openagent/issues/8371)); on an Apple M4 Pro the same boot took 790 ms warm and 9 to 16 seconds with a cold cache. senpi 2026.9.16-3 ([senpi#1758](https://github.com/code-yeongyu/senpi/pull/1758)) answers `--help` from a cache of the last launch's extension flags before the engine is even imported, so the same help costs 28 ms on bun and 59 ms on node once any launch has run. The cache is checked against the engine version and against the modification time and size of every extension, settings and trust input, so an upgrade, an edited extension or a changed setting refreshes it, and a miss loads extensions for their flags only with no model runtime and no session. A help screen never prompts for project trust and never runs project-local extension code you have not already trusted.

**The startup spinner appears before the work it covers.** Its first frame waited on a 120 ms timer that the synchronous extension imports starved, so on a real terminal it showed up after the whole load, about 2.3 seconds in, one frame before the TUI replaced it. The first frame is now written the moment interactive startup begins, and the "extensions & models" phase is visible while extensions load.

## [5.0.0-beta.66] - 2026-09-16

### Engine: senpi 2026.9.16-2

**JavaScript eval cells can now hand `tool(fn)` functions to in-process children.** The kernel-tools capability was previously unreachable on the worker tool-call path, so children were refused with `tools_unavailable`. senpi 2026.9.16-2 ([#1754](https://github.com/code-yeongyu/senpi/issues/1754), [#1755](https://github.com/code-yeongyu/senpi/pull/1755)) dispatches those calls, so item 6 (JS kernel tools) actually works in OmO Native.

## [5.0.0-beta.65] - 2026-09-16

### OmO

**A Kibitzer nudge is reference now, not an order.** The recalled-memory block used to open with "It is a hint, not current state, verify before relying on it; read the source path for full context", which reads as a task, and it arrives on the user channel, so the model treats it with a user turn's authority. Across 3,143 deliveries in local sessions this month, 465 sent the agent to open the recalled note and 75 turned into a different task; 72 of those 75 happened in sessions whose context held no real user request, where the nudge was the only instruction in view. The header now names the sender and the standing of the block: a background memory advisor put it there, it may or may not apply, it is reference only, and the current task stands. Korean hints get the Korean equivalent, and both headers are shorter than the ones they replace.

**The Kibitzer writes observations, not instructions.** More than half of the hints it delivered this month were phrased as orders ("verify these before ...", "하지 말아야 합니다"). Its persona now asks for one sentence about what the stored note records, shows an instruction-shaped hint as a worked bad example, and carries the same block the renderer produces, pinned byte for byte by a test. The rule is enforced where nudges are admitted: a hint carrying the second person, opening with an imperative, or ending in a Korean request form is refused with the reason and the fix, and the judge keeps its single correction. Nudges stored under the old contract still render in past sessions.

**`<memory_notice>` stopped claiming messages left the live context.** It reported the session branch length on every prompt, so a fresh session with 15 entries and no compaction read "12 previous messages ... have left the live context". It now counts the messages a compaction actually removed, omits the line when nothing was compacted, and skips the notice entirely when it would carry no lines. The standing fact that recalled memory arrives on its own and has no tool to call moved into the compiled memory block, where it belongs.

**Plan Effort is five bands, and `disabled_skills` works on Native.** An `**Effort:**` value written as a duration ("200 hours", "3 days") is rewritten to the band that bounds it, Quick through XL, with a warning that explains the bands, so an hour count never reaches the summary a reader sees first. `disabled_skills` is a canonical key of `~/.omo/omo.jsonc` across the shared base, the harness blocks and profiles; on Native the bundled skills now arrive through discovery minus every disabled name, with user, project, harness and profile layers unioned.

## [5.0.0-beta.64] - 2026-09-16

### Engine: senpi 2026.9.16

**Reasoning shows up while the model is still reasoning.** Claude lanes used to sit on a "Working" line for the whole thinking phase and then dump the entire reasoning block at once, because the empty-response recovery wrapper buffered every event until the first visible text or tool call. Seven days of session files say 80% of Claude turns with thinking were held that way, a median of 16 seconds, 37 seconds at p90. The wrapper now starts forwarding at the first meaningful event, so thinking arrives as the model produces it and the assistant message opens as soon as the provider answers. A turn that streams reasoning and then ends with nothing is no longer replayed inside the stream, where a second start would duplicate the message: it ends as a retryable error that keeps what you already saw, and the session's own turn retry re-requests it. Kimi keeps the old buffered path on purpose, since its reasoning channel is where misrouted tool calls land.

**`read` returns structure for JSON.** Eligible `.json` files come back as a segmented structural view with declaration-safe folding instead of raw bytes, while TypeScript and JavaScript stay verbatim because the measured candidate missed the required saving for both. Explicit `offset`/`limit` requests, truncated input, markdown and `.txt` keep the old path.

**One extension can no longer hold quit hostage.** Every `session_shutdown` handler runs under a host budget and receives a per-handler `signal` that aborts when it overruns, so a slow handler stops blocking quit, `/reload`, `/new`, `/resume` and forks. The budget is configurable.

**JavaScript eval cells can publish tools to their children.** `tool(fn, metadata?)` registers a named function as a fenced tool for in-process children, the worker answers describe and invoke requests on a pump separate from the top-level run queue, and `workpool(agent, name, mode?)` lands in the JS, Python, Ruby and Julia preludes as a thin adapter over the host workpool tool. Background `agent(..., handle: true)` now requires a structured task id and run epoch from the host.

**Terminal teardown escalates instead of hoping.** `TerminalSession.terminate()` signals, waits, and escalates to `SIGKILL`; the session registry gained grace settings for the forced kill and for detached children, and detached cleanup kills what survives its grace. An opt-in Bun terminal backend is available behind `SENPI_BUN_TERMINAL`.

**Session lists stopped mixing durable and live state.** `SessionMetadata` replaces `SessionSummary` for `listSessions()` and server snapshots, runtime state comes only from an acquired session, and the protocol gained transport-neutral CBOR schemas with length-prefixed framing.

### OmO

**ulw-loop survives an eval-kernel reload.** A reload used to drop `PI_SESSION_CWD` and `PI_GOAL_STORE_FILE`, which failed the toolkit with `PI_SESSION_CWD is required` and hid the live driver goal, so the loop advised creating a goal that already existed. Both are now derived from the session file before falling back, each fallback names its remediation, and the help text, `addGoal` criteria and artifact paths came along in the same pass.

**The Kibitzer stopped reading your whole disk.** Its read-only grep walked the entire workspace and read every file up to 1MB; on a real 277,000-file workspace the walk alone cost 2.5 seconds and a rare pattern read everything. Candidates now come from git so `.gitignore` counts, the scan stops at file-count, byte and wall-clock budgets, and it honors the turn's abort signal instead of running past the wake deadline. Candidate collection also went incremental: per-trigger CPU on the 800-document fixture dropped from 308 ms to 5 ms with identical output, which removes the pause that landed on every tool call in a large memory corpus.

**Session shutdown no longer waits on the Kibitzer.** The memory extension used to await its sidecar's shutdown and the facts cancellation outside the 1.5-second drain budget, so a slow lease release stalled quit, `/reload`, `/new` and `/resume` and starved the steps queued behind it. Both awaits now race the drain deadline and finish detached, and the wake lease and the sidecar directory lock are still released. Every wake is bounded from admission as well: the 90-second deadline is armed before the child starts, a 300-second total cap holds through steer re-arms, and a stall during child start ends the wake, hands the slot back and disposes the late child.

**Typed task handles.** Background task handles carry a run epoch, so a handle from a previous run cannot be mistaken for the live one.

**`workpool` is a new host tool for keyed, batched fan-out.** `workpool create { name, agent, mode?, tools? }` opens a pool whose workers run a `category` or `subagent_type` with a prompt; `push { pool_id, items: [{ key, input }] }` returns `{ pool_id, item_ids }` at once without waiting for capacity, and scheduling happens one event-loop turn after the durable receipt, so every later wake is event-driven. `inspect` reads the persisted record with each item's status and its data or error, `close` stops intake and lets in-flight items finish, and `cancel` marks queued and assigned items `cancelled` and cancels their workers. Pool ids are `wp_<32 hex>`, item ids `wi_<32 hex>`. Re-pushing a key with byte-identical input is idempotent; a divergent re-push is a `yield_conflict`. A pool worker takes the same admission lease, per-model concurrency slot and spawn-policy checks as a `task` spawn, so nothing in a pool bypasses admission. One acknowledged aggregate result is delivered through the idle-injection path without polling, and it survives a reconnect once.

**Pool workers default to `keep_alive`.** On one real batch, keeping a worker warm between items answered at a p95 of 12 to 13 seconds against 42 to 51 seconds fresh, on about a fifth of the tokens, with identical correctness, so `keep_alive` is the default and `fresh` stays available per pool. A worker that yields after a stale-kernel error produces one keyed error and the single aggregate, never an automatic retry.

**A parent's JavaScript tools are scoped to the child that receives them.** A grant is computed from the child's resolved effective tool set, so a curated read-only agent, a child whose policy is narrower than the parent for any write-capable tool, and process, team and non-JavaScript children are refused with a typed error and no child session. A revived child re-checks the parent kernel's generation and revision on every call: a reset, a same-name redefinition or a new host without the live binding returns `kernel_tool_stale` or `tools_unavailable` on the child's own result channel instead of running a stale closure.

## [5.0.0-beta.63] - 2026-09-15

### Breaking

**OpenCode's `agent-browser` provider and builtin skill have been removed.**
Configs containing `browser_automation_engine.provider: "agent-browser"` now
fail schema validation. `oh-my-opencode doctor` reports the rejected value and
says: "use the built-in browser path: Bun.WebView / playwright-core scripts".
Remove the obsolete override from the active `[opencode]` block in `omo.jsonc`,
including project and profile layers. Browser work uses in-process Bun.WebView
or written playwright-core scripts against local Chrome; these script paths
are not new provider enum values. The retained provider choices are
`playwright`, `dev-browser`, and `playwright-cli`.

### Engine: senpi 2026.9.15-2 (adopting 2026.9.13-2 and 2026.9.15 as well)

**Concurrent questions queue instead of overwriting each other.** Two async questions used to race, and the second one replaced the first. They now sit in a queue: the widget shows `+N more`, `alt+down` cycles through them from an empty composer, and each request keeps its own draft and its own idle deadline. Answering got faster too — a digit on an empty composer answers the shown question, a single-select single question submits on that digit, `/answer` lists or opens a specific request, and typed text binds to one request with a `↳ reply to <header>` label. An answered, commented, dismissed or timed-out question collapses to a `↳ <header>: <answer>` chip you can click to expand.

**A question announces itself.** A `? <header>` layer goes into the terminal title while a question waits, a one-time bell fires (`askUser.bell`, on by default), an `ask-user:asked` bus event and a matching `ask-user-asked` Notification hook fire for anything you want to wire up, and `herdr:blocked` gets an active/inactive pair. Reconnect replay and hydration stay silent.

**Bundled resources have their own provenance scope.** Builtin and bundled extensions resolve to a `system` scope in every runtime, `resources_discover` accepts `{ path, scope }` entries, and a command-line package declaring `"pi": { "system": true }` keeps that scope through CLI precedence. The compact startup banner leaves system resources out of `[Skills]`, `[Extensions]`, `[Prompts]` and `[Themes]`, so what you see is what you added; Ctrl+O or `--verbose` shows the `system` group after the project, user and path groups.

**For extension authors.** `ctx.steeringSignal` is readable during tool execution, so an extension can notice queued steering without cancelling work or consuming the message. `PI_SESSION_CWD` and `PI_GOAL_STORE_FILE` reach kernels and shell children, with inherited stale values cleared. `@code-yeongyu/senpi/bun-runtime` registers providers and OAuth synchronously, once per isolate, for standalone Bun consumers.

**grep is a real search engine again.** A native `senpi-grep` addon walks the tree with ordered parallelism, bounded reads and cancellation; ripgrep stays as the fallback, and `SENPI_GREP_ENGINE=auto|native|rg` picks between them. `mode` selects `content`, `count` or `files`, `limit` and `skip` paginate over files, `path` takes a file, a directory, an array or a `<file>:L1-L2` selector, and `glob` accepts `!` exclusions. Every result ends in a `[grep: matches=2 files=2 searched=42 elapsedMs=8 engine=native nextSkip=none]` footer and carries `details` v1 with structured matches and pagination, and the TUI, the HTML export and the eval widget group matches under their file.

**`tool_search` stopped costing you a round trip.** It is side-effect-free now: it lists up to five matching deferred tools with their parameter schemas and activates nothing, so the old "callable from your NEXT turn" wait is gone and naming a tool activates it on that first call. Results are gated on query-term coverage and a relative score floor, so one incidental word match no longer drags in unrelated tools, and a query naming `bash` or `monitor` answers with that tool's redirect hint instead of "No tools matched". `generate_image` moved behind the same door and no longer ships its roughly 1K-token schema on every request.

**Background processes die with the session that started them.** The bash tool keeps owning a command's process group until its last descendant exits, so `sleep 30 &` or `nohup server &` is killed by shutdown cleanup instead of being orphaned. Eval cells do the same for what they spawn: when a JavaScript cell settles, is interrupted or times out, its children and their descendants get SIGTERM and then SIGKILL after a grace, unless the cell asked for a detached process. Python kernels sweep their process group on close, and a parent-death watchdog takes the kernel down with the host. Underneath, the PTY layer escalates an ignored SIGTERM to SIGKILL in session stop, registry teardown and detached cleanup.

**Pending questions are clickable, including inside tmux.** Click an option to answer it, type your own, cycle between requests, or expand the question tabs, in both regular and fullscreen mode. The new `terminal.mouse` setting defaults to `whilePending`, so the mouse is captured only while a question is waiting; `off` disables capture and `always` keeps it on. Short startup question blocks in tmux used to swallow clicks because the private cursor query never came back — the frame is now calibrated from two stable pane-cursor readings, bounded by 750 ms.

**senpi reports its own state to herdr.** A builtin reporter marks the pane blocked with the question's label while a question or host dialog waits, keeps it working during turns, subagents and monitors, and restores idle on settlement. It coexists with herdr's managed integration and steps aside for a user-authored `herdr-*` reporter.

**webfetch dropped its browser emulator.** LinkeDOM replaced jsdom for inert HTML conversion, which keeps reader output and omitted document tags intact, resolves relative article links and images against the final response URL, and retires the CSS and XHR compile assets that shipped only for the old parser.

**Compiled binaries load TypeScript extensions natively.** jiti is no longer embedded in the Bun binary: extensions load through native runtime modules, so host-module identity survives and a reload gets a fresh dependency graph. Computed imports and requires share their generation, unused graphs can be reclaimed, native data imports keep Bun's loaders, and parser errors keep their source locations. Node runtimes keep their jiti options.

**Devin lanes stopped offering a thinking level that did nothing.** Cascade's chat protocol has no request-side thinking field, and SWE-2 effort is chosen by the lane uid, so the `/efforts` and `/reasoning` selector and the footer thinking suffix were a second control wired to nothing. Streamed thinking output still renders; picking the lane is the one effort control.

**Smaller TUI repairs.** Enter on a multi-select option toggles that choice instead of silently skipping it, including option 1. A bare `/btw` dismisses the panel or cancels the in-flight side query, and Escape reaches it under the kitty keyboard protocol. `/btw` no longer shows its question twice. Every `Tip:` line gets a blank line above it, so it stops reading as part of the block before it.

**Publishing stages what the lockfile says.** The packed tarball now mirrors `publish-deps.lock.json` whatever the developer's package manager did to `node_modules`: nested manifest entries are staged at their manifest path from a version-matched copy, npm's workspace-local placements keep the top-level slot, and packages the manifest no longer lists are pruned. A tarball staged from a bun-hoisted install used to ship `htmlparser2@10` next to a stale `entities@8`, and compiling the engine failed on `No matching export ... for import "fromCodePoint"`.

**Closing an RPC session is ordered now.** `close_session` acknowledgements and `session_closed` events, including worker-failure terminals, go out only after the session registry has dropped the entry, so a `list_sessions` issued right after never returns the closed session. Filesystem watchers are cancelled together with shutdown, every disposer is joined before the process exits, a reentrant shutdown shares that join and keeps its failure exit code, and nonpersistent RPC probes never start watchers.

**The RPC host watchdog stopped spawning `ps`.** Its ppid fallback ran `ps -o lstart=` every 250 ms while the supervisor was alive, and long-lived shared hosts piled up thousands of `ps` children, zombies on runtimes that fail to reap them. A dead supervisor is reaped by its own parent and the host is reparented, so the free `kill(pid, 0)` plus a ppid comparison sees the loss with no child process at all.

**Paused monitors cost nothing.** A paused file watch clears its 250 ms poll timer outright, with no stat or SHA-256 digest work, and resume runs one immediate check so a change made during the pause still fires. Session-output line buffers cap at 64 KiB, so a stream without newlines can no longer grow a monitor's retained tail without bound.

**Eval cells stop hoarding memory in long sessions.** Settled detached cells leave the live registry for a 32-entry snapshot store, where `peek`, `stop` and waiting for a terminal state still work for recent cells; the JS kernel's unconsumed tool-call queue is capped at 256 and cleared on interrupt, reset, close and crash, as the subprocess kernel already did; and per-cell display buffers cap at 8 images, 24 MB and 64 JSON outputs with an elision note. Detached and completed eval cards render static with a frozen elapsed time instead of repainting at 1 Hz forever, and a live ticker whose row stopped rendering stops itself after 60 idle ticks and rearms on the next render, so transcript rebuilds and session switches no longer pile up intervals.

**Standalone binaries ship codemode once.** The compiled binary loads codemode from the staged on-disk package instead of a second embedded copy; the sidecar carries its JS parser dependency and keeps the bun-1-4 skill.

**Multi-day sessions stopped freezing on the status ticker.** Deciding the working/retry animation cadence used to re-parse the whole session file every tick, which periodically froze the UI on long, compaction-trimmed sessions; it now reads an O(1) entry count that `SessionManager` maintains as entries land.

**Cursor CLI OAuth no longer probes on every start.** The startup `cursor-agent models` probe runs only when the lane is usable (not disabled, `cursor-agent` installed, an account bound) and inside that account's HOME, and every `cursor-agent` spawn gets the same explicit environment allowlist instead of the inherited `process.env`. A hermetic or SSH-launched session therefore never trips the CLI's macOS keychain preflight, which used to surface as a blocking "Keychain Not Found" dialog on the console.

### OmO

**omo.dev is rebuilt for people who do not already know what an agent harness is.** The site carries the OmO brand, one install path, the 2026-09-14 manifesto in English and Korean, and a landing page that shows the Kibitzer loop and the main loop running side by side on a research-to-deck scenario. Open Graph cards render from the Figma brand file with the live GitHub star count. Download stats are all-or-nothing now and count `omo-ai`, so a partial registry response no longer publishes a number that is quietly too low. Lark joins the messaging platforms, the ones that are not shipped yet say so, and the Korean copy breaks its lines where a Korean reader would.

**16,497 of a stock launch's 25,048 prompt tokens were tool schemas.** The ones almost nobody calls now register with search exposure and activate when the model names them: `team_create` and `team_delete` (951 tokens), the three ast-grep MCP tools (2,029), `mcp_grep_app_searchGitHub` (713), the two context7 tools (1,006) and `omo_agent_toolkit` (851). Across a 30-day sample each of those appears in 0.1% to 1.6% of sessions. The skills that need them name them, so the ast-grep skill names its three MCP tools, the ulw-loop skill names `omo_agent_toolkit`, and `team_*` is named across the ulw and hyperplan skills.

**The memory notice stopped sending models hunting for a tool that does not exist.** It used to say prior messages are "stored in recall memory", and 33 of 90 sampled `tool_search` calls went looking for the recall tool that phrasing implied. Recall is passive — Kibitzer injects `<recalled-memory>` on its own — so the notice now says relevant memory arrives automatically and there is nothing to call.

**The agent keeps a self-aware block.** `system/self-aware.md` is seeded as a reflection-owned block of reflected self-observations, projected beside the persona and never merged into the soul. It is the reflection's to write, not the session's.

**`system/boundaries.md` belongs to you.** It is a user-owned soul block: only what you actually said about what not to do goes in it, quoted as you said it. The persona no longer advertises a generic `system/*.md` line; it points at the boundaries contract instead.

**Reflections deliver a recap, and they stop eating each other.** A finished reflection hands back a recap with its provenance and relative links to what it read, and recap reads go through the resilient filesystem path, so a transient read error no longer swallows the delivery. Reconciliation stopped killing live reflection runs over a start-identity scheme mismatch, orphaned reflection worktrees get swept, and a reflection that already landed stays merged when its cleanup fails.

**Idle children are parked, not evicted.** A resident that goes idle is suspended and revived when a message arrives, instead of being thrown away and rebuilt from nothing. Idle park retention is configurable, team liveness survives the park, and a batch whose acknowledgment failed to persist is kept.

**The ulw-loop plan store survives a crashed writer.** `.state.lock` is reclaimed through a lease instead of waiting on a lock whose owner is gone, plan and audit state land in an immutable commit log, an invalid legacy plan can be force-recreated, and a session id that normalizes to null is rejected at the door.

**The browser lane is Playwright and the eval kernel.** `agent-browser` and `npx playwright` guidance are gone from the shipped skills; local Chrome templates use `playwright-core`, the WebView examples run as written in the eval kernel, and `ultimate-browsing` loads as the ulw-research companion skill.

**Plan consultants run on Fable 5.1 max.** The plan-consultant chain is headed by Fable 5.1 max with a guarded model-core mirror, qwen3.7-plus joins as a utility rung, and every builtin OpenAI rung routes through `openai-codex`.

**Windows and RPC hardening.** The omo-senpi adapter's Windows compatibility races are gone, the native RPC surface rejects incomplete patch targets and malformed stream events instead of acting on them, the postinstall guard that installs that serializer accepts the engine's new `createRpcShutdown` entry (the previous guard refused any senpi built after 2026.9.15), and the css-tree sidecar trio is embedded only when the engine actually ships it.

**Quieter startup.** omo-senpi declares itself a system package, so its skills and extensions leave the compact startup banner and appear only in the expanded view. Memory-repo skills pin to the user scope on engines that accept scoped entries.

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
