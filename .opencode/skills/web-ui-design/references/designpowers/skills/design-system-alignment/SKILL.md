---
name: design-system-alignment
description: Use when working with or building design systems — tokens, components, naming conventions, theming, or pattern libraries — ensures consistency, accessibility compliance, and systematic thinking
---

# Design System Alignment

A design system is a shared language. When components are consistent, accessible, and well-documented, every new screen starts from a strong foundation. This skill ensures design work aligns with existing systems or builds new ones with the right properties.

## When to Use

- A design system already exists and new work must align with it
- Building new components for an existing system
- Creating a new design system from scratch
- Auditing an existing system for consistency or accessibility
- Defining or modifying design tokens

## Process

### Step 1: Inventory the Existing System

If a design system exists, catalogue:
- **Tokens:** colours, spacing, typography, shadows, borders, motion
- **Components:** what exists, what states are covered, accessibility status
- **Patterns:** common layouts, form patterns, navigation patterns
- **Documentation:** what is documented, what is tribal knowledge
- **Gaps:** what is missing, inconsistent, or broken

If no system exists, document what patterns are already in use (even informally).

### Step 2: Token Architecture

Design tokens are the atoms of the system. Structure them in layers:

**Global tokens** — raw values
```
color-blue-500: #3B82F6
spacing-4: 16px
font-size-base: 1rem
```

**Semantic tokens** — purpose-driven aliases
```
color-primary: {color-blue-500}
color-error: {color-red-600}
spacing-element: {spacing-4}
font-size-body: {font-size-base}
```

**Component tokens** — component-specific overrides
```
button-background: {color-primary}
button-padding: {spacing-3} {spacing-4}
input-border-color: {color-neutral-300}
```

Every token must meet accessibility requirements at the semantic level — if `color-primary` is used for text, it must have sufficient contrast against its background token.

### Step 3: Component Specification

For each component, document:

```markdown
## [Component Name]

**Purpose:** [What this component is for]

**Variants:** [e.g., primary, secondary, ghost, destructive]

**States:** [default, hover, focus, active, disabled, error, loading]

**Accessibility:**
- Role: [ARIA role if not implicit]
- Label: [How it is labelled — visible text, aria-label, aria-labelledby]
- Keyboard: [How to interact via keyboard]
- Screen reader: [What is announced in each state]
- Focus: [Focus indicator style, focus order]

**Tokens used:** [Which design tokens this component references]

**Do:** [Correct usage examples]
**Do not:** [Incorrect usage examples]
```

### Step 4: Naming Conventions

Consistent naming makes a system learnable:

- **Components:** PascalCase for components, kebab-case for tokens
- **Descriptive names:** `AlertDialog` not `Modal2` or `PopupThing`
- **State modifiers:** consistent pattern (e.g., `--disabled`, `--error`, `--active`)
- **Size modifiers:** use a scale (sm, md, lg) or semantic names (compact, comfortable, spacious)

### Step 5: Accessibility Audit

For every component in the system, verify:

| Check | Requirement |
|-------|------------|
| Colour contrast | All text/background pairings meet WCAG AA minimum |
| Keyboard access | Every interactive component is reachable and operable via keyboard |
| Screen reader | Every component announces its role, name, state, and value correctly |
| Focus indicator | Every focusable element has a visible focus ring |
| Touch targets | All interactive elements meet 44x44px minimum |
| Motion | All animations respect prefers-reduced-motion |
| Resize | Components function at 200% zoom |

### Step 6: Document and Communicate

A design system only works if people use it. Ensure:
- Every component has usage documentation with examples
- Accessibility requirements are documented per component, not in a separate "accessibility section"
- Migration guides exist for any changes to existing components
- The system is versioned so consumers know when changes occur

## Integration

- **Called by:** `ui-composition` (when components need to align with a system)
- **Pairs with:** `ui-composition` (visual decisions), `accessible-content` (content patterns within components)
- **Reviewed by:** `designpowers-critique`
