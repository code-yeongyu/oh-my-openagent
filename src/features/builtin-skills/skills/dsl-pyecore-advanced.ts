import type { BuiltinSkill } from "../types"

export const DSL_PYECORE_ADVANCED_SKILL_NAME = "dsl-pyecore-advanced"

const DSL_PYECORE_ADVANCED_SKILL_DESCRIPTION =
  "Advanced PyEcore: serialization (XMI/JSON, ResourceSet, URI), dynamic vs static metamodels (DynamicEPackage, pyecoregen), notifications (EObserver), @EMetaclass decorator, loading .ecore files, EMF interchange, executable models. Triggers: 'XMI', 'ResourceSet', 'pyecoregen', 'DynamicEPackage', 'EObserver', '.ecore', 'EMF interchange'."

export const dslPyecoreAdvancedSkill: BuiltinSkill = {
  name: DSL_PYECORE_ADVANCED_SKILL_NAME,
  description: DSL_PYECORE_ADVANCED_SKILL_DESCRIPTION,
  template: `# PyEcore Advanced — Serialization, Static Metamodels & EMF Interchange

## MODEL SERIALIZATION

### XMI Serialization (Default)

\`\`\`python
from pyecore.resources import ResourceSet, URI
from pyecore.resources.xmi import XMIResource

rset = ResourceSet()

# Save model to XMI
resource = rset.create_resource(URI('model.xmi'))
resource.append(root_element)
resource.save()

# Load model from XMI
resource = rset.get_resource(URI('model.xmi'))
root = resource.contents[0]
\`\`\`

### JSON Serialization

\`\`\`python
from pyecore.resources import ResourceSet, URI
from pyecore.resources.json import JsonResource

rset = ResourceSet()
# Register JSON factory for .json extension
rset.resource_factory['json'] = lambda uri: JsonResource(uri)

# Save as JSON
resource = rset.create_resource(URI('model.json'))
resource.append(root_element)
resource.save()

# Load from JSON
resource = rset.get_resource(URI('model.json'))
root = resource.contents[0]
\`\`\`

### ResourceSet — Managing Multiple Resources

\`\`\`python
from pyecore.resources import ResourceSet, URI

rset = ResourceSet()

# Register metamodel package (required for deserialization)
rset.metamodel_registry[my_package.nsURI] = my_package

# Load multiple related models
r1 = rset.get_resource(URI('types.xmi'))
r2 = rset.get_resource(URI('model.xmi'))
# Cross-references between r1 and r2 are automatically resolved

# In-memory resources (no file backing)
from pyecore.resources.resource import StringURI
resource = rset.create_resource(StringURI('memory://temp'))
resource.append(element)
\`\`\`

### URI Types

| URI Type | Example | Use Case |
|----------|---------|----------|
| \`URI('file.xmi')\` | Local file path | File-based persistence |
| \`StringURI('memory://id')\` | In-memory URI | Testing, temporary models |
| \`HttpURI('https://...')\` | Remote URL | Loading remote metamodels |

---

## DYNAMIC vs STATIC METAMODELS

### Dynamic Metamodels (Runtime)

\`\`\`python
from pyecore.ecore import EPackage, EClass, EAttribute, EString

# Build at runtime — no code generation needed
pkg = EPackage('myLang', nsURI='http://mylang/1.0', nsPrefix='ml')
entity = EClass('Entity')
entity.eStructuralFeatures.append(EAttribute('name', EString))
pkg.eClassifiers.append(entity)

# Instantiate dynamically
obj = entity()  # creates an Entity instance
obj.name = 'Person'
\`\`\`

### DynamicEPackage Utility

\`\`\`python
from pyecore.utils import DynamicEPackage

# Wrap a package for convenient attribute-style access
API = DynamicEPackage(pkg)
entity_instance = API.Entity()
entity_instance.name = 'User'
\`\`\`

### Static Metamodels (Code-Generated via pyecoregen)

\`\`\`bash
# Generate Python code from .ecore file
pyecoregen -e mymetamodel.ecore -o output_dir/

# Generates:
#   output_dir/mylang/__init__.py  — EPackage registration
#   output_dir/mylang/mylang.py    — EClass definitions as Python classes
\`\`\`

**Generated static class example:**
\`\`\`python
from pyecore.ecore import EObject, EAttribute, EReference, EString, EMetaclass

@EMetaclass
class Entity(EObject):
    name = EAttribute(eType=EString)
    attrs = EReference(upper=-1, containment=True)

# Usage — same as any Python class
e = Entity(name='Person')
e.attrs.append(Attribute(name='age'))
\`\`\`

### @EMetaclass Decorator Pattern

\`\`\`python
from pyecore import ecore as Ecore

eClass = Ecore.EPackage(nsURI='http://test/1.0', name='test', nsPrefix='t')

@Ecore.EMetaclass
class A:
    name = Ecore.EAttribute(eType=Ecore.EString)
    children = Ecore.EReference(upper=-1, containment=True)
    parent = Ecore.EReference(eOpposite=children)
    values = Ecore.EAttribute(eType=Ecore.EInt, upper=-1)
\`\`\`

---

## NOTIFICATIONS (Change Tracking)

### EObserver Pattern

\`\`\`python
from pyecore.notification import EObserver, Notification, Kind

class ModelWatcher(EObserver):
    def notifyChanged(self, notif):
        print(f"[{notif.kind.name}] {notif.feature.name}: "
              f"{notif.old} -> {notif.new}")

# Attach observer to an object
watcher = ModelWatcher()
watcher.observe(my_entity)

# Now any change triggers notification
my_entity.name = 'NewName'
# Output: [SET] name: OldName -> NewName
\`\`\`

### Notification Kinds

| Kind | Trigger |
|------|---------|
| \`Kind.SET\` | Single-value attribute/reference changed |
| \`Kind.UNSET\` | Value reset to default |
| \`Kind.ADD\` | Element added to collection |
| \`Kind.REMOVE\` | Element removed from collection |
| \`Kind.ADD_MANY\` | Multiple elements added |
| \`Kind.REMOVE_MANY\` | Multiple elements removed |

---

## LOADING .ECORE FILES (EMF Interchange)

\`\`\`python
from pyecore.resources import ResourceSet, URI

rset = ResourceSet()

# Load an .ecore metamodel
resource = rset.get_resource(URI('MyMetamodel.ecore'))
mm_root = resource.contents[0]  # EPackage

# Register for deserialization of conforming models
rset.metamodel_registry[mm_root.nsURI] = mm_root

# Now load model instances
model_resource = rset.get_resource(URI('mymodel.xmi'))
model_root = model_resource.contents[0]

# Navigate the metamodel
for classifier in mm_root.eClassifiers:
    print(f"EClass: {classifier.name}")
    for feature in classifier.eStructuralFeatures:
        print(f"  {feature.name}: {feature.eType.name}")
\`\`\`

### EMF Compatibility Notes

| Feature | PyEcore | EMF (Java) |
|---------|---------|------------|
| Metamodel format | .ecore (XMI) | .ecore (XMI) — compatible |
| Model format | XMI 2.0 | XMI 2.0 — compatible |
| Code generation | pyecoregen | EMF codegen (Java) |
| OCL constraints | Not built-in (use validators) | Built-in OCL support |
| Model compare | Not built-in | EMF Compare |
| Proxy resolution | Automatic via ResourceSet | Automatic |
| Fragment URIs | Supported (\`#//Entity/attrs.0\`) | Supported |

---

## EXECUTABLE MODELS

PyEcore supports adding behavior directly to model elements:

\`\`\`python
@Ecore.EMetaclass
class StateMachine:
    name = Ecore.EAttribute(eType=Ecore.EString)
    states = Ecore.EReference(upper=-1, containment=True)
    current_state = Ecore.EReference()

    def step(self, event):
        """Execute one step of the state machine."""
        for transition in self.current_state.transitions:
            if transition.trigger == event:
                self.current_state = transition.target
                return self.current_state
        return self.current_state
\`\`\`

### Model Navigation Helpers

\`\`\`python
# Navigate containment tree
for child in root.eAllContents():
    print(child.eClass.name, getattr(child, 'name', ''))

# Find parent
parent = element.eContainer()

# Get all cross-references
for ref in element.eClass.eAllReferences():
    if not ref.containment:
        print(f"Cross-ref: {ref.name} -> {element.eGet(ref)}")
\`\`\``,
}
