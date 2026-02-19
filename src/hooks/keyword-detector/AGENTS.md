# src/hooks/keyword-detector/ — Mode Keyword Injection

**Generated:** 2026-02-19

## OVERVIEW

8 files + 3 mode subdirs (~1665 LOC). Transform Tier hook on `messages.transform`. Scans first user message for mode keywords (ultrawork, search, analyze) and injects mode-specific system prompts.

## KEYWORDS

| Keyword | Pattern | Effect |
|---------|---------|--------|
| `ultrawork` / `ulw` | `/\b(ultrawork|ulw)\b/i` | Full orchestration mode — parallel agents, deep exploration, relentless execution |
| Search mode | `SEARCH_PATTERN` (from `search/`) | Web/doc search focus prompt injection |
| Analyze mode | `ANALYZE_PATTERN` (from `analyze/`) | Deep analysis mode prompt injection |

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
└── analyze/
    ├── index.ts
    ├── pattern.ts     # ANALYZE_PATTERN regex
    └── message.ts     # ANALYZE_MESSAGE
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
