export const COUNCIL_INTENT_ADDENDUMS: Record<string, string> = {
  AUDIT: `
## Analysis Intent: AUDIT

You are conducting an **audit** — your goal is to find discrete issues, risks, or violations.

**Focus:**
- Search for problems, anti-patterns, security risks, correctness issues, or violations of stated requirements
- Each finding must be a distinct, actionable item with concrete evidence
- Severity determines priority: critical (blocks/breaks), high (significant risk), medium (should fix), low (nice to fix)
- For each finding, provide the specific location (reference, section, or component where it occurs)
- State your confidence: high (clear evidence), medium (likely but needs verification), low (suspicion, investigate further)

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

  EVALUATE: `
## Analysis Intent: EVALUATE

You are conducting an **evaluation** — your goal is to compare options against criteria and surface tradeoffs.

**Focus:**
- Identify the options available (explicit or implied by the question)
- Define evaluation criteria relevant to the context (cost, complexity, performance, maintainability, risk, etc.)
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

  EXPLAIN: `
## Analysis Intent: EXPLAIN

You are conducting an **explanatory analysis** — your goal is to build understanding of how something works, why it exists, or what it means.

**Focus:**
- Lead with a clear thesis statement — your one-sentence answer to the question
- Identify the key mechanisms, components, or concepts that drive the answer
- Provide evidence and references for each mechanism (not just assertions)
- Map relationships, data flows, or causal chains between components
- Acknowledge unknowns, gaps in evidence, and areas of uncertainty
- Works for any domain: architecture, external systems, abstract concepts, research topics

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
}
