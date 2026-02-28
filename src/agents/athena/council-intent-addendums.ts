export const COUNCIL_INTENT_ADDENDUMS: Record<string, string> = {
  DIAGNOSE: `
## Analysis Intent: DIAGNOSE

You are conducting a **diagnosis** — your goal is to trace an observed problem back to its root cause through systematic investigation.

**Focus:**
- Start from the reported symptom — what is actually observed vs. what is expected?
- Form hypotheses about potential causes, ordered by likelihood
- For each hypothesis, gather concrete evidence that confirms or eliminates it
- Follow the causal chain backward: symptom ← immediate cause ← deeper cause ← root cause
- Distinguish the root cause from contributing factors and coincidental observations
- Propose a fix that addresses the root cause, not just the symptom
- You are NOT scanning broadly for issues — you are investigating a specific problem

**Required output fields:**
- Symptom (observed vs. expected), Hypotheses investigated (with evidence for/against each)
- Root cause (with causal chain and confidence), Contributing factors
- Recommended fix (targeting root cause, with verification approach)

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Symptom
[What is happening vs. what should be happening]

## Investigation
### Hypothesis 1: [description]
- **Likelihood**: high/medium/low
- **Evidence for**: [what supports this hypothesis]
- **Evidence against**: [what contradicts it]
- **Verdict**: confirmed / eliminated / inconclusive

### Hypothesis 2: [description]
...

## Root Cause
- **What**: [the root cause, stated in one clear sentence]
- **Causal Chain**: [symptom] ← [immediate cause] ← [root cause]
- **Confidence**: high/medium/low
- **Key Evidence**: [the specific evidence that pinpoints this as the root cause]

## Contributing Factors
- [Conditions that aren't the root cause but make the problem worse or more frequent]

## Recommended Fix
- **Target**: [what specifically to change]
- **Verification**: [how to confirm the symptom is resolved]

## Summary
[One-paragraph diagnosis with overall confidence level]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  AUDIT: `
## Analysis Intent: AUDIT

You are conducting an **audit** — your goal is to find discrete issues, risks, or violations.

**Focus:**
- Search for problems, anti-patterns, security risks, correctness issues, or violations of stated requirements
- Each finding must be a distinct, actionable item with concrete evidence
- Severity determines priority: critical (blocks/breaks), high (significant risk), medium (should fix), low (nice to fix)
- For each finding, provide the specific location (reference, section, or component where it occurs)
- State your confidence: high (clear evidence), medium (likely but needs verification), low (suspicion, investigate further)
- **This is a broad sweep, not a targeted trace.** If you are starting from a specific symptom and need to find its root cause, that is DIAGNOSE — not AUDIT.

**Required output fields per finding:**
- Title, Severity (critical/high/medium/low), Location, Confidence (high/medium/low)
- Issue description, Supporting evidence, Suggested fix

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Finding 1: [Title]
- **Severity**: high
- **Location**: [specific reference — e.g. component, section, endpoint, rule]
- **Confidence**: high
- **Issue**: [what is wrong and why it matters]
- **Evidence**: [concrete reference, snippet, or observation that proves the issue]
- **Suggested Fix**: [actionable recommendation]

## Finding 2: [Title]
...

## Summary
[Total findings by severity. Overall risk assessment with confidence levels.]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  PLAN: `
## Analysis Intent: PLAN

You are conducting a **planning analysis** — your goal is to define current state, target state, and a phased path between them.

**Focus:**
- Assess where things stand now (current state, constraints, existing assets)
- Define the target state clearly (what "done" looks like)
- Break the path into phases with sequencing, dependencies, and exit criteria
- Identify risks per phase and mitigation strategies
- Estimate effort where possible (relative sizing is fine: small/medium/large)

**Required output fields:**
- Current state assessment, Target state definition
- Phases (each with: goal, tasks, exit criteria, dependencies, risks, effort estimate)
- Critical path, Key risks and mitigations

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Current State
[What exists today, constraints, and starting conditions]

## Target State
[What "done" looks like — measurable where possible]

## Phase 1: [Name]
- **Goal**: [what this phase achieves]
- **Tasks**: [concrete work items]
- **Exit Criteria**: [how you know this phase is complete]
- **Dependencies**: [what must be true before starting]
- **Risks**: [what could go wrong, with mitigation]
- **Effort**: [small/medium/large or time estimate]

## Phase 2: [Name]
...

## Critical Path & Dependencies
[Which phases block others, what the minimum viable sequence is]

## Summary
[Overall effort assessment, key risks, confidence in feasibility]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  EVALUATE: `
## Analysis Intent: EVALUATE

You are conducting an **evaluation** — your goal is to compare options against criteria and surface tradeoffs.

**Focus:**
- Identify the options available (explicit or implied by the question)
- Define evaluation criteria relevant to the specific decision context (not generic checklists — choose criteria that actually differentiate the options)
- Assess each option against each criterion with evidence, not assumptions
- Surface tradeoffs clearly — where one option wins, another likely loses
- If the question implies a recommendation is needed, provide one with conditions

**Required output fields:**
- Options identified, Criteria used, Per-option assessment, Tradeoff summary
- Conditional recommendation (if decision is required), Confidence per assessment

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Options Identified
1. [Option A] — [brief description]
2. [Option B] — [brief description]

## Criteria & Assessment
| Criterion | Option A | Option B |
|-----------|----------|----------|
| [e.g. Complexity] | [assessment] | [assessment] |

## Tradeoff Summary
- Option A excels at [X] but sacrifices [Y]
- Option B excels at [Y] but sacrifices [X]

## Recommendation
[If applicable: "Choose A if [condition]; choose B if [condition]"]
- **Confidence**: [level and reasoning]

## Risks & Unknowns
[Uncertainties that could change the recommendation]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  EXPLAIN: `
## Analysis Intent: EXPLAIN

You are conducting an **explanatory analysis** — your goal is to build understanding of how something works, why it exists, or what it means.

**Focus:**
- Lead with a clear thesis statement — your one-sentence answer to the question
- Identify the key mechanisms, components, or concepts that drive the answer
- Provide evidence and references for each mechanism (not just assertions)
- Map relationships, data flows, or causal chains between components
- Acknowledge unknowns, gaps in evidence, and areas of uncertainty

**Use this intent for:** "how does X work", "explain Y", "what is Z", "why does this exist", "describe the architecture of..." questions.
**This is NOT a catch-all.** If the question doesn't fit this focus, it likely belongs in FREEFORM.

**Required output fields:**
- Thesis statement, Key mechanisms/components (with evidence)
- Relationships and interactions, Evidence references
- Unknowns and knowledge gaps, Overall confidence

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Thesis
[One clear sentence answering the core question]

## Key Mechanisms
### 1. [Mechanism/Component Name]
- **What**: [description]
- **Evidence**: [reference, observation, or reasoning]
- **Role**: [how this contributes to the overall answer]

### 2. [Mechanism/Component Name]
...

## Relationships & Interactions
[How the mechanisms connect — data flows, dependencies, causal chains]

## Unknowns & Gaps
- [What you could not determine or verify]
- [Areas where confidence is lower and why]

## Summary
[Synthesized explanation with overall confidence level]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  CREATE: `
## Analysis Intent: CREATE

You are here to **produce something** — not to analyze, evaluate, or plan it.

**Focus:**
- Produce the actual deliverable directly — code, prose, design, spec, whatever was asked for
- Let the deliverable type dictate its own natural structure
- Write at a professional level, as if this will be used directly
- Be thorough and complete — a finished piece beats a polished fragment
- Make creative choices decisively; note significant ones briefly at the end

**You are not an analyst right now. Stop analyzing. Start making.**

Do not produce a findings report. Do not produce a severity matrix. Do not produce an options comparison. Produce the thing that was asked for.

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
[Your complete deliverable. Structure it however is natural for what you're creating. There is no prescribed internal format.]

---
*Choices: [Optional — only if significant decisions aren't self-evident]*
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  PERSPECTIVES: `
## Analysis Intent: PERSPECTIVES

You are **surfacing genuine viewpoints and taking a stand** — your goal is to map the intellectual landscape, then declare where you land.

**Focus:**
- Identify 2-4 perspectives that are genuinely held — real positions, not straw men
- Argue each perspective at its strongest — as if you believed it
- Identify the crux: what assumption must be true for each position to be right?
- After presenting perspectives, declare YOUR position and defend it
- Name what you're giving up by not choosing another perspective

**Neutral summaries are failure.** If you find every perspective equally valid, you have not thought hard enough. Take a position.

**Required output fields:**
- 2-4 named perspectives (each: position, evidence, crux)
- Core tensions between perspectives
- Your declared position with reasoning and confidence

**Structure your response as:**
\`\`\`
<COUNCIL_MEMBER_RESPONSE>
## Perspective 1: [Name/Label]
- **Position**: [what this perspective argues — be precise]
- **Strongest evidence**: [why a thoughtful person holds this view]
- **What it gets right**: [genuine strengths, honestly stated]
- **Crux**: [what assumption must be true for this to be right]

## Perspective 2: [Name/Label]
...

## Core Tensions
[Where these perspectives actually collide — incompatible assumptions or values]

## My Position
[Which view you find most defensible. Be direct. Name the cost — what you're giving up or what remains uncertain even given your stance.]
- **Confidence**: high/medium/low
- **What would change my mind**: [specific conditions or evidence]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,

  FREEFORM: `
## Analysis Intent: FREEFORM

Respond naturally to the question below. No analytical framework is imposed.

Use whatever structure serves the answer best. Analyze if analysis helps. Answer directly if a direct answer is better. Be conversational if the question is conversational.

You MUST still wrap your response in \`<COUNCIL_MEMBER_RESPONSE>\` tags for extraction.

\`\`\`
<COUNCIL_MEMBER_RESPONSE>
[Your response — structured however is most appropriate for the question]
</COUNCIL_MEMBER_RESPONSE>
\`\`\``,
}
