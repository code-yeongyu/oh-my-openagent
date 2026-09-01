# Phase 5 — User Decision Escalation

Escalation is for genuine ambiguity, not for skipping investigation. Most "should I ask the user" moments are really "I don't want to do one more query" moments, and those are wrong.

---

## Ask the user ONLY when

- **Evidence exhausted**, contradictions remain, and further investigation would require a decision with policy implications (e.g. "patch the third-party SDK vs wrap it vs change architecture").
- The bug has **multiple valid fixes with different scope/risk tradeoffs** and the user's preference drives the choice.
- A proposed fix would **change observable product behavior** for the end user (not just fix the internal bug).
- You've **exhausted the Oracle Triple** and another 2 rounds failed after synthesis.

## Do NOT ask when

- You haven't tried the Oracle Triple yet.
- The question can be answered by one more runtime query.
- You're asking for permission to do the obvious thing.
- You're asking because you're tired.

---

## Escalation format (paste into the reply)

Keep it short. Evidence-dense. One decision, not a status update.

```markdown
## Decision needed

**What we know** (verbatim evidence, not paraphrase):
- <fact 1 with file:line or address>
- <fact 2 with source>
- <what the evidence rules IN>
- <what the evidence rules OUT>

**What the decision is** (one sentence):
<the fork in the road>

**Options**:

| # | Fix | Scope | Risk | Effort |
|---|-----|-------|------|--------|
| A | <short label> | <files touched / layers> | <regressions possible> | <rough> |
| B | ... | ... | ... | ... |
| C | ... | ... | ... | ... |

**Recommendation**: <A/B/C> because <one-sentence reason>.

Which direction do you want?
```

---

## Anti-patterns in escalation

- **Asking without evidence.** "What do you want me to do?" is not an escalation, it's abandonment. Every escalation includes the evidence the user needs to decide.
- **Two questions in one.** One decision per escalation. Multi-part questions lead to partial answers and re-escalation.
- **Escalating before Phase 4.** If you haven't tried the Oracle Triple, you haven't earned the right to escalate.
- **Presenting options you don't actually have.** If option C requires a library the user doesn't use, don't list it. The options are only things you can actually do today.
- **Hiding a recommendation.** The user hired you to think — always end with a recommendation, even if you're low-confidence. Say so explicitly: "Recommendation (low confidence): B, because X. If you have context about Y that I don't, it might change to A."

---

## What happens after the user responds

- **User picks an option**: return to Phase 6 (root cause confirmation) with the chosen direction. The user's choice is not itself confirmation — you still need runtime evidence that the cause you're fixing is the cause in play.
- **User proposes a different option you hadn't considered**: treat it as new information. Update hypotheses. May trigger another Phase 3 round.
- **User gives more context that resolves the disagreement**: skip to Phase 6.
- **User is also unsure**: that's a signal you need more evidence, not more opinions. Run one more targeted query before asking again.
