---
name: eval-integrity
description: "Assess integrity of an eval, benchmark, metric, A/B test, holdout, LLM-judge, or user-study claim when the question is whether measurement, comparison, or evidence is independent and trustworthy."
---

# Evaluation Integrity

Provide a read-only audit of whether an evaluation can support its stated claim. Do not alter code,
data, prompts, labels, or study operations. State exactly one mandatory verdict: **PASS**, **FAIL**,
or **INCONCLUSIVE**. A favorable score is not itself evidence of integrity.

## Route correctly

- **NOT for code review:** route implementation, correctness, security, or maintainability review to
  `review-work`.
- **NOT for data processing:** route cleaning, transforming, joining, modeling, or analyzing data to
  `data-scientist`.
- Use this skill for the independence and validity of the measurement setup, not for producing a
  result from it.

## Audit method

### 1. State the claim and map the evaluation

Write the claim in testable form: what comparison, metric, threshold, or causal statement is being
made; for which population; and under which decision rule. Map every role before judging it:

| Element | Record |
| --- | --- |
| Claim | The conclusion and decision it is meant to justify. |
| System under test | Exact model, version, configuration, prompt, policy, or treatment. |
| Dataset and split | Sources, collection dates, inclusion rules, train/dev/test or holdout assignment. |
| Designer | Who selected the task, data, prompts, treatments, metric, and stopping rule. |
| Evaluator or judge | Who or what assigns quality judgments, including model and prompt versions. |
| Scorer | The rule or system that turns outputs or judgments into the reported metric. |
| Subjects | Humans, records, tasks, or units exposed to treatment or observation. |

Trace shared ownership, shared data, shared prompts, shared labels, and shared selection decisions
across this map. Several models do **not** establish independence merely because there are several
of them; identify distinct training, tuning, prompt design, labels, data, and decision authority.

### 2. Check the ground truth

Identify the independent ground truth that could confirm the claim without reusing the system's own
preferences, outputs, labels, or optimization target. Test whether it is:

- external to the system under test and its designer;
- collected or adjudicated without seeing the treatment identity when blinding is feasible;
- appropriate to the claim rather than a proxy selected because it favors one arm; and
- fixed before comparison, or accompanied by a disclosed multiplicity and selection procedure.

If no independent ground truth exists, do not substitute agreement among related systems. Mark the
claim **INCONCLUSIVE** unless the stated claim is explicitly limited to that related system's score.

### 3. Probe independence failures

Check only risks relevant to the mapped design:

- **Contamination:** benchmark items, answers, or near duplicates reached training, prompt design,
  retrieval, tuning, or post-hoc selection.
- **Invalid controls:** arms differ beyond the intended treatment, allocation is biased, exposure is
  unequal, or the control cannot answer the causal comparison.
- **Circular judging:** the evaluated system, its designer, or a derived rubric defines its own
  success without external confirmation.
- **Scorer-label coupling:** labels, thresholds, reward signals, or rubric choices are reused by the
  scorer in a way that makes agreement self-fulfilling.
- **Evaluator-designer coupling:** the evaluator, judge prompt, or adjudication process is selected,
  tuned, or influenced by the comparison designer without an independent safeguard.
- **Split or annotator dependence:** overlapping sources, duplicates, temporal leakage, shared
  annotators, or correlated annotation policies invalidate assumed independence.
- **Hypothesis priming:** task framing, examples, pre-registration gaps, or interim results steer
  evaluators or analysts toward the expected outcome.
- **Observer and demand effects:** subjects or observers infer the desired treatment or outcome, and
  behavior or ratings change because of that knowledge.

For each concern, distinguish documented evidence from an assumption. Missing provenance for data,
splits, labels, prompts, evaluator selection, or scoring is **INCONCLUSIVE**, not evidence that the
design was independent.

### 4. Reach the verdict

- **PASS:** evidence supports an independent, valid measurement path for the stated claim, with no
  material unresolved dependency.
- **FAIL:** evidence shows a dependency or invalid design that materially invalidates or overstates
  the stated claim.
- **INCONCLUSIVE:** provenance or evidence is missing, the ground truth is not independently
  established, or remaining uncertainty prevents either result.

Do not convert uncertainty into PASS because a metric looks plausible, a result is statistically
significant, or multiple related evaluators agree.

## Report

Report the verdict first. Then report only findings that fired; do not pad the report with risks
that were checked and did not fire. For each fired finding include:

1. **Evidence:** the observed artifact, provenance record, or explicit absence of one.
2. **Impact:** which claim or inference the issue weakens or invalidates.
3. **Minimal independence fix:** the smallest separation, blind, held-out source, external
   adjudication, or control change that would address it.
4. **Missing evidence:** what must be supplied to resolve the finding, if applicable.
5. **Residual risk:** what remains uncertain after the minimal fix.

Keep conclusions bounded to the evidence. This audit advises; it does not certify a system,
recompute results, or approve deployment.
