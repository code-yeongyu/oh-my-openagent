import type { BuiltinSkill } from "../types"

export const DSL_VALIDATION_SKILL_NAME = "dsl-validation"

const DSL_VALIDATION_SKILL_DESCRIPTION =
  "Advanced DSL model validation: OCL-style constraint patterns, well-formedness rules, multiplicity/cardinality checks, referential integrity, invariant specifications, constraint categories (structural/semantic/domain), error reporting strategy. Triggers: 'OCL', 'constraint', 'well-formedness', 'invariant', 'model validation', 'cardinality', 'referential integrity'."

export const dslValidationSkill: BuiltinSkill = {
  name: DSL_VALIDATION_SKILL_NAME,
  description: DSL_VALIDATION_SKILL_DESCRIPTION,
  template: `# DSL Model Validation — Advanced Patterns Reference

## CONSTRAINT CATEGORIES

| Category | What It Checks | When to Check | Example |
|----------|---------------|---------------|---------|
| **Syntactic** | Grammar conformance | During parsing (automatic) | Missing semicolons, unclosed braces |
| **Structural** | Metamodel conformance | After parsing, before semantics | Multiplicity, containment, typing |
| **Semantic** | Domain-specific rules | After structural validation | "No cycles in inheritance", "unique names" |
| **Cross-model** | Inter-model consistency | After all models loaded | "Imported type exists", "interface implemented" |

## textX VALIDATION (obj_processors)

### Basic Pattern

\`\`\`python
from textx import get_location, TextXSemanticError

def validate_entity(entity):
    """Validate an Entity model element."""
    # Rule 1: Entity must have at least one attribute
    if len(entity.attrs) == 0:
        raise TextXSemanticError(
            f"Entity '{entity.name}' must have at least one attribute.",
            **get_location(entity)
        )

    # Rule 2: No duplicate attribute names
    names = [a.name for a in entity.attrs]
    duplicates = [n for n in names if names.count(n) > 1]
    if duplicates:
        raise TextXSemanticError(
            f"Duplicate attribute names in '{entity.name}': {set(duplicates)}",
            **get_location(entity)
        )

mm.register_obj_processors({'Entity': validate_entity})
\`\`\`

### Validation Across Multiple Rules

\`\`\`python
def validate_model(model):
    """Model-level validation — runs after all elements are parsed."""
    # Global uniqueness of entity names
    names = [e.name for e in model.entities]
    if len(names) != len(set(names)):
        dupes = [n for n in names if names.count(n) > 1]
        raise TextXSemanticError(f"Duplicate entity names: {set(dupes)}")

    # Check for circular inheritance
    for entity in model.entities:
        if has_circular_inheritance(entity):
            raise TextXSemanticError(
                f"Circular inheritance detected involving '{entity.name}'",
                **get_location(entity)
            )

mm.register_obj_processors({
    'Model': validate_model,
    'Entity': validate_entity,
})
\`\`\`

## OCL-STYLE CONSTRAINT PATTERNS

OCL (Object Constraint Language) patterns adapted to Python:

### Invariant Pattern

\`\`\`python
class Invariant:
    def __init__(self, context_type, name, condition, message):
        self.context_type = context_type
        self.name = name
        self.condition = condition   # callable(element) -> bool
        self.message = message       # callable(element) -> str

    def check(self, element):
        if not self.condition(element):
            return ValidationError(
                severity='error',
                context=element,
                rule=self.name,
                message=self.message(element)
            )
        return None

# Define invariants
invariants = [
    Invariant(
        'Entity', 'non_empty_entity',
        condition=lambda e: len(e.attrs) > 0,
        message=lambda e: f"Entity '{e.name}' must have at least one attribute"
    ),
    Invariant(
        'Entity', 'unique_attr_names',
        condition=lambda e: len(e.attrs) == len({a.name for a in e.attrs}),
        message=lambda e: f"Entity '{e.name}' has duplicate attribute names"
    ),
    Invariant(
        'Attribute', 'valid_type_reference',
        condition=lambda a: a.type is not None,
        message=lambda a: f"Attribute '{a.name}' has unresolved type reference"
    ),
]
\`\`\`

### OCL Collection Operations in Python

| OCL Expression | Python Equivalent |
|---------------|-------------------|
| \`self.attrs->size()\` | \`len(self.attrs)\` |
| \`self.attrs->isEmpty()\` | \`len(self.attrs) == 0\` |
| \`self.attrs->forAll(a \\| a.type <> null)\` | \`all(a.type is not None for a in self.attrs)\` |
| \`self.attrs->exists(a \\| a.name = 'id')\` | \`any(a.name == 'id' for a in self.attrs)\` |
| \`self.attrs->select(a \\| a.required)\` | \`[a for a in self.attrs if a.required]\` |
| \`self.attrs->collect(a \\| a.name)\` | \`[a.name for a in self.attrs]\` |
| \`self.attrs->isUnique(a \\| a.name)\` | \`len(self.attrs) == len({a.name for a in self.attrs})\` |
| \`self.parent->closure(p \\| p.parent)\` | \`get_ancestors(self)\` (recursive) |
| \`Entity.allInstances()\` | \`[e for e in model.eAllContents() if isinstance(e, Entity)]\` |

## WELL-FORMEDNESS RULES

### Multiplicity / Cardinality Checks

\`\`\`python
def check_multiplicity(element, feature_name, min_count, max_count=-1):
    """Validate collection size against multiplicity constraints."""
    collection = getattr(element, feature_name, [])
    count = len(collection) if isinstance(collection, list) else (1 if collection else 0)

    if count < min_count:
        raise ValidationError(
            f"{element.__class__.__name__}.{feature_name}: "
            f"requires at least {min_count}, found {count}"
        )
    if max_count != -1 and count > max_count:
        raise ValidationError(
            f"{element.__class__.__name__}.{feature_name}: "
            f"allows at most {max_count}, found {count}"
        )

# Usage
check_multiplicity(entity, 'attrs', min_count=1)          # 1..*
check_multiplicity(function, 'params', min_count=0, max_count=10)  # 0..10
\`\`\`

### Referential Integrity

\`\`\`python
def check_referential_integrity(model):
    """Ensure all cross-references point to valid targets."""
    errors = []

    # Collect all named elements
    named_elements = {}
    for element in all_contents(model):
        if hasattr(element, 'name'):
            named_elements[element.name] = element

    # Check all references
    for element in all_contents(model):
        for ref_feature in get_reference_features(element):
            target = getattr(element, ref_feature.name)
            if target is None and ref_feature.lowerBound > 0:
                errors.append(f"Unresolved required reference: "
                              f"{element.name}.{ref_feature.name}")
            if isinstance(target, list):
                for t in target:
                    if t not in named_elements.values():
                        errors.append(f"Dangling reference in "
                                      f"{element.name}.{ref_feature.name}")

    return errors
\`\`\`

### Type Compatibility

\`\`\`python
TYPE_HIERARCHY = {
    'int': {'int'},
    'float': {'float', 'int'},        # int is assignable to float
    'string': {'string'},
    'bool': {'bool'},
}

def is_type_compatible(target_type, source_type):
    """Check if source_type can be assigned to target_type."""
    compatible = TYPE_HIERARCHY.get(target_type, set())
    return source_type in compatible

def validate_assignment(assignment):
    if not is_type_compatible(assignment.target.type, assignment.value.type):
        raise TextXSemanticError(
            f"Cannot assign '{assignment.value.type}' to "
            f"'{assignment.target.name}' of type '{assignment.target.type}'",
            **get_location(assignment)
        )
\`\`\`

### Cycle Detection

\`\`\`python
def detect_cycle(start, get_next):
    """Generic cycle detection using DFS."""
    visited = set()
    path = []

    def dfs(node):
        if id(node) in visited:
            cycle_start = next(i for i, n in enumerate(path) if id(n) == id(node))
            return [n.name for n in path[cycle_start:]] + [node.name]
        visited.add(id(node))
        path.append(node)
        next_node = get_next(node)
        if next_node:
            result = dfs(next_node)
            if result:
                return result
        path.pop()
        return None

    return dfs(start)

# Usage: detect inheritance cycles
cycle = detect_cycle(entity, lambda e: e.parent_entity)
if cycle:
    raise TextXSemanticError(f"Circular inheritance: {' -> '.join(cycle)}")
\`\`\`

## VALIDATION FRAMEWORK PATTERN

\`\`\`python
from dataclasses import dataclass
from enum import Enum
from typing import List, Callable, Optional

class Severity(Enum):
    ERROR = 'error'
    WARNING = 'warning'
    INFO = 'info'

@dataclass
class ValidationError:
    severity: Severity
    message: str
    element: object
    rule_name: str
    line: Optional[int] = None
    col: Optional[int] = None

class ValidationContext:
    def __init__(self):
        self.errors: List[ValidationError] = []
        self._rules: dict = {}

    def register(self, context_type: str, severity: Severity = Severity.ERROR):
        def decorator(func):
            self._rules.setdefault(context_type, []).append((func, severity))
            return func
        return decorator

    def validate(self, model) -> List[ValidationError]:
        self.errors = []
        for element in all_contents(model):
            type_name = element.__class__.__name__
            for rule_func, severity in self._rules.get(type_name, []):
                try:
                    rule_func(element, self)
                except Exception as e:
                    self.errors.append(ValidationError(
                        severity=severity, message=str(e),
                        element=element, rule_name=rule_func.__name__
                    ))
        return self.errors

    def error(self, element, rule_name, message):
        self.errors.append(ValidationError(
            Severity.ERROR, message, element, rule_name))

    def warning(self, element, rule_name, message):
        self.errors.append(ValidationError(
            Severity.WARNING, message, element, rule_name))

# Usage
ctx = ValidationContext()

@ctx.register('Entity')
def unique_attrs(entity, ctx):
    names = [a.name for a in entity.attrs]
    dupes = [n for n in names if names.count(n) > 1]
    if dupes:
        ctx.error(entity, 'unique_attrs',
                  f"Duplicate attributes: {set(dupes)}")

@ctx.register('Entity', severity=Severity.WARNING)
def entity_naming(entity, ctx):
    if not entity.name[0].isupper():
        ctx.warning(entity, 'entity_naming',
                    f"Entity '{entity.name}' should start with uppercase")

errors = ctx.validate(model)
for err in errors:
    print(f"[{err.severity.value}] {err.rule_name}: {err.message}")
\`\`\``,
}
