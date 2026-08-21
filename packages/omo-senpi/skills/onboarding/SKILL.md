---
name: onboarding
description: "Onboarding tour for first-time omo users"
---

# onboarding - the first conversation with omo

## Purpose

This skill runs the first conversation a new omo user ever has. You are the guide. Walk the user
through six lanes, in order: the feature tour, migration help, session archaeology, value mapping,
memory recording (which runs through the whole flow, not at the end), and the first-session
init-deep proposal. Three of the lanes are opt-in. When the user declines one, move on without
argument and without repeating the offer.

Detect the user's language from their first reply and respond in that language for the rest of the
conversation. The skill is written in English; your output is not. Match them exactly, including
tone.

Use Senpi-native tools only: `read`, `bash`, `edit`, `write`, the `memory` tools, and skill
invocations. Never assume a tool from another agent product exists here.

Be concrete, never generic. "omo caches your context" is a failure of this skill. "Your last week
of Claude Code sessions read 4.7M tokens from cache at a 78% hit rate; here is what that would
have cost cold" is the bar.

## 1. Feature tour

Open by introducing yourself and giving a short tour of what omo adds on top of a plain coding
agent. The catalog below is baked in at authoring time because the user's machine has no omo or
senpi source tree to explore. Present it conversationally, three to five highlights at a time, and
let the user ask for depth on any item. Do not dump the whole list as a wall of text.

The baked catalog:

- **Eleven-agent roster**: primary workers, plan specialists, architecture consultation, codebase
  explorers, research librarians, and focused review agents are routed by the work rather than
  forced through one general-purpose persona.
- **The Senpi component layer**: startup config and migration, native status, onboarding,
  init-deep advising, anonymous telemetry, ultrawork arming, start-work continuation, ulw-loop
  continuation, todo fan-out reminders, fallback architecture, comment checking, ast-grep, LSP,
  task delegation, memory, and live config watching cooperate as independent components.
- **Senpi-native skills**: `init-deep`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`,
  `hyperplan`, `coding-agent-sessions`, and `give-me-tips` provide reusable workflows that the
  agent reads and follows only when relevant.
- **Three MCP tiers**: built-in servers, user or project `.mcp.json` servers, and skill-embedded
  servers give projects a layered tool surface without forcing every integration into core.
- **Team mode**: cooperating agent sessions can share work, messages, and task state when the
  selected omo harness exposes that surface.
- **Goal and boulder state**: durable objective and work-plan state let long work resume from
  recorded progress instead of relying on conversation context alone.
- **Ultrawork and ulw workflows**: planning, research, execution loops, fan-out decisions, and
  evidence-bound continuation keep autonomous work moving until its observable goal is proven.
- **The fallback architect**: refusal metadata can route the unresolved engineering question
  through an architecture consultation lane while the active model continues execution.
- **Memory**: dedicated memory tools record durable user and project facts so later sessions begin
  with the right stack, preferences, and working habits.
- **Telemetry**: privacy-bounded anonymous lifecycle signals and local preview commands make omo
  behavior measurable and auditable, with documented opt-outs.
- **Init-deep**: hierarchical `AGENTS.md` generation, snapshot state, local or committed mode, and
  later drift detection keep project instructions aligned with the codebase.
- **Tips with a live source of truth**: run `senpi --list-tips` during the tour, then read and
  follow `give-me-tips` for any visible tip the user wants explained from the implementation.
- **Interactive UI primitives**: real pickers, confirms, inputs, notifications, editors, custom
  views, and widgets let components ask structured questions instead of burying choices in prose.
- **Re-running this tour**: onboarding auto-starts once, ever. The user can bring it back any time
  with the `senpi --onboard` flag, or shut the auto-start off with the
  `omo-senpi-onboarding-disabled` flag.
- **The init-deep advisor**: after this first session, omo watches each project for AGENTS.md
  coverage gaps and drift, and proposes an init-deep run only when the numbers justify one. On
  this first session, you carry that proposal yourself in lane 6.

While the user reacts to the tour, start lane 5: record what you learn about them through the
memory tools as you learn it.

## 2. Migration help

Ask whether the user is coming from another coding agent and would like their setup carried over.
This lane is opt-in. If they say no, skip to lane 3.

If they say yes, scrape their existing configuration from as many sources as exist on this
machine. Check at least:

- Claude Code: `~/.claude/settings.json`, project and global `CLAUDE.md` files, MCP server
  definitions in `.mcp.json` or settings.
- Co&#x64;ex: <code>~/.co&#x64;ex/config.toml</code>, any `AGENTS.md` files it manages.
- OpenCode / oh-my-openagent: `~/.config/opencode/opencode.json`,
  `~/.config/opencode/oh-my-opencode.jsonc`, project `.mcp.json`, and existing `AGENTS.md` files.
- Anything else the user names.

Read what you find, then present one concrete migration plan: which settings map to
`~/.omo/omo.json[c]`, which MCP servers move to the project `.mcp.json`, which `CLAUDE.md` content
becomes project `AGENTS.md` content, and which personal facts belong in memory instead of files.
Show the plan and WAIT for the user to accept it. Apply nothing before they say yes. If they accept
part of it, apply that part only. Record their agent-product history and migration choices through
the memory tools.

## 3. Session archaeology

Ask the user, in your own voice and their language, a question that means: "may I look through
your previous coding-agent sessions?" Phrase it naturally; do not read that sentence out like a
script. This lane is opt-in. If they say no, skip to lane 4 and base it on nothing.

If they say yes, drive the `coding-agent-sessions` skill: read its SKILL.md and follow it. Use the
bundled finder to list sessions across every platform present on the machine, then go deep on the
interesting ones. Mine for:

- how they actually work: hands-on-the-wheel back-and-forth versus long one-shot delegations,
- their planning stance, feeding the seed described in lane 5: opening-message shape (requirements
  and constraints enumerated upfront, or vague starts?), how they answer agent questions (pick an
  offered option, answer several at once holistically, redirect, or delegate the decision), how
  they approve (a verbal yes versus commanding execution), and whether the style shifts by repo or
  domain,
- what frustrates them: repeated corrections, abandoned sessions, prompts that read as annoyed, in
  any language,
- how much they run in parallel, and how long their longest sessions run,
- which repos, stacks, and models dominate their history.

Weave in migration suggestions where the history invites them, lightly. When a pattern you find
maps to an omo feature from the tour, say so with the evidence: "you corrected the agent about
your test runner in nine sessions; memory ends that" lands, a generic pitch does not. Record every
durable finding about the user through the memory tools as you go.

## 4. Value mapping + savings

From the session data gathered in lane 3, give the user quantified estimates of what omo's caching
would have been worth on their real workload. Compute, do not guess:

- Quantify token and cost savings only from Senpi JSONL v3 sessions. Use other agent stores for
  session counts, duration, concurrency, and qualitative work-pattern analysis, not token savings.
- Fetch `https://models.dev/api.json`. Treat its top level as the provider map. Each provider owns
  a `models` object, and each model cost uses `input`, `output`, `cache_read`, and `cache_write`
  USD prices per one million tokens. If the API is unavailable, every session has insufficient
  pricing data.
- Process session files in chronological filename order. Process entries inside a file in JSONL
  line order. A malformed timestamp skips that entry. Entries whose timestamps differ by at most
  one millisecond retain JSONL line order.
- Read usage only from `message.usage`. Map `input`, `cacheRead`, `cacheWrite`, and `output`
  exactly. The three input categories are disjoint:
  `total_input_tokens = input + cacheRead + cacheWrite`. A session whose total input is zero is
  skipped.
- Attribute each usage entry to `message.provider` plus `message.model` when both are present.
  Otherwise use the latest `model_change` provider and `modelId`. Usage before any model
  information uses the first later `model_change` in that file when one exists; otherwise skip it.
- Resolve prices first by exact `provider/model` composite identity. If that misses, search for an
  exact model id across provider keys sorted alphabetically, then model keys sorted alphabetically.
  The first deterministic hit wins. If any required price field is missing, mark that entire
  session as insufficient data.
- Aggregate usage by provider and model, then compute grand totals. The caching rate is
  `cacheRead / (input + cacheRead + cacheWrite) * 100`.
- Compute actual cost as
  `(input * price.input + output * price.output + cacheRead * price.cache_read + cacheWrite * price.cache_write) / 1_000_000`.
  Compute omo savings as
  `cacheRead * (price.input - price.cache_read) / 1_000_000`.
- Round only final aggregated values with `Math.round(value * 100) / 100`. Never round per message,
  model, or session. Label the result `estimate`.
- Use real correction or frustration prompts found in lane 3 to demonstrate omo's
  language-agnostic intent routing. Explain, in the user's language, how a phrase such as
  "no, that is not what I meant" or its actual non-English equivalent is treated as corrective
  steering for the active task rather than misread as a disconnected request. Tie each example to
  the observed transcript and the omo feature that addresses it.

Label the result as an estimate and give exactly one line of methodology, in this shape: "Estimate
from your local Senpi session logs: message-level model attribution, models.dev input/output/cache
read/cache write pricing, summed across sessions, rounded at the end." One line, then the numbers,
then stop.

If the user skipped lane 3, skip this lane too; there is no data to map.

## 5. Memory recording

This lane has no fixed position: it runs through the entire flow. Whenever any lane teaches you
something durable about the user, write it through the `memory` tools at that moment, not in a
batch at the end. Worth recording:

- their host and machine facts relevant to future work,
- their language and communication style,
- which agent products they came from and what they kept from them,
- their stacks, main repos, and working patterns from lane 3,
- their stated preferences and every accept or decline decision from this conversation.

Write durable personal and cross-project facts through the memory tool into `system/human.md`.
Write repository-specific stack, commands, constraints, and migration decisions through the memory
tool into `system/project.md`. Do not edit those backing files directly.

Planning-stance observations from lane 3 are the one exception: write them as SEEDS under a
`## Seed` heading in `system/human/planning-style.md` (create the block through the memory tool if
absent), never into `system/human.md`. Seeds are inferences and MUST stay weak:

- Phrase every seed as a hypothesis ("appears to enumerate upfront and delegate the rest"), never
  a conclusion, and set `confidence: low` ALWAYS - never medium or high, however consistent the
  history looks. Behavior in another tool reflects that tool's affordances, not necessarily this
  user; omo's own planning sessions will confirm or replace these within a few runs.
- Record full provenance on every seed line: the source harness name(s) (e.g. Claude Code,
  Co&#x64;ex, OpenCode), the model(s) under which the pattern was mainly observed, the session ids
  mined, and today's date as `seeded:`. Format:
  `- [YYYY-MM-DD] (seed) appears to <hypothesis + context> <!-- src: <harness>/<session-id>,...; harness: <names>; model: <models>; seeded: YYYY-MM-DD; pattern: inferred-from-external-sessions; confidence: low -->`
- Seeds carry interaction STYLE only - never session content, code, file paths, or secrets.

Record facts, not narration. "Prefers Korean, migrated from Claude Code, works one repo at a time
in long sessions" is a memory. "The user went through onboarding today" is not.

## 6. First-session init-deep proposal

On the true first session the advisor component stays quiet, so this proposal is yours to carry.
Before saying anything about it, run the same eligibility gate the advisor uses, in this order:

1. The current directory must be inside a git repository. Check with
   `git rev-parse --show-toplevel`. Not a repo: ineligible.
2. There must be candidate directories worth documenting: directories within depth 3 of the repo
   root (excluding `node_modules`, `.git`, `dist`, `build`, `vendor`, `.next`, `__pycache__`,
   `.venv`, `target`, `coverage`, `third_party`) holding at least 8 source files or at least 500
   lines of source directly in them. Zero candidates: ineligible, regardless of anything else.
3. Compute coverage: a candidate counts as covered when it or an ancestor up to the repo root has
   an `AGENTS.md`. The missing ratio is uncovered candidates over all candidates. Below 0.50:
   ineligible. A new project with candidates and no `AGENTS.md` anywhere is missing ratio 1.0 and
   eligible.

If any gate fails, skip this lane SILENTLY. Do not mention AGENTS.md, do not explain why you are
not proposing, do not hint that a check ran. Close the conversation warmly instead.

If all gates pass, ask in the user's language: "want me to set up AGENTS.md for this project?"
This is opt-in. On yes, read the `init-deep` skill at its SKILL.md path and follow it. On no,
record the decline through the memory tools and finish the conversation gracefully: a short
send-off in their language, an invitation to come back with `senpi --onboard`, and nothing more.
