# src/hooks/keyword-detector/ — Mode Keyword Injection

**Generated:** 2026-05-18

## OVERVIEW

Transform Tier hook on `messages.transform`. Scans first user message for mode keywords (ultrawork, search, analyze, team, hyperplan) and injects mode-specific system prompts.

## KEYWORDS

| Keyword             | Pattern                                     | Effect                                                                                       |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ultrawork` / `ulw` | `/\b(ultrawork\|ulw)\b/i`                   | Full orchestration mode — parallel agents, deep exploration, relentless execution            |
| Search mode         | `SEARCH_PATTERN` (from `defaults.jsonc`)    | Web/doc search focus prompt injection                                                        |
| Analyze mode        | `ANALYZE_PATTERN` (from `defaults.jsonc`)   | Deep analysis mode prompt injection                                                          |
| Team mode           | `TEAM_PATTERN` (from `defaults.jsonc`)      | Forces orchestration via `team_*` tools when user invokes `team mode` / `팀 모드` / `팀으로` |
| Hyperplan mode      | `HYPERPLAN_PATTERN` (from `defaults.jsonc`) | Adversarial multi-agent planning via team-mode                                               |
| Hyperplan-ultrawork | `HYPERPLAN_ULTRAWORK_PATTERN` (TypeScript)  | Combo: ultrawork execution + hyperplan workflow                                              |

## STRUCTURE

```
keyword-detector/
├── index.ts           # Barrel export
├── hook.ts            # createKeywordDetectorHook() — chat.message handler
├── detector.ts        # detectKeywordsWithType() + extractPromptText() + config overrides
├── constants.ts       # KEYWORD_DETECTORS array, loads from defaults.jsonc, dynamic patterns
├── defaults.jsonc     # Static patterns + messages (single source of truth)
├── types.ts           # KeywordDetectorState type
└── ultrawork/
    ├── index.ts
    ├── message.ts     # getUltraworkMessage() — dynamic prompt by agent/model
    └── isPlannerAgent.ts
```

## DETECTION LOGIC

```
chat.message (user input)
  → extractPromptText(parts)
  → isSystemDirective? → skip
  → removeSystemReminders(text)  # strip <SYSTEM_REMINDER> blocks
  → detectKeywordsWithType(cleanText, agentName, modelID, disabledKeywords, modes)
  → applyPatternAppend(type, pattern, modeConfig)  # user custom trigger words
  → applyMessageOverride(type, message, modeConfig) # user custom messages
  → isPlannerAgent(agentName)? → filter out ultrawork
  → for each detected keyword: inject mode message into output
```

## CONFIG

```jsonc
{
  "keyword_detector": {
    // Skip injection for any keyword in this list.
    "disabled_keywords": ["search", "analyze"],

    // Customize individual modes (all fields optional per mode)
    "modes": {
      "search": {
        // Append trigger words to default pattern (plain string, compiled with `i` flag)
        "pattern_append": "|lookup|hunt",
        // Append content to default message
        "message_append": "\n\nAlso use: ace_search_context, tavily_tavily_search, deepwiki_ask_question.",
        // Fully replace default message (takes precedence over message_append)
        // "message": "[custom-search] Your custom message here."
      },
      "analyze": {
        "message_append": "\n\nAlso use: deepwiki_ask_question for library internals.",
      },
      "team": {
        "message_append": "\n\nCustom team guidance.",
      },
      "hyperplan": {
        "message_append": "\n\nCustom hyperplan guidance.",
      },
      // ultrawork and hyperplan-ultrawork: only pattern_append is supported
      // (messages are dynamic, based on agent/model)
    },
  },
}
```

Default: empty/missing → all six detectors active with default patterns/messages. Schema lives at [src/config/schema/keyword-detector.ts](../../config/schema/keyword-detector.ts).

## MODES CONFIG RULES

| Field            | Applies to                                           | Behavior                                                                                  |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pattern_append` | All 6 modes                                          | Appended to default pattern source, compiled as `new RegExp(defaultSource + append, "i")` |
| `message_append` | Static modes only (search, analyze, team, hyperplan) | Appended to resolved default message                                                      |
| `message`        | Static modes only                                    | Fully replaces default message (takes precedence over `message_append`)                   |

- **Dynamic modes** (ultrawork, hyperplan-ultrawork): Schema only accepts `pattern_append`; `message` and `message_append` are rejected in user config. If those fields reach runtime through an internal schema bypass, they are ignored defensively because messages are generated from agent/model.
- **Invalid regex** in `pattern_append`: Falls back to default pattern with console warning.
- **Backward compatibility**: No `modes` config = identical behavior to before.

## GUARDS

- **System directive skip**: Messages tagged as system directives are not scanned (prevents infinite loops)
- **Planner agent filter**: Prometheus/plan agents do not receive `ultrawork` injection
- **Session agent tracking**: Uses `getSessionAgent()` to get actual agent (not just input hint)
- **Model-aware messages**: `getUltraworkMessage(agentName, modelID)` adapts message to active model
- **Pattern max length**: `pattern_append` limited to 500 characters (Zod validation)
