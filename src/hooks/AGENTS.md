# HOOKS KNOWLEDGE BASE

## OVERVIEW

Lifecycle hooks that intercept/modify agent behavior. Inject context, enforce rules, recover from errors, notify on events.

## STRUCTURE

```
hooks/
├── agent-usage-reminder/       # Remind to use specialized agents
├── anthropic-context-window-limit-recovery/     # Auto-compact Claude at token limit
├── auto-slash-command/         # Auto-detect and execute /command patterns
├── auto-update-checker/        # Version update notifications
├── background-notification/    # OS notify on background task complete
├── claude-code-hooks/          # Claude Code settings.json integration
├── comment-checker/            # Prevent excessive AI comments
│   ├── filters/                # Filtering rules (docstring, directive, bdd, etc.)
│   └── output/                 # Output formatting
├── compaction-context-injector/ # Inject context during compaction
├── directory-agents-injector/  # Auto-inject AGENTS.md files
├── directory-readme-injector/  # Auto-inject README.md files
├── empty-message-sanitizer/    # Sanitize empty messages
├── interactive-bash-session/   # Tmux session management
├── keyword-detector/           # Detect ultrawork/search keywords
├── non-interactive-env/        # CI/headless environment handling
├── preemptive-compaction/      # Pre-emptive session compaction
├── ralph-loop/                 # Self-referential dev loop until completion
├── rules-injector/             # Conditional rules from .claude/rules/
├── session-recovery/           # Recover from session errors
├── think-mode/                 # Auto-detect thinking triggers
├── thinking-block-validator/   # Validate thinking blocks in messages
├── context-window-monitor.ts   # Monitor context usage (standalone)
├── empty-task-response-detector.ts
├── session-notification.ts     # OS notify on idle (standalone)
├── todo-continuation-enforcer.ts # Force TODO completion (standalone)
└── tool-output-truncator.ts    # Truncate verbose outputs (standalone)
```

## HOOK CATEGORIES

| Category | Hooks | Purpose |
|----------|-------|---------|
| Context Injection | directory-agents-injector, directory-readme-injector, rules-injector, compaction-context-injector | Auto-inject relevant context |
| Session Management | session-recovery, anthropic-context-window-limit-recovery, preemptive-compaction, empty-message-sanitizer | Handle session lifecycle |
| Output Control | comment-checker, tool-output-truncator | Control agent output quality |
| Notifications | session-notification, background-notification, auto-update-checker | OS/user notifications |
| Behavior Enforcement | todo-continuation-enforcer, keyword-detector, think-mode, agent-usage-reminder | Enforce agent behavior |
| Environment | non-interactive-env, interactive-bash-session, context-window-monitor | Adapt to runtime environment |
| Compatibility | claude-code-hooks | Claude Code settings.json support |

## HOW TO ADD A HOOK

1. Create directory: `src/hooks/my-hook/`
2. Create files:
   - `index.ts`: Export `createMyHook(input: PluginInput)`
   - `constants.ts`: Hook name constant
   - `types.ts`: TypeScript interfaces (optional)
   - `storage.ts`: Persistent state (optional)
3. Return event handlers: `{ PreToolUse?, PostToolUse?, UserPromptSubmit?, Stop?, onSummarize? }`
4. Export from `src/hooks/index.ts`
5. Register in main plugin

## HOOK EVENTS

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| PreToolUse | Before tool exec | Yes | Validate, modify input |
| PostToolUse | After tool exec | No | Add context, warnings |
| UserPromptSubmit | On user prompt | Yes | Inject messages, block |
| Stop | Session idle | No | Inject follow-ups |
| onSummarize | During compaction | No | Preserve critical context |

## COMMON PATTERNS

- **Storage**: Use `storage.ts` with JSON file for persistent state across sessions
- **Once-per-session**: Track injected paths in Set to avoid duplicate injection
- **Message injection**: Return `{ messages: [...] }` from event handlers
- **Blocking**: Return `{ blocked: true, message: "reason" }` from PreToolUse

## ANTI-PATTERNS (HOOKS)

- **Heavy computation** in PreToolUse: Slows every tool call
- **Blocking without clear reason**: Always provide actionable message
- **Duplicate injection**: Track what's already injected per session
- **Ignoring errors**: Always try/catch, log failures, don't crash session
