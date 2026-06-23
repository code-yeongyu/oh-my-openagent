import type { BuiltinSkill } from "../types"

export const DSL_TEXTX_ECOSYSTEM_SKILL_NAME = "dsl-textx-ecosystem"

const DSL_TEXTX_ECOSYSTEM_SKILL_DESCRIPTION =
  "textX ecosystem: registration system (entry points, textx_languages/textx_generators), generator framework (textx generate CLI, Jinja2, GeneratorParam), multi-file models (ModelRepository, FQNImportURI), language composition (grammar extension, multi-metamodel), visualization (dot/PlantUML), textX-LS. Triggers: 'textx generate', 'textx_languages', 'entry points', 'multi-file model', 'language composition', 'textX-LS'."

export const dslTextxEcosystemSkill: BuiltinSkill = {
  name: DSL_TEXTX_ECOSYSTEM_SKILL_NAME,
  description: DSL_TEXTX_ECOSYSTEM_SKILL_DESCRIPTION,
  template: `# textX Ecosystem — Advanced Features Reference

## REGISTRATION SYSTEM (Plugin Discovery)

textX uses Python entry points for language/generator discovery — enabling a plug-and-play ecosystem.

### Entry Point Groups

| Group | Purpose | CLI Command |
|-------|---------|-------------|
| \`textx_languages\` | Register a DSL and its metamodel | \`textx list-languages\` |
| \`textx_generators\` | Register a code generator for a language/target pair | \`textx list-generators\` |

### Registering a Language

**pyproject.toml:**
\`\`\`toml
[project.entry-points.textx_languages]
entity = "entity.metamodel:entity_lang"
\`\`\`

**Language function (using decorator):**
\`\`\`python
from textx import language

@language('entity', '*.ent')
def entity_lang():
    """Entity language for data modeling."""
    from textx import metamodel_from_file
    mm = metamodel_from_file('entity.tx')
    # Register scope providers, obj_processors, custom classes here
    return mm
\`\`\`

### Registering a Generator

**pyproject.toml:**
\`\`\`toml
[project.entry-points.textx_generators]
entity_java = "entity.generators:entity_java_gen"
\`\`\`

**Generator function (using decorator):**
\`\`\`python
from textx import generator

@generator('entity', 'java')
def entity_java_gen(metamodel, model, output_path, overwrite, debug, **custom_args):
    """Generate Java classes from Entity models."""
    # Generation logic here
    pass
\`\`\`

### Accessing Registered Languages/Generators

\`\`\`python
from textx import metamodel_for_language, language_descriptions, generator_descriptions

# Get metamodel for a registered language
mm = metamodel_for_language('entity')

# List all registered languages
for name, desc in language_descriptions().items():
    print(f"{name}: {desc.pattern} -> {desc.project_name}")

# List all registered generators
for name, desc in generator_descriptions().items():
    print(f"{name}: {desc.language} -> {desc.target}")
\`\`\`

---

## GENERATOR FRAMEWORK

### \`textx generate\` CLI

\`\`\`bash
# Generate Java from an entity model
textx generate mymodel.ent --target java --output-path src/

# Generate with custom parameters
textx generate mymodel.ent --target java --project_name MyApp

# Generate visualization (built-in)
textx generate mylang.tx --target dot
textx generate mylang.tx --target plantuml
\`\`\`

### Generator with Custom Parameters

\`\`\`python
from textx import generator
from textx.registration import GeneratorParam

@generator('entity', 'java', [
    GeneratorParam('project_name', 'Name of the Java project', 'MyProject'),
    GeneratorParam('package', 'Java package name', 'com.example'),
])
def entity_java_gen(metamodel, model, output_path, overwrite, debug, **custom_args):
    project_name = custom_args.get('project_name', 'MyProject')
    package = custom_args.get('package', 'com.example')
    # ... Jinja2 template rendering
\`\`\`

### Jinja2 Integration Pattern

\`\`\`python
from jinja2 import Environment, FileSystemLoader
import os

@generator('entity', 'python')
def entity_python_gen(metamodel, model, output_path, overwrite, debug, **custom_args):
    env = Environment(
        loader=FileSystemLoader(os.path.join(os.path.dirname(__file__), 'templates')),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template('entity.py.jinja2')

    for entity in model.entities:
        rendered = template.render(entity=entity, model=model)
        out_file = os.path.join(output_path, f"{entity.name.lower()}.py")

        if not overwrite and os.path.exists(out_file):
            continue

        os.makedirs(os.path.dirname(out_file), exist_ok=True)
        with open(out_file, 'w') as f:
            f.write(rendered)
\`\`\`

---

## MULTI-FILE MODELS

### ModelRepository & FQNImportURI

Enable \`import "other_file.model"\` syntax in your DSL:

\`\`\`python
from textx import metamodel_from_str
from textx.scoping.providers import FQNImportURI

grammar = """
Model: imports+=Import elements+=Entity;
Import: 'import' importURI=STRING;
Entity: 'entity' name=ID '{' attrs+=Attribute '}';
Attribute: name=ID ':' type=[Entity];
"""

mm = metamodel_from_str(grammar)
mm.register_scope_providers({
    '*.*': FQNImportURI()
})

# Parse — FQNImportURI resolves paths relative to the importing file
model = mm.model_from_file('main.ent')
# Imported entities are now resolvable as cross-references
\`\`\`

### Scope Providers for Multi-File

| Provider | Use Case |
|----------|----------|
| \`FQNImportURI()\` | Resolve imports via URI strings in grammar |
| \`FQNGlobalRepo()\` | Global repository — all models share one namespace |
| \`PlainNameImportURI()\` | Simple name-based imports (no FQN) |
| \`RelativeName(path, attr, name_attr)\` | Relative scoping within object graph |

---

## LANGUAGE COMPOSITION

### Grammar Extension (Inheritance)

Extend an existing grammar with new rules:

\`\`\`python
# base_lang.tx
BaseModel: elements+=Element;
Element: name=ID;

# extended_lang.tx (imports base)
import base_lang

ExtendedModel: BaseModel elements+=TypedElement;
TypedElement: Element ':' type=ID;
\`\`\`

### Multi-Metamodel (Grammar Referencing)

Two distinct DSLs referencing each other:

\`\`\`
// types.tx — registered as 'types' language
reference types as t

Model:
    entries+=Entry;
Entry:
    'entry' name=ID ':' type=[t.Type];  // cross-reference to types language
\`\`\`

**API Setup:**
\`\`\`python
from textx import metamodel_from_file
from textx.scoping import GlobalModelRepository

# Both metamodels share the same global repository
repo = GlobalModelRepository()
mm_types = metamodel_from_file('types.tx', global_repository=repo)
mm_entries = metamodel_from_file('entries.tx', global_repository=repo)
\`\`\`

---

## VISUALIZATION

### CLI Commands

\`\`\`bash
# Metamodel → GraphViz dot
textx generate mylang.tx --target dot

# Model → GraphViz dot
textx generate mymodel.mylang --grammar mylang.tx --target dot

# Metamodel → PlantUML
textx generate mylang.tx --target plantuml
\`\`\`

### Programmatic Export

\`\`\`python
from textx.export import metamodel_export, model_export, PlantUmlRenderer

# Export metamodel to PlantUML
metamodel_export(mm, 'metamodel.pu', renderer=PlantUmlRenderer())

# Export metamodel to GraphViz
metamodel_export(mm, 'metamodel.dot')

# Export model instance to GraphViz
model_export(model, 'model_instance.dot')
\`\`\`

---

## textX-LS (Language Server)

**Project:** \`textX/textX-LS\`

Provides LSP support for any textX-based DSL:
- Code completion
- Go to definition
- Find all references
- Code lens
- Diagnostics

**Scaffold VS Code extension:**
\`\`\`bash
textx generate mylang.tx --target vscode
# Generates a VS Code extension project with language server configuration
\`\`\``,
}
