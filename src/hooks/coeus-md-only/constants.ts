import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export const HOOK_NAME = "coeus-md-only"

export const COEUS_AGENTS = ["coeus", "sub-prometheus"]

export const ALLOWED_EXTENSIONS = [".md", ".json"]

export const ALLOWED_PATH_PREFIX = ".sisyphus"

export const BLOCKED_FILES = ["boulder.json"]

export const BLOCKED_TOOLS = ["Write", "Edit", "write", "edit"]

export const COEUS_WORKFLOW_REMINDER = `

---

${createSystemDirective(SystemDirectiveTypes.COEUS_READ_ONLY)}

## COEUS MANDATORY WORKFLOW REMINDER

**You are writing a merged plan. STOP AND VERIFY you completed ALL phases:**

┌─────────────────────────────────────────────────────────────────────┐
│                       COEUS WORKFLOW                                │
├──────┬──────────────────────────────────────────────────────────────┤
│  1   │ COMPLEXITY ANALYSIS: Scored 0–100                            │
│      │    - Concern count, file count, cross-domain, coupling       │
├──────┼──────────────────────────────────────────────────────────────┤
│  2   │ DECOMPOSITION DECISION: Score < 40 → plan directly           │
│      │    - Score >= 40 → decompose into domains                    │
├──────┼──────────────────────────────────────────────────────────────┤
│  3   │ GLOBAL CONSTRAINTS: Extracted from project artifacts         │
│      │    - AGENTS.md, package.json, tsconfig, naming conventions   │
├──────┼──────────────────────────────────────────────────────────────┤
│  4   │ SUB-PROMETHEUS SPAWNED: task(subagent_type=sub-prometheus)   │
│      │    - All domains in parallel, run_in_background=true         │
├──────┼──────────────────────────────────────────────────────────────┤
│  5   │ RESULTS COLLECTED AND MERGED: Conflicts resolved             │
│      │    - Topological sort, wave assignments, integration points  │
├──────┼──────────────────────────────────────────────────────────────┤
│  6   │ WRITING MERGED PLAN to .sisyphus/plans/*.md                  │
│      │    <- YOU ARE HERE                                           │
└──────┴──────────────────────────────────────────────────────────────┘

**DID YOU COMPLETE PHASES 1–5 BEFORE WRITING THIS PLAN?**

If you skipped phases, STOP NOW. Go back and complete them.

---

`

export const PLANNING_CONSULT_WARNING = `

---

${createSystemDirective(SystemDirectiveTypes.COEUS_READ_ONLY)}

You are being invoked by ${getAgentDisplayName("coeus")}, a READ-ONLY recursive planning agent.

**CRITICAL CONSTRAINTS:**
- DO NOT modify any files (no Write, Edit, or any file mutations)
- DO NOT execute commands that change system state
- DO NOT create, delete, or rename files
- ONLY provide analysis, recommendations, and information

**YOUR ROLE**: Provide consultation, research, and analysis to assist with recursive planning.
Return your findings and recommendations. The actual implementation will be handled separately after planning is complete.

---

`
