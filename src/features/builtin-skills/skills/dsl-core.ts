import type { BuiltinSkill } from "../types"

export const DSL_CORE_SKILL_NAME = "dsl-core"

export const DSL_CORE_SKILL_DESCRIPTION =
  "DSL engineering foundations: expert constraints, framework selection guide, paradigm coverage, and anti-patterns. Load alongside domain-specific DSL skills (dsl-grammar, dsl-codegen, dsl-metamodel, dsl-tooling). Triggers: 'DSL', 'domain-specific language', 'language design'."

export const dslCoreSkill: BuiltinSkill = {
  name: DSL_CORE_SKILL_NAME,
  description: DSL_CORE_SKILL_DESCRIPTION,
  template: `# DSL Engineering — Core Principles

## EXPERT CONSTRAINTS (MANDATORY — ALL DSL MODES)

<critical_constraints>
These constraints are MANDATORY for every DSL engineering task. Violating any is a design failure.

### 1. FORMAL GRAMMAR FIRST
- ALWAYS define the formal grammar (BNF/EBNF/PEG) BEFORE any implementation code
- Grammar is the specification. Implementation follows specification.
- If asked to "just write the parser," STILL produce the grammar first
- Grammar must be complete, unambiguous, and documented
- Include example programs that exercise each grammar production

### 2. SOUND TYPE SYSTEMS
- Every DSL MUST have a well-defined type system, even if minimal
- NEVER design untyped or weakly-typed DSLs without explicit justification from the user
- Type errors must be caught statically where possible
- Document type rules formally (inference rules or precise plain-English equivalents)
- Consider: what types exist, how they compose, what conversions are valid

### 3. COMPOSABILITY
- DSL constructs MUST be composable — expressions nest, statements combine, modules import
- AVOID monolithic language constructs that cannot be combined or extended
- Design for extension: new constructs should integrate without breaking existing ones
- Prefer small, orthogonal language features over large, entangled ones
- Test composability: can any two features be used together without surprise?

### 4. ERROR REPORTING PRIORITY
- User-friendly error messages are a FIRST-CLASS requirement, not an afterthought
- Parsers MUST implement error recovery (synchronization points, panic mode, error productions)
- Error messages must include: source location, what was expected, what was found, and a suggestion
- Design grammar with error productions for common mistakes (missing semicolons, mismatched brackets)
- Never expose parser internals in error messages — translate to domain terms

### 5. INCREMENTAL PARSING
- Design for IDE integration FROM DAY ONE — not as a retrofit
- Grammar structure must support incremental/partial parsing
- Consider tree-sitter compatibility in grammar design decisions
- Partial or incomplete input must not crash the parser — graceful degradation
- Document recovery points where the parser can resynchronize after errors
</critical_constraints>

## FRAMEWORK SELECTION GUIDE

### Primary (Python Ecosystem)

| Tool | Best For | Key Strengths |
|------|----------|---------------|
| **textX** | Rapid DSL prototyping, metamodel-driven development | Python-native, grammar IS the metamodel, built-in scoping/linking |
| **PyEcore** | EMF-compatible metamodeling, model transformations | Eclipse-compatible, M2M transforms, OCL-style constraints |
| **ANTLR4** | Industrial-strength parsing, multi-language targets | Mature ecosystem, ALL(*) parsing, extensive tooling, grammar repository |

### Secondary

| Tool | Best For | Key Strengths |
|------|----------|---------------|
| **Tree-sitter** | Incremental parsing, syntax highlighting, editor integration | Blazing fast, error-tolerant, used by Neovim/Helix/Zed |
| **Langium** | TypeScript-based DSL workbench, web-first languages | LSP built-in, monaco editor integration, grammar-first |
| **Chevrotain** | JavaScript/TypeScript parser building without codegen | No build step, good error messages, CST/AST separation |

### Quick Selection
- **Rapid prototyping + Python**: textX (grammar = metamodel, instant)
- **Production parser + multi-language targets**: ANTLR4 (battle-tested, widest adoption)
- **Editor integration priority**: Tree-sitter (highlighting) + Langium (full LSP)
- **JavaScript/TypeScript ecosystem**: Chevrotain (simple) or Langium (full workbench)
- **EMF/Eclipse ecosystem compatibility**: PyEcore (faithful EMF port)
- **Full DSL workbench with validation**: textX + PyEcore combination
- **Internal DSL in Python**: Metaclasses + operator overloading + decorators

## PARADIGM COVERAGE

### External DSLs (Custom Syntax)
- Custom grammar → custom parser → custom AST → custom tooling
- Full control over syntax and semantics
- Requires parser infrastructure: grammar definition, lexer, parser, AST, error handling
- Best for: domain experts who need specialized notation divorced from host language

### Internal/Embedded DSLs (Host Language)
- Fluent APIs with method chaining and builder patterns
- Decorators and metaclasses (Python) for declarative syntax
- Operator overloading for domain-specific notation
- Context managers for scoped language constructs
- Best for: developers who want DSL benefits without the parser/tooling overhead

## ANTI-PATTERNS (NEVER DO)

| Anti-Pattern | Why It's Wrong |
|-------------|----------------|
| Skip grammar, jump to parser code | Specification-first is non-negotiable |
| Untyped DSL without justification | Type errors caught late = user frustration |
| No error recovery in parser | First syntax error = useless tool |
| Monolithic grammar (one giant rule) | Uncomposable, unmaintainable |
| Parser internals in error messages | "Expected TOKEN_LBRACE" means nothing to users |
| Ignoring IDE integration | DSL without editor support = adoption failure |
| Template-only code generation | No source maps = undebuggable output |`,
}
