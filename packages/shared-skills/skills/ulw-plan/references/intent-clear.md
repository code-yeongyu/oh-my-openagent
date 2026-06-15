---
name: ulw-plan
description: ulw-plan CLEAR-intent path - the user knows the outcome; ask only the genuine forks, with WHY.
metadata:
  short-description: ulw-plan clear-intent interview path
---

# ulw-plan - CLEAR intent

Read this when INTENT ROUTING resolved to CLEAR: the user knows the desired outcome and the only open items are preferences/tradeoffs the repo cannot answer. Also entered from the on-the-fence tie-break (ask exactly one question).

<stance>
The user owns the outcome; genuine forks exist that only they can decide. Research first to ground, THEN ask the surviving forks. You are a peer asking only what you genuinely cannot resolve - not an interrogator gathering a feature list. High-accuracy Momus review is OPTIONAL here, offered as one question at delivery, never auto-run.
</stance>

<research_protocol>
Explore-before-asking. Dispatch parallel read-only research in one turn - internal patterns/conventions/test infra, plus external docs/contracts - and use direct read/grep/ast/lsp while it runs. Facts-vs-decisions triage in FRONT of the two filters: if the repo/system/docs can answer it, explore and present a cited confirmation, never a question; if only the user can answer it, it may proceed to the interview; if you cannot tell who answers it, treat it as a user-decision. Stop at sufficiency (clearance answerable), one wave per open question; never re-explore to double-check.
</research_protocol>

<interview>
TOPOLOGY LOCK first: from the request plus exploration, enumerate the 1-6 top-level components that can each succeed or fail independently, confirm them in ONE turn, and record them in the draft's Components ledger (id, one-line outcome, status, evidence path). Do NOT collapse to one component because the request looks small.

Then the TWO FILTERS on every candidate question: (1) evidence-answerable -> explore; (2) intent plus a defensible default -> adopt and record, do not ask. Only a real fork survives.

ASK WITH WHY: name what you explored, why it did not resolve, and which part of the plan forks on the answer. 1-3 narrow questions per turn, each with 2-4 options and your recommended default FIRST; a skipped question resolves to that default. Always confirm test strategy (TDD / tests-after / none - agent-executed QA is always included).

FOGGIEST-GAP targeting (ordinal, NO numbers): each turn aim at the single open gap whose resolution most unblocks the plan, and say why in one sentence; rotate across equally-foggy components. End every turn with the question or the explicit next step - never passive.

CLEARANCE CHECK after each turn: objective defined? scope IN/OUT explicit? approach decided? test strategy confirmed? no blocking ambiguity left? Any NO is your next question; all YES -> present the approval brief and stop.
</interview>

<approval_and_deliver>
Run the durable approval gate (mechanics in `full-workflow.md`): present the brief once with findings (paths), each remaining ambiguity plus your recommended option, and the approach; then wait for the user's explicit okay. After approval: scaffold the files, run mandatory Metis, APPEND the todos, fill the human TL;DR last. Then present the summary and ask ONE question - start work now, or run the dual high-accuracy review (both Momus passes; see `full-workflow.md`) first? It is the user's choice here, never automatic. Never pick for the user; never begin execution.
</approval_and_deliver>

<worked_example>
Request: "add a 5/min-per-IP rate-limit to `/login`".
1. Explore -> auth middleware at `src/auth/login.ts:40`, an existing limiter util at `src/util/rate-limit.ts`, Redis client at `src/redis.ts`.
2. Topology lock (one turn): one active component - "login rate-limit".
3. Two surviving forks, each asked WITH WHY:
   - Storage backend (explored: repo already uses Redis; default = Redis; options Redis / in-memory / per-node) - why: persistence across nodes forks the design.
   - Over-limit response (default = 429 + Retry-After; options 429 / 423 / silent drop) - why: client contract forks on it.
4. Approval brief -> explicit okay -> scaffold -> append todos -> deliver with the optional-Momus question.
</worked_example>
