import type { BuiltinSkill } from "../types"

export const DSL_COMPOSITION_SKILL_NAME = "dsl-composition"

const DSL_COMPOSITION_SKILL_DESCRIPTION =
  "Language composition and DSL evolution: textX multi-metamodel, grammar extension/inheritance, grammar referencing, DSL evolution (grammar versioning, backward compatibility), model migration, multiple concrete syntaxes for one abstract syntax, language embedding. Triggers: 'language composition', 'grammar extension', 'multi-metamodel', 'DSL evolution', 'model migration', 'grammar versioning', 'language embedding'."

export const dslCompositionSkill: BuiltinSkill = {
  name: DSL_COMPOSITION_SKILL_NAME,
  description: DSL_COMPOSITION_SKILL_DESCRIPTION,
  template: `# Language Composition & DSL Evolution — Reference

## LANGUAGE COMPOSITION PATTERNS

### Pattern 1: Grammar Extension (Inheritance)

Extend an existing grammar with new rules while reusing the base:

\`\`\`
// base.tx — Base entity language
Model: entities+=Entity;
Entity: 'entity' name=ID '{' attrs+=Attribute '}';
Attribute: name=ID ':' type=ID;
\`\`\`

\`\`\`
// extended.tx — Adds inheritance to entities
import base

Model: entities+=ExtendedEntity;
ExtendedEntity: 'entity' name=ID ('extends' parent=[ExtendedEntity])?
               '{' attrs+=Attribute '}';
// Attribute rule is inherited from base.tx
\`\`\`

**Key considerations:**
- The extending grammar must re-register obj_processors and scope_providers
- Custom classes from the base are NOT automatically inherited
- Test both base and extended grammars independently

### Pattern 2: Multi-Metamodel (Grammar Referencing)

Two distinct DSLs that reference each other's types:

\`\`\`
// types.tx — Type definitions language
TypeModel: types+=Type;
Type: 'type' name=ID '{' fields+=Field '}';
Field: name=ID ':' primitive=PrimitiveType;
PrimitiveType: 'string' | 'int' | 'float' | 'bool';
\`\`\`

\`\`\`
// services.tx — Service definitions referencing types
reference types as t

ServiceModel: services+=Service;
Service: 'service' name=ID '{' operations+=Operation '}';
Operation: name=ID '(' params*=Param[','] ')' ':' returnType=[t.Type];
Param: name=ID ':' type=[t.Type];
\`\`\`

**Setup:**
\`\`\`python
from textx import metamodel_from_file
from textx.scoping import GlobalModelRepository

# Shared repository for cross-model references
repo = GlobalModelRepository()
mm_types = metamodel_from_file('types.tx', global_repository=repo)
mm_services = metamodel_from_file('services.tx', global_repository=repo)

# Load models — order matters (types first)
types_model = mm_types.model_from_file('my_types.types')
services_model = mm_services.model_from_file('my_services.svc')
# Cross-references from services → types are automatically resolved
\`\`\`

### Pattern 3: Language Embedding

Embed one DSL inside another using textX's multi-file mechanism:

\`\`\`
// host.tx — Host language with embedded expressions
Model: statements+=Statement;
Statement: Assignment | Print;
Assignment: name=ID '=' value=Expression;
Print: 'print' value=Expression;

// Expression is defined in a separate grammar
import expressions
Expression: expressions.Expr;
\`\`\`

### Pattern 4: Aspect-Oriented Language Extension

Add cross-cutting concerns without modifying the base grammar:

\`\`\`python
def add_logging_aspect(metamodel):
    """Add logging validation/transformation as an aspect."""
    original_processors = metamodel._obj_processors.copy()

    def logging_processor(obj):
        # Run original processors first
        for proc in original_processors.get(obj.__class__.__name__, []):
            proc(obj)
        # Add aspect behavior
        if hasattr(obj, 'name'):
            print(f"[LOG] Processed {obj.__class__.__name__}: {obj.name}")

    for cls_name in metamodel._obj_processors:
        metamodel._obj_processors[cls_name] = [logging_processor]
\`\`\`

## COMPOSITION ARCHITECTURE

### When to Use Each Pattern

| Scenario | Pattern | Why |
|----------|---------|-----|
| Adding features to existing DSL | Grammar Extension | Reuses base rules, single metamodel |
| Two independent DSLs sharing types | Multi-Metamodel | Separate concerns, loose coupling |
| DSL within a DSL | Language Embedding | Clean separation, independent evolution |
| Cross-cutting concerns | Aspect-Oriented | Non-invasive, composable |
| Same semantics, different syntax | Multiple Concrete Syntaxes | One metamodel, multiple grammars |

---

## MULTIPLE CONCRETE SYNTAXES

### One Abstract Syntax (Metamodel), Multiple Grammars

\`\`\`python
# The metamodel defines the ABSTRACT syntax
from pyecore.ecore import EPackage, EClass, EAttribute, EReference, EString

pkg = EPackage('stateMachine')
State = EClass('State')
State.eStructuralFeatures.append(EAttribute('name', EString))
Transition = EClass('Transition')
Transition.eStructuralFeatures.append(EAttribute('trigger', EString))
Transition.eStructuralFeatures.append(EReference('target', State))
State.eStructuralFeatures.append(EReference('transitions', Transition, upper=-1, containment=True))

# Concrete Syntax 1: Textual (textX grammar)
textual_grammar = """
StateMachine: states+=State;
State: 'state' name=ID '{' transitions+=Transition '}';
Transition: trigger=ID '->' target=[State];
"""

# Concrete Syntax 2: JSON
json_syntax = {
    "states": [
        {"name": "idle", "transitions": [
            {"trigger": "start", "target": "running"}
        ]},
        {"name": "running", "transitions": [
            {"trigger": "stop", "target": "idle"}
        ]}
    ]
}

# Concrete Syntax 3: YAML
yaml_syntax = """
states:
  - name: idle
    transitions:
      - trigger: start
        target: running
  - name: running
    transitions:
      - trigger: stop
        target: idle
"""

# All three parse into the SAME metamodel instances
\`\`\`

---

## DSL EVOLUTION

### Grammar Versioning Strategy

\`\`\`python
# Version grammar changes with semantic versioning
GRAMMAR_VERSION = '2.0.0'

# Version declaration in grammar
# Model: 'version' version=STRING elements+=Element;

def check_version_compatibility(model):
    model_version = model.version
    major, minor, patch = [int(x) for x in model_version.split('.')]
    curr_major, curr_minor, _ = [int(x) for x in GRAMMAR_VERSION.split('.')]

    if major != curr_major:
        raise TextXSemanticError(
            f"Model version {model_version} incompatible with "
            f"grammar version {GRAMMAR_VERSION}. Major version mismatch."
        )
    if minor > curr_minor:
        raise TextXSemanticError(
            f"Model version {model_version} requires grammar >= {major}.{minor}.0, "
            f"but current grammar is {GRAMMAR_VERSION}"
        )
\`\`\`

### Backward Compatibility Rules

| Change Type | Backward Compatible? | Migration Needed? |
|-------------|---------------------|-------------------|
| Add optional feature | Yes | No |
| Add required feature with default | Yes | No |
| Add new rule (not referenced by existing) | Yes | No |
| Remove feature | **No** | Yes — remove from models |
| Rename feature | **No** | Yes — rename in models |
| Change feature type | **No** | Yes — convert values |
| Change multiplicity (1 → *) | **No** | Yes — wrap in list |
| Add keyword | Depends | If keyword was valid ID: yes |

### Model Migration

\`\`\`python
class ModelMigration:
    """Migrate models between grammar versions."""

    def __init__(self):
        self._migrations = {}

    def register(self, from_version, to_version):
        def decorator(func):
            self._migrations[(from_version, to_version)] = func
            return func
        return decorator

    def migrate(self, model_text, from_version, to_version):
        path = self._find_migration_path(from_version, to_version)
        result = model_text
        for step_from, step_to in zip(path, path[1:]):
            migration = self._migrations.get((step_from, step_to))
            if migration:
                result = migration(result)
        return result

    def _find_migration_path(self, start, end):
        # Simple linear version ordering
        versions = sorted(set(
            v for pair in self._migrations for v in pair
        ))
        start_idx = versions.index(start)
        end_idx = versions.index(end)
        return versions[start_idx:end_idx + 1]

# Usage
migrator = ModelMigration()

@migrator.register('1.0', '2.0')
def migrate_1_to_2(text):
    # v2.0: 'entity' keyword renamed to 'class'
    return text.replace('entity ', 'class ')

@migrator.register('2.0', '3.0')
def migrate_2_to_3(text):
    # v3.0: added mandatory 'version' header
    return f'version "3.0"\\n{text}'

# Migrate from v1.0 to v3.0 (chains through v2.0)
migrated = migrator.migrate(old_model_text, '1.0', '3.0')
\`\`\`

### Grammar Deprecation Pattern

\`\`\`python
import warnings

def deprecated_feature_processor(element):
    """Warn about deprecated grammar features."""
    if hasattr(element, 'old_syntax_flag') and element.old_syntax_flag:
        warnings.warn(
            f"Deprecated syntax at line {get_location(element).get('line')}: "
            f"'old_keyword' is deprecated, use 'new_keyword' instead. "
            f"Will be removed in v3.0.",
            DeprecationWarning,
            stacklevel=2
        )
\`\`\``,
}
