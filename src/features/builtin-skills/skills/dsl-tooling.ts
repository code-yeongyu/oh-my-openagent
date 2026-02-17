import type { BuiltinSkill } from "../types"

export const DSL_TOOLING_SKILL_NAME = "dsl-tooling"

export const DSL_TOOLING_SKILL_DESCRIPTION =
  "IDE tooling and internal DSL engineering. Tree-sitter grammars, LSP implementation, syntax highlighting, formatters, fluent APIs, builder patterns, decorators. Triggers: 'tree-sitter', 'LSP', 'syntax highlighting', 'IDE support', 'formatter', 'fluent API', 'builder pattern', 'internal DSL', 'embedded DSL'."

export const dslToolingSkill: BuiltinSkill = {
  name: DSL_TOOLING_SKILL_NAME,
  description: DSL_TOOLING_SKILL_DESCRIPTION,
  template: `# DSL Engineering — IDE Tooling & Internal DSLs

## IDE TOOLING

### Phase T1: Requirements Analysis

1. What editor(s) to support?
2. What features needed? (highlighting, completion, diagnostics, refactoring)
3. What's the existing grammar format?

### Phase T2: Grammar Adaptation

For tree-sitter:
- Convert grammar to tree-sitter grammar.js format
- Ensure incremental parsing compatibility
- Define highlighting queries (.scm files)
- Test error recovery with incomplete/malformed input

For LSP:
- Define document symbols (outline view)
- Implement completion providers (context-aware suggestions)
- Add diagnostic reporting (errors, warnings, hints)
- Implement go-to-definition and find-references
- Add hover information (type info, documentation)
- Implement rename refactoring

### Phase T3: Integration

1. Package as editor extension (VS Code, Neovim, etc.)
2. Configure syntax detection (file extensions, first-line patterns)
3. Test with real-world DSL files
4. Document installation and configuration

---

## INTERNAL / EMBEDDED DSLs

### Phase I1: API Design

1. Identify the domain operations to expose
2. Design the fluent interface chain
3. Plan builder pattern structure
4. Design decorator/metaclass usage (Python)

### Phase I2: Implementation

Python-specific patterns:
- Method chaining with \\\`return self\\\`
- \\\`__enter__\\\`/\\\`__exit__\\\` for context managers (scoped constructs)
- \\\`__init_subclass__\\\` or metaclasses for declarative class syntax
- Operator overloading (\\\`__add__\\\`, \\\`__or__\\\`, etc.) for domain notation
- Decorators for aspect-oriented constructs

TypeScript/JavaScript patterns:
- Fluent builder with generics for type-safe chaining
- Tagged template literals for embedded syntax (\\\`sql\\\\\\\`SELECT ...\\\\\\\`\\\`)
- Proxy objects for dynamic property access
- Symbol-based protocols for extensibility

### Phase I3: Validation & Documentation

1. Add runtime validation for constraint checking
2. Generate helpful error messages for misuse
3. Create comprehensive examples showing idiomatic usage
4. Document the DSL "syntax" (available operations, valid combinations)`,
}
