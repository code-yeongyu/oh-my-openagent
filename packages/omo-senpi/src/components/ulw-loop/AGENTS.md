# ulw-loop component

## OVERVIEW

Session-scoped ULW status loop and footer integration. It reads the external status runner, decides whether boulder work can continue, and routes one hidden continuation through the shared idle coordinator when available.

## WHERE TO LOOK

| Path | Role |
|------|------|
| `index.ts` | Component event handlers, status parsing, continuation gates, and hidden delivery. |
| `omo-command.ts` | Resolves and runs the trusted status command with output/error containment. |
| `session-scope.ts` | Normalizes event session IDs and derives session-specific status/goal paths. |
| `footer-status.ts` | Animated footer lifecycle and timer cleanup. |
| `*.test.ts` | Event, filesystem, command-containment, session-scope, and footer behavior. |

## CONVENTIONS

- Every status lookup is scoped to the event session. If the host cannot prove ownership, the component fails closed rather than reading another session's plan or status.
- The component is inert when the trusted status executable cannot be resolved; it still installs safe no-op handlers so extension composition can continue.
- Continuation eligibility is checked against active status, stale status, session identity, and boulder-work state. A sibling execute-continuation component suppresses duplicate delivery.
- The idle coordinator is preferred for hidden injection because it batches keyed entries. Direct fallback delivery preserves the hidden custom-message route.
- Footer timers and listeners are disposed on session switch and shutdown; injected schedulers make timing behavior testable without sleeps.
- Malformed or unexpected command output is logged and ignored, never treated as active work.

## ANTI-PATTERNS

- Do not use an unscoped status or goals path, infer a session ID from the current directory, or continue when session ownership is unknown.
- Do not execute an arbitrary path supplied by status output or accept a command result outside the containment checks.
- Do not enqueue a second continuation while boulder continuation is already active, after stale status, or after a rejected run-command event.
- Do not leave footer timers alive across session switches or shutdown.
