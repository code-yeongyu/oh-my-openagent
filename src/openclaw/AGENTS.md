# src/openclaw/ — OpenClaw Gateway Integration

## OVERVIEW

This subtree is a focused integration layer for waking external OpenClaw-style gateways from OMO runtime events. It resolves gateway config, interpolates instructions, enriches event context, optionally captures tmux state, dispatches HTTP/command wakeups, and manages reply-listener lifecycle.

## STRUCTURE

```text
openclaw/
├── index.ts           # public wake/init entrypoints
├── config.ts          # gateway resolution + event mapping
├── dispatcher.ts      # HTTP/command dispatch, URL validation, timeouts
├── reply-listener.ts  # inbound reply listener lifecycle
├── tmux.ts            # tmux discovery, pane capture, send-keys helpers
├── session-registry.ts
├── daemon.ts
└── types.ts
```

## KEY INVARIANTS

- Only whitelisted context fields should leave OMO; `buildWhitelistedContext()` is the boundary.
- HTTP gateways must be HTTPS, except explicit localhost loopback exceptions.
- Command gateways are shell-interpolated and must keep timeout and escaping guarantees intact.
- tmux capture is opportunistic context enrichment, not a hard dependency.
- `initializeOpenClaw()` should remain side-effect-light and only start reply listeners when config explicitly enables them.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Gateway routing/config | `config.ts`, `index.ts` | event → gateway resolution |
| HTTP vs command dispatch | `dispatcher.ts` | validates URLs, escapes shell args, enforces timeouts |
| tmux-derived context | `tmux.ts` | session discovery and pane capture |
| Reply channel lifecycle | `reply-listener.ts` | Discord/Telegram-style reply integration |

## ANTI-PATTERNS

- Do not send the full OMO session context blindly; preserve the whitelist boundary.
- Do not weaken URL validation to allow arbitrary insecure remote HTTP endpoints.
- Do not bypass shell escaping when interpolating command gateways.
- Do not make tmux availability mandatory for successful dispatch.
- Do not hide dispatch failures behind silent behavior changes; return structured wake results.

## VERIFICATION

- Read both `index.ts` and `dispatcher.ts` before changing dispatch semantics.
- If changing tmux integration, review `tmux.ts` and any session/reply listener callers together.
- Run the package validation flow after meaningful edits:

```bash
bun run typecheck
bun test
bun run build
```
