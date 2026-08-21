---
name: ulw-plan
description: ulw-plan stance calibration - renderer selection, fork-reply classification, override gates, and the planning-style episode memory.
metadata:
  short-description: How to deliver questions to THIS user, learned from behavior
---

# ulw-plan - stance calibration

Read this alongside your intent reference, before the first user-facing question. Intent routing decides WHAT gets asked (which forks survive); stance decides HOW those forks reach the user. **FIREWALL: stance chooses question form, pacing, and batching. It NEVER reinterprets what a reply meant, and no stored profile may bias fork-reply classification - every reply is classified fresh.**

## Renderers

Three delivery modes over the SAME surviving forks (the two filters and owner-decision rules are unchanged upstream):

- **batch** - all surviving forks in one brief, recommended default first; a skipped fork resolves to its default. Fits users who enumerate upfront and delegate the rest.
- **one-by-one** - one fork per turn. Fits users who own decisions individually.
- **examples-first** - no open questions: present 2-3 contrasting concrete approaches and ask which is closest and what is wrong. Fits users who cannot yet externalize what they want - critique is cheaper than generation. Never ask such a user to produce criteria from a blank page.

The user switches renderer at any time by saying so in their own words; honor it immediately.

## Opening stance

Derive the opening renderer BEFORE the first question:

1. **Episodes exist** (planning-style block in projected memory): generalize from the episodes MOST SIMILAR to this session's context (repo, domain, familiarity) - never from a global average:
   - consistent episodes -> open in the indicated renderer;
   - episodes split by context (own project vs unfamiliar domain) -> apply the side matching this session;
   - variable with no context pattern -> neutral opening (topology echo + escape hatch only) and let in-session signals decide. A single session NEVER flips the opening - do not chase the latest session's style.
2. **No episodes (cold start)**: CLEAR intent -> one-by-one; UNCLEAR intent -> examples-first. Never open an unknown user with silently adopted full defaults: that failure is expensive and invisible until the wrong thing is built, while an unnecessary question fails cheap and loud.
3. **Seeds** (`## Seed` entries): consult only while ZERO native episodes exist, and only for the opening renderer.

Announce the stance in one line beside the intent verdict, with the veto: "Recent sessions suggest batch mode - say the word to go one-by-one." The first time you ask anything, state that opting out is a legitimate answer: "you decide" resolves the fork to its recommended default and lands in the defaults ledger.

## Fork-reply classification

Classify every reply to an asked fork into exactly ONE state. Never infer difficulty from hedge words, filler, tone, or a missing option label - evaluate whether the fork became USABLE. Two tests:

- **Resolution**: given this reply plus existing constraints, could two materially different implementations both comply? No -> resolved.
- **Information gain**: did the reply eliminate an option, add a relevant constraint, challenge the framing, or ask a consequence needed to decide? Yes -> progress.

| State | Meaning | Action |
|---|---|---|
| RESOLVED | one implementable outcome: exact label, semantic equivalent, a new outcome rejecting the offered framing, a constraint leaving one option, or explicit delegation | record the semantic decision; continue |
| RESOLVED_BUT_UNINFORMED | names an outcome but marks it arbitrary, admits not understanding the options, or reveals a misconception about its consequence | correct the misconception in one line; defaultable fork -> adopt the recommendation with a visible veto; owner-decision -> one informed yes/no |
| UNRESOLVED_PROGRESS | still open, but the reply added decision-relevant information | use it, answer any question it raised, re-render THIS fork only |
| UNRESOLVED_BLOCKED | still open, nothing decision-relevant added | re-render THIS fork as 2-3 concrete outcomes, recommendation first, one material consequence each |

One reply may resolve several forks, correct facts, and add scope all at once - parse all of it: distribute answers to their forks, fold new scope into the draft, treat a factual challenge as UNRESOLVED_PROGRESS on the challenged claim.

After two UNRESOLVED_BLOCKED on distinct forks, offer the renderer menu once (continue as-is / defaults for the rest / examples-first). A session-wide renderer switch happens ONLY on an explicit user choice or request - never from counters, streaks, or hedge frequency.

## Override gates

"질문 그만", "니가 정해", "알아서", "stop asking", "you decide" and kin become instructions only after three gates, in order:

1. **Speech act** - a direct affirmative instruction from the user, now. Not negation ("알아서 하지 마"), quoted text, hypotheticals, or reported speech.
2. **Intent** - classify: delegate THIS fork / delegate the REMAINDER / stop the interview / request a recommendation / fix the process (fewer, better questions). Only the two delegations transfer decision ownership.
3. **Scope** - take the narrowest supported reading. A bare "알아서" answering one fork delegates that fork only; session-wide requires explicit breadth ("나머지는", "전부", "from now on"). Preserve stated exceptions exactly.

Actions: delegate-this-fork -> recommended default + ledger, renderer unchanged. Delegate-remainder -> defaults-ledger mode for the remaining defaultable forks; acknowledge the exact scope. Stop-interview -> stop incremental questions, adopt defaults, and consolidate ALL surviving owner-decisions into ONE final authorization block (recommended choice + material consequence each); "go" authorizes only when it follows that block. Recommendation-request -> give it; adopt only if the wording also delegated. Process-fix -> improve the questions; ownership unchanged.

**INVARIANT: no override phrase silently authorizes an irreversible, destructive, or spend decision.** When questions were stopped, those decisions arrive as the final authorization block - never as adopted defaults.

## Planning-style episode memory

The profile is an append-only log of observation episodes at `system/human/planning-style.md` (memory tool; create lazily on the first qualified episode, description: "Planning-interaction episode log; generalize at read time"). **NEVER store scores, counters, thresholds, settled flags, or a summarized persona** - generalization happens at read time, every session, from the raw episodes. A cached summary is what goes stale; raw episodes cannot.

**Qualified episodes only.** At close, record 0-2 lines - only when one of:
- the user explicitly chose or requested a renderer, or stated an interaction preference (record as `declared`);
- the same unsolicited stance showed across 2+ distinct forks: batched or superseded them, demanded per-fork ownership, or needed concrete examples to answer (record as `observed`).

Never record: sessions with no genuine fork, topology corrections, bare approvals ("go"), a single local delegation, frustration alone, or an answer shape the renderer forced. No qualified signal -> record NOTHING; forced observations bias the log toward tidy sessions.

Episode format - every field required:

```
- [YYYY-MM-DD] <context: repo/domain + familiarity evidence> - <observed behavior, one line> <!-- src: <session-id>; model: <session model>; pattern: observed|declared; confidence: low|medium|high -->
```

- **Minority protection**: contradicting episodes are context markers, not noise. Before applying the majority pattern, check whether THIS session matches the minority episode's context. Never prune minority or `declared` entries; cap the log near 15 by pruning the oldest majority-consistent entries first.
- **Memory tools absent**: note the session stance in the draft only; skip the profile.

### Seeds (onboarding-inferred)

`## Seed` entries in the same block are onboarding inferences from OTHER coding agents' session history. Hard rules:

- **`confidence: low`, ALWAYS.** Never raise it, however consistent the foreign evidence looks: behavior in another tool reflects that tool's affordances (no memory there, a different delegation surface), not necessarily this user.
- Every seed carries full provenance: source harness name(s), the model(s) under which the pattern was mainly identified, the session ids mined, and the date the seed was written (`seeded:`). Phrase the body as a hypothesis ("appears to ..."), never a conclusion.

```
- [YYYY-MM-DD] (seed) appears to <hypothesis + context> <!-- src: <harness>/<session-id>,...; harness: <names>; model: <models>; seeded: YYYY-MM-DD; pattern: inferred-from-external-sessions; confidence: low -->
```

- **Precedence: native episodes > the user's explicit statements > seeds.** Once 2-3 native episodes exist, stop consulting seeds entirely.
