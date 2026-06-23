import type { BuiltinSkill } from "../types"

export const DSL_METAMODEL_SKILL_NAME = "dsl-metamodel"

const DSL_METAMODEL_SKILL_DESCRIPTION =
  "Metamodeling for DSLs with textX, PyEcore, and EMF-style tools. Complete textX grammar reference (assignments, rule types, references, modifiers), scoping, validation, model transformations. Triggers: 'metamodel', 'PyEcore', 'EMF', 'model-driven', 'M2M', 'textX', 'Ecore', 'scoping', 'obj_processors'."

export const dslMetamodelSkill: BuiltinSkill = {
  name: DSL_METAMODEL_SKILL_NAME,
  description: DSL_METAMODEL_SKILL_DESCRIPTION,
  template: `# DSL Engineering — Metamodeling & textX Reference

## textX GRAMMAR REFERENCE (Grammar = Metamodel)

In textX, each grammar rule simultaneously defines syntax AND a Python metaclass. Writing a grammar IS defining the metamodel.

### Base Types

| Rule | Matches | Python Type |
|------|---------|-------------|
| \\\`ID\\\` | Identifier (\\\`[^\\\\d\\\\W]\\\\w*\\\\b\\\`) | \\\`str\\\` |
| \\\`INT\\\` | Integer number | \\\`int\\\` |
| \\\`FLOAT\\\` | Floating point (superset of INT) | \\\`float\\\` |
| \\\`STRICTFLOAT\\\` | Float only (requires \\\`.\\\` or \\\`e\\\`) | \\\`float\\\` |
| \\\`NUMBER\\\` | STRICTFLOAT or INT | \\\`float\\\` or \\\`int\\\` |
| \\\`BOOL\\\` | \\\`true\\\` or \\\`false\\\` | \\\`bool\\\` |
| \\\`STRING\\\` | Quoted string | \\\`str\\\` |
| \\\`BASETYPE\\\` | Any base type | varies |

### Assignment Operators (CRITICAL — Defines Metamodel Attributes)

| Operator | Syntax | Semantics | Attribute Type |
|----------|--------|-----------|----------------|
| **Plain** \\\`=\\\` | \\\`name=ID\\\` | Match once, assign | Single value |
| **Boolean** \\\`?=\\\` | \\\`abstract?='abstract'\\\` | True if matched, False otherwise | \\\`bool\\\` |
| **Zero-or-more** \\\`*=\\\` | \\\`items*=Item\\\` | Match 0+ times, collect in list | \\\`list\\\` |
| **One-or-more** \\\`+=\\\` | \\\`items+=Item\\\` | Match 1+ times, collect in list | \\\`list\\\` (non-empty) |

### References (Match vs Link)

\`\`\`
// MATCH reference — creates CONTAINED child object (parent-child)
Entity: 'entity' name=ID '{' attrs+=Attribute '}';
Attribute: name=ID ':' type=ID;
// Each Attribute instance has .parent set to its Entity

// LINK reference — cross-reference to EXISTING object by name (square brackets)
Attribute: name=ID ':' type=[Entity];
// type will be resolved to the Entity object whose name matches
// Default: matches by 'name' attribute using ID rule

// Link with custom match rule:
Attribute: name=ID ':' type=[Entity:FQN];
FQN: ID+['.'];
// Now type is matched by FQN rule, e.g., 'package.MyEntity'
\`\`\`

### Rule Types

**Common rules** — have assignments → create Python objects with attributes:
\`\`\`
Person: name=ID age=INT;  // Creates Person class with name, age attrs
\`\`\`

**Abstract rules** — no assignments, ordered choice of other rules → generalization:
\`\`\`
Statement: IfStmt | WhileStmt | Assignment;  // Never instantiated directly
\`\`\`

**Match rules** — no assignments, no common/abstract references → return base Python types:
\`\`\`
Direction: 'north' | 'south' | 'east' | 'west';  // Returns str
Value: INT | FLOAT | STRING;  // Returns int, float, or str
\`\`\`

### Repetition Modifiers

\`\`\`
// Separator — match items separated by delimiter
params+=Param[',']           // one-or-more Params separated by commas
values*=INT[',']             // zero-or-more INTs separated by commas
names+=ID[/;|,/]             // separated by ; or , (regex separator)

// End-of-line termination — stop repetition at newline
commands+=Command[eolterm]   // match commands only within current line

// Combined
tags*=STRING[',', eolterm]   // comma-separated strings, single line only
\`\`\`

### Rule Modifiers

\`\`\`
// Disable whitespace skipping (for tokens that must not contain spaces)
FQN[noskipws]: ID+['.'];    // 'a.b.c' matches, 'a . b' does NOT

// Custom whitespace definition
CSVLine[ws='\\n']: fields+=Field[','];  // only newlines count as whitespace
\`\`\`

### Syntactic Predicates (Lookahead)

\`\`\`
// Negative lookahead — match only if NOT followed by pattern
Keyword: 'if' | 'else' | 'while' | 'return';
MyID: !Keyword ID;           // match ID only if it's not a keyword

// Positive lookahead — match only if followed by pattern
AbeforeB: a='a' &'b';       // match 'a' only when followed by 'b'
\`\`\`

### Unordered Group (#) — Match Elements in Any Order

\`\`\`
Modifier: (static?='static' final?='final' visibility=Visibility)#;
Visibility: 'public' | 'private' | 'protected';
// Matches: 'public', 'static public', 'final private static', etc.
\`\`\`

### Match Suppression (-) — Discard Matched Content

\`\`\`
QuotedID: '"'?- ID '"'?-;   // optional quotes are parsed but discarded from result
\`\`\`

### Grammar Comments and Language Comments

\`\`\`
// Grammar comments: // line comment, /* block comment */

// To support comments in YOUR DSL, define a special Comment rule:
Comment: /\\\\/\\\\/.*$/;                    // C-style line comments
Comment: /\\\\/\\\\*[\\\\s\\\\S]*?\\\\*\\\\//;        // C-style block comments
// textX automatically tries Comment between every match
\`\`\`

### Grammar Modularization

\`\`\`
import expressions           // imports expressions.tx from same directory
import common.types          // imports types.tx from common/ subdirectory

// Fully qualified references to avoid ambiguity:
MyRule: value=common.types.TypeRef;
\`\`\`

---

## textX PYTHON API

### Creating and Using Metamodels

\`\`\`python
from textx import metamodel_from_file, metamodel_from_str

# Load grammar → get metamodel
mm = metamodel_from_file('my_lang.tx')

# Parse input → get model
model = mm.model_from_file('program.mylang')
model = mm.model_from_str('let x = 42;')

# Access model objects
for decl in model.declarations:
    print(decl.name, decl.__class__.__name__)
\`\`\`

### obj_processors — Semantic Validation

\`\`\`python
def check_entity(entity):
    if len(entity.attrs) == 0:
        raise TextXSemanticError(f"Entity '{entity.name}' must have at least one attribute", **get_location(entity))
    names = [a.name for a in entity.attrs]
    if len(names) != len(set(names)):
        raise TextXSemanticError(f"Duplicate attribute names in '{entity.name}'", **get_location(entity))

mm = metamodel_from_file('entity.tx')
mm.register_obj_processors({'Entity': check_entity})
\`\`\`

### scope_providers — Custom Name Resolution

\`\`\`python
from textx.scoping.providers import FQN, RelativeName, PlainName
from textx.scoping import ModelRepository

mm = metamodel_from_file('my_lang.tx')
mm.register_scope_providers({
    '*.*': FQN(),                           # fully qualified names everywhere
    'Import.module': PlainName(),           # plain names for imports
    'FieldRef.field': RelativeName('obj.type', 'attrs', 'name'),  # relative scoping
})
\`\`\`

### Custom Classes — Add Behavior to Model Objects

\`\`\`python
class Entity:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
    def all_attrs(self):
        # Include inherited attributes
        result = list(self.attrs)
        if self.parent_entity:
            result = self.parent_entity.all_attrs() + result
        return result

mm = metamodel_from_file('entity.tx', classes=[Entity])
\`\`\`

---

## PyEcore-SPECIFIC PATTERNS

\`\`\`python
from pyecore.ecore import EPackage, EClass, EAttribute, EReference, EEnum
from pyecore.ecore import EString, EInt, EBoolean

# Define metamodel programmatically
pkg = EPackage('myLang')
entity_cls = EClass('Entity')
entity_cls.eStructuralFeatures.append(EAttribute('name', EString))
entity_cls.eStructuralFeatures.append(EAttribute('abstract', EBoolean, default_value=False))
attr_cls = EClass('Attribute')
attr_cls.eStructuralFeatures.append(EAttribute('name', EString))
entity_cls.eStructuralFeatures.append(EReference('attrs', attr_cls, upper=-1, containment=True))
attr_cls.eStructuralFeatures.append(EReference('type', entity_cls))  # cross-reference
pkg.eClassifiers.extend([entity_cls, attr_cls])
\`\`\`

Key patterns:
- \\\`EReference(containment=True)\\\` → parent owns children (composition)
- \\\`EReference(containment=False)\\\` → cross-reference (association)
- \\\`upper=-1\\\` → unbounded multiplicity (0..*)
- \\\`EEnum\\\` → fixed value sets
- \\\`EValidator\\\` → OCL-style constraint checking
- \\\`EAdapter\\\` → change notification
- \\\`EResource\\\` → serialization (XMI or JSON)`,
}
