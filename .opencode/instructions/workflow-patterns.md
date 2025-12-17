# Workflow Patterns - Complete Guide

## Overview

This guide shows exactly how to use custom agents for common software development scenarios. Each pattern includes agent sequence, prompts, outputs, and estimated time.

## Command-Driven vs Agent-Driven

**Command-Driven** (Recommended): Use workflow commands (`/specify`, `/plan`, `/tasks`, `/implement`) for deterministic, script-driven workflows with Linear integration.

**Agent-Driven** (Alternative): Use `@Agent-Name` or orchestrator for direct agent invocation with flexible control.

**Note**: Both approaches work together - commands call agents internally, and agents respect command-provided paths.

---

## Pattern 1: New Feature Development

### High-Level Flow
```
📋 product-strategist → 🧠 strategic-architect → 📊 linear-coordinator → 🛠️ implementation-specialist → 🛡️ code-reviewer → 🧪 test-engineer → 📚 documentation-master
```

### Detailed Workflow

#### Step 0: Create/Select Placeholder Linear Issue (REQUIRED - 5 min)
**Command**: `/specify` (or manual Linear creation)

**When Linear MCP Available**:
1. **MUST** create or select a placeholder parent Linear issue FIRST
2. Placeholder issue provides `ISSUE-ID`, `branchName`, and folder naming
3. Example: Create `POLY-42` with title "AI-powered slide suggestions"
4. **DO NOT** proceed without Linear issue (Linear-first requirement)

**When Linear MCP Unavailable**:
- Fall back to sequential numbering: `001-feat-ai-slide-suggestions`

#### Step 1: Define Requirements (30 min)
**Agent**: 📋 product-strategist

**Prompt**:
```
@Product-Strategist Plan a feature for AI-powered slide suggestions to help sales reps create better presentations faster
```

**Agent Does**:
- **ASSUME** Linear issue already exists (from Step 0)
- Uses existing issue ID for folder: `.cursor/specs/POLY-42-feat-ai-slide-suggestions/`
- Asks clarifying questions about users and business goals
- Creates requirements documents

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
└── spec.md
```

---

#### Step 2: Design Architecture (1-2 hours)
**Agent**: 🧠 strategic-architect

**Prompt**:
```
@Strategic-Architect Design the architecture for POLY-42-feat-ai-slide-suggestions
```

**Agent Does**:
- Reads requirements from `.cursor/specs/POLY-42-feat-ai-slide-suggestions/`
- Uses context7 MCP to research any new libraries
- Creates system design with diagrams
- Documents architectural decisions

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
├── spec.md           (existing)
└── plan.md
```

---

#### Step 2.5: Specialized Design (If AI/ML Feature) (1-2 hours)
**Agent**: 🧭 rag-architect OR 🤖 ml-engineer

**Prompt** (if RAG feature):
```
@RAG-Architect Design the RAG pipeline for POLY-42-feat-ai-slide-suggestions
```

**Agent Does**:
- Reads requirements and architecture
- Uses context7 to research RAG frameworks (LangChain, vector DBs)
- Designs embedding strategy and retrieval pipeline

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
├── spec.md           (existing)
└── plan.md           (updated with RAG design)
```

---

#### Step 3: Update Parent Issue & Create Child Issues (15 min)
**Agent**: 📊 linear-coordinator

**Prompt**:
```
@Linear-Coordinator Create Linear issues for POLY-42-feat-ai-slide-suggestions
```

**Agent Does**:
- **Detects** existing parent issue `POLY-42` from folder name
- **Updates** the placeholder parent issue (adds summary, AC from spec.md)
- Reads all planning artifacts from `.cursor/specs/POLY-42-feat-ai-slide-suggestions/`
- Uses Linear MCP to query Linear projects
- Creates CONCISE child Linear issues (stories, tasks)
- Asks for confirmation before creating in Linear
- Creates child issues if confirmed

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
├── spec.md           (existing)
├── plan.md           (existing)
├── tasks.md          (NEW)
└── linear/
    ├── epic.md
    ├── stories.md
    ├── tasks.md
    └── linear-links.md       (if created in Linear)
```

---

#### Step 4: Implement (1-3 days)
**Agent**: 🛠️ implementation-specialist

**Prompt**:
```
@Implementation-Specialist Implement POLY-42-feat-ai-slide-suggestions using all .cursor/specs/ artifacts
```

**Agent Does**:
- Reads requirements, architecture, and Linear issues
- Uses context7 to verify FastAPI/React patterns
- Uses chrome-devtools to test frontend
- Writes production code
- Documents implementation decisions

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
├── spec.md           (existing)
├── plan.md           (existing)
├── linear/                  (existing)
└── implementation/
    ├── implementation-spec.md
    └── technical-notes.md

PLUS actual code files:
backend/app/services/routes/suggestions.py
frontend/src/components/SuggestionPanel.jsx
```

---

#### Step 5: Code Review (30 min)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Review the POLY-42-feat-ai-slide-suggestions implementation
```

**Agent Does**:
- Reviews code for security, performance, quality
- Uses chrome-devtools for live security testing
- Creates review report with severity ratings

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
└── reviews/
    └── review-report.md
```

---

#### Step 6: Testing (1 day)
**Agent**: 🧪 test-engineer

**Prompt**:
```
@Test-Engineer Create comprehensive tests for POLY-42-feat-ai-slide-suggestions
```

**Agent Does**:
- Reads requirements and implementation
- Uses chrome-devtools for browser testing
- Creates test suites (pytest + Vitest)
- Validates 80%+ coverage

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
└── testing/
    ├── test-plan.md
    └── test-strategy.md

PLUS test files:
backend/test/test_suggestions.py
frontend/src/test/SuggestionPanel.test.jsx
```

---

#### Step 7: Documentation (2 hours)
**Agent**: 📚 documentation-master

**Prompt**:
```
@Documentation-Master Document POLY-42-feat-ai-slide-suggestions for users and developers
```

**Agent Does**:
- Reads all `.cursor/specs/` artifacts
- Creates API docs, user guides
- Uses context7 to verify API examples

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
└── documentation/
    ├── docs-plan.md
    ├── api-docs.md
    └── user-guide.md

PLUS documentation files:
backend/docs/api/suggestions-api.md
frontend/docs/user-guides/ai-suggestions.md
```

---

#### Step 8: Deploy (1 day)
**Agent**: ⚙️ devops-specialist

**Prompt**:
```
@DevOps-Specialist Deploy POLY-42-feat-ai-slide-suggestions to production
```

**Agent Does**:
- Reads architecture and implementation
- Creates deployment configs
- Sets up monitoring

**Outputs**:
```
.cursor/specs/POLY-42-feat-ai-slide-suggestions/
└── operations/
    ├── deployment-plan.md
    └── monitoring-setup.md

PLUS deployment configs:
infra-setup-main/openshift/suggestions-service.yaml
```

---

### Total Timeline: New Feature
- **Traditional**: 2-3 weeks
- **With Agents**: 1 week
- **Time Savings**: 60-70%

---

## Pattern 2: Bug Fix

### High-Level Flow
```
⚡ quick-fixer → 📊 linear-coordinator → 🛡️ code-reviewer → 🧪 test-engineer
```

### Workflow

#### Step 1: Fix the Bug (15 min)
**Agent**: ⚡ quick-fixer

**Prompt**:
```
@Quick-Fixer Fix null pointer exception in presentation generation at SlideGenerator:142
```

**Agent Does**:
- Uses chrome-devtools to reproduce bug (if frontend)
- Implements minimal fix
- Tests immediately
- Documents fix

**Outputs**:
```
.cursor/specs/POLY-43-fix-slide-generation/
└── implementation/
    └── hotfix-NPE-142.md

PLUS code fix:
backend/app/services/slide_generator.py (minimal change)
```

---

#### Step 2: Create Bug Ticket (5 min)
**Agent**: 📊 linear-coordinator

**Prompt**:
```
@Linear-Coordinator Create bug issue for POLY-43-fix-slide-generation
```

**Agent Does**:
- Reads hotfix documentation
- Creates CONCISE bug issue
- Asks to create in Linear

**Outputs**:
```
.cursor/specs/POLY-43-fix-slide-generation/
├── implementation/         (existing)
└── linear/
    ├── bugs.md
    └── linear-links.md       (if created)
```

---

#### Step 3: Validate (15 min)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Quick security check on POLY-43-fix-slide-generation
```

---

#### Step 4: Regression Tests (30 min)
**Agent**: 🧪 test-engineer

**Prompt**:
```
@Test-Engineer Add regression test for POLY-43-fix-slide-generation
```

---

### Total Timeline: Bug Fix
- **Traditional**: 2-4 hours
- **With Agents**: 1 hour
- **Time Savings**: 50-75%

---

## Pattern 3: Chore / Tech Debt

### High-Level Flow
```
🛡️ code-reviewer (finds debt) → 📊 linear-coordinator → 🛠️ implementation-specialist
```

### Workflow

#### Step 1: Identify Tech Debt (during review)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Review the customer insights dashboard for tech debt
```

**Agent Does**:
- Identifies tech debt items
- Documents in review report

**Outputs**:
```
.cursor/specs/POLY-44-feat-customer-insights-dashboard/
└── reviews/
    └── tech-debt-review.md
```

---

#### Step 2: Create Tech Debt Tickets (10 min)
**Agent**: 📊 linear-coordinator

**Prompt**:
```
@Linear-Coordinator Create tech debt issues from POLY-44-feat-customer-insights-dashboard/reviews/tech-debt-review.md
```

**Agent Does**:
- Reads tech debt items
- Creates CONCISE improvement stories
- Estimates effort
- Creates in Linear if confirmed

**Outputs**:
```
.cursor/specs/POLY-44-feat-customer-insights-dashboard/
├── reviews/               (existing)
└── linear/
    ├── tech-debt-stories.md
    └── linear-links.md
```

---

#### Step 3: Implement Improvements (varies)
**Agent**: 🛠️ implementation-specialist

**Prompt**:
```
@Implementation-Specialist Fix tech debt items in POLY-44-feat-customer-insights-dashboard per Linear issues
```

---

### Total Timeline: Tech Debt
- **Per item**: 1-4 hours depending on complexity
- **Batch of 5 items**: 1-2 days

---

## Pattern 4: Performance Optimization

### High-Level Flow
```
🛡️ code-reviewer (profile) → 📋 product-strategist (prioritize) → 🛠️ implementation-specialist → 🧪 test-engineer (benchmark)
```

### Workflow

#### Step 1: Profile and Identify (1 hour)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Profile the customer dashboard for performance bottlenecks. Use chrome-devtools performance profiler.
```

**Agent Does**:
- Uses chrome-devtools to profile application
- Identifies bottlenecks
- Prioritizes by impact

---

#### Step 2: Define Optimization Goals (30 min)
**Agent**: 📋 product-strategist

**Prompt**:
```
@Product-Strategist Plan performance optimization for customer-dashboard based on profiling results
```

---

#### Step 3: Create Linear Issues (10 min)
**Agent**: 📊 linear-coordinator

---

#### Step 4: Implement Optimizations (1-2 days)
**Agent**: 🛠️ implementation-specialist

---

#### Step 5: Benchmark Improvements (2 hours)
**Agent**: 🧪 test-engineer

**Special**: Creates performance benchmarks and validates improvements

---

## Pattern 5: Emergency Production Issue

### High-Level Flow
```
⚡ quick-fixer (hotfix) → 📊 linear-coordinator (track) → 🧪 test-engineer (regression) → 📚 documentation-master (postmortem)
```

### Workflow

#### Step 1: Immediate Fix (15 min)
**Agent**: ⚡ quick-fixer

**Prompt**:
```
@Quick-Fixer URGENT: Users can't generate presentations - 500 error on /api/v1/presentations/create
```

**Agent Does**:
- Rapid diagnosis
- Minimal surgical fix
- Immediate validation
- Documents hotfix

---

#### Step 2: Track in Linear (5 min)
**Agent**: 📊 linear-coordinator

**Prompt**:
```
@Linear-Coordinator Create incident issue for presentation-generation-fix
```

---

#### Step 3: Regression Tests (30 min)
**Agent**: 🧪 test-engineer

---

#### Step 4: Postmortem (30 min)
**Agent**: 📚 documentation-master

**Creates incident postmortem and troubleshooting guide**

---

### Total Timeline: Emergency Fix
- **Traditional**: 3-6 hours
- **With Agents**: 1.5 hours
- **Critical**: Faster resolution, better documentation

---

## Pattern 6: Infrastructure Change

### High-Level Flow
```
🧠 strategic-architect (plan) → ⚙️ devops-specialist (implement) → 📊 linear-coordinator (track) → 🧪 test-engineer (validate)
```

### Workflow

#### Step 1: Plan Infrastructure Change (2 hours)
**Agent**: 🧠 strategic-architect

**Prompt**:
```
@Strategic-Architect Plan migration from standalone Redis to Redis cluster for session management
```

---

#### Step 2: Implement Infrastructure (1-2 days)
**Agent**: ⚙️ devops-specialist

**Prompt**:
```
@DevOps-Specialist Implement Redis cluster migration for redis-cluster-migration
```

---

#### Step 3: Create Tracking Tickets (10 min)
**Agent**: 📊 linear-coordinator

---

#### Step 4: Validate (4 hours)
**Agent**: 🧪 test-engineer

**Creates multi-environment validation tests**

---

## Pattern 7: Simple Enhancement / Chore

### High-Level Flow
```
📋 product-strategist (quick plan) → 📊 linear-coordinator → 🛠️ implementation-specialist → 🧪 test-engineer
```

### Workflow (Streamlined)

#### All-in-One Session (2-3 hours)

**Step 1** (10 min):
```
@Product-Strategist Quick plan for adding export to CSV button in analytics dashboard
```

**Step 2** (5 min):
```
@Linear-Coordinator Create task for csv-export-button
```

**Step 3** (1 hour):
```
@Implementation-Specialist Implement csv-export-button
```

**Step 4** (30 min):
```
@Test-Engineer Add tests for csv-export-button
```

**Skip**: Strategic Architect (too simple), Code Reviewer (low risk), Documentation (self-explanatory)

---

## Pattern 8: Refactoring

### High-Level Flow
```
🛡️ code-reviewer (identify) → 📋 product-strategist (scope) → 🛠️ implementation-specialist (refactor) → 🧪 test-engineer (validate no regressions)
```

### Workflow

#### Step 1: Identify Refactoring Needs (1 hour)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Review presentation generation service for refactoring opportunities
```

---

#### Step 2: Define Refactoring Scope (30 min)
**Agent**: 📋 product-strategist

**Prompt**:
```
@Product-Strategist Plan refactoring scope for presentation-service-refactor based on review findings
```

---

#### Step 3: Create Linear Tasks (5 min)
**Agent**: 📊 linear-coordinator

---

#### Step 4: Refactor (1-2 days)
**Agent**: 🛠️ implementation-specialist

---

#### Step 5: Regression Testing (4 hours)
**Agent**: 🧪 test-engineer

**Critical**: Ensures refactoring didn't break existing functionality

---

## Pattern 9: Security Fix

### High-Level Flow
```
🛡️ code-reviewer (audit) → 📊 linear-coordinator (track) → 🛠️ implementation-specialist (fix) → 🧪 test-engineer (security tests)
```

### Workflow

#### Step 1: Security Audit (1-2 hours)
**Agent**: 🛡️ code-reviewer

**Prompt**:
```
@Code-Reviewer Security audit of auth endpoints. Use chrome-devtools to test live authentication flows.
```

**Agent Does**:
- Reviews auth code
- Uses chrome-devtools to test XSS, CSRF, session handling
- Documents security findings

---

#### Step 2: Create Security Tickets (10 min)
**Agent**: 📊 linear-coordinator

**Prompt**:
```
@Linear-Coordinator Create security fix issues from auth-security-audit/reviews/security-audit.md
```

**Agent Creates**: CONCISE security tickets with severity ratings

---

#### Step 3: Implement Fixes (1-2 days)
**Agent**: 🛠️ implementation-specialist

---

#### Step 4: Security Testing (4 hours)
**Agent**: 🧪 test-engineer

**Creates security-specific test suites**

---

## Pattern 10: Documentation Only

### High-Level Flow
```
📚 documentation-master
```

### Workflow (Single Agent)

**Prompt**:
```
@Documentation-Master Create user guide for the customer insights dashboard feature
```

**Agent Does**:
- Reads existing code and artifacts
- Creates comprehensive documentation
- No other agents needed for pure documentation

---

## Quick Reference: When to Use Which Pattern

| Scenario | Pattern | Time | Agents Used |
|----------|---------|------|------------|
| **New major feature** | Pattern 1 | 1 week | 7-8 agents (full workflow) |
| **New AI/ML feature** | Pattern 1 + specialized | 1-2 weeks | 8-9 agents (add RAG/ML) |
| **Bug fix** | Pattern 2 | 1 hour | 4 agents (Quick, Linear, Review, Test) |
| **Simple chore** | Pattern 7 | 2-3 hours | 3-4 agents (Strategist, Linear, Implementation, Test) |
| **Tech debt** | Pattern 3 | Varies | 3 agents (Review, Linear, Implementation) |
| **Performance** | Pattern 4 | 2-3 days | 4-5 agents (Review, Strategist, Linear, Implementation, Test) |
| **Emergency** | Pattern 5 | 1.5 hours | 4 agents (Quick, Linear, Test, Docs) |
| **Infrastructure** | Pattern 6 | 2-3 days | 4 agents (Architect, DevOps, Linear, Test) |
| **Refactoring** | Pattern 8 | 2-3 days | 4-5 agents (Review, Strategist, Linear, Implementation, Test) |
| **Security fix** | Pattern 9 | 2-3 days | 4 agents (Review, Linear, Implementation, Test) |
| **Docs only** | Pattern 10 | 2 hours | 1 agent (Documentation) |

---

## Common Workflow Variations

### Skip Patterns for Speed

**When you can skip agents**:
- **Strategic Architect**: Simple features with clear implementation
- **Code Reviewer**: Low-risk changes (documentation, tests)
- **Documentation Master**: Self-explanatory features
- **DevOps Specialist**: No infrastructure changes

**Core agents you rarely skip**:
- **Product Strategist**: Always define requirements
- **Implementation Specialist**: Always need code
- **Test Engineer**: Always need tests
- **Linear Coordinator**: Always track in Linear

---

## Agent Combinations

### Planning Combo
```
📋 product-strategist + 🧠 strategic-architect + 📊 linear-coordinator
= Complete planning with Linear issues (2-3 hours)
```

### Execution Combo
```
🛠️ implementation-specialist + 🛡️ code-reviewer + 🧪 test-engineer
= Implemented, reviewed, tested code (1-3 days)
```

### AI/ML Combo
```
📋 product-strategist + 🧭 rag-architect + 🤖 ml-engineer + 🛠️ implementation-specialist
= AI feature from concept to code (1-2 weeks)
```

### Quality Combo
```
🛡️ code-reviewer + 🧪 test-engineer + 📚 documentation-master
= Quality gates for any feature (1 day)
```

---

## Real-World Example: Complete Feature

### Feature: "Export presentation analytics to CSV"

**Day 1 Morning - Planning**:
```bash
# 30 minutes
@Product-Strategist Plan export analytics to CSV feature

# 1 hour  
@Strategic-Architect Design csv-export-analytics architecture

# 15 minutes
@Linear-Coordinator Create Linear issues for csv-export-analytics
```

**Day 1 Afternoon - Implementation**:
```bash
# 3 hours
@Implementation-Specialist Implement csv-export-analytics

# 30 minutes
@Code-Reviewer Review csv-export-analytics implementation
```

**Day 2 Morning - Testing & Docs**:
```bash
# 2 hours
@Test-Engineer Create tests for csv-export-analytics

# 1 hour
@Documentation-Master Document csv-export-analytics feature
```

**Day 2 Afternoon - Deploy**:
```bash
# 2 hours
@DevOps-Specialist Deploy csv-export-analytics to production
```

**Total**: 2 days (vs 1 week traditional)

---

## Pro Tips

### Tip 1: Always Start with Product Strategist
Even for "simple" features - 30 minutes of planning saves days of rework.

### Tip 2: Linear Coordinator After Planning, Before Implementation
Creates clear tracking before coding starts. Team knows what's being built.

### Tip 3: Use Quick Fixer for True Emergencies Only
For production-down scenarios. Otherwise use full Implementation Specialist.

### Tip 4: Combine Agents in Same Session
```
# Planning session (morning):
@Product-Strategist → @Strategic-Architect → @Linear-Coordinator

# Implementation session (afternoon):
@Implementation-Specialist → @Code-Reviewer → @Test-Engineer
```

### Tip 5: Skip Docs for Internal/Obvious Features
Not every feature needs Documentation Master. Use judgment.

---

## Workflow Cheat Sheet

```
I WANT TO...                    USE THIS PATTERN
════════════════════════════════════════════════
Add new feature                 → Pattern 1 (7-8 agents, 1 week)
Add AI/ML feature              → Pattern 1 + RAG/ML (8-9 agents, 1-2 weeks)
Fix a bug                      → Pattern 2 (4 agents, 1 hour)
Simple enhancement             → Pattern 7 (3-4 agents, 2-3 hours)
Address tech debt              → Pattern 3 (3 agents, varies)
Improve performance            → Pattern 4 (4-5 agents, 2-3 days)
Emergency production issue     → Pattern 5 (4 agents, 1.5 hours)
Change infrastructure          → Pattern 6 (4 agents, 2-3 days)
Refactor code                  → Pattern 8 (4-5 agents, 2-3 days)
Fix security issue             → Pattern 9 (4 agents, 2-3 days)
Write documentation            → Pattern 10 (1 agent, 2 hours)
```

---

## Sample Prompts for Each Pattern

### New Feature
```
@Product-Strategist Plan a feature for [describe feature and business value]
@Strategic-Architect Design the architecture for [feature-name]
@Linear-Coordinator Create Linear issues for [feature-name]
@Implementation-Specialist Implement [feature-name] using all .cursor/specs/ artifacts
@Code-Reviewer Review [feature-name] implementation
@Test-Engineer Create tests for [feature-name]
@Documentation-Master Document [feature-name]
@DevOps-Specialist Deploy [feature-name] to production
```

### Bug Fix
```
@Quick-Fixer Fix [specific bug description with error details]
@Linear-Coordinator Create bug issue for [feature-name-fix]
@Code-Reviewer Quick security check on [feature-name-fix]
@Test-Engineer Add regression test for [feature-name-fix]
```

### Chore/Tech Debt
```
@Code-Reviewer Review [component] for tech debt and improvement opportunities
@Linear-Coordinator Create tech debt stories from [feature]/reviews/
@Implementation-Specialist Fix tech debt items in [feature] per Linear issues
```

---

## Pattern 11: Post-Development Audit (User-Invoked)

**⚠️ NOTE**: This pattern is **USER-INVOKED ONLY** - not part of automatic workflow orchestration

### Use This Pattern When
- ✅ Completed feature development (before merge request)
- ✅ Security-sensitive changes (auth, data access, API)
- ✅ Multi-agent complex workflows (want to verify compliance)
- ✅ Learning/training (review conversation for best practices)
- ✅ Periodic quality checks (monthly conversation sampling)

### Flow
```
{Feature complete} → 🔍 chat-auditor → Address findings → Merge
```

### Detailed Workflow

#### Step 1: Trigger Audit (15-30 min)
**Agent**: 🔍 chat-auditor

**Prompt**:
```
{audit-conversation}
# OR
@Chat-Auditor Audit this conversation for compliance
# OR (focused)
{audit-conversation} focus on security and testing
```

**Agent Does**:
- Analyzes entire conversation history
- Checks custom agent usage and compliance
- Validates Orchestrator orchestration (if used)
- Reviews adherence to project rules
- Assesses MCP usage (context7, chrome-devtools, Linear MCP)
- Evaluates artifact organization
- Calculates compliance scores (0-100)
- Generates detailed findings with evidence

**Outputs**:
```
.cursor/specs/_audits/
├── audit-YYYY-MM-DD-HHMMSS.md    (detailed report)
├── README.md                      (audit index, updated)
└── trends.json                    (compliance data, updated)
```

---

#### Step 2: Review Findings (5-15 min)
**Human Review**

**Actions**:
- Read audit report
- Understand critical findings (security, data loss, auth)
- Review major findings (architecture, tests, error handling)
- Note minor findings (style, docs, optimizations)

**Decision Points**:
- **Critical findings**: MUST fix before merge
- **Major findings**: Should fix soon (create follow-up tasks)
- **Minor findings**: Note for future improvement

---

#### Step 3: Address Critical/Major Findings (Varies)
**Agent**: Depends on finding type

**For Critical Security Issues**:
```
@Quick-Fixer Fix [critical security issue from audit]
# OR
@Code-Reviewer Review [specific security concern]
```

**For Missing Tests**:
```
@Test-Engineer Add test coverage per audit findings
Read audit report at .cursor/specs/_audits/audit-[timestamp].md
```

**For Architecture Violations**:
```
@Implementation-Specialist Fix [architecture issue from audit]
Follow pattern from .cursor/specs/[feature]/plan.md
```

**Agent Does**:
- Addresses specific findings
- Applies recommended fixes
- Documents changes

---

#### Step 4: Re-audit (Optional, 15-30 min)
**Agent**: 🔍 chat-auditor

**Prompt**:
```
{audit-conversation}
```

**Agent Does**:
- Re-analyzes conversation including fixes
- Updates compliance score
- Confirms critical findings resolved
- Documents improvement

---

### Total Timeline: Post-Development Audit
- **Initial Audit**: 15-30 min
- **Review**: 5-15 min
- **Fixes**: Varies (1-4 hours typical)
- **Re-audit**: 15-30 min (optional)
- **Total**: 1-6 hours depending on findings

### When NOT to Use
- ❌ Simple single-file edits (overkill)
- ❌ Quick Fixer hotfixes (too small)
- ❌ Pure conversational Q&A (nothing to audit)
- ❌ During active development (wait until complete)

### Audit Score Interpretation

| Score | Status | Action |
|-------|--------|--------|
| 90-100 | ✅ Excellent | Merge with confidence |
| 75-89 | ✅ Good | Address minor findings, merge |
| 60-74 | ⚠️ Fair | Fix major findings before merge |
| <60 | ❌ Needs Work | Fix critical findings, re-audit |

### Example Audit Flow

**Scenario**: Just completed POLY-44-feat-customer-insights-dashboard feature

```
1. Development complete (using Strategic Architect → Implementation → Code Review)
2. {audit-conversation}
3. Chat Auditor finds:
   - Critical: 0
   - Major: 3 (missing tests, error handling, security sanitization)
   - Minor: 5
   - Score: 78/100 (Good)
4. Review report, agree with findings
5. @Test-Engineer Add test coverage per audit
6. @Implementation-Specialist Fix error handling issues
7. Re-audit: Score: 88/100 (Good)
8. Create MR with confidence
```

### Audit Trend Analysis

As you accumulate audits, Chat Auditor tracks:
- **Compliance trends**: Improving or declining scores
- **Common violations**: Recurring issues requiring process changes
- **Best practices**: Successfully adopted patterns
- **Improvement velocity**: Rate of compliance improvement

Access trend data:
```
# View all audits
ls .cursor/specs/_audits/

# Read audit index
cat .cursor/specs/_audits/README.md

# Check trends
cat .cursor/specs/_audits/trends.json
```

### Integration with Other Patterns

**New Feature (Pattern 1)**:
```
... → Documentation Master → {audit-conversation} → Merge
```

**Bug Fix (Pattern 2)**:
```
Quick Fixer → Code Reviewer → {audit-conversation} → Merge
```

**Security Fix (Pattern 9)**:
```
Code Reviewer (audit) → ... → Security Testing → {audit-conversation} → Merge
```

---

## Expected Time Savings

### By Pattern

| Pattern | Traditional | With Agents | Savings |
|---------|-------------|------------|---------|
| New Feature | 2-3 weeks | 1 week | 60-70% |
| AI/ML Feature | 3-4 weeks | 1-2 weeks | 50-60% |
| Bug Fix | 2-4 hours | 1 hour | 50-75% |
| Chore | 1 day | 2-3 hours | 75-80% |
| Tech Debt | Varies | 50% less | 50% |
| Performance | 1 week | 2-3 days | 60-70% |
| Emergency | 3-6 hours | 1.5 hours | 50-75% |
| Infrastructure | 1 week | 2-3 days | 60-70% |
| Security Fix | 1 week | 2-3 days | 60-70% |
| Documentation | 1 day | 2 hours | 75% |

---

## Your Cognitive Railway in Action

Each pattern is a **pre-laid track** where:
- You provide the destination (feature description)
- Agents handle the journey (planning, design, implementation, validation)
- You review at each station (approve outputs before next agent)
- Arrive at production-ready code faster and with higher quality

**Choose your pattern based on the work type, and let the agents guide you through! 🚀**




