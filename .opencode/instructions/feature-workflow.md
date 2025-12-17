# Feature Planning & Execution Workflow

## Overview

This document describes the complete workflow for planning and executing new features using custom agents and the `.cursor/specs/` folder structure.

## Command-Driven vs Agent-Driven Workflows

### Command-Driven Workflow (Recommended)

Use workflow commands (`/specify`, `/plan`, `/tasks`, `/implement`) for deterministic, script-driven workflows:

**Benefits**:
- Scripts handle folder creation and branch naming
- Linear integration (automatic `issue.branchName` usage)
- JSON output for reliable command parsing
- Governance hooks (Context Steward + Historian) built-in
- Consistent folder naming: `{ISSUE-ID}-{type}-{name}` or `{NNN}-{type}-{name}`

**Example**:
```bash
/specify Add user authentication system
# → Creates .cursor/specs/POLY-42-feat-user-authentication/ (Linear agent)
# → Creates .cursor/specs/001-feat-user-authentication/ (non-Linear agent)

/plan
# → Creates plan.md in existing spec folder

/tasks
# → Creates tasks.md from plan.md

/implement
# → Implements according to tasks.md
```

**See**: `.opencode/command/` for all commands, `.cursor/scripts/README.md` for script details

### Agent-Driven Workflow (Alternative)

Use `@Agent-Name` or orchestrator for direct agent invocation:

**Benefits**:
- Direct agent control
- Flexible invocation
- No script dependencies

**Example**:
```bash
@Product-Strategist Plan a feature for user authentication
@Strategic-Architect Design the architecture
```

**Note**: Agents respect command-provided paths when invoked by commands (no duplicate folder creation)

## The Workflow: From Idea to Production

### Phase 1: Business Planning 📋
**Agent**: product-strategist
**Duration**: 1-2 hours
**Output Location**: `.cursor/specs/{feature-id}/spec.md`

**What Happens:**
1. User describes the feature idea or business need
2. Product Strategist asks clarifying questions about:
   - Target users
   - Business outcomes
3. Creates comprehensive business documentation:
   - **spec.md** - Feature specification (requirements, user stories, success criteria)

**Example Prompt:**
```
@Product-Strategist We need a feature that helps sales reps get AI-powered suggestions for slide content based on customer data. The goal is to reduce presentation prep time and improve content relevance.
```

**Deliverables:**
- ✅ Clear product vision and goals
- ✅ User stories with acceptance criteria
- ✅ Business value quantified
- ✅ Success metrics defined
- ✅ Files in `.cursor/specs/{feature-id}/spec.md`

**Next Step**: → Strategic Architect

---

### Phase 2: Technical Design 🧠
**Agent**: strategic-architect
**Duration**: 2-4 hours
**Input Location**: `.cursor/specs/{feature-id}/spec.md`
**Output Location**: `.cursor/specs/{feature-id}/plan.md`

**What Happens:**
1. Reads all files from `.cursor/specs/{feature-id}/spec.md`
2. Reviews existing project architecture
3. Asks clarifying questions about:
   - Primary business goal (from spec)
   - Specific performance or security constraints
4. Creates single implementation plan file:
   - **plan.md** - Complete plan with architecture, data models, API design, and contracts

**Example Prompt:**
```
@Strategic-Architect Design the architecture for the AI-powered slide suggestions feature. Reference the spec in .cursor/specs/{feature-id}/spec.md
```

**Deliverables:**
- ✅ System architecture with component diagrams
- ✅ Data flow diagrams
- ✅ Security considerations documented
- ✅ Performance implications analyzed
- ✅ Implementation roadmap with effort estimates
- ✅ Files in `.cursor/specs/{feature-id}/plan.md`

**Next Step**: → Implementation Specialist (or specialized agents if needed)

---

### Phase 2.5: Specialized Design (If Needed)

#### For AI/ML Features: RAG Architect or ML Engineer

**RAG Architect**:
- **When**: Feature involves document retrieval, embeddings, or semantic search
- **Agent**: rag-architect
- **Output**: `.cursor/specs/{feature-id}/plan.md` (adds RAG design section)
- **Includes**: Embedding strategy, vector database design, retrieval algorithms

**ML Engineer**:
- **When**: Feature involves machine learning models, training pipelines
- **Agent**: ml-engineer
- **Output**: `.cursor/specs/{feature-id}/plan.md` (adds ML spec section)
- **Includes**: Model selection, training pipeline, inference optimization

**Example Prompt:**
```
@RAG-Architect Design the RAG pipeline for the slide suggestions feature. Reference the architecture in .cursor/specs/{feature-id}/plan.md
```

---

### Phase 3: Implementation 🛠️
**Agent**: implementation-specialist
**Duration**: 1-3 days (depending on complexity)
**Input Location**: `.cursor/specs/{feature-id}/spec.md` + `.cursor/specs/{feature-id}/plan.md`
**Output Location**: `.cursor/specs/{feature-id}/implementation/` + actual code files

**What Happens:**
1. Reads ALL planning artifacts from `.cursor/specs/{feature-id}/`:
   - Requirements (spec.md)
   - Architecture (plan.md)
   - Specialized designs (RAG, ML specs if applicable)
2. Asks clarifying questions about:
   - Specific acceptance criteria
   - Existing patterns to follow
3. Creates implementation documentation:
   - **implementation-spec.md** - Detailed implementation plan
   - **technical-notes.md** - Implementation decisions and gotchas
4. Writes the actual production code:
   - Backend files (FastAPI routes, services, models)
   - Frontend files (React components, hooks, services)
   - Database migrations (if needed)

**Example Prompt:**
```
@Implementation-Specialist Implement the AI slide suggestions feature. All planning artifacts are in .cursor/specs/{feature-id}/spec.md and .cursor/specs/{feature-id}/plan.md
```

**Deliverables:**
- ✅ Implementation specification documented
- ✅ Production-ready code in codebase
- ✅ Database migrations (if needed)
- ✅ Security measures implemented
- ✅ Technical notes for future maintainers
- ✅ Files in `.cursor/specs/{feature-id}/implementation/` + actual code

**Next Step**: → Code Reviewer

---

### Phase 4: Code Review 🛡️
**Agent**: code-reviewer
**Duration**: 30 minutes - 1 hour
**Input Location**: Actual code + `.cursor/specs/{feature-id}/implementation/`
**Output Location**: `.cursor/specs/{feature-id}/reviews/`

**What Happens:**
1. Reviews the implemented code against requirements and architecture
2. Performs security analysis (auth, data handling, input validation)
3. Reviews performance (database queries, API efficiency)
4. Assesses code quality (patterns, maintainability)
5. Creates review documentation:
   - **review-report.md** - Comprehensive review with severity ratings
   - **security-audit.md** - Security-specific findings (if critical issues found)

**Example Prompt:**
```
@Code-Reviewer Review the AI slide suggestions implementation. Check routes/suggestions.py and components/SuggestionPanel.jsx for security and quality issues.
```

**Deliverables:**
- ✅ Review report with severity ratings (Critical, High, Medium, Low)
- ✅ Specific code references and line numbers
- ✅ Concrete remediation steps
- ✅ Risk assessment
- ✅ Files in `.cursor/specs/{feature-id}/reviews/`

**Next Step**: → Implementation Specialist (if fixes needed) → Test Engineer

---

### Phase 5: Testing 🧪
**Agent**: test-engineer
**Duration**: 1-2 days
**Input Location**: `.cursor/specs/{feature-id}/spec.md` + `.cursor/specs/{feature-id}/implementation/`
**Output Location**: `.cursor/specs/{feature-id}/testing/` + test files

**What Happens:**
1. Reads requirements and implementation specs from `.cursor/specs/{feature-id}/`
2. Asks clarifying questions about:
   - Target test coverage (default: 80%)
   - Specific security or performance requirements
3. Creates test documentation:
   - **test-plan.md** - Comprehensive test planning
   - **test-strategy.md** - Test strategy and approach
4. Implements tests:
   - Backend: pytest unit and integration tests
   - Frontend: Vitest component and integration tests
   - Security: Auth and data handling tests
   - Performance: Benchmarking tests

**Example Prompt:**
```
@Test-Engineer Create comprehensive tests for the AI slide suggestions feature. Requirements are in .cursor/specs/{feature-id}/spec.md and implementation details in .cursor/specs/{feature-id}/implementation/
```

**Deliverables:**
- ✅ Test plan documented
- ✅ Test strategy defined
- ✅ 80%+ meaningful test coverage
- ✅ Security testing completed
- ✅ Performance benchmarks established
- ✅ Files in `.cursor/specs/{feature-id}/testing/` + test code

**Next Step**: → Documentation Master

---

### Phase 6: Documentation 📚
**Agent**: documentation-master
**Duration**: 2-4 hours
**Input Location**: All `.cursor/specs/{feature-id}/` folders
**Output Location**: `.cursor/specs/{feature-id}/documentation/` + actual docs

**What Happens:**
1. Reads ALL feature artifacts from `.cursor/specs/{feature-id}/`
2. Asks clarifying questions about:
   - Primary audience (default: developers)
   - Preferred format (default: Markdown)
3. Creates documentation:
   - **docs-plan.md** - Documentation strategy
   - **api-docs.md** - API documentation (if applicable)
   - **user-guide.md** - User-facing documentation
4. Creates final documentation in appropriate locations:
   - API docs → `docs/api/`
   - User guides → `docs/user-guides/`
   - Technical docs → `docs/technical/`

**Example Prompt:**
```
@Documentation-Master Create comprehensive documentation for the AI slide suggestions feature. All artifacts are in .cursor/specs/{feature-id}/
```

**Deliverables:**
- ✅ Documentation plan
- ✅ API documentation
- ✅ User guides
- ✅ Technical specifications
- ✅ Troubleshooting guides
- ✅ Files in `.cursor/specs/{feature-id}/documentation/` + actual docs

**Next Step**: → DevOps Specialist

---

### Phase 7: Deployment ⚙️
**Agent**: devops-specialist
**Duration**: 1-2 days
**Input Location**: All `.cursor/specs/{feature-id}/` folders
**Output Location**: `.cursor/specs/{feature-id}/operations/` + deployment configs

**What Happens:**
1. Reads architecture and implementation specs from `.cursor/specs/{feature-id}/`
2. Asks clarifying questions about:
   - Target environment (default: development)
   - Security or compliance requirements
3. Creates deployment documentation:
   - **deployment-plan.md** - Deployment strategy and rollout plan
   - **infra-spec.md** - Infrastructure specifications
4. Configures deployment:
   - OpenShift resources (deployments, services, routes)
   - CI/CD pipelines with security gates
   - Monitoring and alerting
   - Rollback procedures

**Example Prompt:**
```
@DevOps-Specialist Create deployment plan for the AI slide suggestions feature. Architecture is in .cursor/specs/{feature-id}/plan.md
```

**Deliverables:**
- ✅ Deployment plan documented
- ✅ Infrastructure configured
- ✅ CI/CD pipelines updated
- ✅ Monitoring and alerting set up
- ✅ Rollback procedures tested
- ✅ Files in `.cursor/specs/{feature-id}/operations/`

---

## Quick Reference: Agent Selection

### Planning a New Feature?
**Start with**: product-strategist
- Creates business requirements in `.cursor/specs/{feature-id}/spec.md`

### Designing the Technical Solution?
**Use**: strategic-architect
- Creates technical design in `.cursor/specs/{feature-id}/plan.md`
- Reads from `.cursor/specs/{feature-id}/spec.md`

### Building the Feature?
**Use**: implementation-specialist
- Creates implementation notes in `.cursor/specs/{feature-id}/implementation/`
- Reads from `.cursor/specs/{feature-id}/spec.md` and `.cursor/specs/{feature-id}/plan.md`
- Writes actual code in codebase

### Need Specialized AI/ML Design?
**Use**: rag-architect or ml-engineer
- Creates specialized designs in `.cursor/specs/{feature-id}/plan.md`

---

## Example: Complete Workflow for "AI Slide Suggestions"

### Step 1: Product Strategist
```
User: @Product-Strategist We need AI-powered slide suggestions for sales reps
```
**Creates:**
- `.cursor/specs/{feature-id}/spec.md` (contains requirements, user stories, success criteria)

### Step 2: Strategic Architect
```
User: @Strategic-Architect Design the AI slide suggestions system based on the spec in .cursor/specs/POLY-XX-feat-ai-slide-suggestions/spec.md
```
**Creates:**
- `.cursor/specs/POLY-XX-feat-ai-slide-suggestions/plan.md` (single file with architecture, data models, API design)

### Step 3: RAG Architect (specialized)
```
User: @RAG-Architect Design the RAG pipeline for slide suggestions based on the plan in .cursor/specs/POLY-XX-feat-ai-slide-suggestions/plan.md
```
**Updates:**
- `.cursor/specs/POLY-XX-feat-ai-slide-suggestions/plan.md` (adds RAG design section)

### Step 4: Implementation Specialist
```
User: @Implementation-Specialist Implement the AI slide suggestions feature using all planning artifacts in .cursor/specs/
```
**Creates:**
- `.cursor/specs/{feature-id}/implementation/implementation-spec.md`
- `.cursor/specs/{feature-id}/implementation/technical-notes.md`
- Actual code files (routes, services, components)

### Step 5: Code Reviewer
```
User: @Code-Reviewer Review the AI slide suggestions implementation
```
**Creates:**
- `.cursor/specs/{feature-id}/reviews/review-report.md`

### Step 6: Test Engineer
```
User: @Test-Engineer Create comprehensive tests for AI slide suggestions using .cursor/specs/ artifacts
```
**Creates:**
- `.cursor/specs/{feature-id}/testing/test-plan.md`
- `.cursor/specs/{feature-id}/testing/test-strategy.md`
- Test files

### Step 7: Documentation Master
```
User: @Documentation-Master Document the AI slide suggestions feature using all .cursor/specs/ artifacts
```
**Creates:**
- `.cursor/specs/{feature-id}/documentation/docs-plan.md`
- `.cursor/specs/{feature-id}/documentation/api-docs.md`
- Final documentation files

### Step 8: DevOps Specialist
```
User: @DevOps-Specialist Deploy AI slide suggestions to production using .cursor/specs/ specifications
```
**Creates:**
- `.cursor/specs/{feature-id}/operations/deployment-plan.md`
- Deployment configurations

---

## Benefits of This Workflow

### Clear Audit Trail
- Every decision documented in `.cursor/specs/{feature-id}/`
- Easy to trace why features were built a certain way
- Helps onboarding new team members

### Agent Specialization
- Each agent focuses on what it does best
- No agent tries to do everything
- Clear handoff points between phases

### Consistent Quality
- Structured process ensures nothing is skipped
- Documentation created throughout, not afterthought
- Testing planned from requirements phase

### Team Collaboration
- Artifacts in `.cursor/specs/{feature-id}/` can be reviewed by humans
- Clear communication between AI agents and human developers
- Easy to pick up where another agent left off

### Time Savings
- Traditional: 2-3 weeks for complex feature
- With agents: 1 week with comprehensive planning and documentation
- 60-70% time reduction while improving quality

---

## Tips for Success

1. **Always Start with Product Strategist**: Don't skip planning
2. **Read the Requirements**: Each agent should review `.cursor/specs/{feature-id}/` before starting
3. **Update Documentation**: Keep technical notes current during implementation
4. **Use Specific Feature Names**: Consistent naming across all artifacts
5. **Archive Completed Features**: Move to `.cursor/specs/_archive/` when done
6. **Review and Learn**: Reference past features to improve future planning

This workflow ensures every feature is well-planned, properly implemented, thoroughly tested, and completely documented! 🚀




