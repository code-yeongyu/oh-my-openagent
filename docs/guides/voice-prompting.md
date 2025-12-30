---
title: "Voice Prompting Best Practices"
description: "Best practices for voice-driven prompting with OpenCode and OmO"
---

# Voice Prompting Best Practices

This guide covers best practices for using voice input (via SuperWhisper or similar tools) to interact with OpenCode and the OmO plugin effectively.

## The Voice-to-Prompt Pipeline

```
Speech → Transcription → AI Processing → OpenCode Prompt
```

Each stage can introduce errors. These practices minimize issues at each stage.

## Core Principles

### 1. Clarity Over Speed

Speak clearly at a natural pace. Rushing introduces transcription errors.

**Practice:**
- Pause briefly between sentences
- Articulate technical terms clearly
- Spell out ambiguous terms: "OAuth, that's O-A-U-T-H"

### 2. Structure Your Thoughts

Before speaking, know:
1. **What** you want to do
2. **Where** in the codebase
3. **How** you want it done (if specific)

**Example mental structure:**
> [ACTION] + [TARGET] + [REQUIREMENTS]
> "Add validation to the user form with email and password checks"

### 3. Use Explicit Keywords

OmO recognizes patterns. Using consistent keywords improves command detection.

| Intent | Keywords That Work |
|--------|-------------------|
| Create spec | "specify", "define the feature", "describe requirements for" |
| Plan | "plan", "design", "architect", "create implementation plan" |
| Tasks | "break down", "create tasks", "list the steps" |
| Implement | "implement", "build", "add", "create", "code" |
| Fix | "fix", "resolve", "patch", "correct" |
| Review | "review", "check", "analyze", "audit" |
| Test | "test", "verify", "validate", "write tests for" |
| Research | "find", "search", "look up", "explore", "where is" |
| Think | "think through", "analyze deeply", "reason about" |

## Pattern Library

### Command Invocation Patterns

**For /specify:**
> "I want to specify a new [feature] that does [requirements]"
> "Let's define the requirements for [feature]"
> "Specify: [feature description]"

**For /plan:**
> "Create an implementation plan for this"
> "Let's plan how to build this"
> "Design the architecture for [feature]"

**For /tasks:**
> "Break this down into tasks"
> "Create a task breakdown"
> "What are the steps to implement this"

**For /implement:**
> "Implement [specific thing] in [location]"
> "Build the [component/feature]"
> "Add [functionality] to [file/module]"

**For /review:**
> "Review my changes"
> "Check this code for [security/performance/bugs]"
> "Analyze the implementation in [area]"

**For /create-pr:**
> "Create a pull request"
> "Let's create the PR"
> "Submit this for review"

**For /try-hard:**
> "Think deeply about [problem]"
> "Analyze this decision: [options]"
> "I need to reason through [complex issue]"

### Question Patterns

**Where questions:**
> "Where is [thing] defined"
> "Find the [component/function]"
> "Show me where [thing] is used"

**How questions:**
> "How does [thing] work"
> "Explain the [component/flow]"
> "What's the pattern for [thing]"

**Why questions:**
> "Why is [thing] done this way"
> "What's the reason for [decision]"

### Implementation Patterns

**Adding features:**
> "Add [feature] to [location] with [requirements]"
> "Create a new [component] that [functionality]"
> "Implement [functionality] following [pattern]"

**Fixing bugs:**
> "Fix the bug in [location] where [description]"
> "There's an issue with [thing] - [symptoms]"
> "Resolve the [error type] in [file]"

**Refactoring:**
> "Refactor [code/component] to [improvement]"
> "Clean up [area] by [action]"
> "Restructure [thing] for [benefit]"

### Context Reference Patterns

**Current file:**
> "In this file..."
> "Here in [filename]..."
> "The current function..."

**Selected code:**
> "This code..."
> "The selected [lines/function/block]..."
> "What I've highlighted..."

**Clipboard:**
> "What I copied..."
> "The clipboard content..."
> "This code snippet..."

## Technical Term Pronunciation

### Common Mappings

SuperWhisper's AI post-processing handles these, but speaking clearly helps:

| Spoken | Becomes |
|--------|---------|
| "use state" | `useState` |
| "use effect" | `useEffect` |
| "use memo" | `useMemo` |
| "use ref" | `useRef` |
| "async await" | `async/await` |
| "try catch" | `try/catch` |
| "null check" | `null` check |
| "type of" | `typeof` |
| "instance of" | `instanceof` |

### Spelling Out Terms

When needed, use NATO phonetic alphabet or clear spelling:

> "The variable camelCase, that's C-A-M-E-L case"
> "API key, A-P-I key"

### Symbols and Punctuation

| Say | Gets |
|-----|------|
| "dot" | `.` |
| "arrow" or "arrow function" | `=>` |
| "equals" | `=` |
| "double equals" | `==` |
| "triple equals" | `===` |
| "open paren" | `(` |
| "close paren" | `)` |
| "open bracket" | `[` |
| "close bracket" | `]` |
| "open brace" | `{` |
| "close brace" | `}` |

## Workflow-Specific Tips

### Starting a Feature (Full Workflow)

**Step 1 - Specify:**
> "Let's start a new feature. Specify: user notifications with email and push support, configurable preferences, and batching for high-frequency events"

**Step 2 - Plan:**
> "Create the implementation plan"

**Step 3 - Tasks:**
> "Break this down into tasks"

**Step 4 - Implement:**
> "Start implementing, begin with the core notification service"

### Code Review

**General review:**
> "Review my changes, check for bugs and best practices"

**Security focus:**
> "Review with security focus, check for OWASP top 10 vulnerabilities"

**Performance focus:**
> "Review for performance, identify bottlenecks and optimization opportunities"

### Debugging Session

**Describe the bug:**
> "Debug this issue: users are getting logged out randomly after about 30 minutes even though the token should last an hour"

**With error context:**
> "There's an error in the console saying undefined is not a function, happening in the auth module"

### Deep Analysis

**Architecture decision:**
> "Think through this: should we use a message queue for notifications or implement polling? Consider scale, complexity, and maintenance"

**Trade-off analysis:**
> "Analyze the trade-offs between using GraphQL subscriptions versus WebSockets for real-time updates"

## Common Mistakes to Avoid

### 1. Being Too Vague

**Bad:**
> "fix the thing"

**Good:**
> "fix the null pointer error in the user service getProfile function"

### 2. Mixing Multiple Requests

**Bad:**
> "add auth and also fix the bug in payments and review the cart"

**Good:**
> "add OAuth authentication to the login page"
> (then separately) "fix the payment calculation bug"
> (then separately) "review the cart module"

### 3. Assuming Context

**Bad:**
> "update it to use the new API"

**Good:**
> "update the user service to use the new REST API endpoints instead of the deprecated GraphQL queries"

### 4. Skipping Requirements

**Bad:**
> "add a button"

**Good:**
> "add a submit button to the form that validates inputs before submission and shows a loading state"

## Environment-Specific Tips

### In Terminal/OpenCode TUI

- Commands are executed directly
- Be explicit about slash commands
- Leverage tab completion after voice input

### In VS Code/Cursor

- Selected code is automatically captured
- Reference "this file" or "this function"
- Use Application Context for current editor state

### Mobile (iOS)

- Speak more deliberately (touch keyboards are less forgiving)
- Use shorter, complete thoughts
- Verify transcription before sending

## Practice Exercises

### Exercise 1: Command Mapping

Practice saying these naturally:

1. "Start specifying a user profile feature with avatar upload"
2. "Create the implementation plan for the dashboard"
3. "Break down the auth system into tasks"
4. "Review my changes with a focus on error handling"

### Exercise 2: Technical Terms

Practice these technical phrases:

1. "Add a useState hook for loading state"
2. "Implement an async await pattern with try catch"
3. "Create a useEffect that runs on mount"
4. "Add TypeScript types for the API response"

### Exercise 3: Contextual References

Practice these with code selected:

1. "Refactor this function to use early returns"
2. "Add JSDoc comments to these methods"
3. "Convert this to TypeScript with proper types"
4. "Extract this logic into a custom hook"

## Troubleshooting

### Transcription Issues

| Problem | Solution |
|---------|----------|
| Wrong technical terms | Speak slower, spell if needed |
| Missing words | Pause between phrases |
| Wrong commands | Use explicit keywords |
| Jumbled output | One thought per recording |

### Processing Issues

| Problem | Solution |
|---------|----------|
| Wrong command detected | Use exact command names |
| Too verbose output | Reduce AI temperature |
| Missing context | Enable all context toggles |
| Unclear intent | Start with "I want to..." |

## Related Resources

- [SuperWhisper Integration Guide](./superwhisper-integration.md)
- [Slash Commands Reference](../reference/commands.md)
- [OmO Agent System](../architecture/02-agent-system.md)
