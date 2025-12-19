# ADR-003: Governance Hooks

**Status**: Accepted  
**Date**: 2025-12-17  
**Deciders**: Project maintainer

## Context

AI agents need guardrails: enforce standards, maintain audit trail, integrate external systems, prevent mistakes. Need real-time enforcement, not post-hoc review.

## Decision

**Lifecycle Hooks** in the tool execution pipeline with three governance hooks:

1. **Path Validator** (`tool.execute.before`): Block writes to unauthorized paths
2. **Historian** (`tool.execute.after`): Auto-generate changelog from file changes
3. **Linear Injector** (`chat.message`): Inject issue context into prompts

## Rationale

Hooks intercept operations in real-time without modifying agent code. Configurable per-project. Non-invasive extension pattern.

## Consequences

### Positive
- Real-time enforcement (issues caught before they happen)
- Automatic documentation (changelog without manual effort)
- Seamless Linear integration
- Configurable (enable/disable/tune each hook)

### Negative
- Performance overhead per tool call
- More code paths to debug
- Path validator may have false positives

## Alternatives Considered

- **Agent Instructions Only**: Rejected - no enforcement mechanism
- **Post-Hoc Validation**: Rejected - damage already done
- **Separate Service**: Rejected - adds latency and dependency

## Notes

See full ADR: `docs/architecture/decisions/ADR-003-governance-hooks.md`
Source: `src/hooks/governance-*/`
