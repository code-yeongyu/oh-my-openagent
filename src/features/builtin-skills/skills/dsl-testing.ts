import type { BuiltinSkill } from "../types"

export const DSL_TESTING_SKILL_NAME = "dsl-testing"

const DSL_TESTING_SKILL_DESCRIPTION =
  "DSL testing patterns: grammar parsing tests, semantic validation testing (TextXSyntaxError/TextXSemanticError), code generator golden-file testing, property-based testing with Hypothesis, model roundtrip testing, test organization. Triggers: 'test grammar', 'test parser', 'test generator', 'golden file', 'roundtrip test', 'DSL test'."

export const dslTestingSkill: BuiltinSkill = {
  name: DSL_TESTING_SKILL_NAME,
  description: DSL_TESTING_SKILL_DESCRIPTION,
  template: `# DSL Testing — Comprehensive Patterns Reference

## TEST ORGANIZATION

\`\`\`
tests/
├── test_grammar.py          # Parsing positive/negative cases
├── test_validation.py       # Semantic validation (obj_processors)
├── test_scoping.py          # Cross-reference resolution
├── test_codegen.py          # Generated code correctness
├── test_roundtrip.py        # Parse → serialize → parse consistency
├── fixtures/
│   ├── valid/               # Valid DSL programs
│   │   ├── simple.mylang
│   │   ├── complex.mylang
│   │   └── edge_cases.mylang
│   ├── invalid/             # Programs that should fail
│   │   ├── syntax_error.mylang
│   │   └── semantic_error.mylang
│   └── expected/            # Golden files for codegen
│       ├── simple.py
│       └── complex.py
└── conftest.py              # Shared fixtures (metamodel, etc.)
\`\`\`

## GRAMMAR TESTING (Parsing)

### Shared Fixture (conftest.py)

\`\`\`python
import pytest
from textx import metamodel_from_file

@pytest.fixture(scope='module')
def metamodel():
    mm = metamodel_from_file('mylang.tx')
    # Register scope providers, obj_processors, etc.
    return mm
\`\`\`

### Positive Parsing Tests

\`\`\`python
def test_parse_simple_entity(metamodel):
    """Test that a basic entity definition parses correctly."""
    model = metamodel.model_from_str('''
        entity Person {
            name: string
            age: int
        }
    ''')
    assert len(model.entities) == 1
    assert model.entities[0].name == 'Person'
    assert len(model.entities[0].attrs) == 2

def test_parse_empty_entity(metamodel):
    """Test that an entity with no attributes parses."""
    model = metamodel.model_from_str('entity Empty {}')
    assert model.entities[0].name == 'Empty'
    assert len(model.entities[0].attrs) == 0

def test_parse_from_file(metamodel):
    """Test parsing from fixture files."""
    model = metamodel.model_from_file('tests/fixtures/valid/complex.mylang')
    assert model is not None
\`\`\`

### Negative Parsing Tests (Expected Failures)

\`\`\`python
from textx import TextXSyntaxError

def test_reject_missing_name(metamodel):
    """Entity without a name should fail."""
    with pytest.raises(TextXSyntaxError, match="Expected 'ID'"):
        metamodel.model_from_str('entity { name: string }')

def test_reject_unclosed_brace(metamodel):
    with pytest.raises(TextXSyntaxError):
        metamodel.model_from_str('entity Foo { name: string')

def test_reject_duplicate_keyword(metamodel):
    with pytest.raises(TextXSyntaxError):
        metamodel.model_from_str('entity entity Foo {}')
\`\`\`

## SEMANTIC VALIDATION TESTING

\`\`\`python
from textx import TextXSemanticError

def test_reject_duplicate_attribute_names(metamodel):
    """Entities with duplicate attribute names should fail validation."""
    with pytest.raises(TextXSemanticError, match="Duplicate attribute"):
        metamodel.model_from_str('''
            entity Person {
                name: string
                name: int
            }
        ''')

def test_reject_unresolved_reference(metamodel):
    """Reference to non-existent entity should fail."""
    with pytest.raises(TextXSemanticError, match="Unknown object.*NonExistent"):
        metamodel.model_from_str('''
            entity Person {
                address: NonExistent
            }
        ''')

def test_accept_valid_cross_reference(metamodel):
    """Valid cross-reference should resolve."""
    model = metamodel.model_from_str('''
        entity Address { city: string }
        entity Person { home: Address }
    ''')
    person = model.entities[1]
    assert person.attrs[0].type.name == 'Address'
\`\`\`

## SCOPING TESTS (Multi-File)

\`\`\`python
def test_import_resolves_cross_file_reference(metamodel, tmp_path):
    """Test that imports resolve types across files."""
    types_file = tmp_path / 'types.mylang'
    types_file.write_text('entity Address { city: string }')

    main_file = tmp_path / 'main.mylang'
    main_file.write_text(f'''
        import "{types_file}"
        entity Person {{ home: Address }}
    ''')

    model = metamodel.model_from_file(str(main_file))
    person = model.entities[0]
    assert person.attrs[0].type.name == 'Address'
\`\`\`

## CODE GENERATOR TESTING

### Golden File Testing

\`\`\`python
import os

def test_codegen_entity_to_python(metamodel, generator):
    """Compare generated output against golden file."""
    model = metamodel.model_from_file('tests/fixtures/valid/simple.mylang')
    generated = generator.generate(model)

    golden_path = 'tests/fixtures/expected/simple.py'
    if os.environ.get('UPDATE_GOLDEN'):
        # Update golden files: pytest --env UPDATE_GOLDEN=1
        with open(golden_path, 'w') as f:
            f.write(generated)
    else:
        with open(golden_path) as f:
            expected = f.read()
        assert generated == expected, f"Generated output differs from golden file"

def test_codegen_compiles(metamodel, generator, tmp_path):
    """Test that generated code is syntactically valid."""
    model = metamodel.model_from_file('tests/fixtures/valid/simple.mylang')
    generated = generator.generate(model)
    out_file = tmp_path / 'output.py'
    out_file.write_text(generated)
    compile(generated, str(out_file), 'exec')  # raises SyntaxError if invalid
\`\`\`

### Behavioral Testing (Generated Code Runs Correctly)

\`\`\`python
import importlib.util

def test_generated_code_executes(metamodel, generator, tmp_path):
    model = metamodel.model_from_file('tests/fixtures/valid/simple.mylang')
    generated = generator.generate(model)

    out_file = tmp_path / 'generated_module.py'
    out_file.write_text(generated)

    spec = importlib.util.spec_from_file_location('generated', str(out_file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Test generated classes
    person = module.Person(name='Alice', age=30)
    assert person.name == 'Alice'
\`\`\`

## MODEL ROUNDTRIP TESTING

\`\`\`python
def test_model_roundtrip_xmi(metamodel, rset):
    """Parse → serialize to XMI → deserialize → compare."""
    original = metamodel.model_from_str('entity Foo { bar: string }')

    # Serialize
    resource = rset.create_resource(StringURI('test.xmi'))
    resource.append(original)
    resource.save()

    # Deserialize
    loaded_resource = rset.get_resource(StringURI('test.xmi'))
    loaded = loaded_resource.contents[0]

    # Compare
    assert loaded.entities[0].name == original.entities[0].name
    assert len(loaded.entities[0].attrs) == len(original.entities[0].attrs)
\`\`\`

## PROPERTY-BASED TESTING (Hypothesis)

\`\`\`python
from hypothesis import given, strategies as st

# Strategy: generate random valid DSL programs
entity_name = st.from_regex(r'[A-Z][a-zA-Z]{0,20}', fullmatch=True)
attr_name = st.from_regex(r'[a-z][a-zA-Z]{0,15}', fullmatch=True)
attr_type = st.sampled_from(['string', 'int', 'float', 'bool'])

@st.composite
def entity_program(draw):
    name = draw(entity_name)
    n_attrs = draw(st.integers(min_value=0, max_value=10))
    attrs = []
    used_names = set()
    for _ in range(n_attrs):
        aname = draw(attr_name)
        while aname in used_names:
            aname = draw(attr_name)
        used_names.add(aname)
        atype = draw(attr_type)
        attrs.append(f"    {aname}: {atype}")
    body = '\\n'.join(attrs)
    return f"entity {name} {{\\n{body}\\n}}"

@given(entity_program())
def test_any_valid_entity_parses(metamodel, program):
    """Any well-formed entity program should parse without errors."""
    model = metamodel.model_from_str(program)
    assert model is not None
    assert len(model.entities) == 1
\`\`\`

## TEST COVERAGE CHECKLIST

| Category | What to Test |
|----------|-------------|
| **Syntax** | Every grammar production, edge cases (empty, max-length, unicode) |
| **Negative syntax** | Every common mistake users will make (missing delimiters, typos) |
| **Semantics** | Every obj_processor / validation rule |
| **Scoping** | Name resolution: local, imported, shadowing, circular |
| **Code generation** | Golden file comparison for each template |
| **Compilation** | Generated code compiles in target language |
| **Behavior** | Generated code runs correctly (integration tests) |
| **Roundtrip** | Parse → serialize → parse produces equivalent model |
| **Error messages** | Error messages are user-friendly and include location |`,
}
