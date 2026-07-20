# Logging — Cross-Language Methodology

Every log line has exactly two legitimate readers: the operator reconstructing an incident and the developer reproducing a bug. A line that serves neither is cost — storage, noise, and attention stolen from the lines that matter. Everything below derives from that.

This reference is deliberately stack-agnostic. It never tells you which logging library to use — the ecosystem table in SKILL.md owns stack defaults, and the project's existing practice overrides everything (Rule 0).

---

## Rule 0 — Discover the project's practice before emitting anything

**BEFORE adding a single log line, find out how this project logs.** Grep for the logger initialization, a wrapper module, prior art in sibling files, and the project's agent docs (AGENTS.md / CLAUDE.md).

| What you find | Required behavior |
|---|---|
| A designated logger or wrapper | Use it exactly — its levels, its field conventions, its error-passing shape. Copy the call shape of the nearest well-written call site, not your habit. |
| A logging lib you like better | Irrelevant. NEVER introduce a second logging framework into a project that already has one. |
| Raw `console.*` / `print` culture | Follow it for user-facing CLI output. For diagnostics, propose structured logging in your reply — do not unilaterally convert the project. |
| **No logging at all** (library, small CLI, script) | **Respect the absence.** A library that suddenly logs is a behavior change its consumers never asked for; a 40-line script does not need a logging framework. If logging would genuinely help, say so in your reply — add it only when the user asks or the task itself is about observability. |

Bypassing the project's designated logger with a bare `console.log` / `print` "just for this one line" is the logging equivalent of `as any`: it escapes every contract the project set up — stage routing, formatting, redaction, shipping.

Serialization contracts (reserved field names, argument order, the key an Error must be passed under) are project knowledge. Discover the contract from the logger config and existing call sites; if the project's agent docs do not record it, record what you found there as part of your change.

## Greenfield — when you own the setup

A new service earns exactly this much logging infrastructure, and no more:

1. **One init module.** Callers import a ready logger; only the init module knows the stage. No call site ever checks `NODE_ENV`-style vars to decide how to log.
2. **Stage split by environment.** Dev = human-readable (pretty, colorized). Prod = structured, machine-parseable (JSON to stdout). Same logger API on both — the stage changes the sink and format, never the call sites.
3. **Level threshold per stage.** Dev = `debug`, prod = `info`, overridable with a `LOG_LEVEL`-style env var.
4. **The stack's standard structured logger** (the ecosystem table in SKILL.md names the default) — never a hand-rolled one.
5. **Error-serialization proof.** Before trusting error logging, pass a real Error/exception through the PROD formatter once and assert the output preserves type, message, and stack. Every structured-logging stack has a reserved-key contract, and violating it typically produces an empty `{}` where the stack trace should have been — discovered during the incident. This is a one-line test; write it at setup time and the whole bug class is dead permanently.

## Choosing the level — consumer, not severity

**A level is a routing decision, not a severity vibe. Choose it by naming who consumes the line and what they do about it. If you cannot name the consumer, do not emit the line.**

| Level | Consumer and action | The line earns this level when |
|---|---|---|
| `error` | Alerting wakes a human NOW | **The service failed** at a user-visible operation and cannot recover on its own. |
| `warn` | Reviewed in batch — dashboards, weekly triage | The request SUCCEEDED but took an abnormal path: retry needed, fallback engaged, degraded mode, suspicious data. |
| `info` | Read during an incident to reconstruct the timeline | A state transition without which the request's story does not reconstruct: session/job/connection created, completed, destroyed. |
| `debug` | The developer reproducing locally | Detailed tracing. **Does not exist in prod.** |

Two corollaries that get violated constantly:

- **`error` means the SERVICE failed, not the request.** A 4xx is the client's mistake handled correctly — that is `warn` at most, `info` for routine misses. Reserve `error` for 5xx-class outcomes: the service could not do its job. Log 4xx as `error` and the alert channel drowns in noise from every crawler probing `/wp-admin`; a drowned alert channel is equivalent to no alerting.
- **A failure logged at `info` is invisible.** If the message says "failed", the level is `warn` or `error` — never `info`.

## Placement — log decisions, not work

Log where the system decides something, not where it does something:

- **Boundaries** — request in / response out, calls to external systems (and their failures).
- **State transitions** — create / complete / destroy of sessions, jobs, connections.
- **Decision points** — retry chosen, fallback engaged, cache bypassed, degraded mode entered.
- **The one place an error is finally handled.**

Never log inside pure functions, utilities, or private helpers — callers with context log outcomes; internals stay silent. Two mechanical rules:

- **One event, one line.** Log-and-rethrow at every layer turns one incident into five look-alike incidents. Log where the error is handled; layers that only propagate stay silent.
- **Mechanical logging belongs to middleware.** Request/response logging is wired once at the framework layer, never hand-assembled per handler. High-volume zero-signal paths (health probes, metrics scrapes) are excluded there as data — an exclusion set — not as scattered `if` statements.

**No speculative logs.** "Might need it later" is not a consumer. A log line earns its place through evidence: a debugging session that burned rounds because this state was invisible (see the debugging bridge below), an incident postmortem, an alert that needs the field.

## The line contract

- **The message is a stable, grep-able constant; data goes in fields.** `logger.warn({orderId, attempt}, "payment retry")` — never `` `retrying payment for ${orderId}` ``. An interpolated message cannot be counted, aggregated, or alerted on.
- **Correlation or it did not happen.** Request-scoped lines carry the trace/request id; entity-scoped lines carry the entity id. A line you cannot join to its request is noise during the only moments logs matter.
- **Name events semantically** (`session.destroy`, `payment.fallback`), never positionally ("Step 3"). Step numbers couple the log stream to today's call structure; the first refactor makes them lie.
- **No secrets.** Tokens, credentials, session cookies, and PII never enter a log line; URLs are sanitized (strip or redact query params like `token`, `key`) before logging. A leaked log is a leaked credential.
- **The logging path may not break the program.** If a log call can itself fail (serializing exotic state, a wrapper that touches I/O), that failure is caught, downgraded to a `warn` through a channel that cannot fail, and the operation continues. An empty catch around logging is still an empty catch.

## Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| `console.*` / `print` bypassing the project's designated logger | Escapes stage routing, redaction, and shipping — invisible in prod |
| Introducing a logging framework to a project that has none | Uninvited behavior change; Rule 0 violation |
| 4xx logged as `error` | Alert noise buries real pages |
| Log-and-rethrow at every layer | One incident looks like five |
| Variables interpolated into the message string | Un-aggregatable, un-alertable |
| "Might need it later" logs | No consumer → pure cost |
| Debug-time prints promoted to permanent `info` | Narration, not state transitions |
| Trusting Error serialization without the proof | `error: {}` in prod, discovered during the incident |

## Debugging bridge — how logs earn their place

When a `debugging`-skill session takes extra rounds *because state was invisible* — no line told you which branch ran, what the value was, whether the fallback engaged — that invisibility is a defect adjacent to the bug. **The fix ships with the log line that would have made diagnosis one round**: placed at a decision point, leveled by consumer, fields not interpolation, through the project's designated logger.

The inverse also holds: every temporary `print` / `dbg!` / `console.log` planted *during* diagnosis is a debug artifact and gets scrubbed at cleanup. The triage between the two is the consumer test — a line whose ongoing consumer you can name is part of the fix; a line that only served today's session is an artifact.
