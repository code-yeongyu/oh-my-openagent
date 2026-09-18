# Phase 4 — Oracle Triple Consultation

At 2 consecutive failed hypothesis rounds, stop investigating and reframe. Continuing past two failures usually means the real cause is in a category you haven't imagined — and more time on your current mental model is wasted time.

The Oracle Triple is how you break out of the mental box.

> ⚠️ **Wrong tool for non-debugging tasks.** The Triple is for *stuck root-cause hunts*. If your task is producing an artifact (extraction, reverse engineering, audit, compliance documentation) and you want a skeptical review before declaring it done, use the **Verification Oracle** pattern in [partial-runtime-evidence.md](partial-runtime-evidence.md#verification-oracle-pattern-for-non-debug-tasks). Running the Triple on a finished extraction returns three diverging "what if you tried…" tangents that are not what you need.

---

## When to invoke

| Situation | Invoke? |
|---|---|
| 1 round failed, you have new distinguishing evidence | No — run one more round with a refined hypothesis set |
| 2 rounds failed, hypotheses now feel like variations of each other | **Yes — invoke now** |
| 2 rounds failed, no new evidence angles left to try | **Yes — invoke now** |
| You've been investigating >2 hours on the same bug | **Yes — invoke now regardless of round count** |
| 1 round failed but the user is watching and wants speed | No — one round isn't enough to justify Oracle cost. Resist the urge. |

---

## Why three Oracles, and why *orthogonal* framings

A single Oracle call returns a single coherent analysis. Coherent analyses tend to inherit the framing of the prompt, which means they inherit the same blind spots the investigator already has. Three Oracles with *orthogonal framings* force the analyses to diverge, and the places where they agree across frames is where the real signal lives.

The three framings below are chosen to cover distinct bug-cause categories:

- **A (obvious-but-missed)** — embarrassingly simple causes the investigator walked past.
- **B (system-boundary)** — causes living at integration seams, not in the code being read.
- **C (invariant-violation)** — assumptions load-bearing to current hypotheses that may themselves be false.

Spawn all three in parallel.

---

## The three prompts

```
task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far, verbatim, with file:line refs]

     Framing A — OBVIOUS-BUT-MISSED.
     What is the most embarrassing, most obvious cause that a senior engineer would spot in 30 seconds and we've overlooked? Consider:
     - typos, off-by-one
     - wrong variable name / wrong constant / wrong import
     - stale cache, wrong file edited, wrong process inspected
     - attached to the wrong instance of the service
     - test harness running different code than the app
     - editing src/ while running dist/

     Give me exactly three candidate causes ranked by likelihood, with one sentence each explaining why our evidence is consistent with each.")

task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far]

     Framing B — SYSTEM-BOUNDARY.
     What if the bug is NOT in the code we've been reading, but at a boundary? Consider:
     - third-party SDK behavior that contradicts its docs
     - middleware that mutates the request or response
     - a proxy/gateway/load balancer that rewrites headers or bodies
     - build-time vs runtime env-var resolution
     - module-load-order issue
     - shared-library version mismatch (system lib vs bundled lib)
     - ABI difference (native addons, glibc versions, musl vs glibc)
     - wrong transport (HTTP/1.1 vs HTTP/2, TLS version negotiation)

     Give me three candidate causes, each naming the specific boundary and the specific contract assumption that might be violated.")

task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far]

     Framing C — INVARIANT-VIOLATION.
     Which invariants that we've been ASSUMING TRUE might actually be false?
     Enumerate the five assumptions most load-bearing to our current hypotheses, then for each:
     - describe the smallest runtime query that would falsify it
     - predict what the observable would be if the invariant holds vs if it fails

     We want at least one of these queries to be decisive.")
```

---

## Synthesizing across three Oracles

**Do not pick the highest-ranked candidate from a single Oracle.** That defeats the purpose of getting three framings.

Instead, walk the outputs in this order:

### 1. Agreement scan

Note which candidate causes appear in at least two Oracles' outputs. Independent agreement across orthogonal framings is strong signal — when the obvious-but-missed framing and the system-boundary framing both land on the same cause, that's usually the bug.

### 2. Disagreement scan

Note where Oracles disagree. Disagreement is genuine uncertainty that runtime evidence (not more reasoning) must resolve. Each disagreement becomes a candidate for the next round's distinguishing query.

### 3. New falsification queries

Framing C produces concrete "one query that would decide it" suggestions. Pull these verbatim into your new round's evidence-gathering plan — they are designed to be decisive.

### 4. Build the new hypothesis set

Minimum 3, same rules as Phase 2. Aim to have hypotheses drawn from the agreement scan (likely cause) AND from the disagreement scan (so one round's evidence resolves the disagreement).

Record in the journal:

```markdown
## Oracle Triple — Round <N>
- Invoked at: <ISO timestamp>
- Framing A summary: <top 3 candidates, one line each>
- Framing B summary: <top 3 candidates>
- Framing C summary: <5 load-bearing assumptions + falsification queries>

### Cross-framing agreement
- <candidate> appeared in A + B
- <candidate> appeared in B + C

### New hypothesis set
1. <hypothesis> — evidence to gather: <one-liner>
2. ...
```

### 5. Reset the counter

Reset the "consecutive failed rounds" counter to 0. Return to Phase 3 (parallel investigation) with the new set.

---

## If *another* 2 rounds fail after the Oracle Triple

You are genuinely stuck. This is the escalation threshold.

Escalate to the user (see `05-escalate.md`) with the full trace: every hypothesis tried, every piece of evidence captured, both Oracle syntheses. Do not guess a fix.

This is rare — in practice, the Oracle Triple resolves almost all stuck debugging sessions within one round, because it pulls in framings the investigator was too close to the code to see.
