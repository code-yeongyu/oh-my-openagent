# Parallel Execution Guidelines

> Instructions for executing multiple agents simultaneously to improve efficiency.

## Core Principle

**Default to parallel execution when tasks are independent. Use sequential execution only when dependencies require it.**

## When to Parallelize

### ✅ Use Parallel Execution When:

- Tasks are **independent** (no shared state or files)
- Tasks operate on **different components** (backend vs frontend)
- Tasks require **different expertise** (review vs testing)
- Results can be **combined** after completion
- Time savings outweigh coordination overhead

### ❌ Use Sequential Execution When:

- Tasks have **strict dependencies** (B needs A's output)
- Tasks modify the **same files**
- Tasks require **iterative refinement**
- Coordination overhead exceeds time savings

## Quick Assessment

Before executing tasks, ask:

1. Can these tasks run without waiting for each other?
2. Do they modify the same files or resources?
3. Do any tasks need output from another?
4. Can results be merged/combined?

If tasks are independent → **Parallelize**

## Parallel Patterns

### Pattern 1: Fan-Out/Fan-In

**Use for**: Breaking one task into independent subtasks

**How it works**:
1. Decompose the work into independent pieces
2. Delegate each piece to an appropriate agent simultaneously
3. Combine results when all complete

**Example scenario**:
> "Build a user dashboard" becomes:
> - Backend API (implementation-specialist)
> - Frontend components (implementation-specialist)  
> - Test suite (test-engineer)
> 
> All three can run in parallel, then integrate.

### Pattern 2: Parallel Streams

**Use for**: Related but independent work tracks

**How it works**:
1. Identify independent work streams
2. Assign agents to each stream
3. Define sync points where streams must coordinate
4. Run streams in parallel between sync points

**Example scenario**:
> Feature development with Backend, Frontend, and QA streams:
> - Backend stream: API design → implementation → testing
> - Frontend stream: UI design → implementation → integration
> - QA stream: test planning → test writing → test execution
>
> Streams run in parallel, syncing at key milestones.

### Pattern 3: Multi-Perspective Analysis

**Use for**: Getting expert input from multiple agents

**How it works**:
1. Identify which specialists are needed
2. Ask each specialist to analyze independently
3. Synthesize their findings

**Example scenario**:
> Reviewing a new feature design:
> - strategic-architect: architecture analysis
> - code-reviewer: security review
> - test-engineer: testability assessment
>
> All reviews happen in parallel, findings combined.

## Tool Call Batching

When using OpenCode tools, batch independent calls:

**Instead of calling tools one at a time:**
- Get issue details
- Then get project info
- Then get team info

**Call them simultaneously:**
- Get issue, project, and team info at the same time

This reduces total wait time significantly.

## Agent Delegation

When delegating to multiple agents via the `task` tool:

**Parallel delegation** - When agents work on independent tasks:
- Delegate to code-reviewer for security audit
- Delegate to test-engineer for test coverage
- Delegate to documentation-master for docs
- All three can work simultaneously

**Sequential delegation** - When agents depend on each other:
- First: strategic-architect designs the approach
- Then: implementation-specialist builds it
- Then: code-reviewer validates it

## Work Coordination via Linear

Use Linear issues to coordinate parallel work:

1. **Create parent issue** for the overall task
2. **Create sub-issues** for each parallel stream
3. **Link related issues** to track dependencies
4. **Update status** as each stream completes
5. **Close parent** when all sub-issues done

This creates natural coordination without agents blocking each other.

## Result Synthesis

When parallel work completes, combine results:

### Merge Strategy
Combine all outputs into unified result. Best when outputs are complementary (e.g., backend + frontend code).

### Review Strategy  
Have one agent review and integrate parallel outputs. Best for complex integrations.

### Selective Strategy
Take the best parts from each parallel result. Best when multiple approaches were tried.

## Performance Guidelines

### Aim for 2-4 parallel agents
- Too few: Missing parallelization opportunities
- Too many: Coordination overhead increases

### Keep parallel tasks similar in scope
- Avoid one 4-hour task parallel with three 30-minute tasks
- Balance work to maximize parallel utilization

### Define clear boundaries
- Each parallel stream should have clear ownership
- Minimize cross-stream dependencies

## Example Workflows

### Feature Development (Parallel)

```
Phase 1: Planning (sequential)
└── Product strategist defines requirements
└── Architect designs approach

Phase 2: Implementation (parallel)
├── Backend implementation
├── Frontend implementation  
└── Test planning

Phase 3: Quality (parallel)
├── Security review
├── Test execution
└── Documentation

Phase 4: Completion (sequential)
└── Integration and final review
└── Historian commits with Linear reference
```

### Code Review (Parallel)

```
Request: "Review this PR for security, performance, and maintainability"

Parallel execution:
├── Security-focused review (code-reviewer)
├── Performance analysis (code-reviewer)
└── Maintainability assessment (code-reviewer)

Synthesis: Combine findings into unified review
```

### Bug Investigation (Parallel)

```
Request: "Investigate why users can't log in"

Parallel execution:
├── Check auth service logs
├── Review recent auth changes
└── Test auth flow manually

Synthesis: Combine findings to identify root cause
```

## Anti-Patterns to Avoid

### ❌ Parallelizing dependent tasks
Don't run tasks in parallel if one needs the other's output.

### ❌ Over-parallelization
Don't create 10 parallel streams for a simple task.

### ❌ No coordination plan
Don't parallelize without a plan for combining results.

### ❌ Ignoring conflicts
Don't have parallel agents modify the same files.

## Summary

1. **Identify independent tasks** - What can run without waiting?
2. **Delegate in parallel** - Use `task` tool for multiple agents simultaneously
3. **Coordinate via Linear** - Use issues to track parallel streams
4. **Synthesize results** - Combine outputs when parallel work completes
5. **Default to parallel** - Only go sequential when dependencies require it
