import type { BuiltinSkill } from "../types"

export const DSL_CODEGEN_SKILL_NAME = "dsl-codegen"

const DSL_CODEGEN_SKILL_DESCRIPTION =
  "Code generation and transpiler engineering for DSLs. Source analysis, generator architecture (template/AST-walk/IR), multi-target generation, source maps. Triggers: 'code generation', 'transpile', 'compile to', 'emit', 'codegen', 'M2T'."

export const dslCodegenSkill: BuiltinSkill = {
  name: DSL_CODEGEN_SKILL_NAME,
  description: DSL_CODEGEN_SKILL_DESCRIPTION,
  template: `# DSL Engineering — Code Generation & Transpilers

## CODE GENERATION

### Phase C1: Source Analysis

1. Define input AST/model structure
2. Map source constructs to target constructs
3. Identify 1:1 mappings vs complex transformations
4. Plan output formatting strategy

### Phase C2: Generator Architecture

Choose approach:
- **Template-based**: String interpolation with templates (Jinja2, StringTemplate)
- **AST-walking**: Visitor pattern over source AST
- **IR-based**: Source → Intermediate Representation → Target

### Phase C3: Implementation

1. Implement generator with chosen approach
2. Add source map generation for debuggability
3. Handle edge cases (escaping, naming conflicts)
4. Format output code properly (indentation, line breaks)
5. Support multi-target generation if needed

---

## LANGUAGE-SPECIFIC IDIOMATIC REQUIREMENTS

When generating code targeting a specific language, follow these conventions:

**Python**: Type hints, PEP 8, dataclasses for AST nodes, \\\`__repr__\\\` for debugging, context managers where appropriate.
**JavaScript/TypeScript**: ESM modules, strict TypeScript types, no \\\`any\\\`, JSDoc for public API if JS.
**Rust**: Ownership-aware generated code, \\\`enum\\\` for AST variants, \\\`impl Display\\\` for pretty-printing, \\\`thiserror\\\` for errors.
**Java**: Builder pattern where appropriate, sealed interfaces (Java 17+), records for value types, proper exception hierarchy.
**C/C++**: Header/source separation, RAII for resource management, \\\`enum class\\\` for variants, CMake integration.
**Go**: Idiomatic error handling (\\\`error\\\` return), interfaces for AST visitors, \\\`go generate\\\` integration, \\\`stringer\\\` for enums.

For **any other language**: Specify idiomatic conventions explicitly. Research the language's ecosystem conventions before generating.

---

## MULTI-TARGET GENERATION

When generating code for multiple target languages from the same DSL:
1. Define a shared IR (Intermediate Representation) if source constructs don't map 1:1
2. Implement one generator per target language
3. Run generators in parallel when possible
4. Verify cross-target consistency (same DSL input → semantically equivalent output)`,
}
