import type { BuiltinSkill } from "../types"

export const DSL_GRAMMAR_SKILL_NAME = "dsl-grammar"

const DSL_GRAMMAR_SKILL_DESCRIPTION =
  "Grammar design and parser implementation for DSLs. Domain analysis, formal grammar (BNF/EBNF/PEG), expression precedence, declaration patterns, error recovery, framework adaptation. Triggers: 'grammar', 'BNF', 'EBNF', 'PEG', 'parser', 'lexer', 'ANTLR', 'textX grammar', 'precedence', 'operator'."

export const dslGrammarSkill: BuiltinSkill = {
  name: DSL_GRAMMAR_SKILL_NAME,
  description: DSL_GRAMMAR_SKILL_DESCRIPTION,
  template: `# DSL Engineering — Grammar Design & Parser Implementation

## PHASE G1: DOMAIN ANALYSIS (MANDATORY — BEFORE ANY GRAMMAR)

\`\`\`
<domain_analysis>
**Domain**: [What domain does this DSL serve?]
**Users**: [Who will write in this DSL? Technical level?]
**Concepts**: [Core domain concepts — nouns → become rules/metaclasses]
**Operations**: [Core operations — verbs → become keywords/operators]
**Relationships**: [How concepts relate → containment vs cross-references]
**Constraints**: [What must always be true → validation rules]
**Existing notations**: [Domain-standard notation to respect?]
</domain_analysis>
\`\`\`

## PHASE G2: FORMAL GRAMMAR

### EBNF Notation Reference

| Notation | Meaning | Example |
|----------|---------|---------|
| \\\`'keyword'\\\` | Literal string match | \\\`'if'\\\`, \\\`'class'\\\` |
| \\\`/regex/\\\` | Regex match | \\\`/[a-zA-Z_]\\\\w*/\\\` |
| \\\`A B\\\` | Sequence (A then B) | \\\`'if' expr 'then' body\\\` |
| \\\`A \\| B\\\` | Ordered choice (PEG) | \\\`'true' \\| 'false'\\\` |
| \\\`A?\\\` | Optional (zero or one) | \\\`('else' body)?\\\` |
| \\\`A*\\\` | Zero or more | \\\`statement*\\\` |
| \\\`A+\\\` | One or more | \\\`param+\\\` |
| \\\`(A B)\\\` | Grouping | \\\`(',' param)*\\\` |

### Expression Grammars — Precedence by Nesting (CRITICAL PATTERN)

The MOST COMMON grammar design problem. Handle operator precedence by nesting rules from LOWEST to HIGHEST precedence. Each level references the next-higher level:

\`\`\`
// Precedence (low→high): or, and, comparison, addition, multiplication, unary, atom
Expression: OrExpr;
OrExpr:     left=AndExpr ('or' right+=AndExpr)*;
AndExpr:    left=CompExpr ('and' right+=CompExpr)*;
CompExpr:   left=AddExpr (op=CompOp right=AddExpr)?;
AddExpr:    left=MulExpr (op+=AddOp right+=MulExpr)*;
MulExpr:    left=UnaryExpr (op+=MulOp right+=UnaryExpr)*;
UnaryExpr:  op=UnaryOp operand=UnaryExpr | atom=Atom;
Atom:       '(' expr=Expression ')' | literal=Literal | ref=[Identifier];

CompOp:  '==' | '!=' | '<' | '>' | '<=' | '>=';
AddOp:   '+' | '-';
MulOp:   '*' | '/' | '%';
UnaryOp: '-' | 'not';
\`\`\`

KEY RULES:
- Lowest precedence = outermost rule (parsed first, binds last)
- Highest precedence = innermost rule (atoms, literals, parenthesized exprs)
- Each level calls the next-higher level as its operand
- Parenthesized expressions restart from the top (\\\`Expression\\\`)

### Declaration & Statement Patterns

\`\`\`
// Top-level structure with multiple declaration types
Program: declarations+=Declaration;
Declaration: TypeDecl | FunctionDecl | ConstDecl;

// Type with fields (containment)
TypeDecl: 'type' name=ID '{' fields+=Field '}';
Field: name=ID ':' type=[TypeDecl];        // cross-reference via [TypeDecl]

// Function with parameters and body
FunctionDecl: 'fn' name=ID '(' params*=Param[','] ')' '->' retType=ID '{' body=Block '}';
Param: name=ID ':' type=ID;
Block: statements+=Statement;

// Statements with keyword prefixes for unambiguous parsing
Statement: LetStmt | ReturnStmt | ExprStmt;
LetStmt: 'let' name=ID '=' value=Expression ';';
ReturnStmt: 'return' value=Expression? ';';
ExprStmt: expr=Expression ';';
\`\`\`

### Common Pitfalls

| Pitfall | Problem | Fix |
|---------|---------|-----|
| Left recursion | \\\`Expr: Expr '+' Term\\\` — infinite loop in PEG/LL | Use precedence nesting pattern above |
| Ambiguous keywords | \\\`ID\\\` matches keywords like \\\`if\\\`, \\\`end\\\` | Use negative lookahead: \\\`!Keyword ID\\\` |
| Greedy repetition | \\\`items*=Item\\\` consumes too much | Add explicit delimiters/terminators |
| Missing separators | \\\`params+=Param\\\` no comma between | Use repetition modifier: \\\`params+=Param[',']\\\` |
| Whitespace in tokens | Token split by spaces | Use \\\`[noskipws]\\\` rule modifier |

## PHASE G3: EXAMPLE PROGRAMS

Write 3+ examples exercising:
1. **Happy path** — all major productions working together
2. **Edge cases** — empty lists, deeply nested expressions, max-length identifiers
3. **Error cases** — missing delimiters, type mismatches, duplicate names (for error message quality)

## PHASE G4: TYPE RULES

Define for every DSL:
- What types exist (primitives, composites, user-defined)
- Type compatibility rules (e.g., int + float → float)
- Assignment compatibility (what can be assigned to what)
- Function/operator signatures and return types
- Type inference rules if applicable

---

## PARSER IMPLEMENTATION

### Framework Adaptation

| Framework | Grammar Format | Key Difference |
|-----------|---------------|----------------|
| **textX** | textX grammar (.tx) | Grammar = metamodel. Rules → Python classes. Assignments → attributes |
| **ANTLR4** | .g4 files | Separate lexer/parser grammars. Visitors/listeners for AST |
| **Chevrotain** | Programmatic (JS/TS) | No codegen. Tokens + parser rules as methods |
| **Tree-sitter** | grammar.js | Incremental. \\\`prec.left()\\\`/\\\`prec.right()\\\` for precedence |

### Error Recovery (MANDATORY)

1. **Synchronization tokens** — semicolons, closing braces, keywords (\\\`let\\\`, \\\`fn\\\`, \\\`type\\\`)
2. **Panic-mode recovery** — on error, skip tokens until sync point, then resume
3. **Error productions** — explicit rules for common mistakes (missing semicolon, unclosed brace)
4. **Error messages** — always include: source location, what was expected, what was found, suggestion
5. **NEVER expose internals** — translate parser jargon to domain terms`,
}
