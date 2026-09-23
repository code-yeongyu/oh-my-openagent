## 2026-09-23 - frontend skill: HIG-derived universal motion and feedback rules in the DESIGN.md contract, interaction mechanics, and ambience retrofit (#8755)

A full read of Apple's Human Interface Guidelines (172 pages) against `packages/shared-skills/skills/frontend`, keeping only the platform-agnostic principles (nothing Liquid Glass, scroll-edge, tab-bar, SF Symbols, or visionOS-specific). Every edit lands in a project-original file at the layer where it is applied; no materialized third-party reference, no SKILL.md, no routing, and no test change.

`references/design/design-system-architecture.md`: Section 2 drops the depth rule that contradicted Section 7's choose-one strategy and rewrites the accent rule to say where accent goes (the primary action's background, not its glyph), how many prominent controls a screen carries (one or two), and how peers differ (style, never size). Section 6 gains a Feedback thresholds table (same-frame press feedback; hover-revealed chrome after hover intent; placeholder at once and indicator only past ~1 s; even-paced progress with no mid-task shape swap; failure next to the object, toast only for outcomes not visible in place), allows `filter` alongside `transform`/`opacity` as the rest of the skill already did, merges the two state bullets, adds a transition-identity rule, and reframes reduced motion as reduce-not-remove. Section 7 gains a Radius scale and two rules (concentric nested radii; elevation reads only when scale, shadow and highlight move together). The validation checklist covers thresholds, reduced-motion paths, and radii.

`references/design/interaction-skill.md` Section 4: a meaning-to-motion table under the motion-serves-meaning rule; a "Transitions keep identity" rule (`layoutId`/measured-height morph, move-before-add, still anchor, no reflow under the user's hands, exit mirrors entry); discrete-vs-continuous input folded into the springs bullet (drags track 1:1, settle on release); interruptibility extended with never-snap; reduced motion extended with what stays, blur never animating, and an `aria-live` equivalent for motion-conveyed state; a new "One event, one feedback" rule (no stacked indicators, success by changed state, failure always reported with cause, undo over dialog, outcome-named buttons, neither Cancel nor a destructive action as the Enter default, request sent when input lands). Section 6 verification adds an interruption pass.

`references/design/ambience-skill.md` Section 4: a comfort bullet for viewport-filling motion (fixed reference frame, low-contrast translucent moving layer, motion toward the center, no ~0.2 Hz oscillation); the closing bullet is trimmed to the one-atmosphere-per-page rule the shared axiom does not already state.

Gates: Agent Skills validator OK on the frontend skill; `bun test packages/shared-skills` membership/provenance/packaging pins unchanged; the DESIGN.md template keeps its eight numbered sections plus Section 0.

## 2026-09-23 - one comment-checker release pin for both editions; native downloads it instead of installing the npm payload (#8247)

`packages/comment-checker-core/src/release.ts` (new) is the single description of the checker release both editions consume: `COMMENT_CHECKER_RELEASE_VERSION` (`0.8.0`), the release repo, `resolveCommentCheckerReleaseAsset(platform, arch)` (the five supported targets and their `tar.gz`/`zip` asset name and URL), `commentCheckerBinaryName`, and `commentCheckerCacheDir` (`%LOCALAPPDATA%\<name>\bin` on Windows, `$XDG_CACHE_HOME/<name>/bin` with the `~/.cache` default elsewhere). Exported from the package barrel and declared in `index.d.ts`; `release.test.ts` pins every target, the unsupported-platform null, the version threading, and the cache-dir precedence. `packages/omo-opencode/src/hooks/comment-checker/downloader.ts` drops its private `REPO`/`COMMENT_CHECKER_VERSION`/`PLATFORM_MAP` and derives URL, cache dir and binary name from the descriptor; its six-platform `downloader.test.ts` is unchanged and green, so the OpenCode edition's URLs and cache location are byte-identical. `packages/omo-opencode/package.json` gains one narrow export, `./binary-downloader` -> `src/shared/binary-downloader.ts`, so the Senpi adapter reuses the archive download, tar/zip extraction, entry validation and chmod primitives instead of copying them; `config-migration-export.test.ts` pins the two-entry export map and audits the new subpath's module graph for OpenCode SDK or plugin-runtime imports the same way it audits `config-migration`.

Why at the root: #8745 declared `@code-yeongyu/comment-checker@0.8.0` as an `omo-ai` runtime dependency to fix the missing checker; that package unpacks to 267,670,796 bytes (every platform's binary; 261,416 KiB on disk against 274,732 KiB for the whole engine), the exact payload #8256 removed from the OpenCode edition on 2026-09-14. That declaration shipped in 5.0.0-beta.87; this change reverts it (`packages/omo-native/package.json`, `bun.lock`) and gives native the same lazy pinned-release download into the shared `oh-my-opencode/bin` cache; the per-package details are in `packages/omo-senpi/changes.md` and `packages/omo-native/changes.md`. Root `CHANGELOG.md`: the beta.87 section keeps #8745's entry as released history; a new [Unreleased] `Fixed` entry describes the download path and the removal.

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
