/**
 * Token Management keyword detector.
 *
 * Triggers when the user wants to manage subscription token limits,
 * switch providers on exhaustion, or wait for token refresh.
 *
 * Trigger phrases:
 * - "manage tokens", "token management", "token limit"
 * - "token budget", "token quota", "token usage"
 * - "save tokens", "conserve tokens", "token aware"
 * - "subscription limit", "rate limit", "quota"
 * - "switch provider", "fallback provider", "alternative provider"
 */

export const TOKEN_MANAGEMENT_PATTERN =
  /\b(manage\s*tokens|token\s*manag|token\s*limit|token\s*budget|token\s*quota|token\s*usage|save\s*tokens|conserve\s*tokens|token[\s-]*aware|subscription\s*limit|rate\s*limit\s*manag|quota\s*manag|switch\s*provider|fallback\s*provider|alternative\s*provider|provider\s*fallback|token\s*refresh|tokens?\s*left|tokens?\s*remaining|out\s*of\s*tokens|no\s*tokens|tokens?\s*exhaust|tokens?\s*run\s*out)\b/i

export const TOKEN_MANAGEMENT_MESSAGE = `[token-management-mode]
TOKEN MANAGEMENT MODE. Monitor subscription token usage, enforce budgets, and handle provider exhaustion with intelligent fallback or wait strategies.

## EXISTING INFRASTRUCTURE (USE THESE - DO NOT REINVENT)

The codebase already has these hooks and systems for token/provider management:

| Hook/System | Purpose |
|-------------|---------|
| \`context-window-monitor\` | Tracks input/output/reasoning/cache tokens per session. Warns at 70% threshold. |
| \`preemptive-compaction\` | Auto-triggers compaction at 78% context usage before hitting hard limit. |
| \`runtime-fallback\` | Auto-switches models on API errors (429, 500, 502, 503, 504). Cooldown 60s. Max 3 attempts. |
| \`model-fallback\` | Provider-level model fallback chains per agent. Progresses through fallback entries on error. |
| \`anthropic-context-window-limit-recovery\` | Multi-strategy recovery: truncation, deduplication, aggressive truncation, summarize-retry. |
| \`context-limit-resolver\` | Resolves actual context limits per provider/model (Anthropic 200k/1M, others via cache). |
| \`AGENT_MODEL_REQUIREMENTS\` | Fallback chains per agent: provider list + model + variant. |

## PHASE 1: Token Inventory & Status Check (MANDATORY FIRST STEP)

Before any work, assess the current token situation:

### 1.1 Check Current Provider Status

\`\`\`
For each configured provider, determine:
- Provider name and model
- Whether API key is configured
- Recent error history (rate limits, quota errors)
- Estimated remaining capacity (if trackable)
\`\`\`

### 1.2 Identify Available Fallback Chain

The \`runtime-fallback\` hook already defines fallback behavior. Check:

\`\`\`
FALLBACK CHAIN (from AGENT_MODEL_REQUIREMENTS):
  Primary:    [current provider/model]
  Fallback 1: [next in chain]
  Fallback 2: [next in chain]
  ...

For each entry, verify:
  - Is the provider connected? (connected-providers-cache)
  - Is the API key valid?
  - Has it been rate-limited recently? (cooldown_seconds check)
\`\`\`

### 1.3 Report Token Status to User

Display a clear status table:

\`\`\`
TOKEN STATUS
============
Provider        | Model              | Status          | Notes
----------------|--------------------|-----------------|-----------------
anthropic       | claude-opus-4-6  | ACTIVE          | Primary
openai          | gpt-5.4            | AVAILABLE       | Fallback 1
google          | gemini-2.5-pro     | AVAILABLE       | Fallback 2
copilot         | claude-opus-4-6  | RATE_LIMITED     | Cooldown: 45s remaining
\`\`\`

## PHASE 2: Token Conservation Strategy

### 2.1 Proactive Token Saving

When token conservation is requested:

1. **Reduce context size** - Use \`preemptive-compaction\` aggressively (lower threshold)
2. **Minimize tool output** - Use targeted reads with offset/limit instead of full file reads
3. **Batch operations** - Combine independent tool calls to reduce round-trips
4. **Skip unnecessary exploration** - Use cached knowledge when confident
5. **Delegate to cheaper models** - Use \`task(category="quick")\` for simple subtasks (uses cheaper model)

### 2.2 Token Budget Enforcement

If the user specifies a token budget:

\`\`\`
BUDGET TRACKING:
  Total budget:    [N tokens]
  Used so far:     [M tokens] (from context-window-monitor)
  Remaining:       [N-M tokens]
  Burn rate:       [tokens/message average]
  Est. messages:   [remaining / burn_rate]

THRESHOLDS:
  50% used  -> Switch to concise responses, minimize exploration
  75% used  -> Critical mode: only essential operations, no background agents
  90% used  -> STOP and report. Ask user before continuing.
  100% used -> Halt. Switch provider or wait for refresh.
\`\`\`

## PHASE 3: Provider Exhaustion Handling

When the current provider's tokens are exhausted (quota exceeded, rate limited, insufficient credits):

### 3.1 Decision Matrix

| Condition | Action |
|-----------|--------|
| Fallback provider available & connected | Switch immediately via \`runtime-fallback\` chain |
| Fallback available but rate-limited | Wait for cooldown (\`cooldown_seconds\`, default 60s) then retry |
| All providers exhausted, refresh < 15 min | WAIT for token refresh, notify user with countdown |
| All providers exhausted, refresh > 15 min | Report status, save session state for later resume |
| User specified "wait" preference | Always wait for current provider refresh, never fallback |
| User specified "switch" preference | Always try fallback first, never wait |

### 3.2 Automatic Provider Switch

When switching providers:

1. Log the switch reason and target:
   \`\`\`
   [token-management] Switching: anthropic/claude-opus-4-6 -> openai/gpt-5.4
   Reason: Rate limit (429) - quota exceeded
   Cooldown on anthropic: 60s
   \`\`\`

2. The \`runtime-fallback\` hook handles the actual model switch automatically on error.
   For PROACTIVE switching (before hitting the error):
   - Check remaining token estimate
   - If below threshold, recommend switch in advance
   - User confirms -> update session model

3. Preserve context:
   - Compaction state carries over
   - Todo list persists across providers
   - Session history maintained

### 3.3 Wait for Token Refresh

When waiting is the strategy:

1. **Determine refresh time**:
   - Parse "quota will reset after" from error messages (RETRYABLE_ERROR_PATTERNS)
   - Common intervals: Anthropic (per-minute), OpenAI (per-minute/per-day), Copilot (monthly)

2. **Wait behavior**:
   - Show countdown to user
   - Save current session state (todos, context, progress)
   - Set a timer notification
   - Resume automatically when tokens refresh

3. **During wait**:
   - Summarize what was accomplished so far
   - List pending tasks that need tokens
   - Offer to switch provider if user changes mind

## PHASE 4: Ongoing Monitoring

Throughout the session, continuously:

1. **Track token velocity** - tokens consumed per message/minute
2. **Project exhaustion time** - "At current rate, tokens exhaust in ~N messages"
3. **Preemptive warnings** - Alert at 50%, 75%, 90% thresholds
4. **Log all provider switches** - maintain audit trail in session

## RULES

- NEVER silently switch providers without logging/notifying
- NEVER continue work after budget is exhausted without user confirmation
- ALWAYS prefer the user's stated preference (wait vs switch)
- ALWAYS report token status when asked, even mid-task
- Use existing hooks (\`runtime-fallback\`, \`model-fallback\`, \`context-window-monitor\`) - do NOT reimplement
- Compaction is your friend - trigger it proactively to extend token runway
- When delegating subtasks, prefer \`category="quick"\` to use cheaper models
- Track cumulative usage across provider switches`
