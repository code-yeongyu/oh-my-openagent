# src/hooks/keyword-detector/ — Mode Keyword Injection

**Generated:** 2026-04-11

## OVERVIEW

Transform Tier hook on `messages.transform`. Scans first user message for mode keywords (ultrawork, search, analyze, team) and injects mode-specific system prompts.

## KEYWORDS

| Keyword | Pattern | Effect |
|---------|---------|--------|
| `ultrawork` / `ulw` | `/\b(ultrawork|ulw)\b/i` | Full orchestration mode — parallel agents, deep exploration, relentless execution |
| Search mode | `SEARCH_PATTERN` (from `search/`) | Web/doc search focus prompt injection |
| Analyze mode | `ANALYZE_PATTERN` (from `analyze/`) | Deep analysis mode prompt injection |
| Team mode | `TEAM_PATTERN` (from `team/`) | Forces orchestration via `team_*` tools when user invokes `team mode` / `팀 모드` / `팀으로`; instructs user to enable `team_mode.enabled` if tools are absent |

## STRUCTURE

```
keyword-detector/
├── index.ts           # Barrel export
├── hook.ts            # createKeywordDetectorHook() — chat.message handler
├── detector.ts        # detectKeywordsWithType() + extractPromptText()
├── constants.ts       # KEYWORD_DETECTORS array, re-exports from submodules
├── types.ts           # KeywordDetector, DetectedKeyword types
├── ultrawork/
│   ├── index.ts
│   ├── message.ts     # getUltraworkMessage() — dynamic prompt by agent/model
│   └── isPlannerAgent.ts
├── search/
│   ├── index.ts
│   ├── pattern.ts     # SEARCH_PATTERN regex
│   └── message.ts     # SEARCH_MESSAGE
├── analyze/
│   ├── index.ts
│   └── default.ts     # ANALYZE_PATTERN + ANALYZE_MESSAGE
└── team/
    ├── index.ts
    └── default.ts     # TEAM_PATTERN + TEAM_MESSAGE
```

## DETECTION LOGIC

```
chat.message (user input)
  → extractPromptText(parts)
  → isSystemDirective? → skip
  → removeSystemReminders(text)  # strip <SYSTEM_REMINDER> blocks
  → detectKeywordsWithType(cleanText, agentName, modelID)
  → isPlannerAgent(agentName)? → filter out ultrawork
  → for each detected keyword: inject mode message into output
```

## GUARDS

- **System directive skip**: Messages tagged as system directives are not scanned (prevents infinite loops)
- **Planner agent filter**: Prometheus/plan agents do not receive `ultrawork` injection
- **Session agent tracking**: Uses `getSessionAgent()` to get actual agent (not just input hint)
- **Model-aware messages**: `getUltraworkMessage(agentName, modelID)` adapts message to active model
