# Manifesto

The principles and philosophy behind Oh My OpenCode.

---

## Human Intervention is a Failure Signal

**HUMAN IN THE LOOP = BOTTLENECK**
**HUMAN IN THE LOOP = BOTTLENECK**
**HUMAN IN THE LOOP = BOTTLENECK**

Think about autonomous driving. When a human has to take over the wheel, that's not a feature - it's a failure of the system. The car couldn't handle the situation on its own.

**Why is coding any different?**

When you find yourself:
- Fixing the AI's half-finished code
- Manually correcting obvious mistakes
- Guiding the agent step-by-step through a task
- Repeatedly clarifying the same requirements

...that's not "human-AI collaboration." That's the AI failing to do its job.

**Oh My OpenCode is built on this premise**: Human intervention during agentic work is fundamentally a wrong signal. If the system is designed correctly, the agent should complete the work without requiring you to babysit it.

---

## Indistinguishable Code

**Goal: Code written by the agent should be indistinguishable from code written by a senior engineer.**

Not "AI-generated code that needs cleanup." Not "a good starting point." The actual, final, production-ready code.

This means:
- Following existing codebase patterns exactly
- Proper error handling without being asked
- Tests that actually test the right things
- No AI slop (over-engineering, unnecessary abstractions, scope creep)
- Comments only when they add value

If you can tell whether a commit was made by a human or an agent, the agent has failed.

---

## Token Cost vs. Productivity

**Higher token usage is acceptable if it significantly increases productivity.**

Using more tokens to:
- Have multiple specialized agents research in parallel
- Get the job done completely without human intervention
- Verify work thoroughly before completion
- Accumulate knowledge across tasks

...is a worthwhile investment when it means 10x, 20x, or 100x productivity gains.

**However:**

Unnecessary token waste is not pursued. The system optimizes for:
- Using cheaper models (Haiku, Flash) for simple tasks
- Avoiding redundant exploration
- Caching learnings across sessions
- Stopping research when sufficient context is gathered

Token efficiency matters. But not at the cost of work quality or human cognitive load.

---

## Minimize Human Cognitive Load

**The human should only need to say what they want. Everything else is the agent's job.**

Two approaches to achieve this:

### Approach 1: Prometheus (Interview Mode)

You say: "I want to add authentication."

Prometheus:
- Researches your codebase to understand existing patterns
- Asks clarifying questions based on actual findings
- Surfaces edge cases you hadn't considered
- Documents decisions as you make them
- Generates a complete work plan

**You provide intent. The agent provides structure.**

### Approach 2: Ultrawork (Just Do It Mode)

You say: "ulw add authentication"

The agent:
- Figures out the right approach
- Researches best practices
- Implements following conventions
- Verifies everything works
- Keeps going until complete

**You provide intent. The agent handles everything.**

In both cases, the human's job is to **express what they want**, not to manage how it gets done.

---

## Predictable, Continuous, Delegatable

**The ideal agent should work like a compiler**: markdown document goes in, working code comes out.

### Predictable

Given the same inputs:
- Same codebase patterns
- Same requirements
- Same constraints

...the output should be consistent. Not random, not surprising, not "creative" in ways you didn't ask for.

### Continuous

Work should survive interruptions:
- Session crashes? Resume with `/start-work`
- Need to step away? Progress is tracked
- Multi-day project? Context is preserved

The agent maintains state. You don't have to.

### Delegatable

Just like you can assign a task to a capable team member and trust them to handle it, you should be able to delegate to the agent.

This means:
- Clear acceptance criteria, verified independently
- Self-correcting behavior when something goes wrong
- Escalation (to Oracle, to user) only when truly needed
- Complete work, not "mostly done"

---

## The Core Loop

```
Human Intent → Agent Execution → Verified Result
       ↑                              ↓
       └──────── Minimum ─────────────┘
          (intervention only on true failure)
```

Everything in Oh My OpenCode is designed to make this loop work:

| Feature | Purpose |
|---------|---------|
| Prometheus | Extract intent through intelligent interview |
| Metis | Catch ambiguities before they become bugs |
| Momus | Verify plans are complete before execution |
| Orchestrator | Coordinate work without human micromanagement |
| Todo Continuation | Force completion, prevent "I'm done" lies |
| Category System | Route to optimal model without human decision |
| Background Agents | Parallel research without blocking user |
| Wisdom Accumulation | Learn from work, don't repeat mistakes |

---

## What This Means in Practice

**You should be able to:**

1. Describe what you want (high-level or detailed, your choice)
2. Let the agent interview you if needed
3. Confirm the plan (or just let ultrawork handle it)
4. Walk away
5. Come back to completed, verified, production-ready work

**If you can't do this, something in the system needs to improve.**

---

## The Future We're Building

A world where:
- Human developers focus on **what** to build, not **how** to get AI to build it
- Code quality is independent of who (or what) wrote it
- Complex projects are as easy as simple ones (just take longer)
- "Prompt engineering" becomes as obsolete as "compiler debugging"

**The agent should be invisible.** Not in the sense that it's hidden, but in the sense that it just works - like electricity, like running water, like the internet.

You flip the switch. The light turns on. You don't think about the power grid.

That's the goal.

---

## Further Reading

- [Overview](./guide/overview.md) - Getting started with Oh My OpenCode
- [Understanding the Orchestration System](./guide/understanding-orchestration-system.md) - How the agent coordination works
