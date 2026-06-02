# src/hooks/keyword-detector/ -- Mode Keyword Injection

**Generated:** 2026-05-24

## OVERVIEW

Transform Tier hook on `messages.transform`. Scans the first user message for mode keywords and injects mode-specific system prompts. The detector and routing logic stay in `src/hooks/keyword-detector/`; prompt bodies now live in [`packages/prompts-core/prompts/`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/) so they can be shared by future harness adapters.

This matches the package layering direction in [`ROADMAP.md`](file:///Users/yeongyu/local-workspaces/omo/ROADMAP.md): `packages/prompts-core` owns static prompt content, while this OpenCode hook owns keyword detection, model routing, and message injection.

## KEYWORDS

| Keyword | Pattern | Effect |
|---------|---------|--------|
| `ultrawork` / `ulw` | `/\b(ultrawork|ulw)\b/i` | Full orchestration mode: parallel agents, deep exploration, relentless execution |
| Search mode | `SEARCH_PATTERN` (from `search/`) | Web/doc search focus prompt injection |
| Analyze mode | `ANALYZE_PATTERN` (from `analyze/`) | Deep analysis mode prompt injection |
| Team mode | `TEAM_PATTERN` (from `team/`) | Forces orchestration via `team_*` tools when user invokes `team mode` / `team-mode` / `team_mode` / `teammode`; instructs user to enable `team_mode.enabled` if tools are absent and reminds lead to run the closure sequence once every task is terminal |
| Hyperplan mode | `HYPERPLAN_PATTERN` (from `hyperplan/`) | Loads the `hyperplan` skill and injects adversarial planning mode guidance |
| Hyperplan-ultrawork combo | `HYPERPLAN_ULTRAWORK_PATTERN` (from `constants.ts`) | Prepends the combo banner, requires the `hyperplan` skill, then appends the routed ultrawork message |

## STRUCTURE

```
keyword-detector/
├── index.ts           # Barrel export
├── hook.ts            # createKeywordDetectorHook() chat.message handler
├── detector.ts        # detectKeywordsWithType() + extractPromptText()
├── constants.ts       # KEYWORD_DETECTORS array, re-exports from submodules
├── types.ts           # KeywordDetector, DetectedKeyword types
├── ultrawork/
│   ├── index.ts       # getUltraworkMessage() router
│   ├── source-detector.ts # agent/model routing helpers
│   ├── default.ts     # thin loader for prompts-core/prompts/ultrawork/default.md
│   ├── gpt.ts         # thin loader for prompts-core/prompts/ultrawork/gpt.md
│   ├── gemini.ts      # thin loader for prompts-core/prompts/ultrawork/gemini.md
│   └── planner.ts     # thin loader for prompts-core/prompts/ultrawork/planner.md
├── search/
│   ├── index.ts
│   └── default.ts     # SEARCH_PATTERN + SEARCH_MESSAGE from prompts-core mode prompt
├── analyze/
│   ├── index.ts
│   └── default.ts     # ANALYZE_PATTERN + ANALYZE_MESSAGE from prompts-core mode prompt
├── team/
│   ├── index.ts
│   └── default.ts     # TEAM_PATTERN + TEAM_MESSAGE from prompts-core mode prompt
└── hyperplan/
    ├── index.ts
    └── default.ts     # HYPERPLAN_PATTERN + HYPERPLAN_MESSAGE from prompts-core mode prompt
```

## PROMPT CONTENT LOCATIONS

| Prompt family | Markdown source |
|---------------|-----------------|
| Ultrawork default | [`packages/prompts-core/prompts/ultrawork/default.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/ultrawork/default.md) |
| Ultrawork GPT | [`packages/prompts-core/prompts/ultrawork/gpt.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/ultrawork/gpt.md) |
| Ultrawork Gemini | [`packages/prompts-core/prompts/ultrawork/gemini.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/ultrawork/gemini.md) |
| Ultrawork planner | [`packages/prompts-core/prompts/ultrawork/planner.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/ultrawork/planner.md) |
| Search mode | [`packages/prompts-core/prompts/mode/search.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/mode/search.md) |
| Analyze mode | [`packages/prompts-core/prompts/mode/analyze.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/mode/analyze.md) |
| Team mode | [`packages/prompts-core/prompts/mode/team.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/mode/team.md) |
| Hyperplan mode | [`packages/prompts-core/prompts/mode/hyperplan.md`](file:///Users/yeongyu/local-workspaces/omo/packages/prompts-core/prompts/mode/hyperplan.md) |

The `src/hooks/keyword-detector/{search,analyze,team,hyperplan}/default.ts` files keep the regex triggers in the hook layer and import the markdown-backed constants from `@oh-my-opencode/prompts-core`. The ultrawork files import markdown with Bun's `.md` text loader so the exact prompt bytes are bundled into `dist/index.js`.

## ULTRAWORK VARIANT ROUTING

[`ultrawork/source-detector.ts`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/keyword-detector/ultrawork/source-detector.ts) decides the ultrawork source in priority order:

1. Planner agents (`prometheus`, `planner`, or normalized `plan`) route to `planner.md`.
2. GPT family models, as detected by `isGptModel(modelID)`, route to `gpt.md`.
3. Gemini family models, as detected by `isGeminiModel(modelID)`, route to `gemini.md`.
4. Everything else routes to `default.md`.

[`ultrawork/index.ts`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/keyword-detector/ultrawork/index.ts) exposes `getUltraworkMessage(agentName, modelID)`, switches on that source, and returns the loaded markdown body.

## DETECTION LOGIC

```
chat.message (user input)
  -> extractPromptText(parts)
  -> isSystemDirective? skip
  -> removeSystemReminders(text)  # strip <SYSTEM_REMINDER> blocks
  -> detectKeywordsWithType(cleanText, agentName, modelID, disabledKeywords)
  -> isNonOmoAgent(agentName)? filter keyword injection
  -> isPlannerAgent(agentName)? filter standalone ultrawork
  -> for each detected keyword: inject mode message into output
```

## CONFIG

```jsonc
{
  "keyword_detector": {
    // Skip injection for any keyword in this list.
    // Allowed: "ultrawork", "search", "analyze", "team", "hyperplan", "hyperplan-ultrawork".
    "disabled_keywords": ["search", "analyze"]
  }
}
```

Default: empty/missing means every detector is active. Schema lives at [`src/config/schema/keyword-detector.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/keyword-detector.ts).

## GUARDS

- **System directive skip**: Messages tagged as system directives are not scanned (prevents infinite loops)
- **Planner agent filter**: Prometheus/plan agents do not receive `ultrawork` injection
- **Non-OMO agent filter**: OpenCode built-in Builder/Plan agents do not receive keyword injection
- **Session agent tracking**: Uses `getSessionAgent()` to get actual agent (not just input hint)
- **Model-aware messages**: `getUltraworkMessage(agentName, modelID)` adapts message to active model
- **Prompt byte baselines**: `mode-prompt-baseline.test.ts` pins mode prompt hashes; `ultrawork/ultrawork-byte-exactness.test.ts` pins ultrawork prompt hashes
