import type { BuiltinSkill } from "../types"

export const DSL_MODEL_TRANSFORMATION_SKILL_NAME = "dsl-model-transformation"

const DSL_MODEL_TRANSFORMATION_SKILL_DESCRIPTION =
  "Model-to-model (M2M) transformations: in-place vs out-place, rule-based mapping, transformation chaining, trace models, ATL-style patterns in Python, motra framework, M2T with Jinja2 best practices. Triggers: 'M2M', 'model transformation', 'ATL', 'motra', 'in-place transformation', 'transformation chain'."

export const dslModelTransformationSkill: BuiltinSkill = {
  name: DSL_MODEL_TRANSFORMATION_SKILL_NAME,
  description: DSL_MODEL_TRANSFORMATION_SKILL_DESCRIPTION,
  template: `# Model Transformations — M2M & M2T Reference

## TRANSFORMATION TAXONOMY

| Type | Direction | Description | Example |
|------|-----------|-------------|---------|
| **M2M (Model-to-Model)** | Model → Model | Transform between metamodels | UML → Relational DB |
| **M2T (Model-to-Text)** | Model → Code | Generate source code/config from model | Entity → Python class |
| **T2M (Text-to-Model)** | Code → Model | Parse text into model (parsing) | Python source → AST model |
| **M2M in-place** | Model → same Model | Modify model destructively | Refactoring, optimization |
| **M2M out-place** | Model → new Model | Create new model from source | Cross-metamodel mapping |

## M2M TRANSFORMATION PATTERNS

### Pattern 1: Rule-Based Mapping (ATL-Style)

The classic ATL pattern translated to Python:

\`\`\`python
class Transformation:
    def __init__(self):
        self.trace = {}  # source -> target mapping

    def transform(self, source_model):
        target_model = TargetRoot()
        # Phase 1: Create target elements (match + create)
        for src_entity in source_model.entities:
            tgt_table = self.entity_to_table(src_entity)
            target_model.tables.append(tgt_table)
        # Phase 2: Resolve references (using trace)
        self._resolve_references()
        return target_model

    def entity_to_table(self, entity):
        table = Table(name=entity.name)
        for attr in entity.attrs:
            col = Column(name=attr.name, type=self.map_type(attr.type))
            table.columns.append(col)
        self.trace[entity] = table  # record trace
        return table

    def _resolve_references(self):
        for src, tgt in self.trace.items():
            for ref in src.references:
                fk = ForeignKey(
                    name=f"fk_{ref.name}",
                    target_table=self.trace[ref.target]
                )
                tgt.foreign_keys.append(fk)
\`\`\`

### Pattern 2: Visitor-Based Transformation

\`\`\`python
class ModelTransformer:
    def __init__(self):
        self._handlers = {}

    def register(self, source_type):
        def decorator(func):
            self._handlers[source_type] = func
            return func
        return decorator

    def transform(self, element):
        handler = self._handlers.get(type(element).__name__)
        if handler:
            return handler(self, element)
        raise ValueError(f"No handler for {type(element).__name__}")

# Usage
tx = ModelTransformer()

@tx.register('Entity')
def entity_rule(self, entity):
    table = Table(name=entity.name)
    table.columns = [self.transform(a) for a in entity.attrs]
    return table

@tx.register('Attribute')
def attr_rule(self, attr):
    return Column(name=attr.name, type=map_type(attr.type))

result = tx.transform(source_entity)
\`\`\`

### Pattern 3: PyEcore motra Framework (Experimental)

\`\`\`python
from pyecore.resources import ResourceSet, URI
from pyecore.notification import EObserver

# motra-style transformation (conceptual — pyecore/experimental/m2m/)
class EObjectProxy:
    """Wraps target objects for lazy reference resolution."""
    def __init__(self, instance):
        self.wrapped = instance
        self.wrapped_eClass = instance.eClass

class TransformationTrace:
    """Records source→target mappings for reference resolution."""
    def __init__(self):
        self._trace = {}

    def record(self, source, target):
        self._trace[id(source)] = target

    def resolve(self, source):
        return self._trace.get(id(source))
\`\`\`

## TRANSFORMATION DESIGN PRINCIPLES

### Two-Phase Execution

| Phase | Purpose | What Happens |
|-------|---------|-------------|
| **Phase 1: Create** | Generate target structure | Walk source model, create target elements, record trace |
| **Phase 2: Resolve** | Wire references | Use trace to connect cross-references in target model |

Why two phases? Cross-references may point to elements not yet created in Phase 1.

### Trace Models

\`\`\`python
class TraceLink:
    """Records the mapping between source and target elements."""
    def __init__(self, source, target, rule_name):
        self.source = source        # source model element
        self.target = target        # target model element
        self.rule_name = rule_name  # which rule produced this

class TraceModel:
    def __init__(self):
        self.links = []

    def add(self, source, target, rule_name):
        self.links.append(TraceLink(source, target, rule_name))

    def find_target(self, source, target_type=None):
        for link in self.links:
            if link.source is source:
                if target_type is None or isinstance(link.target, target_type):
                    return link.target
        return None
\`\`\`

### Transformation Chaining

\`\`\`python
# Chain: Source DSL → Intermediate IR → Target Code
pipeline = [
    DSLToIRTransformation(),      # M2M: DSL model → IR model
    IROptimizer(),                 # M2M in-place: optimize IR
    IRToCodeTransformation(),      # M2T: IR model → source code
]

result = source_model
for step in pipeline:
    result = step.transform(result)
\`\`\`

## M2M IN-PLACE TRANSFORMATIONS

### Refactoring Pattern

\`\`\`python
def inline_single_attribute_entities(model):
    """Refactoring: replace entities with single attribute by their attribute type."""
    to_inline = [e for e in model.entities if len(e.attrs) == 1]

    for entity in to_inline:
        replacement_type = entity.attrs[0].type
        # Update all references pointing to this entity
        for ref in find_all_references_to(model, entity):
            ref.type = replacement_type
        # Remove the entity
        model.entities.remove(entity)
\`\`\`

### Model Optimization Pattern

\`\`\`python
def remove_unreachable_states(state_machine):
    """Remove states not reachable from the initial state."""
    reachable = set()
    queue = [state_machine.initial_state]
    while queue:
        state = queue.pop(0)
        if state not in reachable:
            reachable.add(state)
            for transition in state.transitions:
                queue.append(transition.target)

    unreachable = set(state_machine.states) - reachable
    for state in unreachable:
        state_machine.states.remove(state)
\`\`\`

## M2T BEST PRACTICES (Jinja2)

### Template Organization

\`\`\`
templates/
├── entity.py.jinja2        # One template per target artifact type
├── repository.py.jinja2
├── __init__.py.jinja2
└── macros/
    ├── type_mapping.jinja2  # Shared macros
    └── field_helpers.jinja2
\`\`\`

### Template with Macros

\`\`\`jinja2
{# entity.py.jinja2 #}
{% import 'macros/type_mapping.jinja2' as types %}
from dataclasses import dataclass, field
from typing import Optional, List

@dataclass
class {{ entity.name }}:
    """Generated from {{ entity.name }} entity."""
{% for attr in entity.attrs %}
    {{ attr.name }}: {{ types.python_type(attr.type) }}{{ types.default(attr) }}
{% endfor %}
{% for ref in entity.references %}
{% if ref.upper == -1 %}
    {{ ref.name }}: List['{{ ref.target.name }}'] = field(default_factory=list)
{% else %}
    {{ ref.name }}: Optional['{{ ref.target.name }}'] = None
{% endif %}
{% endfor %}
\`\`\`

### Protected Regions (User Code Preservation)

\`\`\`python
import re

PROTECTED_REGION_RE = re.compile(
    r'# >>> PROTECTED REGION (\\w+)\\n(.*?)# <<< END PROTECTED REGION',
    re.DOTALL
)

def merge_with_protected_regions(generated: str, existing: str) -> str:
    """Preserve user-written code within protected regions."""
    regions = {}
    for match in PROTECTED_REGION_RE.finditer(existing):
        regions[match.group(1)] = match.group(2)

    def replace_region(match):
        name = match.group(1)
        if name in regions:
            return f"# >>> PROTECTED REGION {name}\\n{regions[name]}# <<< END PROTECTED REGION"
        return match.group(0)

    return PROTECTED_REGION_RE.sub(replace_region, generated)
\`\`\``,
}
