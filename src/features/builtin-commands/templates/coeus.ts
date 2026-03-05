export const COEUS_COMMAND_TEMPLATE = `You are starting a Coeus deep research planning session.

## WHAT TO DO

1. **Check for existing brief**: Look for a brief file at \`.sisyphus/briefs/{slug}-*.md\`
   - If brief exists: Skip interview, go to Phase 0 (brief ingestion)
   - If no brief: Conduct structured interview (3-7 questions), then write brief

2. **Interview phase** (if no brief exists):
   - Ask 3-7 clarifying questions to understand the problem domain
   - Identify scope boundaries, unknowns, and key constraints
   - Record answers for brief generation

3. **Write brief** (if no brief exists):
   - Create \`.sisyphus/briefs/{slug}-{YYYYMMDD}.md\`
   - Format: XML-tagged sections with clear problem statement, scope, constraints
   - Include interview findings and key assumptions

4. **Phase 0: Brief ingestion** (if brief exists):
   - Read the existing brief file
   - Extract problem statement, scope, constraints
   - Identify domains requiring taxonomy verification

5. **Query taxonomy for each domain**:
   - For each identified domain, search for existing knowledge/patterns
   - Surface unverified boundaries and assumptions
   - Document gaps and areas needing deeper research

6. **Produce comprehensive plan**:
   - Create \`.sisyphus/plans/{slug}.md\`
   - Format: Markdown with numbered phases, clear deliverables
   - Include research findings, verified boundaries, risk assessment
   - Structure for handoff to Sisyphus execution

7. **Guide user to next step**:
   - When plan is complete, instruct user to run \`/start-work {slug}\`
   - Provide summary of plan scope and estimated effort

## CRITICAL

- The session_id is injected by the hook - use it directly
- Always create/read brief BEFORE producing plan
- Brief format: XML-tagged sections, stored at \`.sisyphus/briefs/{slug}-{YYYYMMDD}.md\`
- Plan format: Markdown with phases, stored at \`.sisyphus/plans/{slug}.md\`
- Surface all unverified assumptions and boundaries
- Do not delegate to other agents - this is deep research and planning only`
