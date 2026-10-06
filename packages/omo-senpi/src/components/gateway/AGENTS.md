# gateway component

Operating-rules injection for gateway sessions (omo-gateway todo 16). The scope lead and every session with an active binding get their scope's compiled behavioral rules as one `<operating-rules version="<rules sha>">` block in the system prompt; a rules commit appends exactly one `rules_changed` delivery per affected session.

## Boundary

Rules are COMPUTED by the gateway package (its store, compiler and commit path; closed source). omo owns only the mechanics, through the `gateway_rules` store extension this component registers on the session-gateway store:

- `rulesCommitted({scope, version, now, targets})` - renders each target's block, upserts `gateway_rules_blocks` when the version moved (`WHERE version != excluded.version`, so an unchanged commit writes nothing), deletes the row when a target's `behavioral` is null (the session lost its binding or its rules), and appends the `rules_changed` delivery via `tx.enqueue`. The event id `rules_changed:<scope>:<version>:<session>` keys the delivery receipt, so a retried commit replays instead of delivering twice - exactly one delivery per session per version, even when the caller passes the same session twice.
- `blockForSession({session_durable_id})` - the per-turn read the prompt handler runs.
- `sessionsWithRules({scope})` - lists a scope's block rows (`{sessions: [{session_durable_id, version}]}`, ordered by session id) so the gateway can compare them against the sessions that should have rules now and send `behavioral: null` for the rest - the only way to clear a session whose binding ended while the connector was down.

The caller (the gateway package) passes ONE target per affected session, choosing any active binding as the delivery path (none for a lead without one). No rules logic lives here: the block content is whatever the caller compiled, and mechanical gate params are never rendered into the prompt block - behavioral text only. Rule text is untrusted (humans set it in chat), so behavioral lines, scope and version render with `&`, `<` and `>` escaped: a rule carrying the end sentinel or the closing tag can neither break the byte-identical turn guarantee nor close the block early, and the `rules_changed` delivery text escapes scope and version the same way.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Component factory. Lazily connects on the first `before_agent_start` that needs it: a non-empty `gateway.scopes` config section plus an existing store database plus the built ops artifact are all required, else the component stays inert for the process (registration failures retry with a warn-once). Owns its own store facade beside the thread component's, like every out-of-process gateway client does. |
| `prompt.ts` | `createGatewayRulesPromptHandler`: reads the session's block row and composes it into `before_agent_start`. Returns `undefined` for every session without a committed row, so an unbound session's prompt passes through byte-identical (a REQUIRED test). Lookup failures pass the prompt through and warn once. |
| `rules-block.ts` | The deterministic block renderer plus the sentinel compose (replace the previous turn's region, never append a second one). |
| `store-extension/` | The worker-side ops module (`index.ts`) and the registration descriptor (`migrations.ts`) shared by the component and the ops module so the two cannot drift. The plugin build emits it as `extensions/gateway-rules-extension.mjs` beside `omo.js`; from source there is no artifact and the component stays inert (tests build it into a temp dir). |

## Tests

Colocated, against a real store (`thread/gateway/testing/harness`): block content for the bound chat, exactly-one `rules_changed` per session per version (repeat commit replays, duplicate target replays, new version delivers), row removal, malformed-args refusal, the byte-identical pass-through, identical bytes across turns on one version, block replacement on a new version, and the activation gates (no config / no database = no store creation).
