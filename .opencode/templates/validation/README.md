# Template Validation

This directory contains tools to validate that all templates render correctly.

## Files

- `sample-data.yaml` - Sample project data used for template validation
- `validate-templates.ts` - TypeScript validation script

## Running Validation

### Prerequisites

Install dependencies:

```bash
npm install -D tsx yaml
# or
pnpm add -D tsx yaml
```

### Run Validation

```bash
npx tsx .opencode/templates/validation/validate-templates.ts
```

### Expected Output

```
🔍 Template Validation

============================================================
✅ Loaded sample data

📁 Found 25 files to validate

Results:
------------------------------------------------------------
✅ project-context.schema.yaml
✅ project-context.example.yaml
✅ root-AGENTS.md.template
   ⚠️  Unresolved placeholders: {{#unless @last}}
✅ layered/structure.yaml
✅ layered/repositories-AGENTS.md
✅ layered/services-AGENTS.md
...

============================================================
Summary: 25 passed, 0 failed, 0 skipped

✅ All templates validated successfully!
```

## Validation Checks

### YAML Files
- Validates YAML syntax is correct
- Checks for common formatting issues

### Markdown Files
- Checks for starting heading
- Detects empty links
- Finds unclosed code blocks

### Template Files
- Attempts to render with sample data
- Reports unresolved placeholders
- Detects `undefined` or `[object Object]` in output

## Sample Data

The `sample-data.yaml` file provides realistic values for all template variables:

```yaml
project:
  name: "my-awesome-app"
  type: "web-app"
  # ...

tech_stack:
  languages:
    - name: "TypeScript"
      version: "5.3"
  # ...

architecture:
  pattern: "layered"
  layers:
    - name: "controllers"
      path: "src/controllers"
  # ...
```

## Adding New Templates

When adding new templates:

1. Use Handlebars-style syntax: `{{variable}}`
2. Ensure all variables exist in `sample-data.yaml`
3. Run validation to verify template renders correctly
4. Fix any reported warnings or errors

## Common Issues

### Unresolved Placeholders

If you see warnings about unresolved placeholders:

```
⚠️  Unresolved placeholders: {{some.path}}
```

Check that:
- The variable path exists in sample-data.yaml
- The path is spelled correctly (case-sensitive)
- Parent objects exist in the data structure

### Invalid YAML

If a YAML file fails validation:

```
❌ config.yaml
   YAML Error: Unexpected token at line 5
```

Check for:
- Missing quotes around strings with special characters
- Incorrect indentation
- Duplicate keys

